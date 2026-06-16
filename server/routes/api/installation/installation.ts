import Router from "koa-router";
import { Client, UserRole } from "@shared/types";
import slugify from "@shared/utils/slugify";
import teamCreator from "@server/commands/teamCreator";
import { ValidationError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Team, User } from "@server/models";
import type { APIContext } from "@server/types";
import { signIn } from "@server/utils/authentication";
import { getVersion, getVersionInfo } from "@server/utils/getInstallationInfo";
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

export default router;
