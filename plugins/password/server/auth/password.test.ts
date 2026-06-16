import bodyParser from "koa-body";
import Koa from "koa";
import Router from "koa-router";
import mount from "koa-mount";
import { addMinutes } from "date-fns";
import { faker } from "@faker-js/faker";
import { CSRF } from "@shared/constants";
import authMiddleware from "@server/middlewares/authentication";
import coalesceBody from "@server/middlewares/coaleseBody";
import { attachCSRFToken, verifyCSRFToken } from "@server/middlewares/csrf";
import onerror from "@server/onerror";
import coreEnv from "@server/env";
import { Event } from "@server/models";
import Redis from "@server/storage/redis";
import { buildGuestUser, buildTeam, buildUser } from "@server/test/factories";
import TestServer from "@server/test/TestServer";
import { setSelfHosted } from "@server/test/support";
import passwordEnv from "../env";
import { createPasswordRouter } from "./password";

describe("password auth", () => {
  let server: TestServer;

  beforeEach(() => {
    const app = new Koa();
    const router = new Router();
    const passwordRouter = createPasswordRouter();

    router.use(
      "/",
      authMiddleware({ optional: true }),
      passwordRouter.routes()
    );

    app.use(bodyParser());
    app.use(coalesceBody());
    app.use(attachCSRFToken());
    app.use(verifyCSRFToken());
    app.use(mount("/auth", router.routes()));
    onerror(app);
    server = new TestServer(app);
  });

  beforeEach(() => {
    setSelfHosted();
    passwordEnv.PASSWORD_AUTH_ENABLED = true;
  });

  afterEach(() => {
    passwordEnv.PASSWORD_AUTH_ENABLED = false;
    server?.close();
  });

  it("should return 404 when the provider is disabled", async () => {
    passwordEnv.PASSWORD_AUTH_ENABLED = false;

    const res = await server.post("/auth/password", {
      body: {
        email: faker.internet.email(),
        password: "correct horse battery staple",
      },
    });

    expect(res.status).toEqual(404);
  });

  it("should return 404 in cloud-hosted mode even when enabled", async () => {
    const originalUrl = coreEnv.URL;
    coreEnv.URL = "https://app.getoutline.com";

    try {
      const res = await server.post("/auth/password", {
        body: {
          email: faker.internet.email(),
          password: "correct horse battery staple",
        },
      });

      expect(res.status).toEqual(404);
    } finally {
      coreEnv.URL = originalUrl;
    }
  });

  it("should fail when body contains token field", async () => {
    const res = await server.post("/auth/password", {
      body: {
        email: faker.internet.email(),
        password: "correct horse battery staple",
        token: "bad",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.error).toEqual("validation_error");
  });

  it("should fail when query is non-empty", async () => {
    const res = await server.post("/auth/password/update?token=bad", {
      body: {
        password: "correct horse battery staple",
        resetToken: "reset-token",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.error).toEqual("validation_error");
  });

  it("should require exactly one of resetToken or currentPassword", async () => {
    const res = await server.post("/auth/password/update", {
      body: {
        password: "correct horse battery staple",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.message).toContain("Provide exactly one");
  });

  it("should require exactly one of resetToken, activationToken or currentPassword", async () => {
    const res = await server.post("/auth/password/update", {
      body: {
        password: "correct horse battery staple",
        resetToken: "reset-token",
        activationToken: "activation-token",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.message).toContain("Provide exactly one");
  });

  it("should redirect to password-auth-failed when password is invalid", async () => {
    const team = await buildTeam({
      domain: new URL(coreEnv.URL).host,
      authenticationProviders: [],
    });
    const user = await buildUser({
      teamId: team.id,
      authentications: [],
    });
    await user.setPassword("correct horse battery staple");
    await user.save();

    const res = await server.post("/auth/password", {
      body: {
        email: user.email,
        password: "wrong password",
      },
      headers: {
        host: new URL(team.url).host,
      },
      redirect: "manual",
    });

    expect(res.status).toEqual(302);
    expect(res.headers.get("location")).toContain(
      "notice=password-auth-failed"
    );
  });

  it("should scope login to the current team when the same email exists in multiple teams", async () => {
    const email = "same@example.com";
    const domainSuffix = faker.string.alphanumeric(8).toLowerCase();
    const teamA = await buildTeam({
      domain: `team-a-${domainSuffix}.example.com`,
      authenticationProviders: [],
    });
    const teamB = await buildTeam({
      domain: `team-b-${domainSuffix}.example.com`,
      authenticationProviders: [],
    });
    const userA = await buildUser({
      teamId: teamA.id,
      email,
      authentications: [],
    });
    const userB = await buildUser({
      teamId: teamB.id,
      email,
      authentications: [],
    });
    await userA.setPassword("team-a password");
    await userA.save();
    await userB.setPassword("team-b password");
    await userB.save();

    const wrongTeamRes = await server.post("/auth/password", {
      body: {
        email,
        password: "team-b password",
      },
      headers: {
        host: teamA.domain!,
      },
      redirect: "manual",
    });

    expect(wrongTeamRes.status).toEqual(302);
    expect(wrongTeamRes.headers.get("location")).toContain(
      "notice=password-auth-failed"
    );
  });

  it("should lock the account after repeated invalid password attempts", async () => {
    const team = await buildTeam({
      domain: new URL(coreEnv.URL).host,
      authenticationProviders: [],
    });
    const user = await buildUser({
      teamId: team.id,
      authentications: [],
    });
    await user.setPassword("correct horse battery staple");
    await user.save();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await server.post("/auth/password", {
        body: {
          email: user.email,
          password: "wrong password",
        },
        headers: {
          host: new URL(team.url).host,
        },
        redirect: "manual",
      });

      expect(res.status).toEqual(302);
      expect(res.headers.get("location")).toContain(
        attempt === 5 ? "notice=password-locked" : "notice=password-auth-failed"
      );
    }

    const reloaded = await user.reload();
    expect(reloaded.failedSignInAttempts).toBe(5);
    expect(reloaded.lockedUntil).not.toBeNull();

    const lockedRes = await server.post("/auth/password", {
      body: {
        email: user.email,
        password: "correct horse battery staple",
      },
      headers: {
        host: new URL(team.url).host,
      },
      redirect: "manual",
    });

    expect(lockedRes.status).toEqual(302);
    expect(lockedRes.headers.get("location")).toContain(
      "notice=password-locked"
    );
  });

  it("should return 503 when reset is requested without email service", async () => {
    const team = await buildTeam({
      domain: new URL(coreEnv.URL).host,
      authenticationProviders: [],
    });

    const originalFrom = coreEnv.SMTP_FROM_EMAIL;
    coreEnv.SMTP_FROM_EMAIL = undefined;

    try {
      const res = await server.post("/auth/password/reset", {
        body: {
          email: faker.internet.email(),
        },
        headers: {
          host: new URL(team.url).host,
        },
      });
      const body = await res.json();

      expect(res.status).toEqual(503);
      expect(body.error).toEqual("service_unavailable");
    } finally {
      coreEnv.SMTP_FROM_EMAIL = originalFrom;
    }
  });

  it("should return success for reset even when user does not exist", async () => {
    const team = await buildTeam({
      domain: new URL(coreEnv.URL).host,
      authenticationProviders: [],
    });
    const spy = vi.spyOn(Redis.defaultClient, "set");

    const res = await server.post("/auth/password/reset", {
      body: {
        email: "nobody@example.com",
      },
      headers: {
        host: new URL(team.url).host,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.success).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should rate limit reset attempts per team without affecting another team with the same email", async () => {
    const email = "same@example.com";
    const domainSuffix = faker.string.alphanumeric(8).toLowerCase();
    const teamA = await buildTeam({
      domain: `team-a-${domainSuffix}.example.com`,
      authenticationProviders: [],
    });
    const teamB = await buildTeam({
      domain: `team-b-${domainSuffix}.example.com`,
      authenticationProviders: [],
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await server.post("/auth/password/reset", {
        body: {
          email,
        },
        headers: {
          host: teamA.domain!,
        },
      });

      expect(res.status).toEqual(200);
    }

    const limitedRes = await server.post("/auth/password/reset", {
      body: {
        email,
      },
      headers: {
        host: teamA.domain!,
      },
    });

    expect(limitedRes.status).toEqual(429);

    const otherTeamRes = await server.post("/auth/password/reset", {
      body: {
        email,
      },
      headers: {
        host: teamB.domain!,
      },
    });
    const otherTeamBody = await otherTeamRes.json();

    expect(otherTeamRes.status).toEqual(200);
    expect(otherTeamBody.success).toBe(true);
  });

  it("should update password via reset token and redirect to password-updated", async () => {
    const team = await buildTeam({
      domain: new URL(coreEnv.URL).host,
      authenticationProviders: [],
    });
    const user = await buildUser({
      teamId: team.id,
      authentications: [],
    });
    const { token, jti } = user.getPasswordResetToken();
    await Redis.defaultClient.set(
      `password-reset:jti:${jti}`,
      JSON.stringify({
        teamId: team.id,
        userId: user.id,
      }),
      "EX",
      900
    );

    const res = await server.post("/auth/password/update", {
      body: {
        password: "correct horse battery staple",
        resetToken: token,
      },
      headers: {
        host: new URL(team.url).host,
      },
      redirect: "manual",
    });

    expect(res.status).toEqual(302);
    expect(res.headers.get("location")).toContain("notice=password-updated");

    const reloaded = await user.reload();
    expect(await reloaded.verifyPassword("correct horse battery staple")).toBe(
      true
    );
  });

  it("should activate an invited user via activation token and sign them in", async () => {
    const team = await buildTeam({
      domain: new URL(coreEnv.URL).host,
      authenticationProviders: [],
    });
    const user = await buildGuestUser({
      teamId: team.id,
      authentications: [],
      lastActiveAt: null,
      lastActiveIp: null,
    });
    const { token, jti } = user.getPasswordActivationToken();
    await Redis.defaultClient.set(
      `password-activation:jti:${jti}`,
      JSON.stringify({
        teamId: team.id,
        userId: user.id,
      }),
      "EX",
      900
    );

    const res = await server.post("/auth/password/update", {
      body: {
        password: "correct horse battery staple",
        activationToken: token,
      },
      headers: {
        host: new URL(team.url).host,
      },
      redirect: "manual",
    });

    expect(res.status).toEqual(302);
    expect(res.headers.get("set-cookie")).toContain("accessToken=");

    const reloaded = await user.reload();
    expect(await reloaded.verifyPassword("correct horse battery staple")).toBe(
      true
    );
    expect(reloaded.lastActiveAt).not.toBeNull();

    const event = await Event.findLatest({
      name: "users.invite_accepted",
      userId: user.id,
    });
    expect(event).not.toBeNull();
  });

  it("should reject reusing an activation token after successful activation", async () => {
    const team = await buildTeam({
      domain: new URL(coreEnv.URL).host,
      authenticationProviders: [],
    });
    const user = await buildGuestUser({
      teamId: team.id,
      authentications: [],
      lastActiveAt: null,
      lastActiveIp: null,
    });
    const { token, jti } = user.getPasswordActivationToken();
    await Redis.defaultClient.set(
      `password-activation:jti:${jti}`,
      JSON.stringify({
        teamId: team.id,
        userId: user.id,
      }),
      "EX",
      900
    );

    const firstRes = await server.post("/auth/password/update", {
      body: {
        password: "correct horse battery staple",
        activationToken: token,
      },
      headers: {
        host: new URL(team.url).host,
      },
      redirect: "manual",
    });
    const secondRes = await server.post("/auth/password/update", {
      body: {
        password: "another correct battery staple",
        activationToken: token,
      },
      headers: {
        host: new URL(team.url).host,
      },
      redirect: "manual",
    });

    expect(firstRes.status).toEqual(302);
    expect(secondRes.status).toEqual(302);
    expect(secondRes.headers.get("location")).toContain("notice=expired-token");
  });

  it("should only allow one successful reset-password update for the same token", async () => {
    const team = await buildTeam({
      domain: new URL(coreEnv.URL).host,
      authenticationProviders: [],
    });
    const user = await buildUser({
      teamId: team.id,
      authentications: [],
    });
    const { token, jti } = user.getPasswordResetToken();
    await Redis.defaultClient.set(
      `password-reset:jti:${jti}`,
      JSON.stringify({
        teamId: team.id,
        userId: user.id,
      }),
      "EX",
      900
    );

    const [firstRes, secondRes] = await Promise.all([
      server.post("/auth/password/update", {
        body: {
          password: "correct horse battery staple",
          resetToken: token,
        },
        headers: {
          host: new URL(team.url).host,
        },
        redirect: "manual",
      }),
      server.post("/auth/password/update", {
        body: {
          password: "correct horse battery staple",
          resetToken: token,
        },
        headers: {
          host: new URL(team.url).host,
        },
        redirect: "manual",
      }),
    ]);
    const locations = [firstRes, secondRes].map(
      (response) => response.headers.get("location") ?? ""
    );

    expect(
      locations.filter((location) =>
        location.includes("notice=password-updated")
      )
    ).toHaveLength(1);
    expect(
      locations.filter((location) => location.includes("notice=expired-token"))
    ).toHaveLength(1);

    const reloaded = await user.reload();
    expect(await reloaded.verifyPassword("correct horse battery staple")).toBe(
      true
    );
    expect(
      await Event.count({
        where: {
          name: "users.update",
          userId: user.id,
        },
      })
    ).toBe(1);
  });

  it("should update password for logged in user and return json success", async () => {
    const team = await buildTeam({
      domain: new URL(coreEnv.URL).host,
      authenticationProviders: [],
    });
    const user = await buildUser({
      teamId: team.id,
      authentications: [],
    });
    await user.setPassword("old password value");
    user.failedSignInAttempts = 3;
    user.lockedUntil = addMinutes(new Date(), 5);
    await user.save({
      hooks: false,
    });

    const sessionToken = user.getSessionToken();
    const csrfRes = await server.get("/auth/password", {
      headers: {
        host: new URL(team.url).host,
        cookie: `accessToken=${sessionToken}`,
      },
    });
    const csrfCookie = csrfRes.headers.get("set-cookie") ?? "";
    const csrfToken = csrfCookie.match(/csrfToken=([^;]+)/)?.[1];

    const res = await server.post("/auth/password/update", {
      body: {
        currentPassword: "old password value",
        password: "new password value",
        [CSRF.fieldName]: csrfToken,
      },
      headers: {
        host: new URL(team.url).host,
        cookie: `accessToken=${sessionToken}; ${csrfCookie.split(";")[0]}`,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.success).toBe(true);
    expect(res.headers.get("set-cookie")).toContain("accessToken=");

    const reloaded = await user.reload();
    expect(await reloaded.verifyPassword("new password value")).toBe(true);
    expect(reloaded.failedSignInAttempts).toBe(0);
    expect(reloaded.lockedUntil).toBeNull();

    const event = await Event.findLatest({
      name: "users.update",
      userId: user.id,
    });
    expect(event?.data).toMatchObject({
      passwordChanged: true,
    });
  });

  it("should reject currentPassword flow when session token is sent in header", async () => {
    const team = await buildTeam({
      domain: new URL(coreEnv.URL).host,
      authenticationProviders: [],
    });
    const user = await buildUser({
      teamId: team.id,
      authentications: [],
    });
    await user.setPassword("old password value");
    await user.save();

    const res = await server.post("/auth/password/update", user, {
      body: {
        currentPassword: "old password value",
        password: "new password value",
      },
      headers: {
        host: new URL(team.url).host,
      },
    });

    expect(res.status).toEqual(401);
  });
});
