import { MemoVisibility } from "@server/models/Memo";
import { buildMemo } from "@server/test/factories";
import presentMemo from "./memo";

describe("presentMemo", () => {
  it("serializes the memo payload", async () => {
    const memo = await buildMemo({
      tags: ["alpha", "beta/subtag"],
      visibility: MemoVisibility.Workspace,
      archivedAt: new Date("2026-06-29T10:00:00.000Z"),
    });

    expect(presentMemo(memo)).toMatchObject({
      id: memo.id,
      content: memo.content,
      tags: ["alpha", "beta/subtag"],
      visibility: MemoVisibility.Workspace,
      userId: memo.userId,
      teamId: memo.teamId,
      archivedAt: memo.archivedAt,
      deletedAt: memo.deletedAt,
    });
  });
});
