import { observable } from "mobx";
import type { ProsemirrorData } from "@shared/types";
import type MemosStore from "~/stores/MemosStore";
import ArchivableModel from "./base/ArchivableModel";
import Field from "./decorators/Field";

class Memo extends ArchivableModel {
  static modelName = "Memo";

  store: MemosStore;

  @Field
  @observable.shallow
  content: ProsemirrorData;

  @Field
  @observable
  tags: string[];

  @Field
  @observable
  visibility: string;

  @Field
  @observable
  userId: string;

  @Field
  @observable
  teamId: string;
}

export default Memo;
