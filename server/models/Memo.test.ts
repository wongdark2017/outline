import { MemoVisibility } from "@server/models/Memo";
import { buildMemo, buildUser } from "@server/test/factories";
import { ProsemirrorHelper } from "@shared/utils/ProsemirrorHelper";

describe("Memo", () => {
  it("defaults visibility to private", async () => {
    const memo = await buildMemo();

    expect(memo.visibility).toEqual(MemoVisibility.Private);
  });

  it("persists tags", async () => {
    const memo = await buildMemo({
      tags: ["alpha", "beta/subtag"],
    });

    expect(memo.tags).toEqual(["alpha", "beta/subtag"]);
  });

  it("supports archive state", async () => {
    const memo = await buildMemo({
      archivedAt: new Date(),
    });

    expect(memo.isArchived).toEqual(true);
  });

  it("stores prose mirror json", async () => {
    const memo = await buildMemo({
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "hello #world" }],
          },
        ],
      },
    });

    expect(ProsemirrorHelper.isEmptyData(memo.content)).toEqual(false);
  });

  it("belongs to the author team", async () => {
    const user = await buildUser();
    const memo = await buildMemo({
      userId: user.id,
      teamId: user.teamId,
    });

    expect(memo.userId).toEqual(user.id);
    expect(memo.teamId).toEqual(user.teamId);
  });
});
