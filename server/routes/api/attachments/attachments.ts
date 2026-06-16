import Router from "koa-router";
import type { WhereOptions } from "sequelize";
import { randomUUID } from "node:crypto";
import contentDisposition from "content-disposition";
import type {
  AttachmentPdfStateData,
  AttachmentPdfStateResponse,
} from "@shared/types";
import { AttachmentPreset } from "@shared/types";
import { bytesToHumanReadable, getFileNameFromUrl } from "@shared/utils/files";
import { AttachmentValidation } from "@shared/validations";
import { createContext } from "@server/context";
import {
  AuthorizationError,
  ConflictError,
  InvalidRequestError,
  ValidationError,
} from "@server/errors";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Attachment, AttachmentPdfState, Document } from "@server/models";
import AttachmentHelper from "@server/models/helpers/AttachmentHelper";
import { authorize } from "@server/policies";
import { presentAttachment, presentPolicies } from "@server/presenters";
import UploadAttachmentFromUrlTask from "@server/queues/tasks/UploadAttachmentFromUrlTask";
import pagination from "@server/routes/api/middlewares/pagination";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";
import BaseStorage from "@server/storage/files/BaseStorage";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { assertIn } from "@server/validation";
import * as T from "./schema";

const router = new Router();

const EmptyPdfStateData: AttachmentPdfStateData = {
  version: 2,
  annotations: [],
};

const presentAttachmentPdfState = (
  state: AttachmentPdfState | {
    attachmentId: string;
    documentId: string;
    revision: number;
    data: AttachmentPdfStateData;
  }
): AttachmentPdfStateResponse => ({
  attachmentId: state.attachmentId,
  documentId: state.documentId,
  revision: state.revision,
  data: state.data,
});

const loadPdfAttachmentForDocument = async (
  ctx:
    | APIContext<T.AttachmentsPdfStateGetReq>
    | APIContext<T.AttachmentsPdfStateUpdateReq>,
  action: "read" | "update"
) => {
  const { attachmentId, documentId } = ctx.input.body;
  const { user } = ctx.state.auth;
  const { transaction } = ctx.state;

  const document = await Document.findByPk(documentId, {
    userId: user.id,
    transaction,
  });
  authorize(user, action, document);

  const attachment = await Attachment.findByPk(attachmentId, {
    rejectOnEmpty: true,
    transaction,
  });

  if (attachment.teamId !== user.teamId) {
    throw AuthorizationError();
  }

  if (attachment.documentId !== documentId) {
    throw ValidationError("Attachment must belong to the document");
  }

  if (attachment.contentType !== "application/pdf") {
    throw ValidationError("Attachment must be a PDF");
  }

  return {
    attachment,
    document,
  };
};

router.post(
  "attachments.list",
  auth(),
  pagination(),
  validate(T.AttachmentsListSchema),
  async (ctx: APIContext<T.AttachmentsListReq>) => {
    const { documentId, userId } = ctx.input.body;
    const { user } = ctx.state.auth;

    const where: WhereOptions<Attachment> = {
      teamId: user.teamId,
    };

    // If a specific user is passed then add to filters
    if (userId && user.isAdmin) {
      where.userId = userId;
    } else {
      where.userId = user.id;
    }

    // If a specific document is passed then add to filters
    if (documentId) {
      const document = await Document.findByPk(documentId, {
        userId: user.id,
      });
      authorize(user, "read", document);
      where.documentId = documentId;
    }

    const [attachments, total] = await Promise.all([
      Attachment.findAll({
        where,
        order: [["createdAt", "DESC"]],
        offset: ctx.state.pagination.offset,
        limit: ctx.state.pagination.limit,
      }),
      Attachment.count({
        where,
      }),
    ]);

    ctx.body = {
      pagination: { ...ctx.state.pagination, total },
      data: attachments.map(presentAttachment),
      policies: presentPolicies(user, attachments),
    };
  }
);

router.post(
  "attachments.create",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.AttachmentsCreateSchema),
  transaction(),
  async (ctx: APIContext<T.AttachmentCreateReq>) => {
    const { id, name, documentId, contentType, size, preset } = ctx.input.body;
    const { auth, transaction } = ctx.state;
    const { user } = auth;

    // All user types can upload an avatar so no additional authorization is needed.
    if (preset === AttachmentPreset.Avatar) {
      assertIn(contentType, AttachmentValidation.avatarContentTypes);
    } else {
      if (preset === AttachmentPreset.DocumentAttachment && documentId) {
        const document = await Document.findByPk(documentId, {
          userId: user.id,
          transaction,
        });
        authorize(user, "update", document);
      }
      if (preset === AttachmentPreset.Emoji) {
        assertIn(contentType, AttachmentValidation.emojiContentTypes);
      }

      authorize(user, "createAttachment", user.team);
    }

    const maxUploadSize = AttachmentHelper.presetToMaxUploadSize(preset);

    if (size > maxUploadSize) {
      throw ValidationError(
        `Sorry, this file is too large – the maximum size is ${bytesToHumanReadable(
          maxUploadSize
        )}`
      );
    }

    const modelId = id ?? randomUUID();
    const acl = AttachmentHelper.presetToAcl(preset);
    const key = AttachmentHelper.getKey({
      id: modelId,
      name,
      userId: user.id,
    });

    const attachment = await Attachment.createWithCtx(ctx, {
      id: modelId,
      key,
      acl,
      size,
      expiresAt: AttachmentHelper.presetToExpiry(preset),
      contentType,
      documentId,
      teamId: user.teamId,
      userId: user.id,
    });

    const presignedPost = await FileStorage.getPresignedPost(
      ctx,
      key,
      acl,
      maxUploadSize,
      contentType
    );

    ctx.body = {
      data: {
        uploadUrl: FileStorage.getUploadUrl(),
        form: {
          "Cache-Control": "max-age=31557600",
          "Content-Type": contentType,
          ...presignedPost.fields,
        },
        attachment: {
          ...presentAttachment(attachment),
          url: attachment.redirectUrl,
        },
      },
    };
  }
);

router.post(
  "attachments.createFromUrl",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.AttachmentsCreateFromUrlSchema),
  async (ctx: APIContext<T.AttachmentCreateFromUrlReq>) => {
    const { id, url, documentId, preset } = ctx.input.body;
    const { user, type } = ctx.state.auth;

    if (preset !== AttachmentPreset.DocumentAttachment || !documentId) {
      throw ValidationError(
        "Only document attachments can be created from a URL"
      );
    }

    const document = await Document.findByPk(documentId, {
      userId: user.id,
    });
    authorize(user, "update", document);

    const name = getFileNameFromUrl(url) ?? "file";
    const modelId = id ?? randomUUID();
    const acl = AttachmentHelper.presetToAcl(preset);
    const key = AttachmentHelper.getKey({
      id: modelId,
      name,
      userId: user.id,
    });

    // Does not use transaction middleware, as attachment must be persisted
    // before the job is scheduled.
    const attachment = await sequelize.transaction(async (transaction) =>
      Attachment.createWithCtx(
        createContext({
          authType: type,
          user,
          ip: ctx.ip,
          transaction,
        }),
        {
          id: modelId,
          key,
          acl,
          size: 0,
          expiresAt: AttachmentHelper.presetToExpiry(preset),
          contentType: "application/octet-stream",
          documentId,
          teamId: user.teamId,
          userId: user.id,
        }
      )
    );

    const job = await new UploadAttachmentFromUrlTask().schedule({
      attachmentId: attachment.id,
      url,
    });

    const response = await job.finished();
    if ("error" in response) {
      throw InvalidRequestError(response.error);
    }

    await attachment.reload();

    ctx.body = {
      data: presentAttachment(attachment),
    };
  }
);

router.post(
  "attachments.delete",
  auth(),
  validate(T.AttachmentDeleteSchema),
  transaction(),
  async (ctx: APIContext<T.AttachmentDeleteReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const attachment = await Attachment.findByPk(id, {
      rejectOnEmpty: true,
      lock: transaction.LOCK.UPDATE,
      transaction,
    });

    if (attachment.documentId) {
      const document = await Document.findByPk(attachment.documentId, {
        userId: user.id,
        transaction,
      });
      authorize(user, "update", document);
    }

    authorize(user, "delete", attachment);
    await attachment.destroyWithCtx(ctx);

    ctx.body = {
      success: true,
    };
  }
);

router.post(
  "attachments.pdfState.get",
  auth(),
  validate(T.AttachmentsPdfStateGetSchema),
  async (ctx: APIContext<T.AttachmentsPdfStateGetReq>) => {
    const { attachmentId, documentId } = ctx.input.body;
    const { user } = ctx.state.auth;

    await loadPdfAttachmentForDocument(ctx, "read");

    const state = await AttachmentPdfState.findOne({
      where: {
        attachmentId,
        documentId,
        teamId: user.teamId,
      },
    });

    ctx.body = {
      data: presentAttachmentPdfState(
        state ?? {
          attachmentId,
          documentId,
          revision: 0,
          data: EmptyPdfStateData,
        }
      ),
    };
  }
);

router.post(
  "attachments.pdfState.update",
  auth(),
  validate(T.AttachmentsPdfStateUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.AttachmentsPdfStateUpdateReq>) => {
    const { attachmentId, data, documentId, revision } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    await loadPdfAttachmentForDocument(ctx, "update");

    const state = await AttachmentPdfState.findOne({
      where: {
        attachmentId,
        documentId,
        teamId: user.teamId,
      },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });

    if (!state) {
      if (revision !== 0) {
        throw ConflictError("PDF annotation state has changed");
      }

      const created = await AttachmentPdfState.create(
        {
          attachmentId,
          data,
          documentId,
          revision: 1,
          teamId: user.teamId,
          createdById: user.id,
          updatedById: user.id,
        },
        { transaction }
      );

      ctx.body = {
        data: presentAttachmentPdfState(created),
      };
      return;
    }

    if (state.revision !== revision) {
      throw ConflictError("PDF annotation state has changed");
    }

    await state.update(
      {
        data,
        revision: revision + 1,
        updatedById: user.id,
      },
      { transaction }
    );

    ctx.body = {
      data: presentAttachmentPdfState(state),
    };
  }
);

const authorizeAttachmentAccess = async (
  ctx: APIContext<T.AttachmentsRedirectReq>
) => {
  const id = (ctx.input.body.id ?? ctx.input.query.id) as string;

  const user = ctx.state.auth?.user;
  const attachment = await Attachment.findByPk(id, {
    rejectOnEmpty: true,
  });

  // Private attachments are accessible to any member of the workspace they
  // belong to. This is intentional and not a permission bypass – attachments
  // are owned by the workspace (team), not by individual documents. Checking
  // document-level permissions here would be insufficient anyway as attachments
  // can exist independently of documents.
  if (attachment.isPrivate && attachment.teamId !== user?.teamId) {
    throw AuthorizationError();
  }

  return attachment;
};

const handleAttachmentsRedirect = async (
  ctx: APIContext<T.AttachmentsRedirectReq>
) => {
  const attachment = await authorizeAttachmentAccess(ctx);

  await attachment.update(
    {
      lastAccessedAt: new Date(),
    },
    {
      silent: true,
    }
  );

  ctx.remove("Content-Security-Policy");

  if (attachment.isStoredInPublicBucket) {
    ctx.set("Cache-Control", `max-age=604800, immutable`);
    ctx.redirect(attachment.canonicalUrl);
  } else {
    ctx.set(
      "Cache-Control",
      `max-age=${BaseStorage.defaultSignedUrlExpires}, immutable`
    );
    ctx.redirect(await attachment.signedUrl);
  }
};

const getByteRange = (rangeHeader: string | undefined, size: number) => {
  if (!rangeHeader) {
    return;
  }

  const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);

  if (!match) {
    return;
  }

  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10) || size - 1;

  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 0 ||
    start > end ||
    start >= size
  ) {
    return;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
};

const handleAttachmentFile = async (
  ctx: APIContext<T.AttachmentsRedirectReq>
) => {
  const attachment = await authorizeAttachmentAccess(ctx);
  const size = Number(attachment.size) || 0;
  const range = getByteRange(ctx.headers.range, size);

  await attachment.update(
    {
      lastAccessedAt: new Date(),
    },
    {
      silent: true,
    }
  );

  if (attachment.contentType === "application/pdf") {
    ctx.remove("X-Frame-Options");
  }

  ctx.set("Accept-Ranges", "bytes");
  ctx.set(
    "Cache-Control",
    `private, max-age=${BaseStorage.defaultSignedUrlExpires}`
  );
  ctx.set("Content-Type", attachment.contentType || "application/octet-stream");
  ctx.set(
    "Content-Security-Policy",
    attachment.contentType === "application/pdf"
      ? "default-src 'self'; object-src 'self'; base-uri 'none';"
      : "sandbox"
  );
  ctx.set(
    "Content-Disposition",
    contentDisposition(attachment.name, {
      type: FileStorage.getContentDisposition(attachment.contentType),
    })
  );

  if (range) {
    ctx.status = 206;
    ctx.set("Content-Length", String(range.end - range.start + 1));
    ctx.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  } else {
    ctx.set("Content-Length", String(size));
  }

  ctx.body = await FileStorage.getFileStream(attachment.key, range);
};

router.get(
  "attachments.redirect",
  auth({ optional: true }),
  validate(T.AttachmentsRedirectSchema),
  handleAttachmentsRedirect
);
router.post(
  "attachments.redirect",
  auth({ optional: true }),
  validate(T.AttachmentsRedirectSchema),
  handleAttachmentsRedirect
);
router.get(
  "attachments.file",
  auth({ optional: true }),
  validate(T.AttachmentsRedirectSchema),
  handleAttachmentFile
);

export default router;
