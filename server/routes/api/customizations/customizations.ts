import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import Router from "@koa/router";
import { AuthenticationType, CustomizationValidation } from "@shared/types";
import {
  changeCustomization,
  getCustomizationsInfo,
  getWorkspaceCustomizationsInfo,
} from "@server/commands/customizations";
import env from "@server/env";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@server/errors";
import Logger from "@server/logging/Logger";
import auth from "@server/middlewares/authentication";
import multipart from "@server/middlewares/multipart";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import {
  CustomizationAsset,
  Team,
  WorkspaceCustomization,
} from "@server/models";
import { ImageHelper } from "@server/models/helpers/ImageHelper";
import { authorize } from "@server/policies";
import { presentCustomizationAsset } from "@server/presenters/customization";
import FileStorage from "@server/storage/files";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import * as T from "./schema";

const router = new Router();
const browserAuth = () => auth({ type: AuthenticationType.APP });

router.post(
  "customizations.info",
  browserAuth(),
  validate(T.CustomizationsInfoSchema),
  async (ctx: APIContext) => {
    ctx.set("Cache-Control", "private, no-store");
    ctx.body = { data: await getCustomizationsInfo(ctx.state.auth.user) };
  }
);

router.post(
  "customizations.workspaceInfo",
  browserAuth(),
  validate(T.CustomizationsInfoSchema),
  async (ctx: APIContext) => {
    ctx.set("Cache-Control", "private, no-store");
    ctx.body = {
      data: await getWorkspaceCustomizationsInfo(ctx.state.auth.user),
    };
  }
);

router.post(
  "customizations.updateBackground",
  browserAuth(),
  validate(T.UpdateBackgroundSchema),
  transaction(),
  async (ctx: APIContext<T.UpdateBackgroundReq>) => {
    await changeCustomization(ctx, { ...ctx.input.body, type: "background" });
    ctx.body = {
      data: await getCustomizationsInfo(
        ctx.state.auth.user,
        ctx.state.transaction
      ),
    };
  }
);

router.post(
  "customizations.uploadBackground",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  browserAuth(),
  validate(T.UploadBackgroundSchema),
  multipart({
    maximumFileSize: Math.min(
      env.FILE_STORAGE_UPLOAD_MAX_SIZE,
      CustomizationValidation.maxBackgroundSize
    ),
  }),
  async (ctx: APIContext<T.UploadBackgroundReq>) => {
    const { user } = ctx.state.auth;
    const { scope } = ctx.input.body;
    const team = await Team.findByPk(user.teamId, { rejectOnEmpty: true });
    authorize(
      user,
      scope === "workspace" ? "manageCustomizations" : "readCustomizations",
      team
    );
    const file = ctx.input.file;
    if (!file) {
      throw ValidationError("Choose a background image");
    }
    const body = await readFile(file.filepath);
    const detected = ImageHelper.detectType(body);
    if (
      !detected ||
      !["image/jpeg", "image/png", "image/webp"].includes(
        detected.contentType
      ) ||
      body.byteLength < 32
    ) {
      throw ValidationError("Choose a JPG, PNG, or WebP image");
    }
    if (file.mimetype && file.mimetype !== detected.contentType) {
      throw ValidationError("The image contents do not match its file type");
    }
    const id = randomUUID();
    const asset = await CustomizationAsset.create({
      id,
      teamId: user.teamId,
      userId: user.id,
      scope,
      key: `customizations/${user.teamId}/${id}.${detected.extension}`,
      name: (file.originalFilename ?? `background.${detected.extension}`)
        .split("")
        .filter((character) => character.charCodeAt(0) >= 32)
        .join("")
        .slice(0, 255),
      contentType: detected.contentType,
      size: body.byteLength,
      ready: false,
    });
    try {
      await FileStorage.store({
        body,
        key: asset.key,
        contentLength: body.byteLength,
        contentType: asset.contentType,
        acl: "private",
      });
      asset.ready = true;
      await asset.save();
    } catch (error) {
      // Retain metadata when storage cleanup fails so the durable sweeper can retry.
      try {
        await FileStorage.deleteFile(asset.key);
        await asset.destroy();
      } catch (cleanupError) {
        Logger.warn("Could not clean up a failed background upload", {
          assetId: asset.id,
          error: cleanupError,
        });
      }
      throw error;
    }
    ctx.body = { data: presentCustomizationAsset(asset) };
  }
);

router.get(
  "customizations.background",
  browserAuth(),
  validate(T.BackgroundReadSchema),
  async (ctx: APIContext<T.BackgroundReadReq>) => {
    const { user } = ctx.state.auth;
    const asset = await CustomizationAsset.findByPk(ctx.input.query.id, {
      rejectOnEmpty: true,
    });
    authorize(user, "read", asset);
    if (!asset.ready) {
      throw NotFoundError();
    }
    if (asset.scope === "workspace" && !user.isAdmin) {
      const settings = await WorkspaceCustomization.findOne({
        where: { teamId: user.teamId, backgroundAssetId: asset.id },
      });
      if (!settings) {
        throw AuthorizationError();
      }
    }
    const body = await FileStorage.getFileStream(asset.key);
    if (!body) {
      throw NotFoundError();
    }
    ctx.set("Cache-Control", "private, no-store");
    ctx.set("X-Content-Type-Options", "nosniff");
    ctx.type = asset.contentType;
    ctx.body = body;
  }
);

export default router;
