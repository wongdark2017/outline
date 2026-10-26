import { faker } from "@faker-js/faker";
import JWT from "jsonwebtoken";
import { UserRole } from "@shared/types";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import { taskQueue } from "@server/queues";
import { buildTeam, buildUser } from "@server/test/factories";
import userInviter from "./userInviter";
import { withAPIContext } from "@server/test/support";
import { TeamDomain } from "@server/models";

describe("userInviter", () => {
  it("schedules development invitations without creating or logging a sign-in shortcut", async () => {
    const smtpFromEmail = env.SMTP_FROM_EMAIL;
    env.SMTP_FROM_EMAIL = "sender@example.com";
    const development = vi
      .spyOn(env, "isDevelopment", "get")
      .mockReturnValue(true);
    const token = vi.spyOn(JWT, "sign");
    const logs = vi.spyOn(Logger, "info");
    const enqueue = vi.spyOn(taskQueue(), "add");
    onTestFinished(() => {
      env.SMTP_FROM_EMAIL = smtpFromEmail;
      development.mockRestore();
      token.mockRestore();
      logs.mockRestore();
      enqueue.mockRestore();
    });
    const user = await buildUser();

    const response = await withAPIContext(user, (ctx) =>
      userInviter(ctx, {
        invites: [
          { role: UserRole.Member, email: "invite@example.com", name: "Test" },
        ],
      })
    );

    expect(response.sent).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "EmailTask",
        props: expect.objectContaining({ templateName: "InviteEmail" }),
      }),
      expect.any(Object)
    );
    expect(token).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "email-signin" }),
      expect.anything()
    );
    expect(JSON.stringify(logs.mock.calls)).not.toMatch(
      /Sign in immediately|token=/
    );
  });

  it("should return sent invites", async () => {
    const user = await buildUser();
    const response = await withAPIContext(user, (ctx) =>
      userInviter(ctx, {
        invites: [
          {
            role: UserRole.Member,
            email: faker.internet.email(),
            name: "Test",
          },
        ],
      })
    );
    expect(response.sent.length).toEqual(1);
  });

  it("should filter empty invites", async () => {
    const user = await buildUser();
    const response = await withAPIContext(user, (ctx) =>
      userInviter(ctx, {
        invites: [
          {
            role: UserRole.Member,
            email: " ",
            name: "Test",
          },
        ],
      })
    );
    expect(response.sent.length).toEqual(0);
  });

  it("should error on non allowed domains", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });

    await TeamDomain.create({
      teamId: team.id,
      name: faker.internet.domainName(),
      createdById: user.id,
    });

    await withAPIContext(user, (ctx) =>
      expect(
        userInviter(ctx, {
          invites: [
            {
              role: UserRole.Member,
              email: "test@example.com",
              name: "Test",
            },
          ],
        })
      ).rejects.toThrow("The domain is not allowed for this workspace")
    );
  });

  it("should allow invites for allowed domains", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const allowedDomain = "google.com";

    await TeamDomain.create({
      teamId: team.id,
      name: allowedDomain,
      createdById: user.id,
    });

    const response = await withAPIContext(user, (ctx) =>
      userInviter(ctx, {
        invites: [
          {
            role: UserRole.Member,
            email: `test@${allowedDomain}`,
            name: "Test User",
          },
        ],
      })
    );

    expect(response.sent.length).toEqual(1);
    expect(response.sent[0].email).toEqual(`test@${allowedDomain}`);
  });

  it("should filter obviously bunk emails", async () => {
    const user = await buildUser();
    const response = await withAPIContext(user, (ctx) =>
      userInviter(ctx, {
        invites: [
          {
            role: UserRole.Member,
            email: "notanemail",
            name: "Test",
          },
        ],
      })
    );
    expect(response.sent.length).toEqual(0);
  });

  it("should not send duplicates", async () => {
    const user = await buildUser();
    const response = await withAPIContext(user, (ctx) =>
      userInviter(ctx, {
        invites: [
          {
            role: UserRole.Member,
            email: "the@same.com",
            name: "Test",
          },
          {
            role: UserRole.Member,
            email: "the@SAME.COM",
            name: "Test",
          },
        ],
      })
    );
    expect(response.sent.length).toEqual(1);
  });

  it("should not send invites to existing team members", async () => {
    const email = faker.internet.email().toLowerCase();
    const user = await buildUser({ email });
    const response = await withAPIContext(user, (ctx) =>
      userInviter(ctx, {
        invites: [
          {
            role: UserRole.Member,
            email,
            name: user.name,
          },
        ],
      })
    );
    expect(response.sent.length).toEqual(0);
  });
});
