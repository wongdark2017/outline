// @vitest-isolate true
import { randomUUID } from "node:crypto";
import { Day } from "@shared/utils/time";
import Redis from "@server/storage/redis";
import { EmailSigninRequest } from "./EmailSigninRequest";
import type { EmailSigninRequestData } from "./EmailSigninRequest";
import { VerificationCode } from "./VerificationCode";

const redis = Redis.defaultClient;

describe("VerificationCode", () => {
  let request: EmailSigninRequestData;
  let now: number;

  beforeEach(async () => {
    now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);

    // Model one clock for ioredis-mock's rounded wall seconds and hrtime fraction.
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
    await EmailSigninRequest.admit(request);
  });

  afterEach(async () => {
    await redis.del(
      ...Object.values(
        EmailSigninRequest.getKeys(request.teamId, request.email)
      )
    );
    vi.restoreAllMocks();
  });

  it("generates uniformly shaped six-digit strings", () => {
    for (let i = 0; i < 1000; i++) {
      expect(VerificationCode.generate()).toMatch(/^\d{6}$/);
    }
  });

  it("sends only HMAC digests to Redis, including candidate arguments", async () => {
    const spy = vi.spyOn(redis, "eval");
    expect(await VerificationCode.publish(request, "123456")).toEqual({
      published: true,
    });
    expect(
      await VerificationCode.verify(
        request.teamId,
        " user@example.com ",
        "123456"
      )
    ).toBe(true);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("123456");
    const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
    expect(await redis.get(keys.verifier)).toBeNull();
    expect(await redis.get(keys.latest)).toBeNull();
    expect(
      await VerificationCode.verify(request.teamId, request.email, "123456")
    ).toBe(false);
  });

  it("stores a versioned HMAC with only the remaining request TTL", async () => {
    now += 120000;
    expect(await VerificationCode.publish(request, "123456")).toEqual({
      published: true,
    });
    const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
    const stored = await redis.hgetall(keys.verifier);
    expect(JSON.stringify(stored)).not.toContain("123456");
    expect(stored).toEqual({
      version: "1",
      hmac: expect.stringMatching(/^[a-f0-9]{64}$/),
      requestId: request.requestId,
      deadline: String(request.requestedAt + 600000),
    });
    expect(await redis.pttl(keys.verifier)).toBe(480000);
    now = request.requestedAt + 599999;
    expect(await VerificationCode.publish(request, "654321")).toEqual({
      published: true,
    });
    expect(await redis.pttl(keys.verifier)).toBe(1);
    now += 1;
    expect(await VerificationCode.publish(request, "654321")).toEqual({
      published: false,
      reason: "invalid_request",
    });
    expect(
      await VerificationCode.verify(request.teamId, request.email, "654321")
    ).toBe(false);
  });

  it("consumes once and never authorizes a legacy plaintext record", async () => {
    const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
    await redis.set(keys.verifier, "123456");
    expect(
      await VerificationCode.verify(request.teamId, request.email, "123456")
    ).toBe(false);
    await VerificationCode.publish(request, "123456");
    expect(
      await VerificationCode.verify("another-team", request.email, "123456")
    ).toBe(false);
    await redis.del(
      ...Object.values(
        EmailSigninRequest.getKeys("another-team", request.email)
      )
    );
    expect(
      await VerificationCode.verify(request.teamId, request.email, "123456")
    ).toBe(true);
    expect(
      await VerificationCode.verify(request.teamId, request.email, "123456")
    ).toBe(false);
  });

  it("retains five-guess exhaustion across retries and gives an admitted resend a fresh budget", async () => {
    await VerificationCode.publish(request, "123456");
    for (let i = 0; i < 4; i++) {
      expect(
        await VerificationCode.verify(request.teamId, request.email, "000000")
      ).toBe(false);
    }
    expect(await VerificationCode.publish(request, "654321")).toEqual({
      published: true,
    });
    expect(
      await VerificationCode.verify(request.teamId, request.email, "000000")
    ).toBe(false);
    expect(
      await VerificationCode.verify(request.teamId, request.email, "654321")
    ).toBe(false);
    expect(await VerificationCode.publish(request, "222222")).toEqual({
      published: false,
      reason: "attempts_exhausted",
    });
    const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
    expect(await redis.get(keys.attempts)).toBe("5");
    expect(await redis.get(keys.verifier)).toBeNull();

    now += 60000;
    const next = { ...request, requestId: randomUUID(), requestedAt: now };
    expect(await EmailSigninRequest.admit(next)).toBe(true);
    expect(await redis.get(keys.attempts)).toBeNull();
    const previousFailures = Number(await redis.get(keys.failures));
    expect(await VerificationCode.publish(next, "111111")).toEqual({
      published: true,
    });
    for (let i = 0; i < 4; i++) {
      expect(
        await VerificationCode.verify(request.teamId, request.email, "000000")
      ).toBe(false);
    }
    expect(
      await VerificationCode.verify(request.teamId, request.email, "111111")
    ).toBe(true);
    expect(await redis.get(keys.attempts)).toBe("4");
    expect(Number(await redis.get(keys.failures))).toBe(previousFailures + 4);
  });

  it("keeps the same-request attempt TTL until its original deadline", async () => {
    await VerificationCode.publish(request, "123456");
    await VerificationCode.verify(request.teamId, request.email, "000000");
    now += 590000;
    expect(await VerificationCode.publish(request, "654321")).toEqual({
      published: true,
    });
    const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
    expect(await redis.get(keys.attempts)).toBe("1");
    expect(await redis.pttl(keys.attempts)).toBe(10000);
    expect(await redis.pttl(keys.verifier)).toBe(10000);
    for (let i = 0; i < 4; i++) {
      await VerificationCode.verify(request.teamId, request.email, "000000");
    }
    expect(
      await VerificationCode.verify(request.teamId, request.email, "654321")
    ).toBe(false);
    expect(await VerificationCode.publish(request, "111111")).toEqual({
      published: false,
      reason: "attempts_exhausted",
    });
  });

  it("reports atomic skip outcomes without extra Redis reads", async () => {
    const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
    const get = vi.spyOn(redis, "get");
    expect(
      await VerificationCode.publish({ ...request, requestId: "" }, "123456")
    ).toEqual({ published: false, reason: "invalid_request" });
    expect(await VerificationCode.publish(request, "invalid")).toEqual({
      published: false,
      reason: "invalid_request",
    });
    await redis.set(keys.attempts, "5", "PX", 600000);
    expect(await VerificationCode.publish(request, "123456")).toEqual({
      published: false,
      reason: "attempts_exhausted",
    });
    await redis.set(keys.failures, "30", "PX", Day.ms);
    expect(await VerificationCode.publish(request, "123456")).toEqual({
      published: false,
      reason: "daily_locked",
    });
    await redis.set(keys.latest, "superseded", "PX", 600000);
    expect(await VerificationCode.publish(request, "123456")).toEqual({
      published: false,
      reason: "superseded_or_expired",
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("blocks thirty failures for the original fixed 24h window without extension", async () => {
    const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
    for (let i = 0; i < 29; i++) {
      expect(
        await VerificationCode.verify(request.teamId, request.email, "000000")
      ).toBe(false);
    }
    expect(await VerificationCode.isLocked(request.teamId, request.email)).toBe(
      false
    );
    const deadline = now + (await redis.pttl(keys.failures));
    now += 123000;
    await VerificationCode.verify(request.teamId, request.email, "000000");
    expect(await VerificationCode.isLocked(request.teamId, request.email)).toBe(
      true
    );
    const next = { ...request, requestId: randomUUID(), requestedAt: now };
    expect(await EmailSigninRequest.admit(next)).toBe(true);
    expect(await redis.get(keys.attempts)).toBeNull();
    expect(await VerificationCode.publish(next, "123456")).toEqual({
      published: false,
      reason: "daily_locked",
    });
    await VerificationCode.verify(request.teamId, request.email, "123456");
    expect(await redis.get(keys.failures)).toBe("30");
    expect(await redis.pttl(keys.failures)).toBe(deadline - now);
    now = request.requestedAt + Day.ms;
    expect(await VerificationCode.isLocked(request.teamId, request.email)).toBe(
      false
    );
  });

  it("refuses an old worker after resend and preserves newer pointer on consumption", async () => {
    await VerificationCode.publish(request, "123456");
    now += 60000;
    const next = { ...request, requestId: randomUUID(), requestedAt: now };
    await EmailSigninRequest.admit(next);
    expect(
      await VerificationCode.verify(request.teamId, request.email, "123456")
    ).toBe(false);
    expect(await VerificationCode.publish(request, "123456")).toEqual({
      published: false,
      reason: "superseded_or_expired",
    });
    await VerificationCode.publish(next, "654321");
    const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
    await redis.set(keys.latest, "newer-request", "PX", 600000);
    expect(
      await VerificationCode.verify(request.teamId, request.email, "654321")
    ).toBe(true);
    expect(await redis.get(keys.latest)).toBe("newer-request");
    expect(await VerificationCode.publish(next, "654321")).toEqual({
      published: false,
      reason: "superseded_or_expired",
    });
  });

  it("delete preserves counters and Redis failures fail closed", async () => {
    await VerificationCode.publish(request, "123456");
    await VerificationCode.verify(request.teamId, request.email, "000000");
    await VerificationCode.delete(request.teamId, request.email);
    const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
    expect(await redis.get(keys.attempts)).toBe("1");
    expect(await redis.get(keys.failures)).toBe("1");
    vi.spyOn(redis, "eval").mockRejectedValueOnce(new Error("unavailable"));
    await expect(
      VerificationCode.verify(request.teamId, request.email, "123456")
    ).rejects.toThrow("unavailable");
  });
});
