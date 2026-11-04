import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  Column,
  DataType,
  Default,
  ForeignKey,
  Table,
  BeforeUpdate,
} from "sequelize-typescript";
import { ValidationError } from "@server/errors";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";

/** Stores CustomizationScriptRevision data independently of color themes. */
@Table({
  tableName: "customizationScriptRevisions",
  modelName: "customizationScriptRevision",
})
export class CustomizationScriptRevision extends IdModel<
  InferAttributes<CustomizationScriptRevision>,
  Partial<InferCreationAttributes<CustomizationScriptRevision>>
> {
  /** Rejects changes to an immutable published script revision. */
  @BeforeUpdate
  static preventUpdate() {
    throw ValidationError("Published script revisions cannot be changed");
  }

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  publisherId: string | null;

  @Column(DataType.INTEGER)
  revision: number;

  @Column(DataType.TEXT)
  source: string;

  @Default({})
  @Column(DataType.JSONB)
  modules: Record<string, string>;

  @Column(DataType.STRING)
  digest: string;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;
}
