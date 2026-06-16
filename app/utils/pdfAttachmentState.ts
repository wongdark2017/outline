import type {
  AttachmentPdfStateGetRequest,
  AttachmentPdfStateResponse,
  AttachmentPdfStateUpdateRequest,
  AttachmentPdfStateData,
  AttachmentPdfStateDataV1,
  AttachmentPdfStateDataV2,
} from "@shared/types";
import type { JSONObject } from "@shared/types";
import { client } from "./ApiClient";

interface AttachmentPdfStateApiResponse {
  data: AttachmentPdfStateResponse;
}

function toPdfStateV1Json(data: AttachmentPdfStateDataV1): JSONObject {
  return {
    version: data.version,
    annotations: data.annotations.map((annotation) => ({
      id: annotation.id,
      pageIndex: annotation.pageIndex,
      type: annotation.type,
      color: annotation.color,
      text: annotation.text,
      rect: annotation.rect
        ? {
            x: annotation.rect.x,
            y: annotation.rect.y,
            width: annotation.rect.width,
            height: annotation.rect.height,
          }
        : null,
      points: annotation.points
        ? annotation.points.map((point) => ({
            x: point.x,
            y: point.y,
          }))
        : null,
      createdById: annotation.createdById,
      updatedById: annotation.updatedById,
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
    })),
  };
}

function toPdfStateV2Json(data: AttachmentPdfStateDataV2): JSONObject {
  return {
    version: data.version,
    annotations: data.annotations.map((annotation) => ({
      id: annotation.id,
      pageIndex: annotation.pageIndex,
      type: annotation.type,
      mode: annotation.mode,
      color: annotation.color,
      text: annotation.text,
      selectedText: annotation.selectedText,
      rects: annotation.rects.map((rect) => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      })),
      createdById: annotation.createdById,
      updatedById: annotation.updatedById,
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
    })),
  };
}

function toPdfStateJson(data: AttachmentPdfStateData): JSONObject {
  if (data.version === 1) {
    return toPdfStateV1Json(data);
  }

  return toPdfStateV2Json(data);
}

/**
 * Reads Outline-internal PDF annotation state for an attachment.
 *
 * @param request - the document and attachment ids that scope the state.
 * @returns the current PDF annotation state.
 */
export async function getPdfAttachmentState(
  request: AttachmentPdfStateGetRequest
): Promise<AttachmentPdfStateResponse> {
  const body: JSONObject = {
    attachmentId: request.attachmentId,
    documentId: request.documentId,
  };

  const response = await client.post<AttachmentPdfStateApiResponse>(
    "/attachments.pdfState.get",
    body
  );

  return response.data;
}

/**
 * Saves Outline-internal PDF annotation state for an attachment.
 *
 * @param request - the state payload and expected revision.
 * @returns the updated PDF annotation state.
 */
export async function updatePdfAttachmentState(
  request: AttachmentPdfStateUpdateRequest
): Promise<AttachmentPdfStateResponse> {
  const body: JSONObject = {
    attachmentId: request.attachmentId,
    data: toPdfStateJson(request.data),
    documentId: request.documentId,
    revision: request.revision,
  };

  const response = await client.post<AttachmentPdfStateApiResponse>(
    "/attachments.pdfState.update",
    body
  );

  return response.data;
}
