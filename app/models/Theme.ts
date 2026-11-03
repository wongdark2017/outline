import { observable } from "mobx";
import type { ThemeTokens } from "@shared/styles/themeTokens";
import User from "./User";
import Model from "./base/Model";
import Field from "./decorators/Field";
import Relation from "./decorators/Relation";

class Theme extends Model {
  static modelName = "Theme";

  constructor(fields: Record<string, unknown>, store: Model["store"]) {
    super(fields, store);
    this.initialize(fields);
  }

  /** The display name of the theme. */
  @Field
  @observable
  name: string;

  /** Color overrides used when the interface is light. */
  @Field
  @observable
  light: ThemeTokens;

  /** Color overrides used when the interface is dark. */
  @Field
  @observable
  dark: ThemeTokens;

  /** The user who created this theme. */
  @Relation(() => User)
  createdBy?: User;

  /** The ID of the user who created this theme. */
  @Field
  @observable
  createdById: string;
}

export default Theme;
