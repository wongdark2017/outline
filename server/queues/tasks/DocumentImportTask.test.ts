import { subHours } from "date-fns";
import { Attachment, Document } from "@server/models";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";
import { buildCollection, buildUser } from "@server/test/factories";
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
    Attachment.removeHook("afterCreate", "markdownImportAttachmentTracking");
    vi.restoreAllMocks();
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
