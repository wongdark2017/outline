import { randomUUID } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import path from "node:path";
import { AttachmentPreset, CollectionPermission } from "@shared/types";
import { AttachmentPdfState, UserMembership } from "@server/models";
import Attachment from "@server/models/Attachment";
import FileStorage from "@server/storage/files";
import {
  buildUser,
  buildAdmin,
  buildCollection,
  buildAttachment,
  buildDocument,
  buildViewer,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";

vi.mock("@server/storage/files");

const server = getTestServer();
const mockFilePath = path.join(__dirname, "../../../test/fixtures/markdown.md");
const mockFileContent = readFileSync(mockFilePath, "utf8");
const mockFileSize = Buffer.byteLength(mockFileContent);

describe("#attachments.list", () => {
  it("should return attachments for user", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
    });
    const attachment2 = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
    });

    const res = await server.post("/api/attachments.list", user);
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.pagination.total).toEqual(2);
    expect(body.data.length).toEqual(2);
    expect(body.data[0].id).toEqual(attachment.id);
    expect(body.data[1].id).toEqual(attachment2.id);
  });

  it("should allow filtering by userId when user is an admin", async () => {
    const admin = await buildAdmin();
    const user = await buildUser({ teamId: admin.teamId });
    // Attachments for user
    const attachment1 = await buildAttachment({
      teamId: admin.teamId,
      userId: user.id,
    });
    // Attachment for admin
    await buildAttachment({
      teamId: admin.teamId,
      userId: admin.id,
    });

    const res = await server.post("/api/attachments.list", admin, {
      body: {
        userId: user.id,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.length).toEqual(1);
    expect(body.data[0].id).toEqual(attachment1.id);
  });

  it("should filter by documentId", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
    });
    await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
    });

    const res = await server.post("/api/attachments.list", user, {
      body: {
        documentId: document.id,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.length).toEqual(1);
    expect(body.data[0].id).toEqual(attachment.id);
  });

  it("should not return attachments created by other users", async () => {
    const user = await buildUser();
    const anotherUser = await buildUser({
      teamId: user.teamId,
    });
    await buildAttachment({
      teamId: user.teamId,
      userId: anotherUser.id,
    });

    const res = await server.post("/api/attachments.list", user);
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.length).toEqual(0);
  });

  it("should require authentication", async () => {
    const res = await server.post("/api/attachments.list");
    expect(res.status).toEqual(401);
  });
});

describe("#attachments.create", () => {
  it("should require authentication", async () => {
    const res = await server.post("/api/attachments.create");
    expect(res.status).toEqual(401);
  });

  describe("member", () => {
    it("should allow upload using avatar preset", async () => {
      const user = await buildUser();
      const res = await server.post("/api/attachments.create", user, {
        body: {
          name: "test.png",
          contentType: "image/png",
          size: 1000,
          preset: AttachmentPreset.Avatar,
        },
      });
      expect(res.status).toEqual(200);

      const body = await res.json();
      const attachment = await Attachment.findByPk(body.data.attachment.id, {
        rejectOnEmpty: true,
      });
      expect(attachment.expiresAt).toBeNull();
    });

    it("should allow attachment creation for documents", async () => {
      const user = await buildUser();
      const document = await buildDocument({
        teamId: user.teamId,
        userId: user.id,
      });

      const res = await server.post("/api/attachments.create", user, {
        body: {
          name: "test.png",
          contentType: "image/png",
          size: 1000,
          documentId: document.id,
          preset: AttachmentPreset.DocumentAttachment,
        },
      });
      expect(res.status).toEqual(200);
    });

    it("should create expiring attachment using import preset", async () => {
      const user = await buildUser();
      const res = await server.post("/api/attachments.create", user, {
        body: {
          name: "test.zip",
          contentType: "application/zip",
          size: 10000,
          preset: AttachmentPreset.WorkspaceImport,
        },
      });
      expect(res.status).toEqual(200);

      const body = await res.json();
      const attachment = await Attachment.findByPk(body.data.attachment.id, {
        rejectOnEmpty: true,
      });
      expect(attachment.expiresAt).toBeTruthy();
    });

    it("should not allow attachment creation for other documents", async () => {
      const user = await buildUser();
      const document = await buildDocument();

      const res = await server.post("/api/attachments.create", user, {
        body: {
          name: "test.png",
          contentType: "image/png",
          size: 1000,
          documentId: document.id,
          preset: AttachmentPreset.DocumentAttachment,
        },
      });
      expect(res.status).toEqual(403);
    });

    it("should not allow file upload for avatar preset", async () => {
      const user = await buildUser();
      const res = await server.post("/api/attachments.create", user, {
        body: {
          name: "test.pdf",
          contentType: "application/pdf",
          size: 1000,
          preset: AttachmentPreset.Avatar,
        },
      });
      expect(res.status).toEqual(400);
    });

    it("should reject negative size", async () => {
      const user = await buildUser();
      const res = await server.post("/api/attachments.create", user, {
        body: {
          name: "test.png",
          contentType: "image/png",
          size: -1,
          preset: AttachmentPreset.Emoji,
        },
      });
      expect(res.status).toEqual(400);
    });

    it("should reject non-integer size", async () => {
      const user = await buildUser();
      const res = await server.post("/api/attachments.create", user, {
        body: {
          name: "test.png",
          contentType: "image/png",
          size: 1.5,
          preset: AttachmentPreset.Emoji,
        },
      });
      expect(res.status).toEqual(400);
    });
  });

  describe("viewer", () => {
    it("should allow attachment creation for documents in collections with edit access", async () => {
      const user = await buildViewer();
      const collection = await buildCollection({
        teamId: user.teamId,
        permission: null,
      });
      const document = await buildDocument({
        teamId: user.teamId,
        collectionId: collection.id,
      });

      await UserMembership.create({
        createdById: user.id,
        collectionId: collection.id,
        userId: user.id,
        permission: CollectionPermission.ReadWrite,
      });

      const res = await server.post("/api/attachments.create", user, {
        body: {
          name: "test.png",
          contentType: "image/png",
          size: 1000,
          documentId: document.id,
          preset: AttachmentPreset.DocumentAttachment,
        },
      });
      expect(res.status).toEqual(200);
    });

    it("should not allow attachment creation for documents", async () => {
      const user = await buildViewer();
      const document = await buildDocument({ teamId: user.teamId });

      const res = await server.post("/api/attachments.create", user, {
        body: {
          name: "test.png",
          contentType: "image/png",
          size: 1000,
          documentId: document.id,
          preset: AttachmentPreset.DocumentAttachment,
        },
      });
      expect(res.status).toEqual(403);
    });

    it("should allow upload using avatar preset", async () => {
      const user = await buildViewer();
      const res = await server.post("/api/attachments.create", user, {
        body: {
          name: "test.png",
          contentType: "image/png",
          size: 1000,
          preset: AttachmentPreset.Avatar,
        },
      });
      expect(res.status).toEqual(200);
    });
  });
});

describe("#attachments.delete", () => {
  it("should require authentication", async () => {
    const res = await server.post("/api/attachments.delete");
    expect(res.status).toEqual(401);
  });

  it("should allow deleting an attachment belonging to a document user has access to", async () => {
    const user = await buildUser();
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
    });
    const res = await server.post("/api/attachments.delete", user, {
      body: {
        id: attachment.id,
      },
    });
    expect(res.status).toEqual(200);
    expect(
      await Attachment.count({
        where: {
          teamId: user.teamId,
        },
      })
    ).toEqual(0);
  });

  it("should allow deleting an attachment without a document created by user", async () => {
    const user = await buildUser();
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
    });
    attachment.documentId = null;
    await attachment.save();
    const res = await server.post("/api/attachments.delete", user, {
      body: {
        id: attachment.id,
      },
    });
    expect(res.status).toEqual(200);
    expect(
      await Attachment.count({
        where: {
          teamId: user.teamId,
        },
      })
    ).toEqual(0);
  });

  it("should allow deleting an attachment without a document if admin", async () => {
    const user = await buildAdmin();
    const attachment = await buildAttachment({
      teamId: user.teamId,
    });
    attachment.documentId = null;
    await attachment.save();
    const res = await server.post("/api/attachments.delete", user, {
      body: {
        id: attachment.id,
      },
    });
    expect(res.status).toEqual(200);
    expect(
      await Attachment.count({
        where: {
          teamId: user.teamId,
        },
      })
    ).toEqual(0);
  });

  it("should not allow deleting an attachment in another team", async () => {
    const user = await buildAdmin();
    const attachment = await buildAttachment();
    attachment.documentId = null;
    await attachment.save();
    const res = await server.post("/api/attachments.delete", user, {
      body: {
        id: attachment.id,
      },
    });
    expect(res.status).toEqual(403);
  });

  it("should not allow deleting an attachment without a document", async () => {
    const user = await buildUser();
    const attachment = await buildAttachment({
      teamId: user.teamId,
    });
    attachment.documentId = null;
    await attachment.save();
    const res = await server.post("/api/attachments.delete", user, {
      body: {
        id: attachment.id,
      },
    });
    expect(res.status).toEqual(403);
  });

  it("should not allow deleting an attachment belonging to a document user does not have access to", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      permission: null,
    });
    const document = await buildDocument({
      teamId: collection.teamId,
      userId: collection.createdById,
      collectionId: collection.id,
    });
    const attachment = await buildAttachment({
      teamId: document.teamId,
      userId: document.createdById,
      documentId: document.id,
      acl: "private",
    });
    const res = await server.post("/api/attachments.delete", user, {
      body: {
        id: attachment.id,
      },
    });
    expect(res.status).toEqual(403);
  });
});

describe("#attachments.pdfState", () => {
  const data = {
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
            x: 0.12,
            y: 0.2,
            width: 0.24,
            height: 0.03,
          },
        ],
        createdById: "00000000-0000-0000-0000-000000000000",
        updatedById: "00000000-0000-0000-0000-000000000000",
        createdAt: "2026-06-07T00:00:00.000Z",
        updatedAt: "2026-06-07T00:00:00.000Z",
      },
    ],
  };

  it("should return empty state for a pdf attachment without state", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
      contentType: "application/pdf",
    });

    const res = await server.post("/api/attachments.pdfState.get", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data).toEqual({
      attachmentId: attachment.id,
      documentId: document.id,
      revision: 0,
      data: {
        version: 2,
        annotations: [],
      },
    });
  });

  it("should create and update pdf state with revision control", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
      contentType: "application/pdf",
    });

    const createRes = await server.post("/api/attachments.pdfState.update", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
        revision: 0,
        data,
      },
    });
    const createBody = await createRes.json();

    expect(createRes.status).toEqual(200);
    expect(createBody.data.revision).toEqual(1);
    expect(createBody.data.data).toEqual(data);

    const updatedData = {
      version: 2,
      annotations: [
        {
          ...data.annotations[0],
          text: "Updated note",
          updatedAt: "2026-06-07T00:10:00.000Z",
        },
      ],
    };

    const updateRes = await server.post("/api/attachments.pdfState.update", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
        revision: 1,
        data: updatedData,
      },
    });
    const updateBody = await updateRes.json();

    expect(updateRes.status).toEqual(200);
    expect(updateBody.data.revision).toEqual(2);
    expect(updateBody.data.data).toEqual(updatedData);
    expect(
      await AttachmentPdfState.count({
        where: {
          attachmentId: attachment.id,
          documentId: document.id,
        },
      })
    ).toEqual(1);
  });

  it("should reject stale pdf state revisions", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
      contentType: "application/pdf",
    });

    await server.post("/api/attachments.pdfState.update", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
        revision: 0,
        data,
      },
    });

    const res = await server.post("/api/attachments.pdfState.update", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
        revision: 0,
        data,
      },
    });

    expect(res.status).toEqual(409);
  });

  it("should require update permission to save pdf state", async () => {
    const user = await buildViewer();
    const collection = await buildCollection({
      teamId: user.teamId,
      permission: null,
    });
    await UserMembership.create({
      collectionId: collection.id,
      createdById: user.id,
      permission: CollectionPermission.Read,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      collectionId: collection.id,
      userId: collection.createdById,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: collection.createdById,
      documentId: document.id,
      contentType: "application/pdf",
    });

    const res = await server.post("/api/attachments.pdfState.update", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
        revision: 0,
        data,
      },
    });

    expect(res.status).toEqual(403);
  });

  it("should allow read-only users to read pdf state", async () => {
    const user = await buildViewer();
    const collection = await buildCollection({
      teamId: user.teamId,
      permission: null,
    });
    await UserMembership.create({
      collectionId: collection.id,
      createdById: user.id,
      permission: CollectionPermission.Read,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      collectionId: collection.id,
      userId: collection.createdById,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: collection.createdById,
      documentId: document.id,
      contentType: "application/pdf",
    });

    const res = await server.post("/api/attachments.pdfState.get", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
      },
    });

    expect(res.status).toEqual(200);
  });

  it("should require read permission to read pdf state", async () => {
    const user = await buildViewer();
    const collection = await buildCollection({
      teamId: user.teamId,
      permission: null,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      collectionId: collection.id,
      userId: collection.createdById,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: collection.createdById,
      documentId: document.id,
      contentType: "application/pdf",
    });

    const res = await server.post("/api/attachments.pdfState.get", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
      },
    });

    expect(res.status).toEqual(403);
  });

  it("should reject non-pdf attachments", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
      contentType: "image/png",
    });

    const res = await server.post("/api/attachments.pdfState.update", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
        revision: 0,
        data,
      },
    });

    expect(res.status).toEqual(400);
  });

  it("should reject attachments from another team", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
    });
    const attachment = await buildAttachment({
      documentId: document.id,
      contentType: "application/pdf",
    });

    const res = await server.post("/api/attachments.pdfState.get", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
      },
    });

    expect(res.status).toEqual(403);
  });

  it("should reject attachments outside the requested document", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
    });
    const otherDocument = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: otherDocument.id,
      contentType: "application/pdf",
    });

    const res = await server.post("/api/attachments.pdfState.get", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
      },
    });

    expect(res.status).toEqual(400);
  });

  it("should cascade delete pdf state when the attachment is deleted", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
      contentType: "application/pdf",
    });

    await server.post("/api/attachments.pdfState.update", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
        revision: 0,
        data,
      },
    });

    await attachment.destroy();

    expect(
      await AttachmentPdfState.count({
        where: {
          attachmentId: attachment.id,
        },
      })
    ).toEqual(0);
  });

  it("should reject invalid pdf state data", async () => {
    const user = await buildUser();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
      contentType: "application/pdf",
    });

    const res = await server.post("/api/attachments.pdfState.update", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
        revision: 0,
        data: {
          version: 9,
          annotations: [],
        },
      },
    });

    expect(res.status).toEqual(400);
  });

  it.each([
    [
      "pageIndex",
      {
        annotations: [
          {
            ...data.annotations[0],
            pageIndex: -1,
          },
        ],
      },
    ],
    [
      "type",
      {
        annotations: [
          {
            ...data.annotations[0],
            type: "comment",
          },
        ],
      },
    ],
    [
      "mode",
      {
        annotations: [
          {
            ...data.annotations[0],
            mode: "outline",
          },
        ],
      },
    ],
    [
      "text",
      {
        annotations: [
          {
            ...data.annotations[0],
            text: "a".repeat(4001),
          },
        ],
      },
    ],
    [
      "annotations",
      {
        annotations: Array.from({ length: 201 }, (_, index) => ({
          ...data.annotations[0],
          id: `annotation-${index}`,
        })),
      },
    ],
    [
      "rects",
      {
        annotations: [
          {
            ...data.annotations[0],
            rects: [
              {
                x: 1.5,
                y: 0,
                width: 0.1,
                height: 0.1,
              },
            ],
          },
        ],
      },
    ],
    [
      "selectedText",
      {
        annotations: [
          {
            ...data.annotations[0],
            selectedText: "a".repeat(4001),
          },
        ],
      },
    ],
  ])("should reject invalid pdf state %s", async (_field, partialData) => {
    const user = await buildUser();
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
      contentType: "application/pdf",
    });

    const res = await server.post("/api/attachments.pdfState.update", user, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
        revision: 0,
        data: {
          version: 2,
          ...partialData,
        },
      },
    });

    expect(res.status).toEqual(400);
  });

  it("should verify pdf attachment state without modifying the original pdf", async () => {
    vi.mocked(FileStorage.getFileStream).mockImplementation(() =>
      Promise.resolve(createReadStream(mockFilePath))
    );

    const user = await buildUser();
    const viewer = await buildViewer({
      teamId: user.teamId,
    });
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
      permission: null,
    });
    await UserMembership.create({
      collectionId: collection.id,
      createdById: user.id,
      permission: CollectionPermission.Read,
      userId: viewer.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
      acl: "private",
      contentType: "application/pdf",
      size: mockFileSize,
    });
    const annotationText = "Sidecar note that should not be in PDF";
    const annotationData = {
      version: 2,
      annotations: [
        {
          ...data.annotations[0],
          id: "manual-verification-note",
          text: annotationText,
        },
      ],
    };

    const originalFileRes = await server.get(
      `/api/attachments.file?id=${attachment.id}`,
      user
    );
    const originalFileBody = await originalFileRes.text();

    expect(originalFileRes.status).toEqual(200);
    expect(originalFileRes.headers.get("content-type")).toContain(
      "application/pdf"
    );
    expect(originalFileBody).toEqual(mockFileContent);

    const updateRes = await server.post(
      "/api/attachments.pdfState.update",
      user,
      {
        body: {
          documentId: document.id,
          attachmentId: attachment.id,
          revision: 0,
          data: annotationData,
        },
      }
    );
    const updateBody = await updateRes.json();

    expect(updateRes.status).toEqual(200);
    expect(updateBody.data.revision).toEqual(1);

    const readRes = await server.post("/api/attachments.pdfState.get", viewer, {
      body: {
        documentId: document.id,
        attachmentId: attachment.id,
      },
    });
    const readBody = await readRes.json();

    expect(readRes.status).toEqual(200);
    expect(readBody.data.data.annotations[0].text).toEqual(annotationText);

    const viewerUpdateRes = await server.post(
      "/api/attachments.pdfState.update",
      viewer,
      {
        body: {
          documentId: document.id,
          attachmentId: attachment.id,
          revision: 1,
          data: annotationData,
        },
      }
    );

    expect(viewerUpdateRes.status).toEqual(403);

    const downloadedFileRes = await server.get(
      `/api/attachments.file?id=${attachment.id}`,
      user
    );
    const downloadedFileBody = await downloadedFileRes.text();

    expect(downloadedFileRes.status).toEqual(200);
    expect(downloadedFileBody).toEqual(originalFileBody);
    expect(downloadedFileBody).not.toContain(annotationText);
  });
});

describe("#attachments.redirect", () => {
  it("should return a redirect for an attachment belonging to a document user has access to", async () => {
    const user = await buildUser();
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
    });
    const res = await server.post("/api/attachments.redirect", user, {
      body: {
        id: attachment.id,
      },
      redirect: "manual",
    });
    expect(res.status).toEqual(302);
  });

  it("should return a redirect for the attachment if id supplied via query params", async () => {
    const user = await buildUser();
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
    });
    const res = await server.post(
      `/api/attachments.redirect?id=${attachment.id}`,
      user,
      {
        redirect: "manual",
      }
    );
    expect(res.status).toEqual(302);
  });

  it("should return a redirect for an attachment belonging to a trashed document user has access to", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      deletedAt: new Date(),
    });
    const attachment = await buildAttachment({
      documentId: document.id,
      teamId: user.teamId,
      userId: user.id,
    });
    const res = await server.post("/api/attachments.redirect", user, {
      body: {
        id: attachment.id,
      },
      redirect: "manual",
    });
    expect(res.status).toEqual(302);
  });

  it("should always return a redirect for a public attachment", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      teamId: user.teamId,
      userId: user.id,
      permission: null,
    });
    const document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
    });
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      documentId: document.id,
    });
    const res = await server.post("/api/attachments.redirect", user, {
      body: {
        id: attachment.id,
      },
      redirect: "manual",
    });
    expect(res.status).toEqual(302);
  });

  it("should return a redirect for an attachment in a public bucket without authentication", async () => {
    const attachment = await buildAttachment({
      key: `public/${randomUUID()}/test.png`,
      acl: "public-read",
    });
    const res = await server.post("/api/attachments.redirect", {
      body: {
        id: attachment.id,
      },
      redirect: "manual",
    });
    expect(res.status).toEqual(302);
    expect(res.headers.get("location")).toContain(attachment.canonicalUrl);
  });

  it("should return a redirect for a public-read attachment without authentication (not in public bucket)", async () => {
    const attachment = await buildAttachment({
      acl: "public-read",
    });
    const res = await server.post("/api/attachments.redirect", {
      body: {
        id: attachment.id,
      },
      redirect: "manual",
    });
    expect(res.status).toEqual(302);
    expect(res.headers.get("location")).toContain(await attachment.signedUrl);
  });

  it("should not return a redirect for a private attachment belonging to a document user does not have access to", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      permission: null,
    });
    const document = await buildDocument({
      teamId: collection.teamId,
      userId: collection.createdById,
      collectionId: collection.id,
    });
    const attachment = await buildAttachment({
      teamId: document.teamId,
      userId: document.createdById,
      documentId: document.id,
      acl: "private",
    });
    const res = await server.post("/api/attachments.redirect", user, {
      body: {
        id: attachment.id,
      },
    });
    expect(res.status).toEqual(403);
  });

  it("should fail in absence of id", async () => {
    const user = await buildUser();
    const res = await server.post("/api/attachments.redirect", user);
    const body = await res.json();
    expect(res.status).toEqual(400);
    expect(body.message).toEqual("id is required");
  });
});

describe("#attachments.file", () => {
  it("should stream a private pdf attachment for an authenticated team member", async () => {
    const user = await buildUser();
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      acl: "private",
      contentType: "application/pdf",
      size: mockFileSize,
    });

    const res = await server.get(
      `/api/attachments.file?id=${attachment.id}`,
      user
    );

    expect(res.status).toEqual(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(res.headers.get("accept-ranges")).toEqual("bytes");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(await res.text()).toEqual(mockFileContent);
    expect(FileStorage.getFileStream).toHaveBeenCalledWith(attachment.key, undefined);
  });

  it("should support byte range requests", async () => {
    const user = await buildUser();
    const attachment = await buildAttachment({
      teamId: user.teamId,
      userId: user.id,
      acl: "private",
      contentType: "application/pdf",
      size: 100,
    });

    const res = await server.get(`/api/attachments.file?id=${attachment.id}`, user, {
      headers: {
        Range: "bytes=10-19",
      },
    });

    expect(res.status).toEqual(206);
    expect(res.headers.get("content-range")).toEqual("bytes 10-19/100");
    expect(res.headers.get("content-length")).toEqual("10");
    expect(FileStorage.getFileStream).toHaveBeenCalledWith(attachment.key, {
      start: 10,
      end: 19,
    });
  });

  it("should reject access to a private attachment from another team", async () => {
    const user = await buildUser();
    const attachment = await buildAttachment({
      acl: "private",
    });

    const res = await server.get(`/api/attachments.file?id=${attachment.id}`, user);

    expect(res.status).toEqual(403);
  });
});
