import type { Transaction } from "sequelize";
import type {
  CustomizationBackgroundFit,
  CustomizationScope,
  CustomizationsInfo,
  WorkspaceCustomizationsInfo,
} from "@shared/types";
import env from "@server/env";
import { AuthorizationError, ValidationError } from "@server/errors";
import Logger from "@server/logging/Logger";
import {
  CustomizationAsset,
  CustomizationScriptRevision,
  Event,
  Team,
  type User,
  UserCustomization,
  WorkspaceCustomization,
} from "@server/models";
import { authorize } from "@server/policies";
import { presentCustomizationAsset } from "@server/presenters/customization";
import DeleteCustomizationAssetTask from "@server/queues/tasks/DeleteCustomizationAssetTask";
import type { APIContext } from "@server/types";
import {
  customizationScriptDigest,
  validateCustomizationCss,
} from "@server/utils/customizations";

interface BackgroundChange {
  type: "background";
  scope: CustomizationScope;
  expectedVersion: number;
  assetId: string | null;
  source?: "inherit" | "personal";
  fit: CustomizationBackgroundFit;
}

interface CssChange {
  type: "css";
  scope: CustomizationScope;
  expectedVersion: number;
  css: string;
}

interface DraftChange {
  type: "draft";
  expectedVersion: number;
  source: string;
  modules: Record<string, string>;
}

interface PublishChange {
  type: "publish";
  expectedVersion: number;
}

interface EnableChange {
  type: "enable";
  revisionId: string;
  digest: string;
}

interface DisableChange {
  type: "disable";
}

type Change =
  | BackgroundChange
  | CssChange
  | DraftChange
  | PublishChange
  | EnableChange
  | DisableChange;

/**
 * Reads background settings with paused CSS and scripts kept inert.
 *
 * @param user the authenticated current user.
 * @param transaction an optional transaction providing read-your-writes.
 * @returns authorized background settings and inert source fields.
 */
export async function getCustomizationsInfo(
  user: User,
  transaction?: Transaction
): Promise<CustomizationsInfo> {
  const team = await Team.findByPk(user.teamId, {
    transaction,
    rejectOnEmpty: true,
  });
  authorize(user, "readCustomizations", team);
  const [workspace, personal] = await Promise.all([
    WorkspaceCustomization.findOne({
      where: { teamId: user.teamId },
      attributes: [
        "backgroundAssetId",
        "backgroundFit",
        "backgroundVersion",
        "cssVersion",
      ],
      transaction,
    }),
    UserCustomization.findOne({
      where: { userId: user.id, teamId: user.teamId },
      attributes: [
        "backgroundAssetId",
        "backgroundSource",
        "backgroundFit",
        "backgroundVersion",
        "cssVersion",
      ],
      transaction,
    }),
  ]);
  const assetFor = async (id: string | null | undefined) => {
    if (!id) {
      return null;
    }
    const asset = await CustomizationAsset.findOne({
      where: { id, teamId: user.teamId, ready: true },
      transaction,
    });
    return asset ? presentCustomizationAsset(asset) : null;
  };
  const [workspaceAsset, personalAsset] = await Promise.all([
    assetFor(workspace?.backgroundAssetId),
    assetFor(personal?.backgroundAssetId),
  ]);

  // Preserve stored source and consent while returning a background-only view.
  return {
    workspace: {
      background: {
        asset: workspaceAsset,
        fit: fitValue(workspace?.backgroundFit),
        version: workspace?.backgroundVersion ?? 0,
      },
      css: {
        source: "",
        version: workspace?.cssVersion ?? 0,
      },
      script: null,
    },
    personal: {
      background: {
        asset: personalAsset,
        source:
          personal?.backgroundSource === "personal" ? "personal" : "inherit",
        fit: fitValue(personal?.backgroundFit),
        version: personal?.backgroundVersion ?? 0,
      },
      css: { source: "", version: personal?.cssVersion ?? 0 },
      enabledScriptId: null,
      enabledScriptDigest: null,
    },
    scriptEnabled: false,
    scriptsAllowed: false,
    canManage: user.isAdmin,
  };
}

/**
 * Reads administrator background settings without exposing paused drafts.
 *
 * @param user the authenticated administrator.
 * @param transaction an optional transaction.
 * @returns background settings with an inert draft and its saved version.
 */
export async function getWorkspaceCustomizationsInfo(
  user: User,
  transaction?: Transaction
): Promise<WorkspaceCustomizationsInfo> {
  const team = await Team.findByPk(user.teamId, {
    transaction,
    rejectOnEmpty: true,
  });
  authorize(user, "manageCustomizations", team);
  const [info, workspace] = await Promise.all([
    getCustomizationsInfo(user, transaction),
    WorkspaceCustomization.findOne({
      where: { teamId: user.teamId },
      attributes: ["scriptDraftVersion"],
      transaction,
    }),
  ]);
  return {
    ...info,
    draft: {
      source: "",
      modules: {},
      version: workspace?.scriptDraftVersion ?? 0,
    },
  };
}

/**
 * Saves exactly one settings field or publication/consent transition.
 *
 * @param ctx the authenticated transactional request context.
 * @param change the independently validated mutation.
 * @throws {ValidationError} if the expected setting or script revision changed.
 */
export async function changeCustomization(
  ctx: APIContext,
  change: Change
): Promise<void> {
  const { user } = ctx.state.auth;
  const transaction = ctx.state.transaction;
  if (!transaction) {
    throw new Error("Customization writes require a transaction");
  }
  const team = await Team.findByPk(user.teamId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
    rejectOnEmpty: true,
  });
  const scope =
    "scope" in change
      ? change.scope
      : change.type === "draft" || change.type === "publish"
        ? "workspace"
        : "personal";
  authorize(
    user,
    scope === "workspace" ? "manageCustomizations" : "readCustomizations",
    team
  );
  if (scope === "personal") {
    authorize(user, "updateCustomizations", user);
  }
  const workspace =
    (await WorkspaceCustomization.findOne({
      where: { teamId: team.id },
      transaction,
    })) ??
    (await WorkspaceCustomization.create({ teamId: team.id }, { transaction }));
  const personal =
    scope === "personal"
      ? ((await UserCustomization.findOne({
          where: { userId: user.id, teamId: team.id },
          transaction,
        })) ??
        (await UserCustomization.create(
          { teamId: team.id, userId: user.id },
          { transaction }
        )))
      : null;

  const retiredAssetIds: string[] = [];
  if (change.type === "background") {
    const target = scope === "personal" && personal ? personal : workspace;
    checkVersion(target.backgroundVersion, change.expectedVersion);
    const source = change.source ?? (change.assetId ? "personal" : "inherit");
    if (scope === "personal" && source === "inherit" && change.assetId) {
      throw ValidationError(
        "An inherited background cannot reference a personal image"
      );
    }
    if (scope === "personal" && source === "personal" && !change.assetId) {
      throw ValidationError("Choose a personal background image first");
    }
    if (change.assetId) {
      const asset = await CustomizationAsset.findByPk(change.assetId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
        rejectOnEmpty: true,
      });
      authorize(user, "read", asset);
      if (
        !asset.ready ||
        asset.teamId !== team.id ||
        asset.scope !== scope ||
        (scope === "personal" && asset.userId !== user.id)
      ) {
        throw AuthorizationError();
      }
    }
    if (
      target.backgroundAssetId &&
      target.backgroundAssetId !== change.assetId
    ) {
      retiredAssetIds.push(target.backgroundAssetId);
    }
    target.backgroundAssetId = change.assetId;
    target.backgroundFit = change.fit;
    target.backgroundVersion += 1;
    if (personal && scope === "personal") {
      personal.backgroundSource = source;
    }
    await target.save({ transaction });
  } else if (change.type === "css") {
    const target = scope === "personal" && personal ? personal : workspace;
    checkVersion(target.cssVersion, change.expectedVersion);
    validateCustomizationCss(change.css);
    target.css = change.css;
    target.cssVersion += 1;
    await target.save({ transaction });
  } else if (change.type === "draft") {
    checkVersion(workspace.scriptDraftVersion, change.expectedVersion);
    customizationScriptDigest(change.source, change.modules);
    workspace.scriptDraft = change.source;
    workspace.scriptDraftModules = { ...change.modules };
    workspace.scriptDraftVersion += 1;
    await workspace.save({ transaction });
    return;
  } else if (change.type === "publish") {
    checkVersion(workspace.scriptDraftVersion, change.expectedVersion);
    const previous = workspace.publishedScriptId
      ? await CustomizationScriptRevision.findByPk(
          workspace.publishedScriptId,
          { transaction }
        )
      : null;
    const digest = customizationScriptDigest(
      workspace.scriptDraft,
      workspace.scriptDraftModules
    );
    if (previous?.digest === digest) {
      return;
    }
    if (
      !workspace.scriptDraft.trim() &&
      Object.keys(workspace.scriptDraftModules).length === 0
    ) {
      workspace.publishedScriptId = null;
    } else {
      const latest = await CustomizationScriptRevision.findOne({
        where: { teamId: team.id },
        order: [["revision", "DESC"]],
        transaction,
      });
      const revision = await CustomizationScriptRevision.create(
        {
          teamId: team.id,
          publisherId: user.id,
          revision: (latest?.revision ?? 0) + 1,
          source: workspace.scriptDraft,
          modules: { ...workspace.scriptDraftModules },
          digest,
        },
        { transaction }
      );
      workspace.publishedScriptId = revision.id;
    }
    await workspace.save({ transaction });
  } else if (change.type === "enable" && personal) {
    if (!env.CUSTOMIZATION_SCRIPTS_ENABLED) {
      throw ValidationError("Custom scripts are disabled by this installation");
    }
    const revision = workspace.publishedScriptId
      ? await CustomizationScriptRevision.findByPk(
          workspace.publishedScriptId,
          { transaction }
        )
      : null;
    if (
      !revision ||
      revision.id !== change.revisionId ||
      revision.digest !== change.digest
    ) {
      throw ValidationError(
        "The published script changed. Review the current version before enabling it"
      );
    }
    personal.enabledScriptId = revision.id;
    personal.enabledScriptDigest = revision.digest;
    await personal.save({ transaction });
  } else if (change.type === "disable" && personal) {
    personal.enabledScriptId = null;
    personal.enabledScriptDigest = null;
    await personal.save({ transaction });
  }

  // Source and private preferences must not enter generic model audit changes.
  // Schedule only identifiers, after commit, without failing a committed write.
  (transaction.parent || transaction).afterCommit(() => {
    for (const assetId of retiredAssetIds) {
      void new DeleteCustomizationAssetTask().scheduleOptional({ assetId });
    }
    void Promise.resolve()
      .then(() =>
        Event.schedule({
          name: "customizations.update",
          modelId: workspace.id,
          teamId: team.id,
          actorId: user.id,
          userId: scope === "personal" ? user.id : null,
          data: { scope, revisionId: workspace.publishedScriptId },
        })
      )
      .catch((error: Error) =>
        Logger.warn("Could not schedule customization invalidation", {
          error,
          teamId: team.id,
        })
      );
  });
}

function checkVersion(current: number, expected: number): void {
  if (current !== expected) {
    throw ValidationError(
      "This setting changed elsewhere. Reload it before saving again"
    );
  }
}

function fitValue(value: string | undefined): CustomizationBackgroundFit {
  return value === "contain" || value === "repeat" ? value : "cover";
}
