import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Table,
} from "sequelize-typescript";
import Document from "./Document";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";
import Fix from "./decorators/Fix";

export enum JournalEntryMood {
  Productive = "productive",
  Neutral = "neutral",
  Tired = "tired",
  Inspired = "inspired",
  Frustrated = "frustrated",
}

/**
 * Links a user's journal date to a document and stores private metadata.
 */
@Table({
  tableName: "journal_entries",
  modelName: "journal_entry",
  timestamps: true,
  paranoid: false,
  indexes: [
    {
      fields: ["teamId", "userId", "date"],
      unique: true,
    },
    {
      fields: ["userId", "date"],
    },
    {
      fields: ["teamId", "date"],
    },
    {
      fields: ["documentId"],
    },
  ],
})
@Fix
class JournalEntry extends IdModel<
  InferAttributes<JournalEntry>,
  Partial<InferCreationAttributes<JournalEntry>>
> {
  @Column(DataType.DATEONLY)
  date: string;

  @Column(DataType.ENUM(...Object.values(JournalEntryMood)))
  mood: JournalEntryMood | null;

  @Default([])
  @Column(DataType.JSONB)
  tags: string[];

  // associations

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

  @BelongsTo(() => Document, "documentId")
  document: Document | null;

  @ForeignKey(() => Document)
  @Column(DataType.UUID)
  documentId: string;
}

export default JournalEntry;
