import { z } from "zod";
import { languages } from "@shared/i18n";
import { TeamValidation, UserValidation } from "@shared/validations";
import { BaseSchema } from "@server/routes/api/schema";

export const InstallationCreateSchema = BaseSchema.extend({
  body: z
    .object({
      /** Team name */
      teamName: z.string().min(1).max(TeamValidation.maxNameLength),
      /** User name */
      userName: z.string().min(1).max(UserValidation.maxNameLength),
      /** User email */
      userEmail: z.email().max(UserValidation.maxEmailLength),
      /** Password for the initial admin account */
      password: z.string().min(12).optional(),
      /** Password confirmation for the initial admin account */
      passwordConfirmation: z.string().min(12).optional(),
    })
    .superRefine((data, ctx) => {
      const hasPassword = data.password !== undefined;
      const hasConfirmation = data.passwordConfirmation !== undefined;

      if (hasPassword !== hasConfirmation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Provide both password and passwordConfirmation",
          path: hasPassword ? ["passwordConfirmation"] : ["password"],
        });
      }

      if (
        hasPassword &&
        hasConfirmation &&
        data.password !== data.passwordConfirmation
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passwords do not match",
          path: ["passwordConfirmation"],
        });
      }
    }),
});

export type InstallationCreateSchemaReq = z.infer<
  typeof InstallationCreateSchema
>;

const httpUrlSchema = z.string().superRefine((value, ctx) => {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "URL must use http or https",
      });
    }
  } catch (_err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "URL must be absolute",
    });
  }
});

const languageSchema = z.string().refine(
  (value) => languages.includes(value as (typeof languages)[number]),
  "Unsupported language"
);

const booleanSchema = z.union([
  z.boolean(),
  z.enum(["true", "false"]).transform((value) => value === "true"),
]);

export const InstallationSetupSchema = BaseSchema.extend({
  body: z
    .object({
      teamName: z.string().min(1).max(TeamValidation.maxNameLength),
      userName: z.string().min(1).max(UserValidation.maxNameLength),
      userEmail: z.email().max(UserValidation.maxEmailLength),
      password: z.string().min(12).optional(),
      passwordConfirmation: z.string().min(12).optional(),
      url: httpUrlSchema,
      defaultLanguage: languageSchema,
      forceHttps: booleanSchema,
      fileStorage: z.enum(["local", "s3"]),
      s3BucketName: z.string().min(1).optional(),
      s3Region: z.string().min(1).optional(),
      s3AccessKeyId: z.string().min(1).optional(),
      s3SecretAccessKey: z.string().min(1).optional(),
      s3Endpoint: httpUrlSchema.optional(),
      s3ForcePathStyle: booleanSchema.optional(),
      s3Acl: z.string().min(1).optional(),
    })
    .superRefine((data, ctx) => {
      const hasPassword = data.password !== undefined;
      const hasConfirmation = data.passwordConfirmation !== undefined;

      if (hasPassword !== hasConfirmation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Provide both password and passwordConfirmation",
          path: hasPassword ? ["passwordConfirmation"] : ["password"],
        });
      }

      if (
        hasPassword &&
        hasConfirmation &&
        data.password !== data.passwordConfirmation
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passwords do not match",
          path: ["passwordConfirmation"],
        });
      }

      if (data.fileStorage !== "s3") {
        return;
      }

      const requiredS3Fields = [
        "s3BucketName",
        "s3AccessKeyId",
        "s3SecretAccessKey",
      ] as const;

      for (const field of requiredS3Fields) {
        if (!data[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Required when fileStorage is s3",
            path: [field],
          });
        }
      }
    }),
});

export type InstallationSetupSchemaReq = z.infer<
  typeof InstallationSetupSchema
>;

export const InstallationTestStorageSchema = BaseSchema.extend({
  body: z.object({
    s3BucketName: z.string().min(1),
    s3Region: z.string().min(1).optional(),
    s3AccessKeyId: z.string().min(1),
    s3SecretAccessKey: z.string().min(1),
    s3Endpoint: httpUrlSchema.optional(),
    s3ForcePathStyle: booleanSchema.optional(),
  }),
});

export type InstallationTestStorageSchemaReq = z.infer<
  typeof InstallationTestStorageSchema
>;

export const InstallationSystemInfoSchema = BaseSchema;

export type InstallationSystemInfoSchemaReq = z.infer<
  typeof InstallationSystemInfoSchema
>;
