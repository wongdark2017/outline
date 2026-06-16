import type JournalEntry from "@server/models/JournalEntry";

/**
 * Formats a JournalEntry model for API response output.
 *
 * @param entry - the JournalEntry instance with optional document association.
 * @returns serialized journal entry data for the client.
 */
export function presentJournalEntry(entry: JournalEntry) {
  return {
    id: entry.id,
    date: entry.date,
    mood: entry.mood,
    tags: entry.tags,
    documentId: entry.documentId,
    document: entry.document
      ? {
          id: entry.document.id,
          title: entry.document.title,
          url: entry.document.url,
          updatedAt: entry.document.updatedAt,
        }
      : null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
