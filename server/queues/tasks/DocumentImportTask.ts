import path from "node:path";
import type { Transaction } from "sequelize";
import { errToString } from "@shared/utils/error";
import type { SourceMetadata } from "@shared/types";
import { AttachmentPreset } from "@shared/types";
import attachmentCreator from "@server/commands/attachmentCreator";
import documentCreator from "@server/commands/documentCreator";
import documentImporter from "@server/commands/documentImporter";
import { createContext } from "@server/context";
import type { MarkdownZipEntry } from "@server/converters/MarkdownZipConverter";
import { MarkdownZipConverter } from "@server/converters/MarkdownZipConverter";
import { FileImportError, InvalidRequestError } from "@server/errors";
import Logger from "@server/logging/Logger";
import { Attachment, Document, User } from "@server/models";
import AttachmentHelper from "@server/models/helpers/AttachmentHelper";
import type { ReplaceImagesOptions } from "@server/models/helpers/ProsemirrorHelper";
import FileStorage from "@server/storage/files";
import { sequelize } from "@server/storage/database";
import type { APIContext, AuthenticationType } from "@server/types";
import { BaseTask, TaskPriority } from "./base/BaseTask";

type Props = {
  userId: string;
  /** The content to import, for callers that hold it in memory. */
  content?: string;
  /** The file storage key the content is staged under, removed once imported. */
  key?: string;
  /** Name and mime type of the content, recorded on the created document. */
  sourceMetadata: Pick<Required<SourceMetadata>, "fileName" | "mimeType">;
  /** Attributes for the created document, taking precedence over those derived from the content. */
  attributes?: {
    title?: string;
    icon?: string;
    color?: string;
    fullWidth?: boolean;
  };
  publish?: boolean;
  collectionId?: string | null;
  parentDocumentId?: string | null;
  authType?: AuthenticationType | null;
  ip?: string;
};

export type DocumentImportTaskResponse =
  | {
      documentId: string;
    }
  | {
      error: string;
    };

/** Imports staged documents or Markdown ZIP trees on a worker. */
export default class DocumentImportTask extends BaseTask<Props> {
  /**
   * Imports a document on a worker, keeping conversion off the process that
   * received the request, and blocks until the worker has finished.
   *
   * @param props the content to import and attributes for the created document.
   * @returns the created document.
   * @throws InvalidRequestError if the content could not be converted.
   */
  public static async scheduleAndWait(props: Props): Promise<Document> {
    const job = await new DocumentImportTask().schedule(props);
    const response: DocumentImportTaskResponse = await job.finished();

    if ("error" in response) {
      throw InvalidRequestError(response.error);
    }

    return Document.findByPk(response.documentId, {
      userId: props.userId,
      rejectOnEmpty: true,
    });
  }

  /**
   * Imports staged content and removes its temporary upload afterwards.
   *
   * @param props the source content, importing user and destination.
   * @returns the imported root document id or a readable import error.
   */
  public async perform({
    key,
    content,
    sourceMetadata,
    attributes,
    authType,
    ip,
    publish,
    collectionId,
    parentDocumentId,
    userId,
  }: Props): Promise<DocumentImportTaskResponse> {
    const attachments = new ImportAttachments();

    try {
      let body: Buffer | string;
      if (key) {
        body = await FileStorage.getFileBuffer(key);
      } else if (content !== undefined) {
        // Empty content is valid and imports an empty document, so only a
        // missing one is rejected.
        body = content;
      } else {
        throw InvalidRequestError("one of key or content is required");
      }

      const user = await User.findByPk(userId, {
        rejectOnEmpty: true,
      });

      // Run document conversion and image downloading outside a transaction
      const ctx = createContext({ user, authType, ip });

      if (
        MarkdownZipConverter.isZip(
          sourceMetadata.fileName,
          sourceMetadata.mimeType
        )
      ) {
        const documentId = await this.importMarkdownZip({
          content: body,
          user,
          ctx,
          attachments,
          sourceMetadata,
          publish,
          collectionId,
          parentDocumentId,
          authType,
          ip,
        });
        return { documentId };
      }

      const { text, state, title, icon } = await documentImporter({
        user,
        fileName: sourceMetadata.fileName,
        mimeType: sourceMetadata.mimeType,
        content: body,
        ctx,
        attachmentOptions: attachments.options,
      });

      const document = await sequelize.transaction(async (transaction) => {
        const created = await documentCreator(
          createContext({
            user,
            authType,
            ip,
            transaction,
          }),
          {
            sourceMetadata,
            title: attributes?.title ?? title,
            icon: attributes?.icon ?? icon,
            color: attributes?.color,
            fullWidth: attributes?.fullWidth,
            text,
            state,
            publish,
            collectionId,
            parentDocumentId,
          }
        );
        await attachments.keep(transaction);
        return created;
      });
      return { documentId: document.id };
    } catch (err) {
      await attachments.discard();
      return { error: errToString(err) };
    } finally {
      if (key) {
        await this.deleteStagedFile(key);
      }
    }
  }

  public get options() {
    return {
      attempts: 1,
      priority: TaskPriority.Normal,
    };
  }

  /**
   * Imports a zip archive of markdown files and images as a tree of
   * documents. Images are uploaded first, then every document is converted,
   * and finally all documents are created, and their attachments kept, in
   * one transaction. On failure `perform` discards the attachments.
   *
   * @param props the zip content, the importing user and where to place the documents.
   * @returns the id of the root document, beneath which all others are nested.
   * @throws FileImportError if the zip cannot be imported.
   */
  private async importMarkdownZip({
    content,
    user,
    ctx,
    attachments,
    sourceMetadata,
    publish,
    collectionId,
    parentDocumentId,
    authType,
    ip,
  }: MarkdownZipImportProps): Promise<string> {
    if (!(content instanceof Buffer)) {
      throw FileImportError("Unsupported zip file");
    }

    const archive = await MarkdownZipConverter.toArchive(
      content,
      sourceMetadata.fileName
    );
    const entries = MarkdownZipConverter.flatten(archive.root);

    // Each image is uploaded once, however many documents reference it.
    const imageKeys = new Set<string>();
    for (const { document } of entries) {
      for (const key of MarkdownZipConverter.referencedImages(
        archive,
        document
      )) {
        imageKeys.add(key);
      }
    }

    const imageUrls = new Map<string, string>();
    await MarkdownZipConverter.readImages(
      content,
      archive,
      imageKeys,
      async (image) => {
        const attachment = await attachmentCreator({
          name: image.name,
          type: image.mimeType,
          buffer: image.buffer,
          preset: AttachmentPreset.DocumentAttachment,
          expiresAt: attachments.expiresAt,
          user,
          ctx,
        });
        if (attachment) {
          attachments.add(attachment);
          imageUrls.set(image.key, attachment.redirectUrl);
        }
      }
    );

    // Converted outside the transaction, as single file imports are.
    const converted: ConvertedMarkdownZipEntry[] = [];
    for (const entry of entries) {
      const result = await documentImporter({
        user,
        ctx,
        fileName: `${entry.document.title}.md`,
        mimeType: "text/markdown",
        content: MarkdownZipConverter.toMarkdown(
          archive,
          entry.document,
          imageUrls
        ),
        attachmentOptions: attachments.options,
      });
      converted.push({ ...entry, result });
    }

    await sequelize.transaction(async (transaction) => {
      const transactionCtx = createContext({
        user,
        authType,
        ip,
        transaction,
      });

      // flatten() lists each parent before its children.
      for (const { document, parent, index, result } of converted) {
        await documentCreator(transactionCtx, {
          id: document.id,
          urlId: document.urlId,
          title: result.title,
          icon: result.icon,
          text: result.text,
          state: result.state,
          sourceMetadata: parent
            ? {
                fileName: document.pathInZip
                  ? path.posix.basename(document.pathInZip)
                  : document.title,
                mimeType: "text/markdown",
              }
            : sourceMetadata,
          publish,

          // Publishing places a document first unless given an index, so
          // children are positioned explicitly to keep the archive's order.
          index,
          collectionId,
          parentDocumentId: parent ? parent.id : parentDocumentId,
        });
      }

      await attachments.keep(transaction);
    });

    return archive.root.id;
  }

  /**
   * Delete the staged upload without changing the result of the import.
   * Uploads staged through attachments.create retain their expiring record
   * for the hourly cleanup job if their stored file cannot be removed now.
   *
   * @param key the storage key of the staged upload.
   * @returns a promise that resolves after cleanup has been attempted.
   */
  private async deleteStagedFile(key: string): Promise<void> {
    try {
      await FileStorage.deleteFile(key);
    } catch (err) {
      Logger.warn("Failed to delete staged import file", {
        key,
        error: errToString(err),
      });
    }
  }
}

/** Tracks temporary attachments until their imported documents are committed. */
class ImportAttachments {
  /** Expiry given to every attachment created by this import. */
  public readonly expiresAt = AttachmentHelper.presetToExpiry(
    AttachmentPreset.Import
  );

  /** Options for tracking attachments created during document conversion. */
  public get options(): ReplaceImagesOptions {
    return { expiresAt: this.expiresAt, onAttachment: this.add };
  }

  /**
   * Record an attachment created by the import.
   *
   * @param attachment the attachment created.
   * @returns nothing.
   */
  public add = (attachment: Attachment): void => {
    this.attachments.push(attachment);
  };

  /**
   * Keep attachments in the transaction that creates their documents.
   *
   * @param transaction the transaction creating the documents.
   * @returns a promise that resolves once the expiry update completes.
   */
  public async keep(transaction: Transaction): Promise<void> {
    if (this.attachments.length === 0) {
      return;
    }

    await Attachment.update(
      { expiresAt: null },
      {
        where: { id: this.attachments.map((attachment) => attachment.id) },
        transaction,
      }
    );
  }

  /**
   * Discard attachments without replacing the import's original error.
   * Attachments that cannot be removed retain their expiry for hourly cleanup.
   *
   * @returns a promise that resolves once every deletion has been attempted.
   */
  public async discard(): Promise<void> {
    const results = await Promise.allSettled(
      this.attachments.map((attachment) => attachment.destroy())
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        Logger.warn(
          "Could not remove an attachment of a failed import, it will expire instead",
          {
            attachmentId: this.attachments[index].id,
            error: errToString(result.reason),
          }
        );
      }
    });
  }

  private readonly attachments: Attachment[] = [];
}

interface MarkdownZipImportProps extends Pick<
  Props,
  | "sourceMetadata"
  | "publish"
  | "collectionId"
  | "parentDocumentId"
  | "authType"
  | "ip"
> {
  /** The zip file content. */
  content: Buffer | string;
  /** The user importing the zip. */
  user: User;
  /** Context for the work done outside of the transaction. */
  ctx: APIContext;
  /** Tracks every attachment created by the import. */
  attachments: ImportAttachments;
}

interface ConvertedMarkdownZipEntry extends MarkdownZipEntry {
  result: Awaited<ReturnType<typeof documentImporter>>;
}
