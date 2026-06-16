import { UniqueConstraintError } from "sequelize";
import env from "@server/env";
import {
  Collection,
  Document,
  JournalEntry,
  UserMembership,
} from "@server/models";
import { JournalEntryMood } from "@server/models/JournalEntry";
import RateLimiter from "@server/utils/RateLimiter";
import { randomString } from "@shared/random";
import { CollectionPermission } from "@shared/types";
import {
  buildCollection,
  buildDocument,
  buildGuestUser,
  buildTeam,
  buildUser,
  buildViewer,
} from "@server/test/factories";
import { getTestServer, withAPIContext } from "@server/test/support";

const server = getTestServer();

async function createJournalEntry(
  user: Awaited<ReturnType<typeof buildUser>>,
  overrides: Partial<JournalEntry> & { date: string }
) {
  const { date, ...entryOverrides } = overrides;
  const collection = await buildCollection({
    name: "__journal__",
    userId: user.id,
    teamId: user.teamId,
    permission: null,
    sharing: false,
    sourceMetadata: {
      externalId: "outline:journal",
      externalName: "Journal",
    },
  });
  const document = await buildDocument({
    userId: user.id,
    teamId: user.teamId,
    collectionId: collection.id,
    title: overrides.date,
  });
  const entry = await JournalEntry.create({
    userId: user.id,
    teamId: user.teamId,
    documentId: document.id,
    date,
    mood: null,
    tags: [],
    ...entryOverrides,
  });

  return { collection, document, entry, user };
}

async function createJournalEntries(
  user: Awaited<ReturnType<typeof buildUser>>,
  dates: string[]
) {
  const collection = await buildCollection({
    name: "__journal__",
    userId: user.id,
    teamId: user.teamId,
    permission: null,
    sharing: false,
    sourceMetadata: {
      externalId: "outline:journal",
      externalName: "Journal",
    },
  });

  return Promise.all(
    dates.map(async (date) => {
      const document = await buildDocument({
        userId: user.id,
        teamId: user.teamId,
        collectionId: collection.id,
        title: date,
      });

      return JournalEntry.create({
        userId: user.id,
        teamId: user.teamId,
        documentId: document.id,
        date,
        mood: null,
        tags: [],
      });
    })
  );
}

async function createJournalEntriesFast(
  user: Awaited<ReturnType<typeof buildUser>>,
  dates: string[]
) {
  const collection = await buildCollection({
    name: "__journal__",
    userId: user.id,
    teamId: user.teamId,
    permission: null,
    sharing: false,
    sourceMetadata: {
      externalId: "outline:journal",
      externalName: "Journal",
    },
  });
  const documents = await Document.bulkCreate(
    dates.map((date) => ({
      urlId: randomString(10),
      title: date,
      text: "",
      content: null,
      publishedAt: new Date(),
      teamId: user.teamId,
      collectionId: collection.id,
      createdById: user.id,
      lastModifiedById: user.id,
      editorVersion: "12.0.0",
    }))
  );

  await JournalEntry.bulkCreate(
    documents.map((document, index) => ({
      userId: user.id,
      teamId: user.teamId,
      documentId: document.id,
      date: dates[index],
      mood: null,
      tags: [],
    }))
  );
}

function datesEndingAt(endDate: string, count: number) {
  const end = new Date(`${endDate}T12:00:00Z`);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - index);
    return date.toISOString().split("T")[0];
  });
}

function todayInUTC() {
  return new Date().toISOString().split("T")[0];
}

function addDays(date: string, days: number) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().split("T")[0];
}

function yearAndMonth(date: string) {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
  };
}

describe("#journal.upsert", () => {
  it("creates a private journal collection, document, and entry", async () => {
    const user = await buildUser();
    const res = await server.post("/api/journal.upsert", user, {
      body: {
        date: "2026-06-01",
        mood: JournalEntryMood.Productive,
        tags: ["writing"],
        title: "Daily notes",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.date).toEqual("2026-06-01");
    expect(body.data.mood).toEqual(JournalEntryMood.Productive);
    expect(body.data.tags).toEqual(["writing"]);
    expect(body.data.document.url).toMatch(/^\/doc\/daily-notes-/);

    const entry = await JournalEntry.findByPk(body.data.id);
    expect(entry?.documentId).toEqual(body.data.documentId);

    const collection = await Collection.findOne({
      where: {
        teamId: user.teamId,
        createdById: user.id,
        name: "__journal__",
      },
    });
    expect(collection?.permission).toEqual(null);
    expect(collection?.sharing).toEqual(false);
    expect(collection?.sourceMetadata).toEqual({
      externalId: "outline:journal",
      externalName: "Journal",
    });
  });

  it("returns the same document on repeated upsert", async () => {
    const user = await buildUser();
    const first = await server.post("/api/journal.upsert", user, {
      body: { date: "2026-06-01" },
    });
    const second = await server.post("/api/journal.upsert", user, {
      body: { date: "2026-06-01" },
    });
    const [firstBody, secondBody] = await Promise.all([
      first.json(),
      second.json(),
    ]);

    expect(first.status).toEqual(200);
    expect(second.status).toEqual(200);
    expect(secondBody.data.id).toEqual(firstBody.data.id);
    expect(secondBody.data.documentId).toEqual(firstBody.data.documentId);
    await expect(
      JournalEntry.count({
        where: {
          teamId: user.teamId,
          userId: user.id,
          date: "2026-06-01",
        },
      })
    ).resolves.toEqual(1);
  });

  it("does not create duplicates under concurrent upsert", async () => {
    const user = await buildUser();
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        server.post("/api/journal.upsert", user, {
          body: { date: "2026-06-01" },
        })
      )
    );
    const bodies = await Promise.all(responses.map((res) => res.json()));

    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(new Set(bodies.map((body) => body.data.id)).size).toEqual(1);
    expect(new Set(bodies.map((body) => body.data.documentId)).size).toEqual(1);
    await expect(
      JournalEntry.count({
        where: {
          teamId: user.teamId,
          userId: user.id,
          date: "2026-06-01",
        },
      })
    ).resolves.toEqual(1);
    await expect(
      Document.count({
        where: {
          teamId: user.teamId,
          createdById: user.id,
          title: "2026-06-01",
        },
      })
    ).resolves.toEqual(1);
  });

  it("isolates entries for different users on the same date", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const otherUser = await buildUser({ teamId: team.id });

    const first = await server.post("/api/journal.upsert", user, {
      body: { date: "2026-06-01" },
    });
    const second = await server.post("/api/journal.upsert", otherUser, {
      body: { date: "2026-06-01" },
    });
    const [firstBody, secondBody] = await Promise.all([
      first.json(),
      second.json(),
    ]);

    expect(first.status).toEqual(200);
    expect(second.status).toEqual(200);
    expect(firstBody.data.id).not.toEqual(secondBody.data.id);
    expect(firstBody.data.documentId).not.toEqual(secondBody.data.documentId);
  });

  it("updates mood and tags, and clears mood with null", async () => {
    const { user } = await createJournalEntry(await buildUser(), {
      date: "2026-06-01",
      mood: JournalEntryMood.Neutral,
      tags: ["draft"],
    });

    const update = await server.post("/api/journal.upsert", user, {
      body: {
        date: "2026-06-01",
        mood: JournalEntryMood.Inspired,
        tags: ["work", "idea"],
      },
    });
    const clear = await server.post("/api/journal.upsert", user, {
      body: {
        date: "2026-06-01",
        mood: null,
      },
    });
    const [updateBody, clearBody] = await Promise.all([
      update.json(),
      clear.json(),
    ]);

    expect(update.status).toEqual(200);
    expect(updateBody.data.mood).toEqual(JournalEntryMood.Inspired);
    expect(updateBody.data.tags).toEqual(["work", "idea"]);
    expect(clear.status).toEqual(200);
    expect(clearBody.data.mood).toEqual(null);
    expect(clearBody.data.tags).toEqual(["work", "idea"]);
  });

  it("registers a per-route rate limiter", async () => {
    const originalRateLimiterEnabled = env.RATE_LIMITER_ENABLED;
    env.RATE_LIMITER_ENABLED = true;
    RateLimiter.rateLimiterMap.clear();

    try {
      const user = await buildUser();
      await server.post("/api/journal.upsert", user, {
        body: { date: "2026-06-01" },
      });

      expect(RateLimiter.hasRateLimiter("/api/journal.upsert")).toBe(true);
      expect(RateLimiter.getRateLimiter("/api/journal.upsert").points).toEqual(
        25
      );
    } finally {
      env.RATE_LIMITER_ENABLED = originalRateLimiterEnabled;
      RateLimiter.rateLimiterMap.clear();
    }
  });

  it("does not reuse an unmarked historical __journal__ collection", async () => {
    const user = await buildUser();
    const historicalCollection = await buildCollection({
      name: "__journal__",
      userId: user.id,
      teamId: user.teamId,
      permission: null,
      sharing: false,
      sourceMetadata: null,
    });

    const res = await server.post("/api/journal.upsert", user, {
      body: { date: "2026-06-01" },
    });
    const body = await res.json();
    const document = await Document.findByPk(body.data.documentId);

    expect(res.status).toEqual(200);
    expect(document?.collectionId).not.toEqual(historicalCollection.id);
  });

  it("reuses a marked journal collection", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      name: "__journal__",
      userId: user.id,
      teamId: user.teamId,
      permission: null,
      sharing: false,
      sourceMetadata: {
        externalId: "outline:journal",
        externalName: "Journal",
      },
    });

    const res = await server.post("/api/journal.upsert", user, {
      body: { date: "2026-06-01" },
    });
    const body = await res.json();
    const document = await Document.findByPk(body.data.documentId);

    expect(res.status).toEqual(200);
    expect(document?.collectionId).toEqual(collection.id);
    await expect(
      Collection.count({
        where: {
          teamId: user.teamId,
          createdById: user.id,
          name: "__journal__",
        },
      })
    ).resolves.toEqual(1);
  });

  it("allows a viewer to open their existing entry without metadata changes", async () => {
    const viewer = await buildViewer();
    const { entry } = await createJournalEntry(viewer, {
      date: "2026-06-01",
    });

    const res = await server.post("/api/journal.upsert", viewer, {
      body: { date: "2026-06-01" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.id).toEqual(entry.id);
  });

  it("rejects viewer and guest metadata updates", async () => {
    const viewer = await buildViewer();
    await createJournalEntry(viewer, { date: "2026-06-01" });

    const guest = await buildGuestUser({ teamId: viewer.teamId });
    const { collection, document } = await createJournalEntry(guest, {
      date: "2026-06-01",
    });
    await UserMembership.update(
      { permission: CollectionPermission.Read },
      { where: { collectionId: collection.id, userId: guest.id } }
    );

    const viewerRes = await server.post("/api/journal.upsert", viewer, {
      body: {
        date: "2026-06-01",
        tags: ["blocked"],
      },
    });
    const guestRes = await server.post("/api/journal.upsert", guest, {
      body: {
        date: "2026-06-01",
        mood: JournalEntryMood.Tired,
      },
    });

    expect(viewerRes.status).toEqual(403);
    expect(guestRes.status).toEqual(403);
    expect(document.collectionId).toBeTruthy();
  });

  it("rejects new journal creation when the user cannot create collections", async () => {
    const team = await buildTeam({ memberCollectionCreate: false });
    const viewer = await buildViewer({ teamId: team.id });

    const res = await server.post("/api/journal.upsert", viewer, {
      body: { date: "2026-06-01" },
    });

    expect(res.status).toEqual(403);
  });

  it("rejects future and invalid dates", async () => {
    const user = await buildUser();

    const future = await server.post("/api/journal.upsert", user, {
      body: { date: addDays(todayInUTC(), 1) },
    });
    const invalid = await server.post("/api/journal.upsert", user, {
      body: { date: "2026-02-31" },
    });

    expect(future.status).toEqual(400);
    expect(invalid.status).toEqual(400);
  });

  it("returns 409 when the existing journal document is trashed", async () => {
    const { document, user } = await createJournalEntry(await buildUser(), {
      date: "2026-06-01",
    });
    await withAPIContext(user, (ctx) => document.destroyWithCtx(ctx));

    const res = await server.post("/api/journal.upsert", user, {
      body: { date: "2026-06-01" },
    });
    const body = await res.json();

    expect(res.status).toEqual(409);
    expect(body.message).toEqual(
      "Journal document is in Trash. Restore it to continue editing."
    );
  });
});

describe("#journal.entries", () => {
  it("returns entries in the requested range and filters trashed documents", async () => {
    const user = await buildUser();
    await createJournalEntries(user, ["2026-05-31", "2026-06-01"]);
    const { document } = await createJournalEntry(user, {
      date: "2026-06-02",
    });
    await withAPIContext(user, (ctx) => document.destroyWithCtx(ctx));

    const res = await server.post("/api/journal.entries", user, {
      body: {
        startDate: "2026-05-31",
        endDate: "2026-06-02",
        direction: "asc",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.map((entry: { date: string }) => entry.date)).toEqual([
      "2026-05-31",
      "2026-06-01",
    ]);
  });

  it("rejects reversed and too-large ranges", async () => {
    const user = await buildUser();

    const reversed = await server.post("/api/journal.entries", user, {
      body: {
        startDate: "2026-06-02",
        endDate: "2026-06-01",
      },
    });
    const tooLarge = await server.post("/api/journal.entries", user, {
      body: {
        startDate: "2025-06-01",
        endDate: "2026-06-02",
      },
    });

    expect(reversed.status).toEqual(400);
    expect(tooLarge.status).toEqual(400);
  });
});

describe("#journal.calendar", () => {
  it("returns month dots, timezone-aware streak, and filters trashed documents", async () => {
    const user = await buildUser();
    const today = todayInUTC();
    const yesterday = addDays(today, -1);
    const twoDaysAgo = addDays(today, -2);
    const { year, month } = yearAndMonth(today);

    await createJournalEntries(user, [yesterday, today]);
    const { document } = await createJournalEntry(user, {
      date: twoDaysAgo,
    });
    await withAPIContext(user, (ctx) => document.destroyWithCtx(ctx));

    const res = await server.post("/api/journal.calendar", user, {
      body: {
        year,
        month,
        timezone: "UTC",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.dates).toEqual([yesterday, today]);
    expect(body.data.streak).toEqual(2);
    expect(body.data.streakCapped).toEqual(false);
  });

  it("returns a capped streak", async () => {
    const user = await buildUser();
    const today = todayInUTC();
    const { year, month } = yearAndMonth(today);

    await createJournalEntriesFast(user, datesEndingAt(today, 367));

    const res = await server.post("/api/journal.calendar", user, {
      body: {
        year,
        month,
        timezone: "UTC",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.streak).toEqual(366);
    expect(body.data.streakCapped).toEqual(true);
  });

  it("rejects invalid timezones", async () => {
    const user = await buildUser();

    const res = await server.post("/api/journal.calendar", user, {
      body: {
        year: 2026,
        month: 6,
        timezone: "Not/AZone",
      },
    });

    expect(res.status).toEqual(400);
  });
});

describe("#journal.info", () => {
  it("returns the current user's entry by date", async () => {
    const { entry, user } = await createJournalEntry(await buildUser(), {
      date: "2026-06-01",
      mood: JournalEntryMood.Neutral,
      tags: ["review"],
    });

    const res = await server.post("/api/journal.info", user, {
      body: { date: "2026-06-01" },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.id).toEqual(entry.id);
    expect(body.data.mood).toEqual(JournalEntryMood.Neutral);
    expect(body.data.tags).toEqual(["review"]);
  });

  it("does not expose another user's entry", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const otherUser = await buildUser({ teamId: team.id });
    await createJournalEntry(otherUser, { date: "2026-06-01" });

    const res = await server.post("/api/journal.info", user, {
      body: { date: "2026-06-01" },
    });

    expect(res.status).toEqual(404);
  });

  it("returns 404 for missing or trashed entries", async () => {
    const user = await buildUser();
    const { document } = await createJournalEntry(user, {
      date: "2026-06-01",
    });
    await withAPIContext(user, (ctx) => document.destroyWithCtx(ctx));

    const missing = await server.post("/api/journal.info", user, {
      body: { date: "2026-06-02" },
    });
    const trashed = await server.post("/api/journal.info", user, {
      body: { date: "2026-06-01" },
    });

    expect(missing.status).toEqual(404);
    expect(trashed.status).toEqual(404);
  });
});

describe("journal unique constraint rollback", () => {
  it("does not leave a second document when JournalEntry create hits the unique constraint", async () => {
    const user = await buildUser();
    await server.post("/api/journal.upsert", user, {
      body: { date: "2026-06-01" },
    });

    const createSpy = vi
      .spyOn(JournalEntry, "create")
      .mockRejectedValueOnce(new UniqueConstraintError({ errors: [] }));

    const res = await server.post("/api/journal.upsert", user, {
      body: { date: "2026-06-02" },
    });

    expect(res.status).toEqual(400);
    await expect(
      JournalEntry.count({
        where: {
          teamId: user.teamId,
          userId: user.id,
          date: "2026-06-02",
        },
      })
    ).resolves.toEqual(0);
    await expect(
      Document.count({
        where: {
          teamId: user.teamId,
          createdById: user.id,
          title: "2026-06-02",
        },
      })
    ).resolves.toEqual(0);

    createSpy.mockRestore();
  });
});
