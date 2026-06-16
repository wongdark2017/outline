import Router from "koa-router";
import { Op, Sequelize, type Transaction } from "sequelize";
import { z } from "zod";
import documentCreator from "@server/commands/documentCreator";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Collection, Document, JournalEntry } from "@server/models";
import { JournalEntryMood } from "@server/models/JournalEntry";
import { authorize } from "@server/policies";
import { BaseSchema } from "@server/routes/api/schema";
import { sequelize } from "@server/storage/database";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { zodTimezone } from "@server/utils/zod";
import { presentJournalEntry } from "../presenters/journalEntry";

const router = new Router();

const JOURNAL_COLLECTION_NAME = "__journal__";
const JOURNAL_SOURCE_EXTERNAL_ID = "outline:journal";
const JOURNAL_SOURCE_EXTERNAL_NAME = "Journal";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const zodDateOnly = () =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: "Expected YYYY-MM-DD format",
    })
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`);
      return !isNaN(date.getTime()) && date.toISOString().startsWith(value);
    }, "Invalid date");

const UpsertSchema = BaseSchema.extend({
  body: z.object({
    date: zodDateOnly(),
    mood: z.enum(JournalEntryMood).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    title: z.string().max(255).optional(),
    timezone: zodTimezone().optional(),
  }),
});

type UpsertReq = z.infer<typeof UpsertSchema>;

const EntriesSchema = BaseSchema.extend({
  body: z
    .object({
      startDate: zodDateOnly(),
      endDate: zodDateOnly(),
      direction: z.enum(["asc", "desc"]).prefault("desc"),
    })
    .refine((data) => data.startDate <= data.endDate, {
      message: "startDate must be <= endDate",
    })
    .refine(
      (data) => {
        const start = new Date(`${data.startDate}T00:00:00Z`);
        const end = new Date(`${data.endDate}T00:00:00Z`);
        const inclusiveDays = (end.getTime() - start.getTime()) / DAY_IN_MS + 1;
        return inclusiveDays <= 366;
      },
      { message: "Date range must not exceed 366 days" }
    ),
});

type EntriesReq = z.infer<typeof EntriesSchema>;

const CalendarSchema = BaseSchema.extend({
  body: z.object({
    year: z.number().int().min(2020).max(2100),
    month: z.number().int().min(1).max(12),
    timezone: zodTimezone().optional(),
  }),
});

type CalendarReq = z.infer<typeof CalendarSchema>;

const InfoSchema = BaseSchema.extend({
  body: z.object({
    date: zodDateOnly(),
  }),
});

type InfoReq = z.infer<typeof InfoSchema>;

router.post(
  "journal.upsert",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(UpsertSchema),
  transaction(),
  async (ctx: APIContext<UpsertReq>) => {
    const { date, mood, tags, title, timezone } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const today = todayInTimezone(user.timezone ?? timezone ?? "UTC");
    if (date > today) {
      ctx.throw(400, "Cannot create journal entries for future dates");
    }

    let entry = await findEntryWithDocument(
      user.id,
      user.teamId,
      date,
      transaction
    );
    if (entry) {
      await updateExistingEntry(ctx, entry, mood, tags);
      return;
    }

    const lockKey = `${user.teamId}:${user.id}:journal`;
    await sequelize.query(
      "SELECT pg_advisory_xact_lock(hashtextextended(:lockKey, 0))",
      {
        replacements: { lockKey },
        transaction,
      }
    );

    entry = await findEntryWithDocument(
      user.id,
      user.teamId,
      date,
      transaction
    );
    if (entry) {
      await updateExistingEntry(ctx, entry, mood, tags);
      return;
    }

    let collection = await Collection.findOne({
      where: {
        teamId: user.teamId,
        createdById: user.id,
        archivedAt: null,
        [Op.and]: Sequelize.where(
          Sequelize.literal(`"sourceMetadata"->>'externalId'`),
          JOURNAL_SOURCE_EXTERNAL_ID
        ),
      },
      transaction,
    });

    if (!collection) {
      authorize(user, "createCollection", user.team);

      collection = Collection.build({
        name: JOURNAL_COLLECTION_NAME,
        teamId: user.teamId,
        createdById: user.id,
        permission: null,
        sharing: false,
        sort: Collection.DEFAULT_SORT,
        sourceMetadata: {
          externalId: JOURNAL_SOURCE_EXTERNAL_ID,
          externalName: JOURNAL_SOURCE_EXTERNAL_NAME,
        },
      });
      await collection.saveWithCtx(ctx);
    }

    collection = await Collection.findByPk(collection.id, {
      userId: user.id,
      transaction,
      rejectOnEmpty: true,
    });
    authorize(user, "createDocument", collection);

    const document = await documentCreator(ctx, {
      title: title || date,
      text: "",
      collectionId: collection.id,
      publish: true,
    });

    entry = await JournalEntry.create(
      {
        userId: user.id,
        teamId: user.teamId,
        documentId: document.id,
        date,
        mood: mood ?? null,
        tags: tags ?? [],
      },
      { transaction }
    );

    entry.document = document;
    ctx.body = { data: presentJournalEntry(entry) };
  }
);

router.post(
  "journal.entries",
  auth(),
  validate(EntriesSchema),
  async (ctx: APIContext<EntriesReq>) => {
    const { startDate, endDate, direction } = ctx.input.body;
    const { user } = ctx.state.auth;

    const entries = await JournalEntry.findAll({
      where: {
        userId: user.id,
        teamId: user.teamId,
        date: { [Op.between]: [startDate, endDate] },
      },
      include: [
        {
          model: Document,
          as: "document",
          attributes: ["id", "title", "urlId", "updatedAt"],
          required: false,
        },
      ],
      order: [["date", direction]],
    });

    ctx.body = {
      data: entries.filter((entry) => entry.document).map(presentJournalEntry),
    };
  }
);

router.post(
  "journal.calendar",
  auth(),
  validate(CalendarSchema),
  async (ctx: APIContext<CalendarReq>) => {
    const { year, month, timezone } = ctx.input.body;
    const { user } = ctx.state.auth;
    const timeZone = timezone ?? user.timezone ?? "UTC";

    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(
      lastDay
    ).padStart(2, "0")}`;

    const entries = await JournalEntry.findAll({
      where: {
        userId: user.id,
        teamId: user.teamId,
        date: { [Op.between]: [startDate, endDate] },
      },
      attributes: ["date"],
      include: [
        {
          model: Document,
          as: "document",
          attributes: [],
          required: true,
        },
      ],
    });

    const { streak, capped } = await calculateStreak(
      user.id,
      user.teamId,
      timeZone
    );

    ctx.body = {
      data: {
        dates: entries.map((entry) => entry.date),
        streak,
        streakCapped: capped,
      },
    };
  }
);

router.post(
  "journal.info",
  auth(),
  validate(InfoSchema),
  async (ctx: APIContext<InfoReq>) => {
    const { date } = ctx.input.body;
    const { user } = ctx.state.auth;

    const entry = await findEntryWithDocument(user.id, user.teamId, date);
    if (!entry?.document) {
      ctx.throw(404, "Journal entry not found");
    }

    authorize(user, "read", entry);

    ctx.body = { data: presentJournalEntry(entry) };
  }
);

async function findEntryWithDocument(
  userId: string,
  teamId: string,
  date: string,
  transaction?: Transaction
) {
  return JournalEntry.findOne({
    where: { userId, teamId, date },
    include: [
      {
        model: Document,
        as: "document",
        required: false,
      },
    ],
    transaction,
  });
}

async function updateExistingEntry(
  ctx: APIContext<UpsertReq>,
  entry: JournalEntry,
  mood: JournalEntryMood | null | undefined,
  tags: string[] | undefined
) {
  const { user } = ctx.state.auth;
  const { transaction } = ctx.state;

  if (!entry.document) {
    ctx.throw(
      409,
      "Journal document is in Trash. Restore it to continue editing."
    );
  }

  const hasMetadataChange = mood !== undefined || tags !== undefined;
  authorize(user, hasMetadataChange ? "update" : "read", entry);

  if (mood !== undefined) {
    entry.mood = mood;
  }
  if (tags !== undefined) {
    entry.tags = tags;
  }
  if (entry.changed()) {
    await entry.save({ transaction });
  }

  ctx.body = { data: presentJournalEntry(entry) };
}

function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().split("T")[0];
}

async function calculateStreak(
  userId: string,
  teamId: string,
  timezone: string
): Promise<{ streak: number; capped: boolean }> {
  const today = todayInTimezone(timezone);
  const lookback = 367;
  const lookbackStart = addDays(today, -(lookback - 1));

  const entries = await JournalEntry.findAll({
    where: {
      userId,
      teamId,
      date: { [Op.between]: [lookbackStart, today] },
    },
    attributes: ["date"],
    include: [
      {
        model: Document,
        as: "document",
        attributes: [],
        required: true,
      },
    ],
    order: [["date", "DESC"]],
  });

  const dateSet = new Set(entries.map((entry) => entry.date));
  let streak = 0;
  let checkDate = today;

  while (dateSet.has(checkDate)) {
    streak++;
    checkDate = addDays(checkDate, -1);
  }

  const capped = streak >= lookback;
  return { streak: capped ? 366 : streak, capped };
}

export default router;
