import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  Column,
  DataType,
  Default,
  ForeignKey,
  Table,
} from "sequelize-typescript";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";

/** Stores UserCustomization data independently of color themes. */
@Table({ tableName: "userCustomizations", modelName: "userCustomization" })
export class UserCustomization extends IdModel<
  InferAttributes<UserCustomization>,
  Partial<InferCreationAttributes<UserCustomization>>
> {
  @ForeignKey(() => User)
  @Column(DataType.UUID)
  userId: string;

  @Default("inherit")
  @Column(DataType.STRING)
  backgroundSource: string;

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

  @Default(null)
  @Column(DataType.UUID)
  enabledScriptId: string | null;

  @Default(null)
  @Column(DataType.STRING)
  enabledScriptDigest: string | null;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;
}
