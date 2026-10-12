import { buildAttachment, buildMemo, buildUser } from "@server/test/factories";
import { withAPIContext } from "@server/test/support";
import memoUpdater from "./memoUpdater";

describe("memoUpdater", () => {
  it("associates uploaded attachments added during edit", async () => {
    const user = await buildUser();
    const memo = await buildMemo({
      userId: user.id,
      teamId: user.teamId,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: null,
    });

    await withAPIContext(user, (ctx) =>
      memoUpdater({
        ctx,
        memo,
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
                    title: "edited.png",
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
});
