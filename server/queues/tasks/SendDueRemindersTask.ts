import { Document, Reminder, Team, User } from "@server/models";
import { CronTask, Props, TaskInterval, TaskSchedule } from "./base/CronTask";
import { Op } from "sequelize";
import { Minute } from "@shared/utils/time";
import DocumentReminderEmail from "@server/emails/templates/DocumentReminderEmail";
import { can } from "@server/policies";
import Logger from "@server/logging/Logger";


export default class SendDueRemindersTask extends CronTask{
    public get cron(): TaskSchedule {
        return {
            interval: TaskInterval.Hour,
            partitionWindow: 10* Minute.ms,
        };
    }
    public async perform({ limit, partition }: Props) {
         const reminders = await Reminder.findAll({
            where:{
                sentAt: null,
                remindAt: {[Op.lte]: new Date()},
                ...this.getPartitionWhereClause("id",partition),
            },
            include: [
                {
                    model: User,
                    as: "user",
                    required: true,
                    include: [{ model: Team, as: "team",required: true}],
                },
            ],
            order: [["reminderAt","ASC"]],
            limit,
         });
         for (const reminder of reminders){
            const { user } = reminder;
            const document = await Document.findByPk(reminder.documentId,{
                userId: user.id,
            });
            if(!user.isSuspended && document && can(user,"read",document)){
                await new DocumentReminderEmail({
                    to: user.email,
                    language: user.language,
                    documentTitle: document.displayTitle,
                    documentUrl: `${user.team.url}${document.path}`,
                    note: reminder.note,
                }).schedule();
            }
            await reminder.update({ sentAt: new Date() });
         }
         if (reminders.length){
            Logger.info("task",`Processed ${reminders.length} due reminders`);
         }
    }
    
}