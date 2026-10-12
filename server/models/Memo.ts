import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  Table,
} from "sequelize-typescript";
import type { ProsemirrorData } from "@shared/types";
import Attachment from "./Attachment";
import Team from "./Team";
import User from "./User";
import ArchivableModel from "./base/ArchivableModel";
import Fix from "./decorators/Fix";

export enum MemoVisibility {
  Private = "private",
  Workspace = "workspace",
  Public = "public",
}

/**
 * Short-form notes captured outside the document hierarchy.
 */
@Table({
  tableName: "memos",
  modelName: "memo",
  indexes: [
    {
      fields: ["teamId", "userId", "createdAt"],
    },
    {
      fields: ["teamId", "visibility", "createdAt"],
    },
    {
      fields: ["tags"],
      using: "gin",
    },
  ],
})
@Fix
class Memo extends ArchivableModel<
  InferAttributes<Memo>,
  Partial<InferCreationAttributes<Memo>>
> {
  @Column(DataType.JSONB)
  content: ProsemirrorData;

  @Default([])
  @Column(DataType.JSONB)
  tags: string[];

  @Default(MemoVisibility.Private)
  @Column(DataType.ENUM(...Object.values(MemoVisibility)))
  visibility: MemoVisibility;

  @BelongsTo(() => User, "userId")
  user: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  userId: string;

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @HasMany(() => Attachment, "memoId")
  attachments: Attachment[];
}

export default Memo;
