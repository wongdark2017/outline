import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { faker } from "@faker-js/faker";
import { reloadEnvironment } from "@server/env";
import { sequelize } from "@server/storage/database";
import { resetFileStorage } from "@server/storage/files";
import { buildUser, buildTeam } from "@server/test/factories";
import { getTestServer, setSelfHosted } from "@server/test/support";
import { getEnvironment } from "@server/utils/environment";
import { SystemSetting, Team, User } from "@server/models";
import passwordEnv from "../../../../plugins/password/server/env";

setSelfHosted();
const server = getTestServer();
const originalEnvironment = { ...getEnvironment() };
const originalProcessEnv = { ...process.env };

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

describe.sequential("installation.setup", () => {
  afterEach(() => {
    restoreEnvironment();
    passwordEnv.PASSWORD_AUTH_ENABLED = false;
  });

  it("should create the first team, system admin, and install settings", async () => {
    passwordEnv.PASSWORD_AUTH_ENABLED = true;
    await truncateInstallationState();

    const teamName = faker.company.name();
    const userName = faker.person.fullName();
    const userEmail = faker.internet.email().toLowerCase();
    const password = "correct horse battery staple";

    const res = await server.post("/api/installation.setup", {
      body: {
        teamName,
        userName,
        userEmail,
        password,
        passwordConfirmation: password,
        url: "https://docs.example.com",
        defaultLanguage: "en_US",
        forceHttps: false,
        fileStorage: "local",
      },
      redirect: "manual",
    });

    expect(res.status).toEqual(302);

    const [team, user, settings] = await Promise.all([
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
      SystemSetting.getAll(),
    ]);

    expect(team).not.toBeNull();
    expect(user).not.toBeNull();
    expect(user?.isSystemAdmin).toBe(true);
    expect(user?.passwordHash).toBeTruthy();
    await expect(user?.verifyPassword(password) ?? Promise.resolve(false)).resolves.toBe(
      true
    );
    expect(settings).toMatchObject({
      URL: "https://docs.example.com",
      DEFAULT_LANGUAGE: "en_US",
      FORCE_HTTPS: "false",
      FILE_STORAGE: "local",
    });
  });

  it("should fail when teams already exist", async () => {
    await truncateInstallationState();
    await buildTeam();

    const res = await server.post("/api/installation.setup", {
      body: {
        teamName: faker.company.name(),
        userName: faker.person.fullName(),
        userEmail: faker.internet.email().toLowerCase(),
        url: "https://docs.example.com",
        defaultLanguage: "en_US",
        forceHttps: false,
        fileStorage: "local",
      },
    });

    expect(res.status).toEqual(400);
    const body = await res.json();
    expect(body.message).toContain("Installation already has existing teams");
  });
});

describe.sequential("installation.testStorage", () => {
  beforeEach(() => {
    vi.mocked(S3Client).mockReset();
    vi.mocked(PutObjectCommand).mockClear();
    vi.mocked(DeleteObjectCommand).mockClear();
  });

  it("should verify S3 settings by putting and deleting a test object", async () => {
    await truncateInstallationState();
    const send = mockS3Send();

    const res = await server.post("/api/installation.testStorage", {
      body: {
        s3BucketName: "outline-files",
        s3Region: "us-east-1",
        s3AccessKeyId: "access-key",
        s3SecretAccessKey: "secret-key",
        s3Endpoint: "https://s3.example.com",
        s3ForcePathStyle: true,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.success).toBe(true);
    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          accessKeyId: "access-key",
          secretAccessKey: "secret-key",
        },
        endpoint: "https://s3.example.com",
        forcePathStyle: true,
        region: "us-east-1",
      })
    );
    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: "outline-files",
        Body: "outline setup storage test",
        ContentType: "text/plain",
      })
    );
    expect(DeleteObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: "outline-files",
      })
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("should return a sanitized failure when S3 write validation fails", async () => {
    await truncateInstallationState();
    mockS3Send(vi.fn().mockRejectedValue(new Error("secret-key rejected")));

    const res = await server.post("/api/installation.testStorage", {
      body: {
        s3BucketName: "outline-files",
        s3AccessKeyId: "access-key",
        s3SecretAccessKey: "secret-key",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.success).toBe(false);
    expect(body.data.error).toBe(
      "Unable to write and delete a test object with these S3 settings."
    );
    expect(body.data.error).not.toContain("secret-key");
  });

  it("should fail when teams already exist", async () => {
    await truncateInstallationState();
    await buildTeam();

    const res = await server.post("/api/installation.testStorage", {
      body: {
        s3BucketName: "outline-files",
        s3AccessKeyId: "access-key",
        s3SecretAccessKey: "secret-key",
      },
    });

    expect(res.status).toEqual(400);
  });
});

describe("installation.systemInfo", () => {
  beforeEach(async () => {
    await truncateInstallationState();
  });

  afterEach(() => {
    restoreEnvironment();
  });

  it("should return effective settings for the system admin", async () => {
    const user = await buildUser({ isSystemAdmin: true });
    await SystemSetting.bulkSet([
      { key: "AWS_REGION", value: "us-east-1" },
      { key: "AWS_SECRET_ACCESS_KEY", value: "secret-key" },
    ]);

    const res = await server.post("/api/installation.systemInfo", user, {
      body: {},
    });
    const body = await res.json();
    const settings = body.data.settings as Array<{
      key: string;
      value: string;
      source: string;
      isSensitive: boolean;
    }>;

    expect(res.status).toEqual(200);
    expect(settings).toContainEqual(
      expect.objectContaining({
        key: "AWS_REGION",
        value: "us-east-1",
        source: "database",
        isSensitive: false,
      })
    );
    expect(settings).toContainEqual(
      expect.objectContaining({
        key: "AWS_SECRET_ACCESS_KEY",
        value: "********",
        source: "database",
        isSensitive: true,
      })
    );
  });

  it("should reject authenticated users who are not system admins", async () => {
    const user = await buildUser();

    const res = await server.post("/api/installation.systemInfo", user, {
      body: {},
    });
    const body = await res.json();

    expect(res.status).toEqual(403);
    expect(body.message).toContain("System admin access required");
  });
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

async function truncateInstallationState() {
  await sequelize.query(
    "TRUNCATE TABLE system_settings, teams, users, team_domains, user_authentications RESTART IDENTITY CASCADE"
  );
}

function restoreEnvironment() {
  for (const key of Object.keys(getEnvironment())) {
    delete getEnvironment()[key];
  }

  Object.assign(getEnvironment(), originalEnvironment);
  process.env = { ...originalProcessEnv };
  reloadEnvironment();
  resetFileStorage();
}

function mockS3Send(send = vi.fn().mockResolvedValue({})) {
  vi.mocked(S3Client).mockImplementation(function () {
    return {
      send,
    } as unknown as S3Client;
  });

  return send;
}
