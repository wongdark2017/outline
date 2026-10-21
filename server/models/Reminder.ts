import IdModel from "@server/models/base/IdModel";
import { InferAttributes, InferCreationAttributes } from "sequelize";
import { Column, DataType, Table,IsDate, Length, ForeignKey, BelongsTo } from "sequelize-typescript";
import { ReminderValidation } from "@shared/validations";
import Document from "./Document";
import Team from "./Team";
import User from "./User";

@Table({tableName:"reminders",modelName:"reminder"})
class Reminder extends IdModel<
    InferAttributes<Reminder>,
    Partial<InferCreationAttributes<Reminder>>
>{
    @IsDate
    @Column(DataType.DATE)
    remindAt: Date;

    @Length({
        max: ReminderValidation.maxNoteLength,
        msg: `note must be ${ReminderValidation.maxNoteLength} characters or less`,
    })
    @Column(DataType.STRING)
    note:string | null;

    @IsDate
    @Column(DataType.DATE)
    sentAt: Date| null;

    // associations

  @BelongsTo(() => User, "userId")
  user: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  userId: string;

  @BelongsTo(() => Document, "documentId")
  document: Document;

  @ForeignKey(() => Document)
  @Column(DataType.UUID)
  documentId: string;

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;
};

export default Reminder;