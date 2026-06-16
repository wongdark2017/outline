import type {
  AttachmentPdfStateData,
  AttachmentPdfStateDataV2,
} from "@shared/types";
import { OutlinePdfAnnotationType } from "@shared/types";
import {
  EmptyPdfStateDataV2,
  hasLegacyPdfNotes,
  toV2PdfStateData,
} from "./pdfState";

describe("pdfState", () => {
  it("returns version 2 state unchanged", () => {
    const state: AttachmentPdfStateDataV2 = {
      version: 2,
      annotations: [],
    };

    expect(toV2PdfStateData(state)).toEqual(state);
  });

  it("downgrades legacy version 1 state to an empty version 2 state", () => {
    const state: AttachmentPdfStateData = {
      version: 1,
      annotations: [
        {
          id: "legacy-annotation",
          pageIndex: 0,
          type: OutlinePdfAnnotationType.Note,
          color: null,
          text: "Legacy note",
          rect: null,
          points: null,
          createdById: null,
          updatedById: null,
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z",
        },
      ],
    };

    expect(toV2PdfStateData(state)).toEqual(EmptyPdfStateDataV2);
    expect(hasLegacyPdfNotes(state)).toBe(true);
  });

  it("does not report legacy notes for version 2 state", () => {
    expect(hasLegacyPdfNotes(EmptyPdfStateDataV2)).toBe(false);
  });
});
