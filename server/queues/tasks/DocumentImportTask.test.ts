import { subHours } from "date-fns";
import { http, HttpResponse } from "msw";
import Logger from "@server/logging/Logger";
import { Attachment, Document } from "@server/models";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";
import {
  buildAttachment,
  buildCollection,
  buildDocument,
  buildUser,
} from "@server/test/factories";
import { buildZip, getTestServer } from "@server/test/support";
import { server as mockServer } from "@server/test/msw";
import CleanupExpiredAttachmentsTask from "./CleanupExpiredAttachmentsTask";
import DocumentImportTask from "./DocumentImportTask";

/** A 1x1 transparent PNG, small enough to embed in a test archive. */
const PNG_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

const PNG_DATA_URI = `data:image/png;base64,${PNG_PIXEL.toString("base64")}`;

/**
 * Serve content as the staged upload and stub the storage writes.
 *
 * @param content the staged content to serve.
 * @returns the spies standing in for attachment uploads and file deletion.
 */
function stageUpload(content: Buffer) {
  vi.spyOn(FileStorage, "getFileBuffer").mockResolvedValue(
    Buffer.from(content)
  );
  const deleteFile = vi
    .spyOn(FileStorage, "deleteFile")
    .mockResolvedValue(undefined);

  // storeFromUrl requires a URL before it creates remote or data attachments.
  const store = vi
    .spyOn(FileStorage, "store")
    .mockResolvedValue("https://app.outline.dev/stored");
  return { store, deleteFile };
}

/** Fail the task's transaction after factory transactions have completed. */
function failNextTransaction() {
  vi.spyOn(sequelize, "transaction").mockRejectedValueOnce(
    new Error("database unavailable")
  );
}

/** Capture the attachments actually inserted before an import succeeds or fails. */
function trackCreatedAttachments(): Attachment[] {
  const attachments: Attachment[] = [];
  Attachment.addHook(
    "afterCreate",
    "markdownImportAttachmentTracking",
    (attachment: Attachment) => {
      attachments.push(attachment);
    }
  );
  return attachments;
}

async function setupImport() {
  const user = await buildUser();
  const collection = await buildCollection({
    userId: user.id,
    teamId: user.teamId,
  });
  return { user, collection };
}

async function importZip(
  userId: string,
  collectionId: string,
  parentDocumentId?: string
) {
  return new DocumentImportTask().perform({
    key: "uploads/import.zip",
    sourceMetadata: { fileName: "import.zip", mimeType: "application/zip" },
    userId,
    collectionId,
    parentDocumentId,
    publish: true,
  });
}

async function importMarkdown(userId: string, collectionId: string) {
  return new DocumentImportTask().perform({
    key: "uploads/note.md",
    sourceMetadata: { fileName: "note.md", mimeType: "text/markdown" },
    userId,
    collectionId,
    publish: true,
  });
}

describe("DocumentImportTask", () => {
  afterEach(() => {
    Document.removeHook("beforeCreate", "markdownZipImportFailure");
    Attachment.removeHook("afterCreate", "markdownImportAttachmentTracking");
    Attachment.removeHook("afterBulkUpdate", "markdownImportKeepFailure");
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("zip of markdown", () => {
    it("imports documents nested by folder, with images and links", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const { store, deleteFile } = stageUpload(
        await buildZip({
          "Handbook/README.md":
            "# Handbook\n\nRead [the policy](Policy.md).\n\n![logo](images/logo.png)",
          "Handbook/Policy.md": "# Policy\n\n![logo](images/logo.png)",
          "Handbook/Values.md": "# Values",
          "Handbook/images/logo.png": PNG_PIXEL,
        })
      );

      const response = await importZip(user.id, collection.id);

      expect(response).toEqual({ documentId: expect.any(String) });
      if ("error" in response) {
        throw new Error(response.error);
      }
      const root = await Document.findByPk(response.documentId, {
        userId: user.id,
        rejectOnEmpty: true,
      });
      expect(root.title).toEqual("Handbook");
      expect(root.publishedAt).toBeTruthy();
      expect(root.sourceMetadata).toEqual({
        fileName: "import.zip",
        mimeType: "application/zip",
      });

      // Siblings keep the archive's order in the sidebar.
      await collection.reload();
      const [node] = collection.documentStructure ?? [];
      expect(node.id).toEqual(root.id);
      expect(node.children.map((child) => child.title)).toEqual([
        "Policy",
        "Values",
      ]);

      const policy = await Document.findByPk(node.children[0].id, {
        userId: user.id,
        rejectOnEmpty: true,
      });
      expect(policy.parentDocumentId).toEqual(root.id);
      expect(policy.sourceMetadata).toEqual({
        fileName: "Policy.md",
        mimeType: "text/markdown",
      });

      // Prefixes only: the serializer decides what follows the destination.
      expect(root.text).toContain(`[the policy](/doc/${policy.urlId}`);

      // The image is uploaded once, however many documents reference it.
      const attachments = await Attachment.findAll({
        where: { teamId: user.teamId },
      });
      expect(attachments).toHaveLength(1);
      await attachments[0].reload();
      expect(attachments[0].expiresAt).toBeNull();
      expect(root.text).toContain(`![logo](${attachments[0].redirectUrl}`);
      expect(policy.text).toContain(`![logo](${attachments[0].redirectUrl}`);
      expect(store).toHaveBeenCalledTimes(1);

      expect(deleteFile).toHaveBeenCalledWith("uploads/import.zip");
    });

    it("creates nothing for a zip without markdown", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      stageUpload(await buildZip({ "photo.png": PNG_PIXEL }));

      const response = await importZip(user.id, collection.id);

      expect(response).toEqual({
        error: expect.stringContaining("does not contain any Markdown"),
      });
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(0);
    });

    it("removes uploaded images when the import fails", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const { store, deleteFile } = stageUpload(
        await buildZip({
          "Trip.md": "![a](a.png) ![b](b.png)",
          "a.png": PNG_PIXEL,
          "b.png": PNG_PIXEL,
        })
      );
      store
        .mockResolvedValueOnce("https://app.outline.dev/stored")
        .mockRejectedValueOnce(new Error("storage unavailable"));

      const response = await importZip(user.id, collection.id);

      expect(response).toEqual({ error: "storage unavailable" });
      expect(
        await Attachment.count({ where: { teamId: user.teamId } })
      ).toEqual(0);
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(0);
      expect(deleteFile).toHaveBeenCalledTimes(2);
      expect(deleteFile).toHaveBeenCalledWith("uploads/import.zip");
    });

    it("rolls back inserted documents and sidebar changes if a child insert fails", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const originalStructure = collection.documentStructure;
      const { deleteFile } = stageUpload(
        await buildZip({
          "Handbook/README.md": "# Handbook\n\n![logo](logo.png)",
          "Handbook/Policy.md": "# Policy",
          "Handbook/Values.md": "# Values",
          "Handbook/logo.png": PNG_PIXEL,
        })
      );
      const attemptedTitles: string[] = [];
      Document.addHook(
        "beforeCreate",
        "markdownZipImportFailure",
        (document: Document) => {
          attemptedTitles.push(document.title);
          if (document.title === "Values") {
            throw new Error("child insert failed");
          }
        }
      );

      const response = await importZip(user.id, collection.id);

      expect(response).toEqual({ error: "child insert failed" });
      expect(attemptedTitles).toEqual(["Handbook", "Policy", "Values"]);
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(0);
      expect(
        await Attachment.count({ where: { teamId: user.teamId } })
      ).toEqual(0);
      await collection.reload();
      expect(collection.documentStructure).toEqual(originalStructure);
      expect(deleteFile).toHaveBeenCalledTimes(2);
    });

    it("nests the imported root under the requested existing document", async () => {
      const user = await buildUser();
      const parent = await buildDocument({
        userId: user.id,
        teamId: user.teamId,
      });
      if (!parent.collectionId) {
        throw new Error("The parent must belong to a collection");
      }
      stageUpload(await buildZip({ "Child.md": "# Imported child\n\nBody" }));

      const response = await importZip(user.id, parent.collectionId, parent.id);

      if ("error" in response) {
        throw new Error(response.error);
      }
      const root = await Document.findByPk(response.documentId, {
        userId: user.id,
        rejectOnEmpty: true,
      });
      expect(root.title).toEqual("Imported child");
      expect(root.parentDocumentId).toEqual(parent.id);
      expect(root.collectionId).toEqual(parent.collectionId);
      expect(root.text).toEqual("Body");
    });

    it("preserves Chinese names and extracts a normalized front matter title", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      stageUpload(
        await buildZip({
          "知识库/README.md": "\uFEFF---\r\ntitle: 中文标题\r\n---\r\n\r\n正文",
          "知识库/设置.markdown": "设置内容",
        })
      );

      const response = await importZip(user.id, collection.id);

      if ("error" in response) {
        throw new Error(response.error);
      }
      const root = await Document.findByPk(response.documentId, {
        userId: user.id,
        rejectOnEmpty: true,
      });
      expect(root.title).toEqual("中文标题");
      expect(root.text).toEqual("正文");
      await collection.reload();
      const [node] = collection.documentStructure ?? [];
      expect(node.children.map((child) => child.title)).toEqual(["设置"]);
    });

    it("returns a readable error for a corrupt ZIP and removes its staged upload", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        userId: user.id,
        teamId: user.teamId,
      });
      const { deleteFile } = stageUpload(Buffer.from("This is not a ZIP"));

      expect(await importZip(user.id, collection.id)).toEqual({
        error: "The zip file could not be read",
      });
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(0);
      expect(deleteFile).toHaveBeenCalledWith("uploads/import.zip");
    });

    it("rejects string content for a ZIP", async () => {
      const user = await buildUser();

      const response = await new DocumentImportTask().perform({
        content: "not binary ZIP content",
        sourceMetadata: { fileName: "import.zip", mimeType: "application/zip" },
        userId: user.id,
      });

      expect(response).toEqual({ error: "Unsupported zip file" });
    });
  });

  describe("ZIP attachment failure handling", () => {
    it("discards ZIP and data images that were uploaded before a transaction failure", async () => {
      const { user, collection } = await setupImport();
      const { store, deleteFile } = stageUpload(
        await buildZip({
          "Note.md": `![zip](photo.png)\n\n![inline](${PNG_DATA_URI})`,
          "photo.png": PNG_PIXEL,
        })
      );
      const created = trackCreatedAttachments();
      failNextTransaction();

      const response = await importZip(user.id, collection.id);

      expect(response).toEqual({ error: "database unavailable" });
      expect(store).toHaveBeenCalledTimes(2);
      expect(created).toHaveLength(2);
      for (const attachment of created) {
        expect(attachment.expiresAt?.getTime()).toBeGreaterThan(Date.now());
        expect(deleteFile).toHaveBeenCalledWith(attachment.key);
      }
      expect(
        await Attachment.count({ where: { teamId: user.teamId } })
      ).toEqual(0);
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(0);
    });

    it("keeps ZIP and data images permanent in a successful import", async () => {
      const { user, collection } = await setupImport();
      const { store } = stageUpload(
        await buildZip({
          "Note.md": `![zip](photo.png)\n\n![inline](${PNG_DATA_URI})`,
          "photo.png": PNG_PIXEL,
        })
      );
      const created = trackCreatedAttachments();

      const response = await importZip(user.id, collection.id);

      expect(response).toEqual({ documentId: expect.any(String) });
      expect(store).toHaveBeenCalledTimes(2);
      expect(created).toHaveLength(2);
      for (const attachment of created) {
        expect(attachment.expiresAt?.getTime()).toBeGreaterThan(Date.now());
        await attachment.reload();
        expect(attachment.expiresAt).toBeNull();
      }
      if ("error" in response) {
        throw new Error(response.error);
      }
      const document = await Document.findByPk(response.documentId, {
        userId: user.id,
        rejectOnEmpty: true,
      });
      for (const attachment of created) {
        expect(document.text).toContain(attachment.redirectUrl);
      }
    });

    it("tracks a real remote-image download before rolling back the import", async () => {
      const { user, collection } = await setupImport();
      const url = "https://example.com/import-image.png";

      // Keep the mocked request local instead of doing proxy DNS preflight.
      vi.stubEnv("npm_config_no_proxy", "*");
      let requests = 0;
      mockServer.use(
        http.get(url, () => {
          requests++;
          return HttpResponse.arrayBuffer(Uint8Array.from(PNG_PIXEL).buffer, {
            headers: { "Content-Type": "image/png" },
          });
        })
      );
      const { store, deleteFile } = stageUpload(
        await buildZip({ "Note.md": `![remote](${url})` })
      );
      const created = trackCreatedAttachments();
      failNextTransaction();

      const response = await importZip(user.id, collection.id);

      expect(response).toEqual({ error: "database unavailable" });
      expect(requests).toEqual(1);
      expect(store).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
      expect(deleteFile).toHaveBeenCalledWith(created[0].key);
      expect(
        await Attachment.count({ where: { teamId: user.teamId } })
      ).toEqual(0);
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(0);
    });

    it("preserves a successful result when deleting the staged ZIP fails", async () => {
      const { user, collection } = await setupImport();
      const { deleteFile } = stageUpload(
        await buildZip({ "Note.md": "# Note\n\nBody" })
      );
      deleteFile.mockRejectedValue(new Error("storage unavailable"));
      const warning = vi.spyOn(Logger, "warn");

      const response = await importZip(user.id, collection.id);

      expect(response).toEqual({ documentId: expect.any(String) });
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(1);
      expect(warning).toHaveBeenCalledWith(
        "Failed to delete staged import file",
        {
          key: "uploads/import.zip",
          error: "storage unavailable",
        }
      );
    });

    it("preserves the ZIP error when deleting its staged upload also fails", async () => {
      const { user, collection } = await setupImport();
      const { deleteFile } = stageUpload(
        await buildZip({ "photo.png": PNG_PIXEL })
      );
      deleteFile.mockRejectedValue(new Error("storage unavailable"));

      expect(await importZip(user.id, collection.id)).toEqual({
        error: "Zip file does not contain any Markdown documents",
      });
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(0);
    });

    it("leaves failed ZIP attachment cleanup eligible for the existing expiry job", async () => {
      const { user, collection } = await setupImport();
      const { store, deleteFile } = stageUpload(
        await buildZip({
          "Note.md": "![zip](photo.png)",
          "photo.png": PNG_PIXEL,
        })
      );
      const created = trackCreatedAttachments();
      failNextTransaction();
      const destroy = vi
        .spyOn(Attachment.prototype, "destroy")
        .mockRejectedValue(new Error("cleanup unavailable"));
      const warning = vi.spyOn(Logger, "warn");

      const response = await importZip(user.id, collection.id);

      expect(response).toEqual({ error: "database unavailable" });
      expect(store).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
      const attachment = await created[0].reload();
      expect(attachment.expiresAt?.getTime()).toBeGreaterThan(Date.now());
      expect(warning).toHaveBeenCalledWith(
        "Could not remove an attachment of a failed import, it will expire instead",
        { attachmentId: attachment.id, error: "cleanup unavailable" }
      );
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(0);

      destroy.mockRestore();
      await attachment.update({ expiresAt: subHours(new Date(), 1) });
      await new CleanupExpiredAttachmentsTask().perform({
        limit: 100,
        partition: { partitionIndex: 0, partitionCount: 1 },
      });
      expect(
        await Attachment.count({ where: { teamId: user.teamId } })
      ).toEqual(0);
      expect(deleteFile).toHaveBeenCalledWith(attachment.key);
    });

    it("rolls back expiry clearing together with documents when keeping attachments fails", async () => {
      const { user, collection } = await setupImport();
      const originalStructure = collection.documentStructure;
      const { store } = stageUpload(
        await buildZip({
          "Note.md": "![zip](photo.png)",
          "photo.png": PNG_PIXEL,
        })
      );
      const created = trackCreatedAttachments();
      Attachment.addHook("afterBulkUpdate", "markdownImportKeepFailure", () => {
        throw new Error("expiry update failed");
      });
      const destroy = vi
        .spyOn(Attachment.prototype, "destroy")
        .mockRejectedValue(new Error("cleanup unavailable"));

      const response = await importZip(user.id, collection.id);

      expect(response).toEqual({ error: "expiry update failed" });
      expect(store).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
      const attachment = await created[0].reload();
      expect(attachment.expiresAt?.getTime()).toBeGreaterThan(Date.now());
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(0);
      await collection.reload();
      expect(collection.documentStructure).toEqual(originalStructure);

      destroy.mockRestore();
      await attachment.destroy();
    });
  });

  describe("single-file attachment handling", () => {
    it("discards data images uploaded before a single-file transaction failure", async () => {
      const { user, collection } = await setupImport();
      const { store, deleteFile } = stageUpload(
        Buffer.from(`# Note\n\n![inline](${PNG_DATA_URI})`)
      );
      const created = trackCreatedAttachments();
      failNextTransaction();

      const response = await importMarkdown(user.id, collection.id);

      expect(response).toEqual({ error: "database unavailable" });
      expect(store).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
      expect(created[0].expiresAt?.getTime()).toBeGreaterThan(Date.now());
      expect(deleteFile).toHaveBeenCalledWith(created[0].key);
      expect(
        await Attachment.count({ where: { teamId: user.teamId } })
      ).toEqual(0);
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(0);
    });

    it("makes downloaded data images permanent after a successful single-file import", async () => {
      const { user, collection } = await setupImport();
      const { store } = stageUpload(
        Buffer.from(`# Note\n\n![inline](${PNG_DATA_URI})`)
      );
      const created = trackCreatedAttachments();

      const response = await importMarkdown(user.id, collection.id);

      expect(response).toEqual({ documentId: expect.any(String) });
      expect(store).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
      expect(created[0].expiresAt?.getTime()).toBeGreaterThan(Date.now());
      await created[0].reload();
      expect(created[0].expiresAt).toBeNull();
      if ("error" in response) {
        throw new Error(response.error);
      }
      const document = await Document.findByPk(response.documentId, {
        userId: user.id,
        rejectOnEmpty: true,
      });
      expect(document.text).toContain(created[0].redirectUrl);
    });

    it("keeps single-file success when deleting the staged upload fails", async () => {
      const { user, collection } = await setupImport();
      const { deleteFile } = stageUpload(Buffer.from("# Note\n\nBody"));
      deleteFile.mockRejectedValue(new Error("storage unavailable"));

      const response = await importMarkdown(user.id, collection.id);

      expect(response).toEqual({ documentId: expect.any(String) });
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(1);
    });

    it("keeps the original single-file error when staged cleanup fails too", async () => {
      const { user, collection } = await setupImport();
      const { deleteFile } = stageUpload(Buffer.from("# Note\n\nBody"));
      deleteFile.mockRejectedValue(new Error("storage unavailable"));
      failNextTransaction();

      expect(await importMarkdown(user.id, collection.id)).toEqual({
        error: "database unavailable",
      });
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(0);
    });

    it("expires a single-file attachment that cannot be discarded immediately", async () => {
      const { user, collection } = await setupImport();
      const { store, deleteFile } = stageUpload(
        Buffer.from(`# Note\n\n![inline](${PNG_DATA_URI})`)
      );
      const created = trackCreatedAttachments();
      failNextTransaction();
      const destroy = vi
        .spyOn(Attachment.prototype, "destroy")
        .mockRejectedValue(new Error("cleanup unavailable"));

      const response = await importMarkdown(user.id, collection.id);

      expect(response).toEqual({ error: "database unavailable" });
      expect(store).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
      const attachment = await created[0].reload();
      expect(attachment.expiresAt?.getTime()).toBeGreaterThan(Date.now());
      expect(
        await Document.count({ where: { collectionId: collection.id } })
      ).toEqual(0);

      destroy.mockRestore();
      await attachment.update({ expiresAt: subHours(new Date(), 1) });
      await new CleanupExpiredAttachmentsTask().perform({
        limit: 100,
        partition: { partitionIndex: 0, partitionCount: 1 },
      });
      expect(
        await Attachment.count({ where: { teamId: user.teamId } })
      ).toEqual(0);
      expect(deleteFile).toHaveBeenCalledWith(attachment.key);
    });
  });

  it("retains single-file import attributes and content conversion", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });

    const response = await new DocumentImportTask().perform({
      content: "# Source title\n\nBody",
      sourceMetadata: { fileName: "Note.md", mimeType: "text/markdown" },
      attributes: { title: "Custom title", fullWidth: true },
      userId: user.id,
      collectionId: collection.id,
      publish: true,
    });

    if ("error" in response) {
      throw new Error(response.error);
    }
    const document = await Document.findByPk(response.documentId, {
      userId: user.id,
      rejectOnEmpty: true,
    });
    expect(document.title).toEqual("Custom title");
    expect(document.fullWidth).toBe(true);
    expect(document.text).toEqual("Body");
    expect(document.publishedAt).toBeTruthy();
  });
});

describe("#documents.import with a Markdown ZIP", () => {
  const server = getTestServer();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("imports an attachment ZIP through the route and returns its root", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const upload = await buildAttachment(
      {
        userId: user.id,
        teamId: user.teamId,
        contentType: "application/zip",
        acl: "private",
      },
      "Handbook.zip"
    );
    const { store, deleteFile } = stageUpload(
      await buildZip({
        "Handbook/README.md": "# Handbook\n\n[Policy](Policy.md)",
        "Handbook/Policy.md": "# Policy\n\n![logo](logo.png)",
        "Handbook/logo.png": PNG_PIXEL,
      })
    );

    const response = await server.post("/api/documents.import", user, {
      body: {
        attachmentId: upload.id,
        collectionId: collection.id,
        publish: true,
      },
    });
    const body: ImportResponse = await response.json();

    expect(response.status).toEqual(200);
    expect(body.data.title).toEqual("Handbook");
    await collection.reload();
    const [root] = collection.documentStructure ?? [];
    expect(root.id).toEqual(body.data.id);
    expect(root.children.map((child) => child.title)).toEqual(["Policy"]);
    const policy = await Document.findByPk(root.children[0].id, {
      userId: user.id,
      rejectOnEmpty: true,
    });
    expect(policy.parentDocumentId).toEqual(root.id);
    expect(policy.text).toContain("/api/attachments.redirect?id=");
    expect(store).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(upload.key);
  });

  it("returns the ZIP error through the route without creating documents", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const upload = await buildAttachment(
      {
        userId: user.id,
        teamId: user.teamId,
        contentType: "application/zip",
        acl: "private",
      },
      "Images.zip"
    );
    const { deleteFile } = stageUpload(
      await buildZip({ "photo.png": PNG_PIXEL })
    );

    const response = await server.post("/api/documents.import", user, {
      body: { attachmentId: upload.id, collectionId: collection.id },
    });
    const body: ImportErrorResponse = await response.json();

    expect(response.status).toEqual(400);
    expect(body.message).toEqual(
      "Zip file does not contain any Markdown documents"
    );
    expect(
      await Document.count({ where: { collectionId: collection.id } })
    ).toEqual(0);
    expect(deleteFile).toHaveBeenCalledWith(upload.key);
  });
});

interface ImportResponse {
  data: Pick<Document, "id" | "title">;
}

interface ImportErrorResponse {
  message: string;
}
