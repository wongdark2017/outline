import Router from "@koa/router";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import validate from "@server/middlewares/validate";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import * as T from "./schema";
import { transaction } from "@server/middlewares/transaction";
import { APIContext } from "@server/types";
import { Document, Reminder } from "@server/models";

import { isError } from "es-toolkit";
import { authorize } from "@server/policies";
import pagination from "../middlewares/pagination";
import { presentPolicies } from "@server/presenters";
import presentReminder from "@server/presenters/reminder";
const router = new Router();
router.post(
    "reminders.create",
    rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
    auth(),
    validate(T.RemindersCreateSchema),
    transaction(),
    async (ctx: APIContext<T.RemindersCreateReq>) => {
        const { documentId, remindAt, note } = ctx.input.body;
        const { user } = ctx.state.auth;
        const { transaction } = ctx.state;

        const document = await Document.findByPk(documentId, {
            userId: user.id,
            transaction,
        });
        authorize(user, "remind", document);

        // createWithCtx passes the request transaction and records reminders.create
        const reminder = await Reminder.createWithCtx(ctx, {
            documentId: document.id,
            userId: user.id,
            teamId: user.teamId,
            remindAt,
            note: note ?? null,
        });

        ctx.body = {
            data: presentReminder(reminder),
            policies: presentPolicies(user, [reminder]),
        };
    }
);

router.post(
    "reminder.list",
    auth(),
    pagination(),
    validate(T.ReminderListSchema),
    async (ctx: APIContext<T.ReminderListReq>) => {
        const { documentId } = ctx.input.body;
        const { user } = ctx.state.auth;

        const reminders = await Reminder.findAll({
            where: {
                userId: user.id,
                sentAt: null,
                ...(documentId ? { documentId } : {}),
            },
            order: [["remindAt", "ASC"]],
            offset: ctx.state.pagination.offset,
            limit: ctx.state.pagination.limit,
        });

        ctx.body = {
            pagination: ctx.state.pagination,
            data: reminders.map(presentReminder),
            policies: presentPolicies(user, reminders),
        };
    }
);

router.post(
    "reminders.delete",
    auth(),
    validate(T.ReminderDeleteSchema),
    transaction(),
    async (ctx: APIContext<T.ReminderDeleteReq>) => {
        const { id } = ctx.input.body;
        const { user } = ctx.state.auth;
        const { transaction } = ctx.state;

        const reminder = await Reminder.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        authorize(user, "delete", reminder);
        await reminder.destroyWithCtx(ctx);
        ctx.body = { success: true };
    }
);

export default router;