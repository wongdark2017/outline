import z from "zod";
import { BaseSchema } from "../schema";
import { zodIdType } from "@server/utils/zod";
import { ReminderValidation } from "@shared/validations";

export const RemindersCreateSchema = BaseSchema.extend({
    body: z.object({
        documentId: zodIdType(),
        remindAt: z.coerce
            .date()
            .refine((date)=> date > new Date(),{error:  "must be in the future"}),
        note: z.string().max(ReminderValidation.maxNoteLength).optional(),
    })
});

export type RemindersCreateReq = z.infer<typeof RemindersCreateSchema>;

export const ReminderListSchema = BaseSchema.extend({
    body: z.object({
        documentId: z.uuid().optional(),
    }),
});

export type ReminderListReq = z.infer<typeof ReminderListSchema>;

export const ReminderDeleteSchema = BaseSchema.extend({
    body: z.object({id: z.uuid()}),
});

export type ReminderDeleteReq = z.infer<typeof ReminderDeleteSchema>;