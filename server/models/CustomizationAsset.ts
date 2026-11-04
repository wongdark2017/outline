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

/** Stores CustomizationAsset data independently of color themes. */
@Table({ tableName: "customizationAssets", modelName: "customizationAsset" })
export class CustomizationAsset extends IdModel<
  InferAttributes<CustomizationAsset>,
  Partial<InferCreationAttributes<CustomizationAsset>>
> {
  @ForeignKey(() => User)
  @Column(DataType.UUID)
  userId: string | null;

  @Default(false)
  @Column(DataType.BOOLEAN)
  ready: boolean;

  @Column(DataType.STRING)
  scope: string;

  @Column(DataType.STRING)
  key: string;

  @Column(DataType.STRING)
  name: string;

  @Column(DataType.STRING)
  contentType: string;

  @Column(DataType.INTEGER)
  size: number;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string | null;
}
