import { faker } from "@faker-js/faker";
import { UserRole } from "@shared/types";
import { buildTeam, buildUser } from "@server/test/factories";
import userInviter from "./userInviter";
import { withAPIContext } from "@server/test/support";
import { TeamDomain } from "@server/models";
import passwordEnv from "../../plugins/password/server/env";
import InvitePasswordActivationEmail from "@server/emails/templates/InvitePasswordActivationEmail";

describe("userInviter", () => {
  beforeEach(() => {
    passwordEnv.PASSWORD_AUTH_ENABLED = false;
  });

  afterEach(() => {
    passwordEnv.PASSWORD_AUTH_ENABLED = false;
    vi.restoreAllMocks();
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

  it("should send a password activation email when password auth is enabled", async () => {
    passwordEnv.PASSWORD_AUTH_ENABLED = true;
    const schedule = vi
      .spyOn(InvitePasswordActivationEmail.prototype, "schedule")
      .mockResolvedValue(undefined);
    const team = await buildTeam({
      authenticationProviders: [],
    });
    const user = await buildUser({ teamId: team.id });

    const response = await withAPIContext(user, (ctx) =>
      userInviter(ctx, {
        invites: [
          {
            role: UserRole.Member,
            email: faker.internet.email().toLowerCase(),
            name: "Invited User",
          },
        ],
      })
    );

    expect(response.sent.length).toEqual(1);
    expect(schedule).toHaveBeenCalledTimes(1);
  });
});
