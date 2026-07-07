import type { ProsemirrorData } from "@shared/types";
import { Node } from "prosemirror-model";
import { Attachment } from "@server/models";
import type Memo from "@server/models/Memo";
import type { APIContext } from "@server/types";
import { schema } from "@server/editor";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import { parseTags } from "./memoCreator";

type Props = {
  /** The request context. */
  ctx: APIContext;
  /** The memo to update. */
  memo: Memo;
  /** Optional replacement content. */
  content?: ProsemirrorData;
  /** Optional replacement visibility. */
  visibility?: Memo["visibility"];
};

/**
 * Update memo content and derived tags.
 *
 * @param props - Update input.
 * @returns The updated memo.
 */
export default async function memoUpdater({
  ctx,
  memo,
  content,
  visibility,
}: Props): Promise<Memo> {
  const update: Partial<Memo> = {};

  if (content) {
    const doc = Node.fromJSON(schema, content);
    const attachmentIds = ProsemirrorHelper.parseAttachmentIds(doc);

    update.content = content;
    update.tags = parseTags(doc);

    if (attachmentIds?.length) {
      await Attachment.update(
        {
          memoId: memo.id,
        },
        {
          where: {
            id: attachmentIds,
            teamId: memo.teamId,
            userId: memo.userId,
          },
          transaction: ctx.state.transaction,
        }
      );
    }
  }

  if (visibility) {
    update.visibility = visibility;
  }

  await memo.updateWithCtx(ctx, update);

  return memo;
}
