// @vitest-isolate true
import { randomUUID } from "node:crypto";
import Redis from "@server/storage/redis";
import { EmailSigninRequest } from "./EmailSigninRequest";
import type { EmailSigninRequestData } from "./EmailSigninRequest";

const redis = Redis.defaultClient;

describe("EmailSigninRequest", () => {
  let request: EmailSigninRequestData;
  let now: number;

  beforeEach(() => {
    now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);

    // ioredis-mock TIME rounds wall seconds and reads its fraction from hrtime.
    vi.spyOn(Date.prototype, "getTime").mockImplementation(
      () => Math.floor(now / 1000) * 1000
    );
    vi.spyOn(process, "hrtime").mockImplementation(() => [
      0,
      (now % 1000) * 1000000,
    ]);
    request = {
      teamId: randomUUID(),
      email: "User@Example.COM",
      requestId: randomUUID(),
      requestedAt: now,
    };
  });

  afterEach(async () => {
    await redis.del(
      ...Object.values(
        EmailSigninRequest.getKeys(request.teamId, request.email)
      )
    );
    vi.restoreAllMocks();
  });

  it("normalizes team/email keys and admits one common cooldown", async () => {
    expect(await EmailSigninRequest.admit(request)).toBe(true);
    expect(
      await EmailSigninRequest.admit({
        ...request,
        email: " user@example.com ",
        requestId: randomUUID(),
      })
    ).toBe(false);
    const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
    expect(await redis.get(keys.latest)).toBe(request.requestId);
    expect(await redis.pttl(keys.latest)).toBeGreaterThan(599900);
    now += 59999;
    expect(
      await EmailSigninRequest.admit({
        ...request,
        requestId: randomUUID(),
        requestedAt: now,
      })
    ).toBe(false);
    now += 1;
    expect(
      await EmailSigninRequest.admit({
        ...request,
        requestId: randomUUID(),
        requestedAt: now,
      })
    ).toBe(true);
  });

  it("limits common reservations to five in a fixed hour", async () => {
    for (let i = 0; i < 5; i++) {
      expect(
        await EmailSigninRequest.admit({
          ...request,
          requestId: randomUUID(),
          requestedAt: now,
        })
      ).toBe(true);
      now += 60000;
    }
    expect(
      await EmailSigninRequest.admit({ ...request, requestedAt: now })
    ).toBe(false);
    now = request.requestedAt + 3600000;
    expect(
      await EmailSigninRequest.admit({ ...request, requestedAt: now })
    ).toBe(true);
  });

  it("invalidates the prior code, resets challenge attempts and preserves daily failures", async () => {
    const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
    await redis.set(keys.verifier, "old-hmac", "PX", 120000);
    await redis.set(keys.legacyVerifier, "123456", "PX", 120000);
    await redis.set(keys.attempts, "3", "PX", 1000);
    await redis.set(keys.failures, "8", "PX", 800000);
    expect(await EmailSigninRequest.admit(request)).toBe(true);
    expect(await redis.get(keys.verifier)).toBeNull();
    expect(await redis.get(keys.legacyVerifier)).toBeNull();
    expect(await redis.get(keys.attempts)).toBeNull();
    expect(await redis.pttl(keys.attempts)).toBe(-2);
    expect(await redis.get(keys.failures)).toBe("8");
    expect(await redis.pttl(keys.failures)).toBeLessThanOrEqual(800000);
  });

  it("leaves existing verifier/pointer untouched when a resend is suppressed", async () => {
    expect(await EmailSigninRequest.admit(request)).toBe(true);
    const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
    await redis.set(keys.verifier, "old-hmac");
    await redis.set(keys.attempts, "5", "PX", 200000);
    await redis.set(keys.failures, "8", "PX", 400000);
    expect(
      await EmailSigninRequest.admit({ ...request, requestId: randomUUID() })
    ).toBe(false);
    expect(await redis.get(keys.latest)).toBe(request.requestId);
    expect(await redis.get(keys.verifier)).toBe("old-hmac");
    expect(await redis.get(keys.attempts)).toBe("5");
    expect(await redis.pttl(keys.attempts)).toBe(200000);
    expect(await redis.get(keys.failures)).toBe("8");
    expect(await redis.pttl(keys.failures)).toBe(400000);
  });

  it("guards replaced, consumed, expired and missing-identity worker tasks", async () => {
    expect(await EmailSigninRequest.isCurrent(request)).toBe(false);
    await EmailSigninRequest.admit(request);
    expect(await EmailSigninRequest.isCurrent(request)).toBe(true);
    expect(
      await EmailSigninRequest.isCurrent({ ...request, requestId: "" })
    ).toBe(false);
    const next = {
      ...request,
      requestId: randomUUID(),
      requestedAt: now + 60000,
    };
    now += 60000;
    await EmailSigninRequest.admit(next);
    expect(await EmailSigninRequest.isCurrent(request)).toBe(false);
    expect(await EmailSigninRequest.clear(request)).toBe(false);
    expect(await EmailSigninRequest.isCurrent(next)).toBe(true);
    expect(await EmailSigninRequest.clear(next)).toBe(true);
    expect(await EmailSigninRequest.isCurrent(next)).toBe(false);
    now = next.requestedAt + 600000;
    expect(await EmailSigninRequest.isCurrent(next)).toBe(false);
    expect(
      await EmailSigninRequest.admit({ ...request, requestedAt: now - 600000 })
    ).toBe(false);
  });

  it.each([-30000, 30000])(
    "accepts %i ms host skew without moving the request deadline",
    async (skew) => {
      request.requestedAt = now + skew;
      expect(EmailSigninRequest.isValid(request)).toBe(true);
      expect(await EmailSigninRequest.admit(request)).toBe(true);
      expect(await EmailSigninRequest.isCurrent(request)).toBe(true);
      const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
      expect(await redis.pttl(keys.latest)).toBe(600000 + skew);
    }
  );

  it("rejects future drift beyond thirty seconds and expires at the absolute deadline", async () => {
    expect(
      EmailSigninRequest.isValid({ ...request, requestedAt: now + 30001 })
    ).toBe(false);
    expect(
      await EmailSigninRequest.admit({ ...request, requestedAt: now + 30001 })
    ).toBe(false);
    expect(
      EmailSigninRequest.isValid({ ...request, requestedAt: now - 600000 })
    ).toBe(false);
    expect(await EmailSigninRequest.admit(request)).toBe(true);
    now = request.requestedAt + 600000;
    expect(await EmailSigninRequest.isCurrent(request)).toBe(false);
  });

  it("fails closed on Redis failure", async () => {
    vi.spyOn(redis, "eval").mockRejectedValueOnce(new Error("unavailable"));
    await expect(EmailSigninRequest.admit(request)).rejects.toThrow(
      "unavailable"
    );
  });
});
