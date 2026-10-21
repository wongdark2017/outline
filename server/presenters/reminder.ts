import type { Reminder } from "@server/models";

export default function presentReminder(reminder: Reminder) {
  return {
    id: reminder.id,
    documentId: reminder.documentId,
    remindAt: reminder.remindAt,
    note: reminder.note,
    sentAt: reminder.sentAt,
    createdAt: reminder.createdAt,
    updatedAt: reminder.updatedAt,
  };
}