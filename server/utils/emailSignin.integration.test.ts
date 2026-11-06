// @vitest-isolate true
import { randomUUID } from "node:crypto";
import type RedisAdapter from "@server/storage/redis";
import type {
  EmailSigninRequest,
  EmailSigninRequestData,
} from "./EmailSigninRequest";
import type { VerificationCode } from "./VerificationCode";

const optedIn = process.env.RUN_REDIS_INTEGRATION === "1";
const redisUrl = process.env.REDIS_URL;

describe.skipIf(!optedIn || !redisUrl)(
  "email sign-in real Redis boundaries",
  () => {
    let clients: RedisAdapter[] = [];
    let reachable = false;
    let request: EmailSigninRequestData;
    let Request: typeof EmailSigninRequest;
    let Code: typeof VerificationCode;
    let Adapter: typeof RedisAdapter;

    beforeAll(async () => {
      vi.doUnmock("ioredis");
      vi.resetModules();
      Adapter = (await import("@server/storage/redis")).default;
      Request = (await import("./EmailSigninRequest")).EmailSigninRequest;
      Code = (await import("./VerificationCode")).VerificationCode;
      clients = [0, 1].map(
        () =>
          new Adapter(redisUrl, {
            lazyConnect: true,
            connectTimeout: 500,
            maxRetriesPerRequest: 0,
            retryStrategy: () => null,
            enableOfflineQueue: false,
          })
      );
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(
            clients.map(async (client) => {
              await client.connect();
              await client.ping();
            })
          ),
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Redis probe timeout")),
              1500
            );
          }),
        ]);
        reachable = true;
      } catch {
        clients.forEach((client) => client.disconnect());
      } finally {
        clearTimeout(timeout);
      }
    });

    beforeEach(() => {
      request = {
        teamId: `email-signin-integration-${randomUUID()}`,
        email: "integration@example.invalid",
        requestId: randomUUID(),
        requestedAt: Date.now(),
      };
    });

    afterEach(async () => {
      if (reachable) {
        const client = clients[0];
        if (client) {
          await client.del(
            ...Object.values(Request.getKeys(request.teamId, request.email))
          );
        }
      }
      vi.restoreAllMocks();
    });

    afterAll(() => clients.forEach((client) => client.disconnect()));

    it("consumes exactly once across independent connections", async (context) => {
      const [first, second] = clients;
      if (!reachable || !first || !second) {
        return context.skip(
          "Test Redis unavailable; concurrency was not verified"
        );
      }
      const getter = vi
        .spyOn(Adapter, "defaultClient", "get")
        .mockReturnValue(first);
      expect(await Request.admit(request)).toBe(true);
      expect(await Code.publish(request, "123456")).toEqual({
        published: true,
      });
      getter.mockReturnValueOnce(first).mockReturnValueOnce(second);
      const results = await Promise.all([
        Code.verify(request.teamId, request.email, "123456"),
        Code.verify(request.teamId, request.email, "123456"),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(
        await first.exists(
          Request.getKeys(request.teamId, request.email).verifier
        )
      ).toBe(0);
    });

    it("does not leave an old verifier after concurrent resend admission/publication", async (context) => {
      const [first, second] = clients;
      if (!reachable || !first || !second) {
        return context.skip(
          "Test Redis unavailable; concurrency was not verified"
        );
      }
      const getter = vi
        .spyOn(Adapter, "defaultClient", "get")
        .mockReturnValue(first);
      expect(await Request.admit(request)).toBe(true);
      expect(await Request.isCurrent(request)).toBe(true);
      await Code.publish(request, "111111");
      await Code.verify(request.teamId, request.email, "000000");
      const keys = Request.getKeys(request.teamId, request.email);

      // The old worker is paused after precheck; allow a new admitted resend fixture.
      await first.del(keys.cooldown);
      const next = {
        ...request,
        requestId: randomUUID(),
        requestedAt: Date.now(),
      };
      getter.mockReturnValueOnce(first).mockReturnValueOnce(second);
      const [, admitted] = await Promise.all([
        Code.publish(request, "123456"),
        Request.admit(next),
      ]);
      expect(admitted).toBe(true);
      expect(await first.get(keys.latest)).toBe(next.requestId);
      expect(await first.exists(keys.verifier)).toBe(0);
      expect(await first.exists(keys.attempts)).toBe(0);
      expect(await first.get(keys.failures)).toBe("1");
      expect(await Code.publish(request, "123456")).toEqual({
        published: false,
        reason: "superseded_or_expired",
      });
      expect(await Code.publish(next, "654321")).toEqual({ published: true });
      expect(await Code.verify(next.teamId, next.email, "123456")).toBe(false);
      expect(await Code.verify(next.teamId, next.email, "654321")).toBe(true);
    });

    it("reserves the common email quota only once under contention", async (context) => {
      const [first, second] = clients;
      if (!reachable || !first || !second) {
        return context.skip(
          "Test Redis unavailable; concurrency was not verified"
        );
      }
      const getter = vi
        .spyOn(Adapter, "defaultClient", "get")
        .mockReturnValue(first);
      getter.mockReturnValueOnce(first).mockReturnValueOnce(second);
      const results = await Promise.all([
        Request.admit(request),
        Request.admit({ ...request, requestId: randomUUID() }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(
        await first.get(Request.getKeys(request.teamId, request.email).hourly)
      ).toBe("1");
    });
  }
);
