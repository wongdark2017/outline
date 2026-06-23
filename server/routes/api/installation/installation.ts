import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import Router from "koa-router";
import { Client, UserRole } from "@shared/types";
import slugify from "@shared/utils/slugify";
import env, { reloadEnvironment } from "@server/env";
import teamCreator from "@server/commands/teamCreator";
import { AuthorizationError, ValidationError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { SystemSetting, Team, User } from "@server/models";
import { sequelize } from "@server/storage/database";
import { resetFileStorage } from "@server/storage/files";
import type { APIContext } from "@server/types";
import { signIn } from "@server/utils/authentication";
import { getVersion, getVersionInfo } from "@server/utils/getInstallationInfo";
import {
  applySystemSettingsToEnvironment,
  buildSystemSettingEntriesFromSetupInput,
  getEffectiveSystemSettings,
  isSupportedSystemSettingKey,
  supportedSystemSettingKeys,
  type SupportedSystemSettingKey,
} from "@server/utils/systemSettings";
import passwordEnv from "../../../../plugins/password/server/env";
import * as T from "./schema";

// Note: This entire router is only mounted in self-hosted installations.
const router = new Router();

router.post(
  "installation.create",
  validate(T.InstallationCreateSchema),
  transaction(),
  async (ctx: APIContext<T.InstallationCreateSchemaReq>) => {
    const {
      teamName,
      userName,
      userEmail,
      password,
      passwordConfirmation,
    } = ctx.input.body;
    const { transaction } = ctx.state;

    // Check that this can only be called when there are no existing teams
    const existingTeamCount = await Team.count({ transaction });
    if (existingTeamCount > 0) {
      throw ValidationError("Installation already has existing teams");
    }

    if (passwordEnv.PASSWORD_AUTH_ENABLED) {
      if (!password || !passwordConfirmation) {
        throw ValidationError("Password is required");
      }

      if (password !== passwordConfirmation) {
        throw ValidationError("Passwords do not match");
      }
    }

    const team = await teamCreator(ctx, {
      name: teamName,
      subdomain: slugify(teamName),
      authenticationProviders: [],
    });

    const user = await User.createWithCtx(ctx, {
      name: userName,
      email: userEmail,
      teamId: team.id,
      role: UserRole.Admin,
      passwordHash:
        passwordEnv.PASSWORD_AUTH_ENABLED && password
          ? await User.hashPassword(password)
          : undefined,
    });

    await signIn(ctx, passwordEnv.PASSWORD_AUTH_ENABLED ? "password" : "email", {
      user,
      team,
      isNewTeam: true,
      isNewUser: true,
      client: Client.Web,
    });
  }
);

router.post(
  "installation.setup",
  validate(T.InstallationSetupSchema),
  async (ctx: APIContext<T.InstallationSetupSchemaReq>) => {
    const {
      teamName,
      userName,
      userEmail,
      password,
      passwordConfirmation,
    } = ctx.input.body;

    if (passwordEnv.PASSWORD_AUTH_ENABLED) {
      if (!password || !passwordConfirmation) {
        throw ValidationError("Password is required");
      }

      if (password !== passwordConfirmation) {
        throw ValidationError("Passwords do not match");
      }
    }

    const systemSettingEntries = buildSystemSettingEntriesFromSetupInput(
      ctx.input.body
    );

    const { team, user } = await sequelize.transaction(async (transaction) => {
      ctx.state.transaction = transaction;

      const existingTeamCount = await Team.count({ transaction });
      if (existingTeamCount > 0) {
        throw ValidationError("Installation already has existing teams");
      }

      const team = await teamCreator(ctx, {
        name: teamName,
        subdomain: slugify(teamName),
        authenticationProviders: [],
      });

      const user = await User.createWithCtx(ctx, {
        name: userName,
        email: userEmail,
        teamId: team.id,
        role: UserRole.Admin,
        isSystemAdmin: true,
        passwordHash:
          passwordEnv.PASSWORD_AUTH_ENABLED && password
            ? await User.hashPassword(password)
            : undefined,
      });

      await SystemSetting.bulkSet(systemSettingEntries, { transaction });

      return {
        team,
        user,
      };
    });

    applySystemSettingsToEnvironment(systemSettingEntries);
    reloadEnvironment();
    resetFileStorage();

    const transaction = ctx.state.transaction;
    Reflect.deleteProperty(ctx.state, "transaction");

    try {
      await signIn(ctx, passwordEnv.PASSWORD_AUTH_ENABLED ? "password" : "email", {
        user,
        team,
        isNewTeam: true,
        isNewUser: true,
        client: Client.Web,
      });
    } finally {
      ctx.state.transaction = transaction;
    }
  }
);

router.post(
  "installation.testStorage",
  validate(T.InstallationTestStorageSchema),
  async (ctx: APIContext<T.InstallationTestStorageSchemaReq>) => {
    const existingTeamCount = await Team.count();
    if (existingTeamCount > 0) {
      throw ValidationError("Installation already has existing teams");
    }

    const {
      s3AccessKeyId,
      s3BucketName,
      s3Endpoint,
      s3ForcePathStyle,
      s3Region,
      s3SecretAccessKey,
    } = ctx.input.body;
    const client = new S3Client({
      credentials: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
      },
      endpoint: s3Endpoint,
      forcePathStyle: s3ForcePathStyle,
      region: s3Region,
    });
    const key = `setup-test/${crypto.randomUUID()}.txt`;

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: s3BucketName,
          Key: key,
          Body: "outline setup storage test",
          ContentType: "text/plain",
        })
      );
      await client.send(
        new DeleteObjectCommand({
          Bucket: s3BucketName,
          Key: key,
        })
      );

      ctx.body = {
        data: {
          success: true,
        },
        policies: [],
      };
    } catch (_err) {
      ctx.body = {
        data: {
          success: false,
          error: "Unable to write and delete a test object with these S3 settings.",
        },
        policies: [],
      };
    }
  }
);

router.post(
  "installation.systemInfo",
  auth(),
  async (ctx: APIContext<T.InstallationSystemInfoSchemaReq>) => {
    const { user } = ctx.state.auth;

    if (!user.isSystemAdmin) {
      throw AuthorizationError("System admin access required");
    }

    const persistedSettings = filterSupportedSettings(
      await SystemSetting.getAll()
    );

    ctx.body = {
      data: {
        settings: getEffectiveSystemSettings(
          persistedSettings,
          getEffectiveEnvironmentValues()
        ),
      },
      policies: [],
    };
  }
);

router.post("installation.info", auth(), async (ctx: APIContext) => {
  const currentVersion = getVersion();
  const { latestVersion, versionsBehind } =
    await getVersionInfo(currentVersion);

  ctx.body = {
    data: {
      version: currentVersion,
      latestVersion,
      versionsBehind,
    },
    policies: [],
  };
});

function getEffectiveEnvironmentValues() {
  return supportedSystemSettingKeys.reduce<
    Partial<Record<SupportedSystemSettingKey, string>>
  >((acc, key) => {
    const value = env[key];

    if (value !== undefined) {
      acc[key] = String(value);
    }

    return acc;
  }, {});
}

function filterSupportedSettings(settings: Record<string, string>) {
  return Object.entries(settings).reduce<
    Partial<Record<SupportedSystemSettingKey, string>>
  >((acc, [key, value]) => {
    if (isSupportedSystemSettingKey(key)) {
      acc[key] = value;
    }

    return acc;
  }, {});
}

export default router;
