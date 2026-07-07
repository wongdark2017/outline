import { z } from "zod";
import type { ProsemirrorData } from "@shared/types";
import { BaseSchema } from "@server/routes/api/schema";
import { MemoVisibility } from "@server/models/Memo";

const ProsemirrorSchema: z.ZodType<ProsemirrorData> = z.lazy(() =>
  z.object({
    type: z.string(),
    content: z.array(ProsemirrorSchema).optional(),
    text: z.string().optional(),
    attrs: z.record(z.string(), z.any()).optional(),
    marks: z
      .array(
        z.object({
          type: z.string(),
          attrs: z.record(z.string(), z.any()).optional(),
        })
      )
      .optional(),
  })
);

export const MemosCreateSchema = BaseSchema.extend({
  body: z.object({
    content: ProsemirrorSchema,
    visibility: z.enum(MemoVisibility).optional(),
  }),
});

export type MemosCreateReq = z.infer<typeof MemosCreateSchema>;

export const MemosListSchema = BaseSchema.extend({
  body: z.object({
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
    archived: z.boolean().optional(),
    tag: z.string().trim().min(1).optional(),
  }),
});

export type MemosListReq = z.infer<typeof MemosListSchema>;

export const MemosInfoSchema = BaseSchema.extend({
  body: z.object({
    id: z.uuid(),
  }),
});

export type MemosInfoReq = z.infer<typeof MemosInfoSchema>;

export const MemosUpdateSchema = BaseSchema.extend({
  body: z.object({
    id: z.uuid(),
    content: ProsemirrorSchema.optional(),
    visibility: z.enum(MemoVisibility).optional(),
  }),
});

export type MemosUpdateReq = z.infer<typeof MemosUpdateSchema>;

export const MemosArchiveSchema = BaseSchema.extend({
  body: z.object({
    id: z.uuid(),
  }),
});

export type MemosArchiveReq = z.infer<typeof MemosArchiveSchema>;

export const MemosDeleteSchema = BaseSchema.extend({
  body: z.object({
    id: z.uuid(),
  }),
});

export type MemosDeleteReq = z.infer<typeof MemosDeleteSchema>;

export const MemosTagsSchema = BaseSchema.extend({
  body: z.object({
    query: z.string().optional(),
  }),
});

export type MemosTagsReq = z.infer<typeof MemosTagsSchema>;
