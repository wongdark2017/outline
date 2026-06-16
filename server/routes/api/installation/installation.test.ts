import { faker } from "@faker-js/faker";
import { sequelize } from "@server/storage/database";
import { buildUser, buildTeam } from "@server/test/factories";
import { getTestServer, setSelfHosted } from "@server/test/support";
import { Team, User } from "@server/models";
import passwordEnv from "../../../../plugins/password/server/env";

setSelfHosted();
const server = getTestServer();

describe.sequential("installation.create", () => {
  beforeEach(() => {
    passwordEnv.PASSWORD_AUTH_ENABLED = false;
  });

  afterEach(() => {
    passwordEnv.PASSWORD_AUTH_ENABLED = false;
  });

  // Skipped in CI because tests run in parallel and this requires a clean database state.
  it.skip("should create a team when no teams exist", async () => {
    await sequelize.query(
      "TRUNCATE TABLE teams, users, team_domains, user_authentications RESTART IDENTITY CASCADE"
    );

    const res = await server.post("/api/installation.create", {
      body: {
        teamName: faker.company.name(),
        userName: faker.person.fullName(),
        userEmail: faker.internet.email().toLowerCase(),
      },
      redirect: "manual",
    });
    expect(res.status).toEqual(302);
    expect(res.headers.get("location")).not.toBeNull();
  });

  it("should fail when teams already exist", async () => {
    await buildTeam();

    const res = await server.post("/api/installation.create", {
      body: {
        teamName: faker.company.name(),
        userName: faker.person.fullName(),
        userEmail: faker.internet.email().toLowerCase(),
      },
    });

    expect(res.status).toEqual(400);
    const body = await res.json();
    expect(body.message).toContain("Installation already has existing teams");
  });

  it("should validate required fields", async () => {
    const res = await server.post("/api/installation.create", {
      body: {
        teamName: "",
        userName: "",
        userEmail: "invalid-email",
      },
    });

    expect(res.status).toEqual(400);
  });

  it("should validate required password fields", async () => {
    passwordEnv.PASSWORD_AUTH_ENABLED = true;

    const res = await server.post("/api/installation.create", {
      body: {
        teamName: faker.company.name(),
        userName: faker.person.fullName(),
        userEmail: faker.internet.email().toLowerCase(),
      },
    });

    expect(res.status).toEqual(400);
  });

  it("should validate password confirmation", async () => {
    passwordEnv.PASSWORD_AUTH_ENABLED = true;

    const res = await server.post("/api/installation.create", {
      body: {
        teamName: faker.company.name(),
        userName: faker.person.fullName(),
        userEmail: faker.internet.email().toLowerCase(),
        password: "correct horse battery staple",
        passwordConfirmation: "different horse battery staple",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(400);
    expect(body.error).toEqual("validation_error");
  });

  it.skipIf(process.env.CI)(
    "should create a team and admin with a password when no teams exist",
    async () => {
      passwordEnv.PASSWORD_AUTH_ENABLED = true;

      await sequelize.query(
        "TRUNCATE TABLE teams, users, team_domains, user_authentications RESTART IDENTITY CASCADE"
      );

      const teamName = faker.company.name();
      const userName = faker.person.fullName();
      const userEmail = faker.internet.email().toLowerCase();
      const password = "correct horse battery staple";

      const res = await server.post("/api/installation.create", {
        body: {
          teamName,
          userName,
          userEmail,
          password,
          passwordConfirmation: password,
        },
        redirect: "manual",
      });

      expect(res.status).toEqual(302);
      expect(res.headers.get("location")).not.toBeNull();

      const [team, user] = await Promise.all([
        Team.findOne({
          where: {
            name: teamName,
          },
        }),
        User.findOne({
          where: {
            email: userEmail,
          },
        }),
      ]);

      expect(team).not.toBeNull();
      expect(user).not.toBeNull();
      expect(user?.passwordHash).toBeTruthy();
      await expect(user?.verifyPassword(password) ?? Promise.resolve(false)).resolves.toBe(
        true
      );
    }
  );
});

describe("installation.info", () => {
  it.skip("should require authentication", async () => {
    const res = await server.post("/api/installation.info", {
      body: {},
    });
    expect(res.status).toEqual(401);
  });

  it.skip("should return installation information", async () => {
    const user = await buildUser();
    const res = await server.post("/api/installation.info", user);

    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).not.toBeFalsy();
    expect(body.data.version).not.toBeFalsy();
    expect(body.data.latestVersion).not.toBeFalsy();
    expect(typeof body.data.versionsBehind).toBe("number");
    expect(body.policies).not.toBeFalsy();
  });
});
