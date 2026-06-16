import { observable } from "mobx";
import type JournalEntriesStore from "~/stores/JournalEntriesStore";
import Model from "./base/Model";
import Field from "./decorators/Field";

interface JournalEntryDocument {
  id: string;
  title: string;
  url: string;
  updatedAt: string;
}

class JournalEntry extends Model {
  static modelName = "JournalEntry";

  store: JournalEntriesStore;

  @Field
  @observable
  date: string;

  @Field
  @observable
  mood: string | null;

  @Field
  @observable
  tags: string[];

  @Field
  @observable
  documentId: string;

  @observable
  document: JournalEntryDocument | null;
}

export default JournalEntry;
