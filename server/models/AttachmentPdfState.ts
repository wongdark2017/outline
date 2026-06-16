import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Table,
} from "sequelize-typescript";
import type { AttachmentPdfStateData } from "@shared/types";
import Attachment from "./Attachment";
import Document from "./Document";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";
import Fix from "./decorators/Fix";

/**
 * Stores Outline-internal PDF annotation state for one document attachment.
 */
@Table({
  tableName: "attachment_pdf_states",
  modelName: "attachment_pdf_state",
  indexes: [
    {
      fields: ["documentId", "attachmentId"],
      unique: true,
    },
    {
      fields: ["attachmentId"],
    },
    {
      fields: ["teamId", "documentId"],
    },
  ],
})
@Fix
class AttachmentPdfState extends IdModel<
  InferAttributes<AttachmentPdfState>,
  Partial<InferCreationAttributes<AttachmentPdfState>>
> {
  @Default({
    version: 2,
    annotations: [],
  })
  @Column(DataType.JSONB)
  data: AttachmentPdfStateData;

  @Default(0)
  @Column(DataType.INTEGER)
  revision: number;

  // associations

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => Document, "documentId")
  document: Document;

  @ForeignKey(() => Document)
  @Column(DataType.UUID)
  documentId: string;

  @BelongsTo(() => Attachment, "attachmentId")
  attachment: Attachment;

  @ForeignKey(() => Attachment)
  @Column(DataType.UUID)
  attachmentId: string;

  @BelongsTo(() => User, "createdById")
  createdBy: User | null;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  createdById: string | null;

  @BelongsTo(() => User, "updatedById")
  updatedBy: User | null;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  updatedById: string | null;
}

export default AttachmentPdfState;
