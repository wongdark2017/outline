import type { AttachmentPdfStateData } from "@shared/types";
import { ConflictError } from "./errors";
import {
  getPdfAttachmentState,
  updatePdfAttachmentState,
} from "./pdfAttachmentState";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("~/utils/ApiClient", () => ({
  client: {
    post: mocks.post,
  },
}));

describe("pdfAttachmentState", () => {
  const data: AttachmentPdfStateData = {
    version: 2,
    annotations: [
      {
        id: "annotation-1",
        pageIndex: 0,
        type: "text",
        mode: "highlight",
        color: "#ffcc00",
        text: "Check this section",
        selectedText: "Check this section",
        rects: [
          {
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.04,
          },
        ],
        createdById: null,
        updatedById: null,
        createdAt: "2026-06-07T00:00:00.000Z",
        updatedAt: "2026-06-07T00:00:00.000Z",
      },
    ],
  };

  beforeEach(() => {
    mocks.post.mockReset();
  });

  it("requests pdf state by document and attachment id", async () => {
    const response = {
      data: {
        attachmentId: "attachment-id",
        documentId: "document-id",
        revision: 0,
        data: {
          version: 2,
          annotations: [],
        },
      },
    };
    mocks.post.mockResolvedValue(response);

    await expect(
      getPdfAttachmentState({
        attachmentId: "attachment-id",
        documentId: "document-id",
      })
    ).resolves.toEqual(response.data);
    expect(mocks.post).toHaveBeenCalledWith("/attachments.pdfState.get", {
      attachmentId: "attachment-id",
      documentId: "document-id",
    });
  });

  it("updates pdf state with revision and data", async () => {
    const response = {
      data: {
        attachmentId: "attachment-id",
        documentId: "document-id",
        revision: 2,
        data,
      },
    };
    mocks.post.mockResolvedValue(response);

    await expect(
      updatePdfAttachmentState({
        attachmentId: "attachment-id",
        documentId: "document-id",
        revision: 1,
        data,
      })
    ).resolves.toEqual(response.data);
    expect(mocks.post).toHaveBeenCalledWith("/attachments.pdfState.update", {
      attachmentId: "attachment-id",
      documentId: "document-id",
      revision: 1,
      data,
    });
  });

  it("passes through conflict errors from the API client", async () => {
    const error = new ConflictError("PDF annotation state has changed");
    mocks.post.mockRejectedValue(error);

    await expect(
      updatePdfAttachmentState({
        attachmentId: "attachment-id",
        documentId: "document-id",
        revision: 1,
        data,
      })
    ).rejects.toBe(error);
  });
});
