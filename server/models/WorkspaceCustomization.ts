import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  Column,
  DataType,
  Default,
  ForeignKey,
  Table,
} from "sequelize-typescript";
import Team from "./Team";
import IdModel from "./base/IdModel";

/** Stores WorkspaceCustomization data independently of color themes. */
@Table({
  tableName: "workspaceCustomizations",
  modelName: "workspaceCustomization",
})
export class WorkspaceCustomization extends IdModel<
  InferAttributes<WorkspaceCustomization>,
  Partial<InferCreationAttributes<WorkspaceCustomization>>
> {
  @Default(null)
  @Column(DataType.UUID)
  backgroundAssetId: string | null;

  @Default("cover")
  @Column(DataType.STRING)
  backgroundFit: string;

  @Default(0)
  @Column(DataType.INTEGER)
  backgroundVersion: number;

  @Default("")
  @Column(DataType.TEXT)
  css: string;

  @Default(0)
  @Column(DataType.INTEGER)
  cssVersion: number;

  @Default("")
  @Column(DataType.TEXT)
  scriptDraft: string;

  @Default({})
  @Column(DataType.JSONB)
  scriptDraftModules: Record<string, string>;

  @Default(0)
  @Column(DataType.INTEGER)
  scriptDraftVersion: number;

  @Default(null)
  @Column(DataType.UUID)
  publishedScriptId: string | null;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;
}
