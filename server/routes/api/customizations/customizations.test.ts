import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import FormData from "form-data";
import { subDays } from "date-fns";
import type {
  CustomizationsInfo,
  WorkspaceCustomizationsInfo,
} from "@shared/types";
import { customizationAssetDelete } from "@server/commands/customizationAssetDelete";
import env from "@server/env";
import {
  CustomizationAsset,
  CustomizationScriptRevision,
  Event,
  type User,
  UserCustomization,
  WorkspaceCustomization,
} from "@server/models";
import CleanupCustomizationAssetsTask from "@server/queues/tasks/CleanupCustomizationAssetsTask";
import DeleteCustomizationAssetTask from "@server/queues/tasks/DeleteCustomizationAssetTask";
import FileStorage from "@server/storage/files";
import { buildAdmin, buildApiKey, buildUser } from "@server/test/factories";
import { getTestServer } from "@server/test/support";
import { customizationScriptDigest } from "@server/utils/customizations";

const server = getTestServer();
const firstSource = "export function activate() { return () => {}; }";
const disabledMethods = [
  "customizations.updateCss",
  "customizations.saveScriptDraft",
  "customizations.publishScript",
  "customizations.enableScript",
  "customizations.disableScript",
] as const;

async function info(user: User): Promise<CustomizationsInfo> {
  const response = await server.post("/api/customizations.info", user);
  const body: { data: CustomizationsInfo } = await response.json();
  expect(response.status).toEqual(200);
  expect(response.headers.get("cache-control")).toEqual("private, no-store");
  return body.data;
}

async function asset(user: User, scope = "personal", createdAt = new Date()) {
  return CustomizationAsset.create({
    createdAt,
    teamId: user.teamId,
    userId: user.id,
    scope,
    ready: true,
    name: "background.png",
    contentType: "image/png",
    size: 100,
    key: `customizations/${user.teamId}/${randomUUID()}.png`,
  });
}

async function seedPausedSettings(admin: User, user: User) {
  const modules = { "deps/value.js": "export const value = 1;" };
  const revision = await CustomizationScriptRevision.create({
    teamId: admin.teamId,
    publisherId: admin.id,
    revision: 1,
    source: firstSource,
    modules,
    digest: customizationScriptDigest(firstSource, modules),
  });
  const workspace = await WorkspaceCustomization.create({
    teamId: admin.teamId,
    css: "p { line-height: 2; }",
    cssVersion: 3,
    scriptDraft: firstSource + "\n// next draft",
    scriptDraftModules: { "deps/value.js": "export const value = 2;" },
    scriptDraftVersion: 7,
    publishedScriptId: revision.id,
  });
  const personal = await UserCustomization.create({
    teamId: admin.teamId,
    userId: user.id,
    css: "p { font-size: 18px; }",
    cssVersion: 4,
    enabledScriptId: revision.id,
    enabledScriptDigest: revision.digest,
  });

  return {
    workspace,
    personal,
    revision,
    original: {
      workspace: workspace.toJSON(),
      personal: personal.toJSON(),
      revision: revision.toJSON(),
    },
  };
}

async function expectStoredSettingsUnchanged(
  saved: Awaited<ReturnType<typeof seedPausedSettings>>
) {
  await Promise.all([
    saved.workspace.reload(),
    saved.personal.reload(),
    saved.revision.reload(),
  ]);
  expect(saved.workspace.toJSON()).toEqual(saved.original.workspace);
  expect(saved.personal.toJSON()).toEqual(saved.original.personal);
  expect(saved.revision.toJSON()).toEqual(saved.original.revision);
}

function expectPausedResponse(data: CustomizationsInfo) {
  expect(data.workspace.css.source).toEqual("");
  expect(data.personal.css.source).toEqual("");
  expect(data.workspace.script).toBeNull();
  expect(data.personal.enabledScriptId).toBeNull();
  expect(data.personal.enabledScriptDigest).toBeNull();
  expect(data.scriptEnabled).toBe(false);
  expect(data.scriptsAllowed).toBe(false);
}

afterEach(() => {
  vi.restoreAllMocks();
  env.CUSTOMIZATION_SCRIPTS_ENABLED = true;
});

describe("background-only customization settings", () => {
  it("requires application authentication and returns inert defaults without creating records", async () => {
    const anonymous = await server.post("/api/customizations.info");
    expect(anonymous.status).toEqual(401);
    const user = await buildUser();
    const key = await buildApiKey({ userId: user.id });
    const keyed = await server.post("/api/customizations.info", {
      headers: { Authorization: `Bearer ${key.value}` },
    });
    expect(keyed.status).toEqual(403);
    const data = await info(user);
    expect(data.personal.background.source).toEqual("inherit");
    expectPausedResponse(data);
    expect(
      await WorkspaceCustomization.count({ where: { teamId: user.teamId } })
    ).toEqual(0);
    expect(
      await UserCustomization.count({ where: { userId: user.id } })
    ).toEqual(0);
  });

  it("requires administrator policy for workspace inspection", async () => {
    const user = await buildUser();
    expect(
      (await server.post("/api/customizations.workspaceInfo", user)).status
    ).toEqual(403);
    const admin = await buildAdmin();
    const key = await buildApiKey({ userId: admin.id });
    expect(
      (
        await server.post("/api/customizations.workspaceInfo", {
          headers: { Authorization: `Bearer ${key.value}` },
        })
      ).status
    ).toEqual(403);
    const response = await server.post(
      "/api/customizations.workspaceInfo",
      admin
    );
    expect(response.status).toEqual(200);
    const body: { data: WorkspaceCustomizationsInfo } = await response.json();
    expectPausedResponse(body.data);
    expect(body.data.draft).toEqual({ source: "", modules: {}, version: 0 });
  });

  it("returns inert settings for saved CSS, drafts and consent even when installation scripts are enabled", async () => {
    const admin = await buildAdmin();
    const user = await buildUser({ teamId: admin.teamId });
    const saved = await seedPausedSettings(admin, user);
    const findRevision = vi.spyOn(CustomizationScriptRevision, "findOne");

    for (const enabled of [true, false]) {
      env.CUSTOMIZATION_SCRIPTS_ENABLED = enabled;
      const data = await info(user);
      expectPausedResponse(data);
      expect(data.workspace.css.version).toEqual(3);
      expect(data.personal.css.version).toEqual(4);
      expect(data).not.toHaveProperty("draft");
      const response = await server.post(
        "/api/customizations.workspaceInfo",
        admin
      );
      expect(response.status).toEqual(200);
      expect(response.headers.get("cache-control")).toEqual(
        "private, no-store"
      );
      const body: { data: WorkspaceCustomizationsInfo } = await response.json();
      expectPausedResponse(body.data);
      expect(body.data.draft).toEqual({ source: "", modules: {}, version: 7 });
    }
    expect(findRevision).not.toHaveBeenCalled();
    await expectStoredSettingsUnchanged(saved);
  });

  it("keeps saved CSS, draft, publication and consent unchanged when backgrounds are saved", async () => {
    const admin = await buildAdmin();
    const user = await buildUser({ teamId: admin.teamId });
    const saved = await seedPausedSettings(admin, user);
    const shared = await asset(admin, "workspace");
    const own = await asset(user);

    for (const [actor, scope, image] of [
      [admin, "workspace", shared],
      [user, "personal", own],
    ] as const) {
      const response = await server.post(
        "/api/customizations.updateBackground",
        actor,
        {
          body: {
            scope,
            expectedVersion: 0,
            assetId: image.id,
            source: "personal",
            fit: "contain",
          },
        }
      );
      expect(response.status).toEqual(200);
      const body: { data: CustomizationsInfo } = await response.json();
      expectPausedResponse(body.data);
    }

    await Promise.all([
      saved.workspace.reload(),
      saved.personal.reload(),
      saved.revision.reload(),
    ]);
    expect(saved.workspace.backgroundAssetId).toEqual(shared.id);
    expect(saved.personal.backgroundAssetId).toEqual(own.id);
    expect(saved.workspace.css).toEqual(saved.original.workspace.css);
    expect(saved.workspace.cssVersion).toEqual(
      saved.original.workspace.cssVersion
    );
    expect(saved.workspace.scriptDraft).toEqual(
      saved.original.workspace.scriptDraft
    );
    expect(saved.workspace.scriptDraftModules).toEqual(
      saved.original.workspace.scriptDraftModules
    );
    expect(saved.workspace.scriptDraftVersion).toEqual(
      saved.original.workspace.scriptDraftVersion
    );
    expect(saved.workspace.publishedScriptId).toEqual(
      saved.original.workspace.publishedScriptId
    );
    expect(saved.personal.css).toEqual(saved.original.personal.css);
    expect(saved.personal.cssVersion).toEqual(
      saved.original.personal.cssVersion
    );
    expect(saved.personal.enabledScriptId).toEqual(
      saved.original.personal.enabledScriptId
    );
    expect(saved.personal.enabledScriptDigest).toEqual(
      saved.original.personal.enabledScriptDigest
    );
    expect(saved.revision.toJSON()).toEqual(saved.original.revision);
  });

  it("rejects unauthorized workspace backgrounds and stale independent background versions", async () => {
    const user = await buildUser();
    const own = await asset(user);
    const forbidden = await server.post(
      "/api/customizations.updateBackground",
      user,
      {
        body: {
          scope: "workspace",
          expectedVersion: 0,
          assetId: null,
          fit: "cover",
        },
      }
    );
    expect(forbidden.status).toEqual(403);
    const invalid = await server.post(
      "/api/customizations.updateBackground",
      user,
      {
        body: {
          scope: "personal",
          expectedVersion: 0,
          source: "inherit",
          assetId: own.id,
          fit: "cover",
        },
      }
    );
    expect(invalid.status).toEqual(400);
    const saved = await server.post(
      "/api/customizations.updateBackground",
      user,
      {
        body: {
          scope: "personal",
          expectedVersion: 0,
          source: "personal",
          assetId: own.id,
          fit: "cover",
        },
      }
    );
    expect(saved.status).toEqual(200);
    const stale = await server.post(
      "/api/customizations.updateBackground",
      user,
      {
        body: {
          scope: "personal",
          expectedVersion: 0,
          source: "inherit",
          assetId: null,
          fit: "contain",
        },
      }
    );
    expect(stale.status).toEqual(400);
    expect((await info(user)).personal.background.asset?.id).toEqual(own.id);
  });

  it("persists a background change when optional invalidation scheduling fails", async () => {
    const user = await buildUser();
    vi.spyOn(Event, "schedule").mockImplementation(() => {
      throw new Error("queue unavailable");
    });
    const response = await server.post(
      "/api/customizations.updateBackground",
      user,
      {
        body: {
          scope: "personal",
          expectedVersion: 0,
          source: "inherit",
          assetId: null,
          fit: "cover",
        },
      }
    );
    expect(response.status).toEqual(200);
    const persisted = await UserCustomization.findOne({
      where: { userId: user.id },
      rejectOnEmpty: true,
    });
    await persisted.reload();
    expect(persisted.backgroundVersion).toEqual(1);
    expect(persisted.backgroundSource).toEqual("inherit");
  });
});

describe("paused CSS and JavaScript routes", () => {
  it.each(disabledMethods)(
    "returns standard 404 for %s without changing stored data",
    async (method) => {
      const admin = await buildAdmin();
      const user = await buildUser({ teamId: admin.teamId });
      const saved = await seedPausedSettings(admin, user);
      const key = await buildApiKey({ userId: admin.id });
      const unknown = await server.post("/api/unknown.endpoint", admin);
      const expected = await unknown.json();
      expect(unknown.status).toEqual(404);
      expect(expected.error).toEqual("not_found");
      const body = {
        scope: "workspace",
        expectedVersion: 7,
        css: "body { display: none; }",
        source: firstSource,
        modules: {},
        revisionId: saved.revision.id,
        digest: saved.revision.digest,
      };

      for (const actor of [undefined, user, admin]) {
        const response = actor
          ? await server.post(`/api/${method}`, actor, { body })
          : await server.post(`/api/${method}`, { body });
        expect(response.status).toEqual(404);
        expect(await response.json()).toEqual(expected);
      }
      const keyed = await server.post(`/api/${method}`, {
        headers: { Authorization: `Bearer ${key.value}` },
        body,
      });
      expect(keyed.status).toEqual(404);
      expect(await keyed.json()).toEqual(expected);
      const get = await server.get(`/api/${method}`, admin);
      expect(get.status).toEqual(404);
      expect(await get.json()).toEqual(expected);
      await expectStoredSettingsUnchanged(saved);
    }
  );

  it.each(["entry.js", "deps/value.js"])(
    "does not serve %s for any actor even with exact saved consent",
    async (modulePath) => {
      const admin = await buildAdmin();
      const user = await buildUser({ teamId: admin.teamId });
      const outsider = await buildUser();
      const saved = await seedPausedSettings(admin, user);
      const key = await buildApiKey({ userId: user.id });
      const path = `/api/customizations.module/${saved.revision.id}/${modulePath}`;
      const unknown = await server.get("/api/unknown.endpoint", admin);
      const expected = await unknown.json();
      expect(unknown.status).toEqual(404);
      expect(expected.error).toEqual("not_found");

      for (const actor of [undefined, user, admin, outsider]) {
        const response = actor
          ? await server.get(path, actor)
          : await server.get(path);
        expect(response.status).toEqual(404);
        expect(await response.json()).toEqual(expected);
      }
      const keyed = await server.get(path, {
        headers: { Authorization: `Bearer ${key.value}` },
      });
      expect(keyed.status).toEqual(404);
      expect(await keyed.json()).toEqual(expected);
      await expectStoredSettingsUnchanged(saved);
    }
  );
});

describe("private background images", () => {
  it("keeps personal overrides independent and restores workspace inheritance", async () => {
    const admin = await buildAdmin();
    const user = await buildUser({ teamId: admin.teamId });
    const other = await buildUser({ teamId: admin.teamId });
    const shared = await asset(admin, "workspace");
    const own = await asset(user);
    await server.post("/api/customizations.updateBackground", admin, {
      body: {
        scope: "workspace",
        expectedVersion: 0,
        assetId: shared.id,
        fit: "cover",
      },
    });
    const saved = await server.post(
      "/api/customizations.updateBackground",
      user,
      {
        body: {
          scope: "personal",
          expectedVersion: 0,
          source: "personal",
          assetId: own.id,
          fit: "contain",
        },
      }
    );
    expect(saved.status).toEqual(200);
    expect((await info(user)).personal.background.asset?.id).toEqual(own.id);
    expect((await info(other)).personal.background.source).toEqual("inherit");
    expect((await info(other)).workspace.background.asset?.id).toEqual(
      shared.id
    );
    await server.post("/api/customizations.updateBackground", user, {
      body: {
        scope: "personal",
        expectedVersion: 1,
        source: "inherit",
        assetId: null,
        fit: "cover",
      },
    });
    expect((await info(user)).personal.background.source).toEqual("inherit");
  });

  it("streams private images without granting another member, workspace, or anonymous access", async () => {
    const user = await buildUser();
    const other = await buildUser({ teamId: user.teamId });
    const outsider = await buildUser();
    const own = await asset(user);
    vi.spyOn(FileStorage, "getFileStream").mockResolvedValue(
      Readable.from(Buffer.from("image bytes"))
    );
    const path = `/api/customizations.background?id=${own.id}`;
    const response = await server.get(path, user);
    expect(response.status).toEqual(200);
    expect(response.headers.get("cache-control")).toEqual("private, no-store");
    expect((await server.get(path, other)).status).toEqual(403);
    expect((await server.get(path, outsider)).status).toEqual(403);
    expect((await server.get(path)).status).toEqual(401);
    expect(
      (await server.get(`/api/attachments.redirect?id=${own.id}`, other)).status
    ).toEqual(404);
    const rawPath = `/api/files.get?key=${encodeURIComponent(own.key)}`;
    expect((await server.get(rawPath, user)).status).toEqual(400);
    expect((await server.get(rawPath, other)).status).toEqual(400);
    expect((await server.get(rawPath)).status).toEqual(400);
  });

  it("exposes only the saved workspace default to other members", async () => {
    const admin = await buildAdmin();
    const member = await buildUser({ teamId: admin.teamId });
    const staged = await asset(admin, "workspace");
    const replacement = await asset(admin, "workspace");
    const imagePath = `/api/customizations.background?id=${staged.id}`;
    vi.spyOn(FileStorage, "getFileStream").mockImplementation(async () =>
      Readable.from(Buffer.from("image bytes"))
    );

    expect((await server.get(imagePath, admin)).status).toEqual(200);
    expect((await server.get(imagePath, member)).status).toEqual(403);
    await server.post("/api/customizations.updateBackground", admin, {
      body: {
        scope: "workspace",
        expectedVersion: 0,
        assetId: staged.id,
        fit: "cover",
      },
    });
    expect((await server.get(imagePath, member)).status).toEqual(200);
    await server.post("/api/customizations.updateBackground", admin, {
      body: {
        scope: "workspace",
        expectedVersion: 1,
        assetId: replacement.id,
        fit: "cover",
      },
    });
    expect((await server.get(imagePath, member)).status).toEqual(403);
  });

  it("rejects attaching another user's or another workspace's image", async () => {
    const user = await buildUser();
    const other = await buildUser({ teamId: user.teamId });
    const own = await asset(user);
    const response = await server.post(
      "/api/customizations.updateBackground",
      other,
      {
        body: {
          scope: "personal",
          expectedVersion: 0,
          source: "personal",
          assetId: own.id,
          fit: "cover",
        },
      }
    );
    expect(response.status).toEqual(403);
    expect((await info(other)).personal.background.version).toEqual(0);

    const outsider = await buildUser();
    const crossWorkspace = await server.post(
      "/api/customizations.updateBackground",
      outsider,
      {
        body: {
          scope: "personal",
          expectedVersion: 0,
          source: "personal",
          assetId: own.id,
          fit: "cover",
        },
      }
    );
    expect(crossWorkspace.status).toEqual(403);
    expect((await info(outsider)).personal.background.version).toEqual(0);
  });

  it("validates actual uploaded bytes, uses private storage, and returns only an application URL", async () => {
    const user = await buildUser();
    const store = vi.spyOn(FileStorage, "store").mockResolvedValue(undefined);
    const form = new FormData();
    form.append("scope", "personal");
    form.append(
      "file",
      readFileSync("plugins/storage/server/test/fixtures/avatar.jpg"),
      { filename: "wallpaper.jpg", contentType: "image/jpeg" }
    );
    const response = await server.post(
      "/api/customizations.uploadBackground",
      user,
      { headers: form.getHeaders(), body: form }
    );
    expect(response.status).toEqual(200);
    const body = await response.json();
    expect(body.data.url).toEqual(
      `/api/customizations.background?id=${body.data.id}`
    );
    expect(body.data.key).toBeUndefined();
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({ acl: "private", contentType: "image/jpeg" })
    );
    const invalid = new FormData();
    invalid.append("scope", "personal");
    invalid.append(
      "file",
      Buffer.from("<svg><script>alert(1)</script></svg>"),
      { filename: "wallpaper.png", contentType: "image/png" }
    );
    expect(
      (
        await server.post("/api/customizations.uploadBackground", user, {
          headers: invalid.getHeaders(),
          body: invalid,
        })
      ).status
    ).toEqual(400);
    expect(
      await CustomizationAsset.count({ where: { userId: user.id } })
    ).toEqual(1);
  });

  it("retains metadata for retry when deletion fails and never deletes referenced assets", async () => {
    const admin = await buildAdmin();
    const image = await asset(admin, "workspace");
    await server.post("/api/customizations.updateBackground", admin, {
      body: {
        scope: "workspace",
        expectedVersion: 0,
        assetId: image.id,
        fit: "cover",
      },
    });
    const remove = vi
      .spyOn(FileStorage, "deleteFile")
      .mockResolvedValue(undefined);
    expect(await customizationAssetDelete(image.id)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
    const unused = await asset(admin);
    remove.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(customizationAssetDelete(unused.id)).rejects.toThrow(
      "storage unavailable"
    );
    expect(await CustomizationAsset.findByPk(unused.id)).not.toBeNull();
    expect(await customizationAssetDelete(unused.id)).toBe(true);
    expect(await CustomizationAsset.findByPk(unused.id)).toBeNull();
  });

  it("keeps a committed replacement when optional cleanup scheduling fails", async () => {
    const user = await buildUser();
    const image = await asset(user);
    await server.post("/api/customizations.updateBackground", user, {
      body: {
        scope: "personal",
        expectedVersion: 0,
        source: "personal",
        assetId: image.id,
        fit: "cover",
      },
    });
    vi.spyOn(
      DeleteCustomizationAssetTask.prototype,
      "schedule"
    ).mockImplementation(() => {
      throw new Error("queue unavailable");
    });
    const response = await server.post(
      "/api/customizations.updateBackground",
      user,
      {
        body: {
          scope: "personal",
          expectedVersion: 1,
          source: "inherit",
          assetId: null,
          fit: "cover",
        },
      }
    );
    expect(response.status).toEqual(200);
    expect((await info(user)).personal.background.source).toEqual("inherit");
    expect(await CustomizationAsset.findByPk(image.id)).not.toBeNull();
  });

  it("sweeps abandoned uploads without letting old referenced images exhaust the batch", async () => {
    const user = await buildUser();
    const referenced = await asset(user, "personal", subDays(new Date(), 3));
    const abandoned = await asset(user, "personal", subDays(new Date(), 2));
    await server.post("/api/customizations.updateBackground", user, {
      body: {
        scope: "personal",
        expectedVersion: 0,
        source: "personal",
        assetId: referenced.id,
        fit: "cover",
      },
    });
    vi.spyOn(FileStorage, "deleteFile").mockResolvedValue(undefined);
    await new CleanupCustomizationAssetsTask().perform({
      limit: 1,
      partition: { partitionIndex: 0, partitionCount: 1 },
    });
    expect(await CustomizationAsset.findByPk(referenced.id)).not.toBeNull();
    expect(await CustomizationAsset.findByPk(abandoned.id)).toBeNull();
  });
});
