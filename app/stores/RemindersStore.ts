import { computed } from "mobx";
import Reminder from "~/models/Reminders";
import type RootStore from "./RootStore";
import Store, { RPCAction } from "./base/Store";

export default class RemindersStore extends Store<Reminder> {
    actions = [RPCAction.List, RPCAction.Create, RPCAction.Delete];

    constructor(rootStore: RootStore) {
        super(rootStore, Reminder);
    }

    /** Pending reminders, soonest first. */
    @computed
    get pending(): Reminder[] {
        return this.orderedData
            .filter((reminder) => !reminder.sentAt)
            .sort((a, b) => a.remindAt.localeCompare(b.remindAt));
    }

    /**
     * Returns the pending reminders for a document.
     *
     * @param documentId the document to filter by.
     * @returns the reminders, soonest first.
     */
    forDocument(documentId: string): Reminder[] {
        return this.pending.filter((r) => r.documentId === documentId);
    }
}