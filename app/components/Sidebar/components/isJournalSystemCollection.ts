import type Collection from "~/models/Collection";

/**
 * Checks whether a collection is the internal Journal system collection.
 *
 * @param collection - the collection to inspect.
 * @returns true when the collection has the Journal source marker.
 */
export function isJournalSystemCollection(
  collection: Pick<Collection, "sourceMetadata">
) {
  return collection.sourceMetadata?.externalId === "outline:journal";
}
