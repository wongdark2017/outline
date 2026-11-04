import { randomUUID } from "node:crypto";
import type { CustomizationScope } from "@shared/types";
import {
  CustomizationAsset,
  CustomizationScriptRevision,
  Team,
  type User,
  UserCustomization,
  WorkspaceCustomization,
} from "@server/models";
import { sequelize } from "@server/storage/database";
import { buildTeam, buildUser } from "@server/test/factories";

const database = sequelize.getQueryInterface();

function image(user: User, scope: CustomizationScope = "personal") {
  return CustomizationAsset.create({
    teamId: user.teamId,
    userId: user.id,
    scope,
    ready: true,
    key: `customizations/${user.teamId}/${randomUUID()}.png`,
    name: "background.png",
    size: 100,
    contentType: "image/png",
  });
}

function script(user: User) {
  return CustomizationScriptRevision.create({
    teamId: user.teamId,
    publisherId: user.id,
    revision: 1,
    source: "export function activate() {}",
    modules: {},
    digest: "a".repeat(64),
  });
}

describe("customization database ownership", () => {
  it("allows absent references while preserving each configuration's unique owner", async () => {
    const user = await buildUser();
    const workspace = await WorkspaceCustomization.create({
      teamId: user.teamId,
    });
    const personal = await UserCustomization.create({
      teamId: user.teamId,
      userId: user.id,
    });
    await workspace.reload();
    await personal.reload();
    expect(workspace.backgroundAssetId).toBeNull();
    expect(workspace.publishedScriptId).toBeNull();
    expect(personal.backgroundAssetId).toBeNull();
    expect(personal.enabledScriptId).toBeNull();
    await expect(
      WorkspaceCustomization.create({ teamId: user.teamId })
    ).rejects.toThrow();
    await expect(
      UserCustomization.create({ teamId: user.teamId, userId: user.id })
    ).rejects.toThrow();
  });

  it("rejects a configuration claiming a user from another workspace", async () => {
    const user = await buildUser();
    const outsider = await buildUser();
    await expect(
      UserCustomization.create({ teamId: outsider.teamId, userId: user.id })
    ).rejects.toMatchObject({ name: "SequelizeForeignKeyConstraintError" });
  });

  it("rejects an image or publication claiming a creator from another workspace", async () => {
    const user = await buildUser();
    const outsider = await buildUser();
    const asset = await image(user);
    const revision = await script(user);
    await expect(
      database.bulkUpdate(
        "customizationAssets",
        { teamId: outsider.teamId },
        { id: asset.id }
      )
    ).rejects.toMatchObject({ name: "SequelizeForeignKeyConstraintError" });
    await expect(
      database.bulkUpdate(
        "customizationScriptRevisions",
        { publisherId: outsider.id },
        { id: revision.id }
      )
    ).rejects.toMatchObject({ name: "SequelizeForeignKeyConstraintError" });
    await asset.reload();
    await revision.reload();
    expect(asset.teamId).toEqual(user.teamId);
    expect(revision.publisherId).toEqual(user.id);
  });

  it("rejects a workspace background from another workspace through direct SQL writes", async () => {
    const user = await buildUser();
    const outsider = await buildUser();
    const asset = await image(outsider, "workspace");
    const workspace = await WorkspaceCustomization.create({
      teamId: user.teamId,
    });
    await expect(
      database.bulkUpdate(
        "workspaceCustomizations",
        { backgroundAssetId: asset.id },
        { id: workspace.id }
      )
    ).rejects.toMatchObject({ name: "SequelizeForeignKeyConstraintError" });
    await workspace.reload();
    expect(workspace.backgroundAssetId).toBeNull();
  });

  it("rejects personal images as workspace defaults even when they share the workspace", async () => {
    const user = await buildUser();
    const asset = await image(user);
    const workspace = await WorkspaceCustomization.create({
      teamId: user.teamId,
    });
    await expect(
      database.bulkUpdate(
        "workspaceCustomizations",
        { backgroundAssetId: asset.id },
        { id: workspace.id }
      )
    ).rejects.toMatchObject({ name: "SequelizeForeignKeyConstraintError" });
  });

  it("rejects personal image references belonging to another owner, workspace, or scope", async () => {
    const user = await buildUser();
    const colleague = await buildUser({ teamId: user.teamId });
    const outsider = await buildUser();
    const assets = [
      await image(colleague),
      await image(outsider),
      await image(user, "workspace"),
    ];
    const personal = await UserCustomization.create({
      teamId: user.teamId,
      userId: user.id,
    });
    for (const asset of assets) {
      await expect(
        database.bulkUpdate(
          "userCustomizations",
          { backgroundAssetId: asset.id },
          { id: personal.id }
        )
      ).rejects.toMatchObject({ name: "SequelizeForeignKeyConstraintError" });
    }
    await personal.reload();
    expect(personal.backgroundAssetId).toBeNull();
  });

  it("rejects published and enabled script references from another workspace", async () => {
    const user = await buildUser();
    const outsider = await buildUser();
    const revision = await script(outsider);
    const workspace = await WorkspaceCustomization.create({
      teamId: user.teamId,
    });
    const personal = await UserCustomization.create({
      teamId: user.teamId,
      userId: user.id,
    });
    await expect(
      database.bulkUpdate(
        "workspaceCustomizations",
        { publishedScriptId: revision.id },
        { id: workspace.id }
      )
    ).rejects.toMatchObject({ name: "SequelizeForeignKeyConstraintError" });
    await expect(
      database.bulkUpdate(
        "userCustomizations",
        { enabledScriptId: revision.id },
        { id: personal.id }
      )
    ).rejects.toMatchObject({ name: "SequelizeForeignKeyConstraintError" });
    await workspace.reload();
    await personal.reload();
    expect(workspace.publishedScriptId).toBeNull();
    expect(personal.enabledScriptId).toBeNull();
  });

  it("persists same-workspace and same-owner references and clears only deleted targets", async () => {
    const user = await buildUser();
    const sharedImage = await image(user, "workspace");
    const ownImage = await image(user);
    const revision = await script(user);
    const workspace = await WorkspaceCustomization.create({
      teamId: user.teamId,
      backgroundAssetId: sharedImage.id,
      publishedScriptId: revision.id,
    });
    const personal = await UserCustomization.create({
      teamId: user.teamId,
      userId: user.id,
      backgroundAssetId: ownImage.id,
      enabledScriptId: revision.id,
      enabledScriptDigest: revision.digest,
    });
    await workspace.reload();
    await personal.reload();
    expect(workspace.backgroundAssetId).toEqual(sharedImage.id);
    expect(personal.backgroundAssetId).toEqual(ownImage.id);
    expect(workspace.publishedScriptId).toEqual(revision.id);
    expect(personal.enabledScriptId).toEqual(revision.id);
    await sequelize.transaction(async (transaction) => {
      await sharedImage.destroy({ transaction });
      await ownImage.destroy({ transaction });
      await revision.destroy({ transaction });
    });
    await workspace.reload();
    await personal.reload();
    expect(workspace.teamId).toEqual(user.teamId);
    expect(personal.teamId).toEqual(user.teamId);
    expect(personal.userId).toEqual(user.id);
    expect(workspace.backgroundAssetId).toBeNull();
    expect(personal.backgroundAssetId).toBeNull();
    expect(workspace.publishedScriptId).toBeNull();
    expect(personal.enabledScriptId).toBeNull();
  });

  it("lets user deletion cascade settings while retaining orphaned image metadata", async () => {
    const user = await buildUser();
    const asset = await image(user);
    const revision = await script(user);
    const personal = await UserCustomization.create({
      teamId: user.teamId,
      userId: user.id,
      backgroundAssetId: asset.id,
      enabledScriptId: revision.id,
    });
    await database.bulkDelete("users", { id: user.id });
    expect(await UserCustomization.findByPk(personal.id)).toBeNull();
    await asset.reload();
    await revision.reload();
    expect(asset.userId).toBeNull();
    expect(asset.teamId).toEqual(user.teamId);
    expect(revision.publisherId).toBeNull();
  });

  it("lets workspace deletion finish all cascades before checking composite constraints", async () => {
    const team = await buildTeam({ authenticationProviders: [] });
    const user = await buildUser({ teamId: team.id });
    const sharedImage = await image(user, "workspace");
    const ownImage = await image(user);
    const revision = await script(user);
    const workspace = await WorkspaceCustomization.create({
      teamId: user.teamId,
      backgroundAssetId: sharedImage.id,
      publishedScriptId: revision.id,
    });
    const personal = await UserCustomization.create({
      teamId: user.teamId,
      userId: user.id,
      backgroundAssetId: ownImage.id,
      enabledScriptId: revision.id,
    });
    await database.bulkDelete("teams", { id: user.teamId });
    expect(await Team.findByPk(user.teamId, { paranoid: false })).toBeNull();
    expect(await WorkspaceCustomization.findByPk(workspace.id)).toBeNull();
    expect(await UserCustomization.findByPk(personal.id)).toBeNull();
    expect(await CustomizationScriptRevision.findByPk(revision.id)).toBeNull();
    await sharedImage.reload();
    await ownImage.reload();
    expect(sharedImage.teamId).toBeNull();
    expect(ownImage.teamId).toBeNull();
  });
});
