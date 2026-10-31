import { z } from "zod";
import { Client } from "@shared/types";
import { BaseSchema } from "@server/routes/api/schema";

export const EmailSchema = BaseSchema.extend({
  body: z.object({
    email: z.email(),
    client: z.enum(Client).prefault(Client.Web),
    preferOTP: z.boolean().prefault(false),
  }),
});

export type EmailReq = z.infer<typeof EmailSchema>;

const callbackDataSchema = z.object({
  token: z.string().optional(),
  code: z.string().optional(),
  email: z.string().optional(),
  client: z.enum(Client).optional(),
  follow: z.string().prefault(""),
});

export const EmailCallbackSchema = BaseSchema.extend({
  query: callbackDataSchema,
  body: callbackDataSchema,
});

export type EmailCallbackReq = z.infer<typeof EmailCallbackSchema>;
