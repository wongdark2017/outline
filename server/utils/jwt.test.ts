// @vitest-isolate true
import { randomUUID } from "node:crypto";
import Redis from "@server/storage/redis";
import { EmailSigninRequest } from "./EmailSigninRequest";
import { hash } from "./crypto";
import { RedisPrefixHelper } from "./RedisPrefixHelper";
import { subMinutes } from "date-fns";
import JWT from "jsonwebtoken";
import type { Context } from "koa";
import { buildUser } from "@server/test/factories";
import { getUserForEmailSigninToken } from "./jwt";

/**
 * Minimal Koa context stub exposing only the request IP.
 */
function buildContext(ip = "127.0.0.1") {
  return { request: { ip } } as unknown as Context;
}

describe("getUserForEmailSigninToken", () => {
  it("should return the user for a valid token", async () => {
    const user = await buildUser();
    const ctx = buildContext();
    const token = user.getEmailSigninToken({
      requestIp: ctx.request.ip,
      requestId: randomUUID(),
      requestedAt: Date.now(),
    });

    const result = await getUserForEmailSigninToken(ctx, token);
    expect(result.id).toEqual(user.id);
  });

  it("should reject a token that was already used", async () => {
    const user = await buildUser();
    const ctx = buildContext();
    const token = user.getEmailSigninToken({
      requestIp: ctx.request.ip,
      requestId: randomUUID(),
      requestedAt: Date.now(),
    });

    await getUserForEmailSigninToken(ctx, token);
    await expect(getUserForEmailSigninToken(ctx, token)).rejects.toThrow(
      "Token has already been used"
    );
  });

  it("should allow only one of several concurrent redemptions", async () => {
    const user = await buildUser();
    const ctx = buildContext();
    const token = user.getEmailSigninToken({
      requestIp: ctx.request.ip,
      requestId: randomUUID(),
      requestedAt: Date.now(),
    });

    const results = await Promise.allSettled([
      getUserForEmailSigninToken(ctx, token),
      getUserForEmailSigninToken(ctx, token),
      getUserForEmailSigninToken(ctx, token),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("should not use a token that fails the IP check", async () => {
    const user = await buildUser();
    const ctx = buildContext();
    const token = user.getEmailSigninToken({
      requestIp: ctx.request.ip,
      requestId: randomUUID(),
      requestedAt: Date.now(),
    });

    await expect(
      getUserForEmailSigninToken(buildContext("10.0.0.1"), token)
    ).rejects.toThrow("Token mismatch");

    const result = await getUserForEmailSigninToken(ctx, token);
    expect(result.id).toEqual(user.id);
  });

  it("redeems an already signed legacy token without runtime legacy generation", async () => {
    const user = await buildUser();
    const ctx = buildContext();
    const token = JWT.sign(
      {
        id: user.id,
        ip: ctx.request.ip,
        createdAt: new Date().toISOString(),
        type: "email-signin",
      },
      user.jwtSecret
    );
    expect((await getUserForEmailSigninToken(ctx, token)).id).toBe(user.id);
    await expect(getUserForEmailSigninToken(ctx, token)).rejects.toThrow(
      "Token has already been used"
    );
  });

  it("should reject an expired token", async () => {
    const user = await buildUser();
    const ctx = buildContext();
    const token = JWT.sign(
      {
        id: user.id,
        ip: ctx.request.ip,
        createdAt: subMinutes(new Date(), 11).toISOString(),
        type: "email-signin",
      },
      user.jwtSecret
    );

    await expect(getUserForEmailSigninToken(ctx, token)).rejects.toThrow(
      "Expired token"
    );
  });

  it("should reject a token signed with another secret", async () => {
    const user = await buildUser();
    const ctx = buildContext();
    const token = JWT.sign(
      {
        id: user.id,
        ip: ctx.request.ip,
        createdAt: new Date().toISOString(),
        type: "email-signin",
      },
      "wrong-secret"
    );

    await expect(getUserForEmailSigninToken(ctx, token)).rejects.toThrow(
      "Invalid token"
    );
  });
});

describe("worker-generated email tokens", () => {
  const ctx = buildContext();
  const redis = Redis.defaultClient;

  afterEach(() => vi.restoreAllMocks());

  it.each(["older-first", "newer-first"])(
    "redeems independent tokens in %s order",
    async (order) => {
      const user = await buildUser();
      const requestedAt = Date.now();
      const requestA = {
        teamId: user.teamId,
        email: user.email ?? "",
        requestId: randomUUID(),
        requestedAt,
      };
      const requestB = { ...requestA, requestId: randomUUID() };
      const tokenA = user.getEmailSigninToken({
        ...requestA,
        requestIp: ctx.request.ip,
      });
      const tokenB = user.getEmailSigninToken({
        ...requestB,
        requestIp: ctx.request.ip,
      });
      const keys = EmailSigninRequest.getKeys(user.teamId, user.email ?? "");
      await redis.set(keys.latest, requestB.requestId, "PX", 600000);
      const first = order === "older-first" ? tokenA : tokenB;
      const second = order === "older-first" ? tokenB : tokenA;
      expect((await getUserForEmailSigninToken(ctx, first)).id).toBe(user.id);
      expect(await redis.get(keys.latest)).toBe(
        order === "older-first" ? requestB.requestId : null
      );
      expect((await getUserForEmailSigninToken(ctx, second)).id).toBe(user.id);
      await expect(getUserForEmailSigninToken(ctx, tokenA)).rejects.toThrow(
        "Token has already been used"
      );
      await redis.del(
        keys.latest,
        RedisPrefixHelper.getEmailSigninTokenKey(hash(tokenA)),
        RedisPrefixHelper.getEmailSigninTokenKey(hash(tokenB))
      );
    }
  );

  it("uses original IP and deadline, allows absent latest, and hashes replay keys", async () => {
    const user = await buildUser();
    const requestedAt = Date.now() - 120000;
    const input = {
      requestIp: ctx.request.ip,
      requestId: randomUUID(),
      requestedAt,
    };
    const token = user.getEmailSigninToken(input);
    expect(JWT.verify(token, user.jwtSecret)).toMatchObject({
      requestedAt,
      requestId: input.requestId,
      createdAt: new Date(requestedAt).toISOString(),
      expiresAt: new Date(requestedAt + 600000).toISOString(),
      ip: ctx.request.ip,
    });
    await expect(
      getUserForEmailSigninToken(buildContext("10.0.0.1"), token)
    ).rejects.toThrow("Token mismatch");
    expect((await getUserForEmailSigninToken(ctx, token)).id).toBe(user.id);
    const marker = RedisPrefixHelper.getEmailSigninTokenKey(hash(token));
    expect(marker).not.toContain(token);
    expect(await redis.get(marker)).toBe("1");
    expect(await redis.pttl(marker)).toBeGreaterThan(478000);
    expect(await redis.pttl(marker)).toBeLessThanOrEqual(482000);
    await redis.del(marker);
  });

  it("creates independently redeemable retry tokens under the same request", async () => {
    const user = await buildUser();
    const input = {
      requestIp: ctx.request.ip,
      requestId: randomUUID(),
      requestedAt: Date.now(),
    };
    const first = user.getEmailSigninToken(input);
    const second = user.getEmailSigninToken(input);
    expect(first).not.toBe(second);
    expect((await getUserForEmailSigninToken(ctx, first)).id).toBe(user.id);
    expect((await getUserForEmailSigninToken(ctx, second)).id).toBe(user.id);
    await redis.del(
      RedisPrefixHelper.getEmailSigninTokenKey(hash(first)),
      RedisPrefixHelper.getEmailSigninTokenKey(hash(second))
    );
  });

  it.each([
    { createdAt: undefined },
    { createdAt: "invalid" },
    { requestId: "incomplete" },
    { requestedAt: "invalid" },
    { expiresAt: "invalid" },
    { expiresAt: new Date(Date.now() + 1200000).toISOString() },
    { jti: "incomplete" },
  ])("rejects malformed signed request metadata %j", async (override) => {
    const user = await buildUser();
    const token = JWT.sign(
      {
        id: user.id,
        ip: ctx.request.ip,
        createdAt: new Date().toISOString(),
        type: "email-signin",
        ...override,
      },
      user.jwtSecret
    );
    await expect(getUserForEmailSigninToken(ctx, token)).rejects.toThrow(
      "Invalid token"
    );
  });

  it.each([-30000, 30000])(
    "issues and redeems with %i ms request-host skew",
    async (skew) => {
      const user = await buildUser();
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      const requestedAt = now + skew;
      const token = user.getEmailSigninToken({
        requestIp: ctx.request.ip,
        requestId: randomUUID(),
        requestedAt,
      });
      expect(JWT.verify(token, user.jwtSecret)).toMatchObject({
        createdAt: new Date(requestedAt).toISOString(),
        expiresAt: new Date(requestedAt + 600000).toISOString(),
      });
      expect((await getUserForEmailSigninToken(ctx, token)).id).toBe(user.id);
      await redis.del(RedisPrefixHelper.getEmailSigninTokenKey(hash(token)));
    }
  );

  it("rejects generation and signed-token future skew beyond thirty seconds", async () => {
    const user = await buildUser();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const input = {
      requestIp: ctx.request.ip,
      requestId: randomUUID(),
      requestedAt: now + 30001,
    };
    expect(() => user.getEmailSigninToken(input)).toThrow(
      "Invalid email sign-in request"
    );
    const token = JWT.sign(
      {
        id: user.id,
        ip: input.requestIp,
        requestId: input.requestId,
        requestedAt: input.requestedAt,
        createdAt: new Date(input.requestedAt).toISOString(),
        expiresAt: new Date(input.requestedAt + 600000).toISOString(),
        jti: randomUUID(),
        type: "email-signin",
      },
      user.jwtSecret
    );
    await expect(getUserForEmailSigninToken(ctx, token)).rejects.toThrow(
      "Invalid token"
    );
  });

  it("rejects redemption at the exact request deadline without a skew extension", async () => {
    const user = await buildUser();
    const requestedAt = Date.now();
    const token = user.getEmailSigninToken({
      requestIp: ctx.request.ip,
      requestId: randomUUID(),
      requestedAt,
    });
    vi.spyOn(Date, "now").mockReturnValue(requestedAt + 600000);
    await expect(getUserForEmailSigninToken(ctx, token)).rejects.toThrow(
      "Expired token"
    );
  });

  it("rejects expired generation metadata and fails closed on Redis errors", async () => {
    const user = await buildUser();
    expect(() =>
      user.getEmailSigninToken({
        requestIp: ctx.request.ip,
        requestId: randomUUID(),
        requestedAt: Date.now() - 600000,
      })
    ).toThrow("Invalid email sign-in request");
    const token = user.getEmailSigninToken({
      requestIp: ctx.request.ip,
      requestId: randomUUID(),
      requestedAt: Date.now(),
    });
    vi.spyOn(redis, "eval").mockRejectedValueOnce(new Error("unavailable"));
    await expect(getUserForEmailSigninToken(ctx, token)).rejects.toThrow(
      "unavailable"
    );
  });
});
