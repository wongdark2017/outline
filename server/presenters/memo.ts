import type Memo from "@server/models/Memo";

/**
 * Serialize a memo for API responses.
 *
 * @param memo - The memo to serialize.
 * @returns The serialized memo payload.
 */
export default function presentMemo(memo: Memo) {
  return {
    id: memo.id,
    content: memo.content,
    tags: memo.tags,
    visibility: memo.visibility,
    userId: memo.userId,
    teamId: memo.teamId,
    createdAt: memo.createdAt,
    updatedAt: memo.updatedAt,
    archivedAt: memo.archivedAt,
    deletedAt: memo.deletedAt,
  };
}
