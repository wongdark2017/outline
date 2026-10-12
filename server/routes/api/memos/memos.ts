import Router from "koa-router";
import { Op, Transaction } from "sequelize";
import memoCreator from "@server/commands/memoCreator";
import memoUpdater from "@server/commands/memoUpdater";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Memo } from "@server/models";
import { authorize } from "@server/policies";
import { presentPolicies } from "@server/presenters";
import presentMemo from "@server/presenters/memo";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import pagination from "../middlewares/pagination";
import * as T from "./schema";

const router = new Router();

router.post(
  "memos.create",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.MemosCreateSchema),
  transaction(),
  async (ctx: APIContext<T.MemosCreateReq>) => {
    const { content, visibility } = ctx.input.body;
    const { user } = ctx.state.auth;

    const memo = await memoCreator({
      ctx,
      user,
      content,
      visibility,
    });

    ctx.body = {
      data: presentMemo(memo),
      policies: presentPolicies(user, [memo]),
    };
  }
);

router.post(
  "memos.list",
  auth(),
  validate(T.MemosListSchema),
  pagination(),
  async (ctx: APIContext<T.MemosListReq>) => {
    const { archived, tag } = ctx.input.body;
    const { user } = ctx.state.auth;

    const memos = await Memo.findAll({
      where: {
        teamId: user.teamId,
        userId: user.id,
        archivedAt: archived ? { [Op.not]: null } : null,
        ...(tag ? { tags: { [Op.contains]: [tag] } } : undefined),
      },
      order: [["createdAt", "DESC"]],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
    });

    ctx.body = {
      pagination: ctx.state.pagination,
      data: memos.map(presentMemo),
      policies: presentPolicies(user, memos),
    };
  }
);

router.post(
  "memos.info",
  auth(),
  validate(T.MemosInfoSchema),
  async (ctx: APIContext<T.MemosInfoReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const memo = await Memo.findByPk(id, {
      rejectOnEmpty: true,
    });

    authorize(user, "read", memo);

    ctx.body = {
      data: presentMemo(memo),
      policies: presentPolicies(user, [memo]),
    };
  }
);

router.post(
  "memos.update",
  auth(),
  validate(T.MemosUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.MemosUpdateReq>) => {
    const { id, content, visibility } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const memo = await Memo.findByPk(id, {
      rejectOnEmpty: true,
      transaction,
      lock: Transaction.LOCK.UPDATE,
    });

    authorize(user, "update", memo);

    await memoUpdater({
      ctx,
      memo,
      content,
      visibility,
    });

    ctx.body = {
      data: presentMemo(memo),
      policies: presentPolicies(user, [memo]),
    };
  }
);

router.post(
  "memos.archive",
  auth(),
  validate(T.MemosArchiveSchema),
  transaction(),
  async (ctx: APIContext<T.MemosArchiveReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const memo = await Memo.findByPk(id, {
      rejectOnEmpty: true,
      transaction: ctx.state.transaction,
      lock: Transaction.LOCK.UPDATE,
    });

    authorize(user, "archive", memo);

    await memo.updateWithCtx(ctx, {
      archivedAt: new Date(),
    });

    ctx.body = {
      data: presentMemo(memo),
      policies: presentPolicies(user, [memo]),
    };
  }
);

router.post(
  "memos.delete",
  auth(),
  validate(T.MemosDeleteSchema),
  transaction(),
  async (ctx: APIContext<T.MemosDeleteReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const memo = await Memo.findByPk(id, {
      rejectOnEmpty: true,
      transaction: ctx.state.transaction,
      lock: Transaction.LOCK.UPDATE,
    });

    authorize(user, "delete", memo);
    await memo.destroyWithCtx(ctx);

    ctx.body = {
      success: true,
    };
  }
);

router.post(
  "memos.tags",
  auth(),
  validate(T.MemosTagsSchema),
  async (ctx: APIContext<T.MemosTagsReq>) => {
    const { query } = ctx.input.body;
    const { user } = ctx.state.auth;
    const memos = await Memo.findAll({
      where: {
        teamId: user.teamId,
        userId: user.id,
      },
      attributes: ["tags"],
      order: [["updatedAt", "DESC"]],
      limit: 100,
    });

    const tags = Array.from(
      new Set(
        memos.flatMap((memo) => memo.tags).filter((tag) => {
          if (!query) {
            return true;
          }

          return tag.toLowerCase().includes(query.toLowerCase());
        })
      )
    );

    ctx.body = {
      data: tags,
    };
  }
);

export default router;
