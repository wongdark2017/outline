import { observable } from "mobx";
import type RemindersStore from "~/stores/RemindersStore";
import Document from "./Document";
import Model from "./base/Model";
import Field from "./decorators/Field";
import Relation from "./decorators/Relation";

class Reminder extends Model {
    static modelName = "Reminder";

    constructor(fields: Record<string, unknown>, store: RemindersStore) {
        super(fields, store);
        this.initialize(fields);
    }

    store: RemindersStore;

    /** The document ID this reminder is for. */
    @Field
    documentId: string;

    /** The document this reminder is for. */
    @Relation(() => Document, { onDelete: "cascade" })
    document?: Document;

    /** When the reminder is due, as an ISO 8601 string. */
    @Field
    @observable
    remindAt: string;

    /** An optional note included in the email. */
    @Field
    @observable
    note: string | null;

    /** When the reminder was sent, null while pending. */
    @observable
    sentAt: string | null;
}

export default Reminder;