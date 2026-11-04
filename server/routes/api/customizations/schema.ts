import { z } from "zod";
import { CustomizationValidation } from "@shared/types";
import { isCustomizationModulePath } from "@server/utils/customizations";
import { BaseSchema } from "../schema";

const scope = z.enum(["workspace", "personal"]);
const version = z.number().int().min(0);
const source = z.string().max(CustomizationValidation.maxScriptLength);
const modules = z
  .record(z.string().refine(isCustomizationModulePath), source)
  .refine(
    (value) =>
      Object.keys(value).length <= CustomizationValidation.maxModuleCount,
    "Too many managed modules"
  );

export const CustomizationsInfoSchema = BaseSchema.extend({
  body: z.object({}),
});
export const UpdateBackgroundSchema = BaseSchema.extend({
  body: z.object({
    scope,
    expectedVersion: version,
    assetId: z.uuid().nullable(),
    source: z.enum(["inherit", "personal"]).optional(),
    fit: z.enum(["cover", "contain", "repeat"]).default("cover"),
  }),
});
export const UpdateCssSchema = BaseSchema.extend({
  body: z.object({
    scope,
    expectedVersion: version,
    css: z.string().max(CustomizationValidation.maxCssLength),
  }),
});
export const ScriptDraftSchema = BaseSchema.extend({
  body: z.object({
    expectedVersion: version,
    source,
    modules: modules.default({}),
  }),
});
export const PublishScriptSchema = BaseSchema.extend({
  body: z.object({ expectedVersion: version }),
});
export const EnableScriptSchema = BaseSchema.extend({
  body: z.object({
    revisionId: z.uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
});
export const UploadBackgroundSchema = BaseSchema.extend({
  body: z.object({ scope }),
});
export const BackgroundReadSchema = BaseSchema.extend({
  query: z.object({ id: z.uuid() }),
});

export type UpdateBackgroundReq = z.infer<typeof UpdateBackgroundSchema>;
export type UpdateCssReq = z.infer<typeof UpdateCssSchema>;
export type ScriptDraftReq = z.infer<typeof ScriptDraftSchema>;
export type PublishScriptReq = z.infer<typeof PublishScriptSchema>;
export type EnableScriptReq = z.infer<typeof EnableScriptSchema>;
export type UploadBackgroundReq = z.infer<typeof UploadBackgroundSchema>;
export type BackgroundReadReq = z.infer<typeof BackgroundReadSchema>;
