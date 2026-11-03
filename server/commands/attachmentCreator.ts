import { randomUUID } from "node:crypto";
import { UniqueConstraintError } from "sequelize";
import { AttachmentPreset } from "@shared/types";
import { errToString } from "@shared/utils/error";
import Logger from "@server/logging/Logger";
import type { User } from "@server/models";
import { Attachment } from "@server/models";
import AttachmentHelper from "@server/models/helpers/AttachmentHelper";
import FileStorage from "@server/storage/files";
import type { APIContext } from "@server/types";
import type { RequestInit } from "@server/utils/fetch";

type BaseProps = {
  /** The ID of the attachment, when provided creation is idempotent */
  id?: string;
  /** The name of the attachment */
  name: string;
  /** The user who is creating the attachment */
  user: User;
  /** The source of the attachment */
  source?: "import";
  /** The preset to use for the attachment */
  preset: AttachmentPreset;
  /** The request context */
  ctx: APIContext;
  /** Options to pass to fetch when downloading the attachment */
  fetchOptions?: RequestInit;

  /** When set, the attachment is removed by the expired attachment cleanup task after this date. */
  expiresAt?: Date;
};

type UrlProps = BaseProps & {
  url: string;
};

type BufferProps = BaseProps & {
  buffer: Buffer;
  type: string;
};

type Props = UrlProps | BufferProps;

/**
 * Uploads a file and creates its attachment record, compensating failed record creation.
 *
 * @param props the attachment content, owner and optional expiry.
 * @returns the attachment, or undefined when the URL could not be uploaded.
 * @throws the original error if the attachment record cannot be created.
 */
export default async function attachmentCreator({
  id,
  name,
  user,
  source,
  preset,
  ctx,
  fetchOptions,
  expiresAt,
  ...rest
}: Props): Promise<Attachment | undefined> {
  // Scoped to the team so a caller-supplied id can never resolve an attachment
  // outside of it – an id that belongs elsewhere falls through to the insert
  // and collides there, as it did before.
  if (id) {
    const existing = await Attachment.findOne({
      where: { id, teamId: user.teamId },
      transaction: ctx.context.transaction,
    });

    if (existing) {
      return existing;
    }
  }

  const modelId = id ?? randomUUID();
  const acl = AttachmentHelper.presetToAcl(preset);
  const key = AttachmentHelper.getKey({
    id: modelId,
    name,
    userId: user.id,
  });

  let size: number;
  let contentType: string;

  if ("url" in rest) {
    const { url } = rest;
    const res = await FileStorage.storeFromUrl(url, key, acl, fetchOptions, {
      imagesOnly: preset === AttachmentPreset.Avatar,
    });

    if (!res) {
      return;
    }
    size = res.contentLength;
    contentType = res.contentType;
  } else {
    const { buffer, type } = rest;
    await FileStorage.store({
      body: buffer,
      contentType: type,
      contentLength: buffer.length,
      key,
      acl,
    });

    size = buffer.length;
    contentType = type;
  }

  try {
    return await Attachment.createWithCtx(ctx, {
      id: modelId,
      key,
      acl,
      size,
      contentType,
      expiresAt,
      teamId: user.teamId,
      userId: user.id,
    });
  } catch (err) {
    // A caller-supplied id can share its storage key with a concurrent winner,
    // so its unique-constraint failure must not delete that winner's file.
    if (!(id && err instanceof UniqueConstraintError)) {
      try {
        await FileStorage.deleteFile(key);
      } catch (deleteErr) {
        Logger.warn(
          "Failed to delete attachment file after its record could not be created",
          { key, error: errToString(deleteErr) }
        );
      }
    }

    throw err;
  }
}
