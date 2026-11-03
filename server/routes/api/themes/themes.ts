import Router from "@koa/router";
import type { WhereOptions } from "sequelize";
import { Op } from "sequelize";
import { TeamPreference, ThemeChoice } from "@shared/types";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Team, Theme, User } from "@server/models";
import { authorize } from "@server/policies";
import { presentPolicies, presentTheme } from "@server/presenters";
import { QueryHelper } from "@server/storage/QueryHelper";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import pagination from "../middlewares/pagination";
import * as T from "./schema";

const router = new Router();

const include = [
  {
    model: User,
    as: "createdBy",
    paranoid: false,
  },
];

router.post(
  "themes.info",
  auth(),
  validate(T.ThemesInfoSchema),
  async (ctx: APIContext<T.ThemesInfoReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;

    const theme = await Theme.findByPk(id, {
      include,
      rejectOnEmpty: true,
    });
    authorize(user, "read", theme);

    ctx.body = {
      data: presentTheme(theme),
      policies: presentPolicies(user, [theme]),
    };
  }
);

router.post(
  "themes.list",
  auth(),
  pagination(),
  validate(T.ThemesListSchema),
  async (ctx: APIContext<T.ThemesListReq>) => {
    const { user } = ctx.state.auth;
    const { query } = ctx.input.body;

    let where: WhereOptions<Theme> = {
      teamId: user.teamId,
    };

    if (query) {
      where = {
        ...where,
        name: { [Op.iLike]: QueryHelper.likeContains(query) },
      };
    }

    const [themes, total] = await Promise.all([
      Theme.findAll({
        where,
        include,
        order: [["name", "ASC"]],
        offset: ctx.state.pagination.offset,
        limit: ctx.state.pagination.limit,
      }),
      Theme.count({ where }),
    ]);

    ctx.body = {
      pagination: { ...ctx.state.pagination, total },
      data: themes.map(presentTheme),
      policies: presentPolicies(user, themes),
    };
  }
);

router.post(
  "themes.create",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.ThemesCreateSchema),
  transaction(),
  async (ctx: APIContext<T.ThemesCreateReq>) => {
    const { name, light, dark } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const team = await Team.findByPk(user.teamId, {
      transaction,
      rejectOnEmpty: true,
    });
    authorize(user, "createTheme", team);

    const theme = await Theme.createWithCtx(ctx, {
      name,
      light,
      dark,
      teamId: user.teamId,
      createdById: user.id,
    });
    theme.createdBy = user;

    ctx.body = {
      data: presentTheme(theme),
      policies: presentPolicies(user, [theme]),
    };
  }
);

router.post(
  "themes.update",
  auth(),
  validate(T.ThemesUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.ThemesUpdateReq>) => {
    const { id, name, light, dark } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    // The lock is restricted to the theme row: Postgres refuses FOR UPDATE on
    // the nullable side of the outer join added by the createdBy include.
    const theme = await Theme.findByPk(id, {
      include,
      transaction,
      rejectOnEmpty: true,
      lock: { level: transaction.LOCK.UPDATE, of: Theme },
    });
    authorize(user, "update", theme);

    if (name !== undefined) {
      theme.name = name;
    }
    if (light !== undefined) {
      theme.light = light;
    }
    if (dark !== undefined) {
      theme.dark = dark;
    }
    await theme.save({ transaction });

    ctx.body = {
      data: presentTheme(theme),
      policies: presentPolicies(user, [theme]),
    };
  }
);

router.post(
  "themes.delete",
  auth(),
  validate(T.ThemesDeleteSchema),
  transaction(),
  async (ctx: APIContext<T.ThemesDeleteReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const theme = await Theme.findByPk(id, {
      transaction,
      rejectOnEmpty: true,
      lock: transaction.LOCK.UPDATE,
    });
    authorize(user, "delete", theme);

    // A workspace default that points at the deleted theme falls back to the
    // built-in colors. User preferences are resolved on the client, which
    // already falls back when a theme can't be loaded.
    const team = await Team.findByPk(theme.teamId, {
      transaction,
      rejectOnEmpty: true,
      lock: transaction.LOCK.UPDATE,
    });
    let teamChanged = false;
    for (const key of [
      TeamPreference.DefaultLightTheme,
      TeamPreference.DefaultDarkTheme,
    ] as const) {
      if (team.getPreference(key) === theme.id) {
        team.setPreference(key, ThemeChoice.Builtin);
        teamChanged = true;
      }
    }
    if (teamChanged) {
      await team.save({ transaction });
    }

    await theme.destroyWithCtx(ctx);

    ctx.body = {
      success: true,
    };
  }
);

export default router;
