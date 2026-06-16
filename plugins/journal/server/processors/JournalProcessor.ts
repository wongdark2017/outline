import { JournalEntry } from "@server/models";
import BaseProcessor from "@server/queues/processors/BaseProcessor";
import type { DocumentEvent, Event as TEvent } from "@server/types";

/**
 * Handles JournalEntry cleanup for permanently deleted journal documents.
 */
export default class JournalProcessor extends BaseProcessor {
  static applicableEvents: TEvent["name"][] = ["documents.permanent_delete"];

  public async perform(event: DocumentEvent): Promise<void> {
    await JournalEntry.destroy({
      where: { documentId: event.documentId },
    });
  }
}
