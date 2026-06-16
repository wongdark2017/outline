import { isEmpty } from "es-toolkit/compat";
import { z } from "zod";
import { AttachmentPreset, OutlinePdfAnnotationType } from "@shared/types";
import { BaseSchema } from "@server/routes/api/schema";

const MaxPdfAnnotations = 200;
const MaxPdfAnnotationTextLength = 4000;
const MaxPdfAnnotationPoints = 500;
const MaxPdfAnnotationRects = 500;
const MinPdfNormalizedRectValue = -0.01;
const MaxPdfNormalizedRectValue = 1.01;

export const AttachmentsListSchema = BaseSchema.extend({
  body: z.object({
    /** Id of the document to which the Attachment belongs */
    documentId: z.uuid().optional(),
    /** Id of the user that uploaded the Attachment */
    userId: z.uuid().optional(),
  }),
});

export type AttachmentsListReq = z.infer<typeof AttachmentsListSchema>;

export const AttachmentsCreateSchema = BaseSchema.extend({
  body: z.object({
    /** Attachment id */
    id: z.uuid().optional(),

    /** Attachment name */
    name: z.string(),

    /** Id of the document to which the Attachment belongs */
    documentId: z.uuid().optional(),

    /** File size of the Attachment */
    size: z.number().int().nonnegative(),

    /** Content-Type of the Attachment */
    contentType: z.string().optional().prefault("application/octet-stream"),

    /** Attachment type */
    preset: z
      .enum(AttachmentPreset)
      .prefault(AttachmentPreset.DocumentAttachment),
  }),
});

export type AttachmentCreateReq = z.infer<typeof AttachmentsCreateSchema>;

export const AttachmentsCreateFromUrlSchema = BaseSchema.extend({
  body: z.object({
    /** Attachment id */
    id: z.uuid().optional(),

    /** Attachment url */
    url: z.string(),

    /** Id of the document to which the Attachment belongs */
    documentId: z.uuid().optional(),

    /** Attachment type */
    preset: z
      .enum(AttachmentPreset)
      .prefault(AttachmentPreset.DocumentAttachment),
  }),
});

export type AttachmentCreateFromUrlReq = z.infer<
  typeof AttachmentsCreateFromUrlSchema
>;

export const AttachmentDeleteSchema = BaseSchema.extend({
  body: z.object({
    /** Id of the attachment to be deleted */
    id: z.uuid(),
  }),
});

export type AttachmentDeleteReq = z.infer<typeof AttachmentDeleteSchema>;

const OutlinePdfPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const OutlinePdfRectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});

const OutlinePdfNormalizedRectSchema = z
  .object({
    x: z
      .number()
      .finite()
      .min(MinPdfNormalizedRectValue)
      .max(MaxPdfNormalizedRectValue),
    y: z
      .number()
      .finite()
      .min(MinPdfNormalizedRectValue)
      .max(MaxPdfNormalizedRectValue),
    width: z
      .number()
      .finite()
      .nonnegative()
      .max(MaxPdfNormalizedRectValue),
    height: z
      .number()
      .finite()
      .nonnegative()
      .max(MaxPdfNormalizedRectValue),
  })
  .refine(
    (rect) => rect.x + rect.width <= MaxPdfNormalizedRectValue,
    "rect x + width must remain within page bounds"
  )
  .refine(
    (rect) => rect.y + rect.height <= MaxPdfNormalizedRectValue,
    "rect y + height must remain within page bounds"
  );

const PdfAttachmentStateDataV1Schema = z.object({
  version: z.literal(1),
  annotations: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        pageIndex: z.number().int().nonnegative(),
        type: z.enum(OutlinePdfAnnotationType),
        color: z.string().max(32).nullable(),
        text: z.string().max(MaxPdfAnnotationTextLength),
        rect: OutlinePdfRectSchema.nullable(),
        points: z.array(OutlinePdfPointSchema).max(MaxPdfAnnotationPoints).nullable(),
        createdById: z.uuid().nullable(),
        updatedById: z.uuid().nullable(),
        createdAt: z.string().max(64),
        updatedAt: z.string().max(64),
      })
    )
    .max(MaxPdfAnnotations),
});

const PdfAttachmentStateDataV2Schema = z.object({
  version: z.literal(2),
  annotations: z
    .array(
      z.object({
        id: z.string().min(1).max(128),
        pageIndex: z.number().int().nonnegative(),
        type: z.enum(["text", "rectangle"]),
        mode: z.enum(["highlight", "fill", "border"]),
        color: z
          .string()
          .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/)
          .max(32),
        text: z.string().max(MaxPdfAnnotationTextLength),
        selectedText: z.string().max(MaxPdfAnnotationTextLength).nullable(),
        rects: z
          .array(OutlinePdfNormalizedRectSchema)
          .min(1)
          .max(MaxPdfAnnotationRects),
        createdById: z.uuid().nullable(),
        updatedById: z.uuid().nullable(),
        createdAt: z.string().max(64),
        updatedAt: z.string().max(64),
      })
    )
    .max(MaxPdfAnnotations),
});

const PdfAttachmentStateDataSchema = z.union([
  PdfAttachmentStateDataV1Schema,
  PdfAttachmentStateDataV2Schema,
]);

export const AttachmentsPdfStateGetSchema = BaseSchema.extend({
  body: z.object({
    /** Id of the document to which the PDF Attachment belongs */
    documentId: z.uuid(),

    /** Id of the PDF Attachment */
    attachmentId: z.uuid(),
  }),
});

export type AttachmentsPdfStateGetReq = z.infer<
  typeof AttachmentsPdfStateGetSchema
>;

export const AttachmentsPdfStateUpdateSchema = BaseSchema.extend({
  body: z.object({
    /** Id of the document to which the PDF Attachment belongs */
    documentId: z.uuid(),

    /** Id of the PDF Attachment */
    attachmentId: z.uuid(),

    /** Revision returned by the last PDF state read or write */
    revision: z.number().int().nonnegative(),

    /** Outline-internal PDF annotation state */
    data: PdfAttachmentStateDataSchema,
  }),
});

export type AttachmentsPdfStateUpdateReq = z.infer<
  typeof AttachmentsPdfStateUpdateSchema
>;

export const AttachmentsRedirectSchema = BaseSchema.extend({
  body: z.object({
    /** Id of the attachment to be deleted */
    id: z.uuid().optional(),
  }),
  query: z.object({
    /** Id of the attachment to be deleted */
    id: z.uuid().optional(),
  }),
}).refine((req) => !(isEmpty(req.body.id) && isEmpty(req.query.id)), {
  message: "id is required",
});

export type AttachmentsRedirectReq = z.infer<typeof AttachmentsRedirectSchema>;
