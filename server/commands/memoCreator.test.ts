import { Event } from "@server/models";
import { buildAttachment, buildUser } from "@server/test/factories";
import { withAPIContext } from "@server/test/support";
import { MemoVisibility } from "@server/models/Memo";
import memoCreator from "./memoCreator";

describe("memoCreator", () => {
  it("creates a memo and extracts inline tags", async () => {
    const user = await buildUser();

    const memo = await withAPIContext(user, (ctx) =>
      memoCreator({
        ctx,
        user,
        visibility: MemoVisibility.Workspace,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "hello #alpha #beta/subtag" }],
            },
          ],
        },
      })
    );

    expect(memo.visibility).toEqual(MemoVisibility.Workspace);
    expect(memo.tags).toEqual(["alpha", "beta/subtag"]);
  });

  it("associates uploaded attachments", async () => {
    const user = await buildUser();
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: null,
    });

    const memo = await withAPIContext(user, (ctx) =>
      memoCreator({
        ctx,
        user,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "attachment",
                  attrs: {
                    href: `/api/attachments.redirect?id=${attachment.id}`,
                    title: "upload.png",
                    size: 100,
                  },
                },
              ],
            },
          ],
        },
      })
    );

    await attachment.reload();

    expect(attachment.memoId).toEqual(memo.id);
  });

  it("records a create event", async () => {
    const user = await buildUser();

    const memo = await withAPIContext(user, (ctx) =>
      memoCreator({
        ctx,
        user,
        content: ProsemirrorEmptyDoc,
      })
    );

    const event = await Event.findLatest({
      teamId: user.teamId,
    });

    expect(memo.id).toBeTruthy();
    expect(event?.name).toEqual("memos.create");
    expect(event?.modelId).toEqual(memo.id);
  });
});

const ProsemirrorEmptyDoc = {
  type: "doc" as const,
  content: [{ type: "paragraph" }],
};
