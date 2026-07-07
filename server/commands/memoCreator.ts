import type { ProsemirrorData } from "@shared/types";
import { Node } from "prosemirror-model";
import type { User } from "@server/models";
import { Attachment, Memo } from "@server/models";
import type { APIContext } from "@server/types";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import { schema } from "@server/editor";

type Props = {
  /** The request context. */
  ctx: APIContext;
  /** The memo author. */
  user: User;
  /** The memo content. */
  content: ProsemirrorData;
  /** The memo visibility. */
  visibility?: Memo["visibility"];
};

/**
 * Create a memo and derive tags from the editor content.
 *
 * @param props - The memo creation input.
 * @returns The created memo.
 */
export default async function memoCreator({
  ctx,
  user,
  content,
  visibility,
}: Props): Promise<Memo> {
  const doc = Node.fromJSON(schema, content);
  const tags = parseTags(doc);
  const attachmentIds = ProsemirrorHelper.parseAttachmentIds(doc);

  const memo = await Memo.createWithCtx(ctx, {
    content,
    tags,
    visibility,
    userId: user.id,
    teamId: user.teamId,
  });

  if (attachmentIds?.length) {
    await Attachment.update(
      {
        memoId: memo.id,
      },
      {
        where: {
          id: attachmentIds,
          teamId: user.teamId,
          userId: user.id,
        },
        transaction: ctx.state.transaction,
      }
    );
  }

  return memo;
}

/**
 * Parse inline memo tags from a ProseMirror document.
 *
 * @param doc - The ProseMirror document.
 * @returns A de-duplicated list of tags.
 */
export function parseTags(doc: Node): string[] {
  const tags = new Set<string>();

  doc.descendants((node) => {
    if (node.type.name === "memo_tag" && node.attrs.label) {
      tags.add(String(node.attrs.label));
    }

    return true;
  });

  if (tags.size > 0) {
    return Array.from(tags);
  }

  const text = ProsemirrorHelper.toPlainText(doc);
  for (const match of text.matchAll(/(?:^|\s)#([A-Za-z0-9/_-]+)/g)) {
    if (match[1]) {
      tags.add(match[1]);
    }
  }

  return Array.from(tags);
}
