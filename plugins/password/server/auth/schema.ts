import { z } from "zod";
import { Client } from "@shared/types";
import { CSRF } from "@shared/constants";
import { BaseSchema } from "@server/routes/api/schema";

const StrictEmptyQuery = z.object({}).strict();

export const PasswordSchema = BaseSchema.extend({
  body: z
    .object({
      email: z.email(),
      password: z.string().min(1),
      client: z.enum(Client).prefault(Client.Web),
      [CSRF.fieldName]: z.string().optional(),
    })
    .strict(),
  query: StrictEmptyQuery,
});

export type PasswordReq = z.infer<typeof PasswordSchema>;

export const PasswordResetSchema = BaseSchema.extend({
  body: z
    .object({
      email: z.email(),
      [CSRF.fieldName]: z.string().optional(),
    })
    .strict(),
  query: StrictEmptyQuery,
});

export type PasswordResetReq = z.infer<typeof PasswordResetSchema>;

export const PasswordUpdateSchema = BaseSchema.extend({
  body: z
    .object({
      password: z.string().min(12),
      currentPassword: z.string().min(1).optional(),
      resetToken: z.string().min(1).optional(),
      activationToken: z.string().min(1).optional(),
      [CSRF.fieldName]: z.string().optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
      const hasResetToken = data.resetToken !== undefined;
      const hasActivationToken = data.activationToken !== undefined;
      const hasCurrentPassword = data.currentPassword !== undefined;
      const total =
        Number(hasResetToken) +
        Number(hasActivationToken) +
        Number(hasCurrentPassword);

      if (total !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Provide exactly one of resetToken, activationToken or currentPassword",
          path: ["resetToken"],
        });
      }
    }),
  query: StrictEmptyQuery,
});

export type PasswordUpdateReq = z.infer<typeof PasswordUpdateSchema>;
