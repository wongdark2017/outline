import type { AttachmentPdfStateData, AttachmentPdfStateDataV2 } from "@shared/types";

export const EmptyPdfStateDataV2: AttachmentPdfStateDataV2 = {
  version: 2,
  annotations: [],
};

/**
 * Converts any persisted PDF state to the current version 2 shape.
 *
 * @param data - persisted PDF state.
 * @returns a version 2 state object.
 */
export function toV2PdfStateData(
  data: AttachmentPdfStateData
): AttachmentPdfStateDataV2 {
  if (data.version === 2) {
    return data;
  }

  return EmptyPdfStateDataV2;
}

/**
 * Determines whether a response contains legacy note-style annotations.
 *
 * @param data - persisted PDF state.
 * @returns true if legacy version 1 notes exist.
 */
export function hasLegacyPdfNotes(data: AttachmentPdfStateData): boolean {
  return data.version === 1 && data.annotations.length > 0;
}
