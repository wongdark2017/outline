// @vitest-isolate true
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { faker } from "@faker-js/faker";
import { Client, EmailSigninMethod } from "@shared/types";
import mailer from "@server/emails/mailer";
import Logger from "@server/logging/Logger";
import { taskQueue } from "@server/queues";
import Redis from "@server/storage/redis";
import { EmailSigninRequest } from "@server/utils/EmailSigninRequest";
import { VerificationCode } from "@server/utils/VerificationCode";
import * as authentication from "@server/utils/authentication";
import * as jwt from "@server/utils/jwt";
import SigninEmail from "@server/emails/templates/SigninEmail";
import WelcomeEmail from "@server/emails/templates/WelcomeEmail";
import { AuthenticationProvider } from "@server/models";
import {
  buildUser,
  buildGuestUser,
  buildTeam,
  buildSubdomain,
} from "@server/test/factories";
import TestServer from "@server/test/TestServer";
import webService from "@server/services/web";
import onerror from "@server/onerror";
import { redirectOnClient } from "@server/utils/redirectOnClient";

const queueEnvelopeSchema = z.object({
  name: z.literal("EmailTask"),
  props: z.object({
    templateName: z.literal("SigninEmail"),
    props: z.record(z.string(), z.unknown()),
  }),
});

const app = webService();
app.context.redirectOnClient = redirectOnClient;
onerror(app);
const server = new TestServer(app);
afterAll(() => server.close());

describe("email", () => {
  it("should fail with status 400 bad request if email is invalid", async () => {
    const res = await server.post("/auth/email", {
      body: { email: "invalid" },
    });
    const body = await res.json();
    expect(res.status).toEqual(400);
    expect(body.message).toEqual("email: Invalid email address");
  });

  it("should require email param", async () => {
    const res = await server.post("/auth/email", {
      body: {},
    });
    const body = await res.json();
    expect(res.status).toEqual(400);
    expect(body.error).toEqual("validation_error");
    expect(body.ok).toEqual(false);
  });

  it("should respond with redirect location when user is SSO enabled", async () => {
    const spy = vi.spyOn(WelcomeEmail.prototype, "schedule");
    const subdomain = buildSubdomain();
    const team = await buildTeam({ subdomain });
    const user = await buildUser({ teamId: team.id });
    const res = await server.post("/auth/email", {
      body: {
        email: user.email,
      },
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.redirect).toMatch("slack");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should respond with success and email to be sent when user has SSO but disabled", async () => {
    const spy = vi.spyOn(SigninEmail.prototype, "schedule");
    const subdomain = buildSubdomain();
    const team = await buildTeam({ subdomain });
    const user = await buildUser({ teamId: team.id });

    // Disable all the auth providers
    await AuthenticationProvider.update(
      {
        enabled: false,
      },
      {
        where: {
          teamId: team.id,
          enabled: true,
        },
      }
    );

    const res = await server.post("/auth/email", {
      body: {
        email: user.email,
      },
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.success).toEqual(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should not send email when user is on another subdomain but respond with success", async () => {
    const user = await buildUser();
    const spy = vi.spyOn(WelcomeEmail.prototype, "schedule");
    const subdomain = buildSubdomain();
    await buildTeam({ subdomain });
    const res = await server.post("/auth/email", {
      body: {
        email: user.email,
      },
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });

    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.success).toEqual(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should respond with success and email to be sent when user is not SSO enabled", async () => {
    const spy = vi.spyOn(SigninEmail.prototype, "schedule");
    const subdomain = buildSubdomain();
    const team = await buildTeam({ subdomain });
    const user = await buildGuestUser({
      teamId: team.id,
    });
    const res = await server.post("/auth/email", {
      body: {
        email: user.email,
      },
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.success).toEqual(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should respond with success regardless of whether successful to prevent crawling email logins", async () => {
    const spy = vi.spyOn(WelcomeEmail.prototype, "schedule");
    const subdomain = buildSubdomain();
    await buildTeam({ subdomain });
    const res = await server.post("/auth/email", {
      body: {
        email: "user@example.com",
      },
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.success).toEqual(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  describe("with multiple users matching email", () => {
    it("should default to current subdomain with SSO", async () => {
      const spy = vi.spyOn(SigninEmail.prototype, "schedule");
      const email = "sso-user@example.org";
      const subdomain = buildSubdomain();
      const team = await buildTeam({
        subdomain,
      });
      await buildGuestUser({
        email,
      });
      await buildUser({
        email,
        teamId: team.id,
      });
      const res = await server.post("/auth/email", {
        body: {
          email,
        },
        headers: {
          host: `${subdomain}.outline.dev`,
        },
      });
      const body = await res.json();
      expect(res.status).toEqual(200);
      expect(body.redirect).toMatch("slack");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("should default to current subdomain with guest email", async () => {
      const spy = vi.spyOn(SigninEmail.prototype, "schedule");
      const email = "guest-user@example.org";
      const subdomain = buildSubdomain();
      const team = await buildTeam({
        subdomain,
      });
      await buildUser({
        email,
      });
      await buildGuestUser({
        email,
        teamId: team.id,
      });
      const res = await server.post("/auth/email", {
        body: {
          email,
        },
        headers: {
          host: `${subdomain}.outline.dev`,
        },
      });
      const body = await res.json();
      expect(res.status).toEqual(200);
      expect(body.success).toEqual(true);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("should default to custom domain with SSO", async () => {
      const spy = vi.spyOn(WelcomeEmail.prototype, "schedule");
      const email = "sso-user-2@example.org";
      const domain = faker.internet.domainName();
      const team = await buildTeam({
        domain,
      });
      await buildGuestUser({
        email,
      });
      await buildUser({
        email,
        teamId: team.id,
      });
      const res = await server.post("/auth/email", {
        body: {
          email,
        },
        headers: {
          host: domain,
        },
      });
      const body = await res.json();
      expect(res.status).toEqual(200);
      expect(body.redirect).toMatch("slack");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("should default to custom domain with guest email", async () => {
      const spy = vi.spyOn(SigninEmail.prototype, "schedule");
      const email = "guest-user-2@example.org";
      const domain = faker.internet.domainName();
      const team = await buildTeam({
        domain,
      });
      await buildUser({
        email,
      });
      await buildGuestUser({
        email,
        teamId: team.id,
      });
      const res = await server.post("/auth/email", {
        body: {
          email,
        },
        headers: {
          host: domain,
        },
      });
      const body = await res.json();
      expect(res.status).toEqual(200);
      expect(body.success).toEqual(true);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});

describe("credential-free sign-in admission", () => {
  beforeEach(async () => {
    await Redis.defaultClient.flushall();
  });

  afterEach(() => vi.restoreAllMocks());

  async function setup() {
    const subdomain = buildSubdomain();
    const team = await buildTeam({ subdomain });
    const user = await buildGuestUser({ teamId: team.id });
    const headers = {
      host: `${subdomain}.outline.dev`,
      "user-agent": "Original browser",
    };
    if (!user.email) {
      throw new Error("Fixture requires an email");
    }
    return { team, user: Object.assign(user, { email: user.email }), headers };
  }

  it("returns the same method/timestamp shape for known, unknown and suppressed requests", async () => {
    const { user, headers } = await setup();
    const add = vi.spyOn(taskQueue(), "add");
    const generate = vi.spyOn(VerificationCode, "generate");
    for (const email of [
      user.email.toUpperCase(),
      "unknown@example.com",
      user.email,
    ]) {
      const res = await server.post("/auth/email", {
        body: { email, preferOTP: true },
        headers,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        method: "code",
        requestedAt: expect.any(Number),
      });
    }
    expect(add).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled();
    const payload = queueEnvelopeSchema.parse(add.mock.calls[0][0]).props.props;
    expect(payload).toMatchObject({
      to: user.email,
      method: "code",
      userAgent: "Original browser",
      requestIp: expect.any(String),
    });
    expect(Object.keys(payload).sort()).toEqual([
      "client",
      "language",
      "method",
      "requestId",
      "requestIp",
      "requestedAt",
      "teamId",
      "to",
      "userAgent",
      "userId",
    ]);
    expect(
      await Redis.defaultClient.get(
        EmailSigninRequest.getKeys(user.teamId, "unknown@example.com").latest
      )
    ).toBeNull();
  });

  it("keeps Link as the actual default and shares its cooldown with Code", async () => {
    const { user, headers } = await setup();
    const add = vi.spyOn(taskQueue(), "add");
    const link = await server.post("/auth/email", {
      body: { email: user.email, client: Client.Desktop },
      headers,
    });
    expect(await link.json()).toMatchObject({
      success: true,
      method: EmailSigninMethod.Link,
    });
    expect(
      queueEnvelopeSchema.parse(add.mock.calls[0][0]).props.props
    ).toMatchObject({
      method: "link",
      client: Client.Desktop,
    });
    const code = await server.post("/auth/email", {
      body: { email: user.email, preferOTP: true },
      headers,
    });
    expect(await code.json()).toMatchObject({
      success: true,
      method: EmailSigninMethod.Code,
    });
    expect(add).toHaveBeenCalledOnce();
  });

  it("invalidates an old code at admission even when queueing fails, and recovers on a later resend", async () => {
    const { user, headers } = await setup();
    const request = {
      teamId: user.teamId,
      email: user.email,
      requestId: randomUUID(),
      requestedAt: Date.now(),
    };
    await EmailSigninRequest.admit(request);
    await VerificationCode.publish(request, "123456");
    const keys = EmailSigninRequest.getKeys(user.teamId, user.email);
    await Redis.defaultClient.del(keys.cooldown);
    const add = vi.spyOn(taskQueue(), "add").mockRejectedValueOnce(
      Object.assign(new Error("body 123456 token=private-token"), {
        code: "ETIMEDOUT",
        command: "CONN",
      })
    );
    const warn = vi.spyOn(Logger, "warn");

    const failure = await server.post("/auth/email", {
      body: { email: user.email, preferOTP: true },
      headers,
    });

    expect(failure.status).toBe(200);
    expect(await failure.json()).toMatchObject({
      success: true,
      method: "code",
      requestedAt: expect.any(Number),
    });
    expect(
      await VerificationCode.verify(user.teamId, user.email, "123456")
    ).toBe(false);
    expect(await Redis.defaultClient.exists(keys.verifier)).toBe(0);
    expect(await Redis.defaultClient.get(keys.latest)).toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/123456|private-token/);
    expect(warn).toHaveBeenCalledWith("Sign-in email could not be queued", {
      reason: "Sign-in email scheduling failed",
      name: "Error",
      code: "ETIMEDOUT",
      responseCode: undefined,
      command: "CONN",
    });
    expect(await Redis.defaultClient.get(keys.hourly)).toBe("2");
    await Redis.defaultClient.del(keys.cooldown);

    const recovery = await server.post("/auth/email", {
      body: { email: user.email, preferOTP: true },
      headers,
    });
    expect(await recovery.json()).toMatchObject({ success: true });
    expect(add).toHaveBeenCalledTimes(2);
    expect(await Redis.defaultClient.get(keys.latest)).toBe(
      queueEnvelopeSchema.parse(add.mock.calls[1][0]).props.props.requestId
    );
  });

  it("never deletes a newer pointer when enqueueing an older request fails", async () => {
    const { user, headers } = await setup();
    const newerId = randomUUID();
    const key = EmailSigninRequest.getKeys(user.teamId, user.email).latest;
    vi.spyOn(taskQueue(), "add").mockImplementationOnce(async () => {
      await Redis.defaultClient.set(key, newerId);
      throw new Error("Transport unavailable");
    });
    const res = await server.post("/auth/email", {
      body: { email: user.email, preferOTP: true },
      headers,
    });
    expect(await res.json()).toMatchObject({ success: true });
    expect(await Redis.defaultClient.get(key)).toBe(newerId);
  });

  it("retains old code invalidation before the replacement worker runs", async () => {
    const { user, headers } = await setup();
    const request = {
      teamId: user.teamId,
      email: user.email,
      requestId: randomUUID(),
      requestedAt: Date.now(),
    };
    await EmailSigninRequest.admit(request);
    await VerificationCode.publish(request, "123456");
    await Redis.defaultClient.del(
      EmailSigninRequest.getKeys(user.teamId, user.email).cooldown
    );
    const generate = vi.spyOn(VerificationCode, "generate");
    await server.post("/auth/email", {
      body: { email: user.email, preferOTP: true },
      headers,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(
      await VerificationCode.verify(user.teamId, user.email, "123456")
    ).toBe(false);
  });
});

describe("email callback", () => {
  beforeEach(async () => {
    await Redis.defaultClient.flushall();
  });
  afterEach(() => vi.restoreAllMocks());

  async function setupCode(overrides = {}) {
    const subdomain = buildSubdomain();
    const team = await buildTeam({ subdomain });
    const user = await buildGuestUser({ teamId: team.id, ...overrides });
    if (!user.email) {
      throw new Error("Fixture requires an email");
    }
    const request = {
      teamId: team.id,
      email: user.email,
      requestId: randomUUID(),
      requestedAt: Date.now(),
    };
    await EmailSigninRequest.admit(request);
    await VerificationCode.publish(request, "123456");
    return {
      user: Object.assign(user, { email: user.email }),
      team,
      request,
      headers: { host: `${subdomain}.outline.dev` },
    };
  }

  it.each([
    ["GET", "?code=123456&email=user@example.com", {}],
    ["POST", "?code=123456", { email: "user@example.com", code: "123456" }],
    ["POST", "?token=secret", { email: "user@example.com", code: "123456" }],
    ["POST", "", { email: "user@example.com", code: "12e456" }],
    ["POST", "?token=secret&follow=true", { token: "other" }],
  ])(
    "rejects ambiguous/query/malformed credentials (%s %s)",
    async (method, query, body) => {
      const { headers } = await setupCode();
      const verify = vi.spyOn(VerificationCode, "verify");
      const res = await server.fetch(`/auth/email.callback${query}`, {
        method,
        ...(method === "POST" ? { body } : {}),
        headers,
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(
        `${server.address}/?notice=invalid-code`
      );
      expect(verify).not.toHaveBeenCalled();
    }
  );

  it("normalizes POST codes, consumes exactly once and preserves desktop handoff", async () => {
    const { user, headers } = await setupCode();
    const signIn = vi
      .spyOn(authentication, "signIn")
      .mockImplementation(async (ctx) => {
        ctx.redirect("/signed-in");
      });
    const options = {
      body: {
        email: ` ${user.email.toUpperCase()} `,
        code: "123 456",
        client: Client.Desktop,
      },
      headers,
      redirect: "manual" as const,
    };
    const success = await server.post("/auth/email.callback", options);
    expect(success.headers.get("location")).toBe(`${server.address}/signed-in`);
    expect(signIn).toHaveBeenCalledWith(
      expect.anything(),
      "email",
      expect.objectContaining({
        user: expect.objectContaining({ id: user.id }),
        client: Client.Desktop,
      })
    );
    const replay = await server.post("/auth/email.callback", options);
    expect(replay.headers.get("location")).toBe(
      `${server.address}/?notice=invalid-code`
    );
    expect(signIn).toHaveBeenCalledOnce();
  });

  it("retains the welcome email for an invited user", async () => {
    const { user, headers } = await setupCode({ lastActiveAt: null });
    const welcome = vi.spyOn(WelcomeEmail.prototype, "schedule");
    vi.spyOn(authentication, "signIn").mockImplementation(async (ctx) => {
      ctx.redirect("/signed-in");
    });
    const res = await server.post("/auth/email.callback", {
      body: { email: user.email, code: "123456" },
      headers,
      redirect: "manual",
    });
    expect(res.headers.get("location")).toBe(`${server.address}/signed-in`);
    expect(welcome).toHaveBeenCalledOnce();
  });

  it.each(["user", "team", "disabled"])(
    "reveals the %s notice only after consuming a valid code",
    async (kind) => {
      const { user, team, headers } = await setupCode();
      if (kind === "user") {
        await user.update({ suspendedAt: new Date(), suspendedById: user.id });
      }
      if (kind === "team") {
        await team.update({ suspendedAt: new Date() });
      }
      if (kind === "disabled") {
        await team.update({ guestSignin: false });
      }
      const verify = vi.spyOn(VerificationCode, "verify");
      const res = await server.post("/auth/email.callback", {
        body: { email: user.email, code: "123456" },
        headers,
        redirect: "manual",
      });
      const expected =
        kind === "disabled"
          ? "/?notice=auth-error&description=Disabled%20signin%20method"
          : `/?notice=${kind}-suspended`;
      expect(res.headers.get("location")).toBe(`${server.address}${expected}`);
      expect(verify).toHaveBeenCalledWith(team.id, user.email, "123456");
      expect(
        await Redis.defaultClient.exists(
          EmailSigninRequest.getKeys(team.id, user.email).verifier
        )
      ).toBe(0);

      const replay = await server.post("/auth/email.callback", {
        body: { email: user.email, code: "123456" },
        headers,
        redirect: "manual",
      });
      expect(replay.headers.get("location")).toBe(
        `${server.address}/?notice=invalid-code`
      );
    }
  );

  it.each(["unknown", "ordinary", "user", "team", "disabled", "sso"])(
    "does not expose the %s account state for an invalid code",
    async (kind) => {
      const { user, team, headers } = await setupCode();
      let email = user.email;
      if (kind === "unknown") {
        email = "unknown@example.com";
      } else if (kind === "user") {
        await user.update({ suspendedAt: new Date(), suspendedById: user.id });
      } else if (kind === "team") {
        await team.update({ suspendedAt: new Date() });
      } else if (kind === "disabled") {
        await team.update({ guestSignin: false });
      } else if (kind === "sso") {
        const ssoUser = await buildUser({ teamId: team.id });
        if (!ssoUser.email) {
          throw new Error("Fixture requires an email");
        }
        email = ssoUser.email;
      }
      const verify = vi.spyOn(VerificationCode, "verify");
      const signIn = vi.spyOn(authentication, "signIn");

      const res = await server.post("/auth/email.callback", {
        body: { email, code: "654321" },
        headers,
        redirect: "manual",
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(
        `${server.address}/?notice=invalid-code`
      );
      expect(verify).toHaveBeenCalledExactlyOnceWith(team.id, email, "654321");
      expect(signIn).not.toHaveBeenCalled();
    }
  );

  it.each(["Disabled signin method", "User suspended", "Team suspended"])(
    "does not expose account state when OTP verification throws %s",
    async (message) => {
      const { user, headers } = await setupCode();
      vi.spyOn(VerificationCode, "verify").mockRejectedValue(
        new Error(message)
      );
      const signIn = vi.spyOn(authentication, "signIn");

      const res = await server.post("/auth/email.callback", {
        body: { email: user.email, code: "654321" },
        headers,
        redirect: "manual",
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(
        `${server.address}/?notice=invalid-code`
      );
      expect(signIn).not.toHaveBeenCalled();
    }
  );

  it("resets an exhausted challenge on an admitted resend and retains abuse limits", async () => {
    const { user, team, headers } = await setupCode();
    const keys = EmailSigninRequest.getKeys(team.id, user.email);
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await server.post("/auth/email.callback", {
        body: { email: user.email, code: "654321" },
        headers,
        redirect: "manual",
      });
      expect(res.headers.get("location")).toBe(
        `${server.address}/?notice=invalid-code`
      );
    }
    expect(await Redis.defaultClient.get(keys.attempts)).toBe("5");
    const add = vi.spyOn(taskQueue(), "add");
    await Redis.defaultClient.del(keys.cooldown);

    const res = await server.post("/auth/email", {
      body: { email: user.email, preferOTP: true },
      headers,
    });

    expect(await res.json()).toMatchObject({ success: true, method: "code" });
    expect(add).toHaveBeenCalledOnce();
    expect(await Redis.defaultClient.get(keys.attempts)).toBeNull();
    expect(await Redis.defaultClient.get(keys.failures)).toBe("5");
    expect(await Redis.defaultClient.get(keys.hourly)).toBe("2");

    const send = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    vi.spyOn(VerificationCode, "generate").mockReturnValue("111222");
    const payload = queueEnvelopeSchema.parse(add.mock.calls[0][0]).props.props;
    await new SigninEmail({
      userId: user.id,
      teamId: team.id,
      to: user.email,
      language: user.language,
      client: Client.Web,
      method: EmailSigninMethod.Code,
      requestId: z.string().parse(payload.requestId),
      requestedAt: z.number().parse(payload.requestedAt),
      requestIp: z.string().parse(payload.requestIp),
      userAgent: z.string().parse(payload.userAgent),
    }).send();

    expect(send).toHaveBeenCalledOnce();
    expect(await VerificationCode.verify(team.id, user.email, "111222")).toBe(
      true
    );
  });

  it.each([Client.Web, Client.Desktop])(
    "preserves real %s session handoff",
    async (client) => {
      const { user, headers } = await setupCode();
      const res = await server.post("/auth/email.callback", {
        body: { email: user.email, code: "123456", client },
        headers,
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      const location = res.headers.get("location");
      expect(location).toBeTruthy();
      const redirect = new URL(location ?? "http://invalid");
      expect(redirect.pathname).toBe(
        client === Client.Desktop ? "/desktop-redirect" : "/auth/redirect"
      );
      expect(redirect.searchParams.get("token")).toBeTruthy();
      expect(res.headers.raw()["set-cookie"].join(" ")).toContain(
        "lastSignedIn=email"
      );
      expect(res.headers.raw()["set-cookie"].join(" ")).toContain("sessions=");
    }
  );

  it.each(["user", "team", "disabled"])(
    "preserves the %s magic-link notice without claiming the token",
    async (kind) => {
      const { user, team, headers } = await setupCode();
      await Redis.defaultClient.del(
        EmailSigninRequest.getKeys(team.id, user.email).cooldown
      );
      const add = vi.spyOn(taskQueue(), "add");
      await server.post("/auth/email", {
        body: { email: user.email },
        headers,
      });
      const input = queueEnvelopeSchema.parse(add.mock.calls[0][0]).props.props;
      const token = user.getEmailSigninToken({
        requestIp: z.string().parse(input.requestIp),
        requestId: z.string().parse(input.requestId),
        requestedAt: z.number().parse(input.requestedAt),
      });
      if (kind === "user") {
        await user.update({ suspendedAt: new Date(), suspendedById: user.id });
      }
      if (kind === "team") {
        await team.update({ suspendedAt: new Date() });
      }
      if (kind === "disabled") {
        await team.update({ guestSignin: false });
      }
      const res = await server.post("/auth/email.callback", {
        body: { token, follow: "true" },
        headers,
        redirect: "manual",
      });
      const expected =
        kind === "disabled"
          ? "/?notice=auth-error&description=Disabled%20signin%20method"
          : `/?notice=${kind}-suspended`;
      expect(res.headers.get("location")).toBe(`${server.address}${expected}`);

      // Enabling eligibility again proves the denied attempt did not claim the token.
      await user.update({ suspendedAt: null, suspendedById: null });
      await team.update({ suspendedAt: null, guestSignin: true });
      vi.spyOn(authentication, "signIn").mockImplementation(async (ctx) => {
        ctx.redirect("/signed-in");
      });
      const retry = await server.post("/auth/email.callback", {
        body: { token, follow: "true" },
        headers,
        redirect: "manual",
      });
      expect(retry.headers.get("location")).toBe(`${server.address}/signed-in`);
    }
  );

  it("keeps magic-link GET prefetch protection without consuming the token", async () => {
    const { user, headers, request } = await setupCode();
    const token = user.getEmailSigninToken({
      requestIp: "127.0.0.1",
      requestId: request.requestId,
      requestedAt: request.requestedAt,
    });
    const getUser = vi.spyOn(jwt, "getUserForEmailSigninToken");
    const res = await server.get(`/auth/email.callback?token=${token}`, {
      headers,
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("follow");
    expect(getUser).not.toHaveBeenCalled();
  });

  it.each(["code", "link"])(
    "redacts raw %s callback errors and redirects generically",
    async (kind) => {
      const { user, headers } = await setupCode();
      const debug = vi.spyOn(Logger, "debug");
      const error = Object.assign(new Error("123456 token=secret-token"), {
        code: "ETIMEDOUT",
        command: "CONN",
      });
      if (kind === "code") {
        vi.spyOn(VerificationCode, "verify").mockRejectedValue(error);
      } else {
        vi.spyOn(jwt, "getUserForEmailSigninToken").mockRejectedValue(error);
      }
      const body =
        kind === "code"
          ? { email: user.email, code: "123456" }
          : { token: "secret-token", follow: "true" };
      const res = await server.post("/auth/email.callback", {
        body,
        headers,
        redirect: "manual",
      });
      expect(res.headers.get("location")).toBe(
        `${server.address}/?notice=invalid-code`
      );
      expect(JSON.stringify(debug.mock.calls)).not.toMatch(
        /123456|secret-token/
      );
      expect(debug).toHaveBeenCalledWith(
        "authentication",
        "Email sign-in verification failed",
        {
          name: "Error",
          code: "ETIMEDOUT",
          responseCode: undefined,
          command: "CONN",
        }
      );
    }
  );
});
