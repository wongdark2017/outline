import { UniqueConstraintError } from "sequelize";
import { JournalEntry } from "@server/models";
import { buildDocument, buildTeam, buildUser } from "@server/test/factories";

describe("JournalEntry", () => {
  it("enforces one entry per team, user, and date", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const firstDocument = await buildDocument({
      userId: user.id,
      teamId: team.id,
    });
    const secondDocument = await buildDocument({
      userId: user.id,
      teamId: team.id,
    });

    await JournalEntry.create({
      userId: user.id,
      teamId: team.id,
      documentId: firstDocument.id,
      date: "2026-06-01",
      mood: null,
      tags: [],
    });

    await expect(
      JournalEntry.create({
        userId: user.id,
        teamId: team.id,
        documentId: secondDocument.id,
        date: "2026-06-01",
        mood: null,
        tags: [],
      })
    ).rejects.toThrow(UniqueConstraintError);
  });

  it("removes entries when the document is physically deleted", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    const entry = await JournalEntry.create({
      userId: user.id,
      teamId: user.teamId,
      documentId: document.id,
      date: "2026-06-01",
      mood: null,
      tags: [],
    });

    await document.destroy({ force: true });

    await expect(JournalEntry.findByPk(entry.id)).resolves.toEqual(null);
  });
});
