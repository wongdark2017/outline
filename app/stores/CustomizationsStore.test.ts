import type {
  CustomizationScript,
  CustomizationsInfo,
} from "@shared/types/customizations";
import { client } from "~/utils/ApiClient";
import { CustomizationsStore } from "./CustomizationsStore";

function createStore() {
  const root = { auth: { currentUserId: "user-a", currentTeamId: "team-a" } };
  return { root, store: new CustomizationsStore(root) };
}

function buildInfo(): CustomizationsInfo {
  return {
    workspace: {
      background: { asset: null, fit: "cover", version: 0 },
      css: { source: "p { line-height: 1.9; }", version: 0 },
      script: null,
    },
    personal: {
      background: { asset: null, fit: "cover", source: "inherit", version: 0 },
      css: { source: "", version: 0 },
      enabledScriptId: null,
      enabledScriptDigest: null,
    },
    scriptEnabled: false,
    scriptsAllowed: true,
    canManage: false,
  };
}

function buildEnabledInfo(): CustomizationsInfo {
  const info = buildInfo();
  const script: CustomizationScript = {
    id: "revision-a",
    revision: 1,
    digest: "a".repeat(64),
    source: "export function activate() {}",
    modules: {},
    url: "/customizations/scripts/revision-a/entry.js",
    createdAt: "2026-11-04T00:00:00.000Z",
  };
  info.workspace.script = script;
  info.personal.enabledScriptId = script.id;
  info.personal.enabledScriptDigest = script.digest;
  info.scriptEnabled = true;
  return info;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred promise was not initialized");
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => vi.mocked(client.post).mockReset());
afterEach(() => vi.restoreAllMocks());

describe("CustomizationsStore", () => {
  it("shares a pending configuration read and retains the authorized response", async () => {
    const { store } = createStore();
    const info = buildInfo();
    const post = vi.spyOn(client, "post").mockResolvedValue({ data: info });

    await Promise.all([store.fetchInfo(), store.fetchInfo()]);

    expect(post).toHaveBeenCalledTimes(1);
    expect(store.info).toEqual(info);
    expect(store.isFetching).toBe(false);
    expect(store.workspaceCss).toBe("");
  });

  it("discards a response after its authenticated user changes", async () => {
    const { store, root } = createStore();
    const request = deferred<{ data: CustomizationsInfo }>();
    vi.spyOn(client, "post").mockReturnValue(request.promise);
    const pending = store.fetchInfo();

    root.auth.currentUserId = "user-b";
    request.resolve({ data: buildInfo() });

    expect(await pending).toBeUndefined();
    expect(store.info).toBeUndefined();
  });

  it("clears cached personal settings when a new user fetches", async () => {
    const { store, root } = createStore();
    const first = buildInfo();
    first.personal.css.source = "p { color: red; }";
    const second = buildInfo();
    vi.spyOn(client, "post")
      .mockResolvedValueOnce({ data: first })
      .mockResolvedValueOnce({ data: second });
    await store.fetchInfo();

    root.auth.currentUserId = "user-b";
    await store.fetchInfo();

    expect(store.info?.personal.css.source).toBe("");
    expect(store.personalCss).toBe("");
  });

  it("does not share an old user's pending request with a new user", async () => {
    const { store, root } = createStore();
    const first = deferred<{ data: CustomizationsInfo }>();
    const next = buildInfo();
    next.personal.css.source = "p { color: blue; }";
    const post = vi
      .spyOn(client, "post")
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ data: next });
    const oldRead = store.fetchInfo();

    root.auth.currentUserId = "user-b";
    await store.fetchInfo();
    first.resolve({ data: buildInfo() });
    await oldRead;

    expect(post).toHaveBeenCalledTimes(2);
    expect(store.info?.personal.css.source).toBe(next.personal.css.source);
    expect(store.personalCss).toBe("");
  });

  it("does not let an old read overwrite a successful field save", async () => {
    const { store } = createStore();
    const request = deferred<{ data: CustomizationsInfo }>();
    const saved = buildInfo();
    saved.personal.background = {
      ...saved.personal.background,
      fit: "contain",
      version: 1,
    };
    vi.spyOn(client, "post")
      .mockReturnValueOnce(request.promise)
      .mockResolvedValueOnce({ data: saved });
    const pending = store.fetchInfo();

    await store.updateBackground("personal", {
      assetId: null,
      source: "inherit",
      fit: "contain",
      expectedVersion: 0,
    });
    request.resolve({ data: buildInfo() });
    await pending;

    expect(store.info?.personal.background.fit).toBe("contain");
    expect(store.info?.personal.background.version).toBe(1);
  });

  it("serializes background saves while keeping old script metadata inactive", async () => {
    const { store } = createStore();
    const request = deferred<{ data: CustomizationsInfo }>();
    const first = buildEnabledInfo();
    first.personal.background = {
      ...first.personal.background,
      fit: "contain",
      version: 1,
    };
    const updated = buildEnabledInfo();
    updated.personal.background = {
      ...updated.personal.background,
      fit: "repeat",
      version: 2,
    };
    const post = vi
      .spyOn(client, "post")
      .mockReturnValueOnce(request.promise)
      .mockResolvedValueOnce({ data: updated });

    const firstSave = store.updateBackground("personal", {
      assetId: null,
      source: "inherit",
      fit: "contain",
      expectedVersion: 0,
    });
    const secondSave = store.updateBackground("personal", {
      assetId: null,
      source: "inherit",
      fit: "repeat",
      expectedVersion: 1,
    });
    await Promise.resolve();
    expect(post).toHaveBeenCalledTimes(1);

    request.resolve({ data: first });
    await Promise.all([firstSave, secondSave]);

    expect(post).toHaveBeenCalledTimes(2);
    expect(store.info?.personal.background.fit).toBe("repeat");
    expect(store.info?.personal.background.version).toBe(2);
    expect(store.info?.personal.enabledScriptId).toBe("revision-a");
    expect(store.enabledScript).toBeNull();
  });

  it("keeps saved CSS and exact script consent inactive in an older response", async () => {
    const { store } = createStore();
    const info = buildEnabledInfo();
    info.personal.css.source = "body { display: none; }";
    vi.spyOn(client, "post").mockResolvedValue({ data: info });

    await store.fetchInfo();

    expect(store.workspaceCss).toBe("");
    expect(store.personalCss).toBe("");
    expect(store.enabledScript).toBeNull();
    expect(store.scriptRequiresConsent).toBe(false);
    expect(store.info?.workspace.css.source).toBe(info.workspace.css.source);
    expect(store.info?.personal.css.source).toBe(info.personal.css.source);
    expect(store.info?.personal.enabledScriptId).toBe("revision-a");
  });

  it("distinguishes a deployment pause from a new revision requiring consent", async () => {
    const { store } = createStore();
    const info = buildEnabledInfo();
    info.scriptsAllowed = false;
    info.scriptEnabled = false;
    vi.spyOn(client, "post").mockResolvedValue({ data: info });

    await store.fetchInfo();

    expect(store.enabledScript).toBeNull();
    expect(store.scriptRequiresConsent).toBe(false);
  });

  it("keeps the saved background after a failed mutation and allows the next save", async () => {
    const { store } = createStore();
    const initial = buildInfo();
    const saved = buildInfo();
    saved.personal.background = {
      ...saved.personal.background,
      fit: "contain",
      version: 1,
    };
    vi.spyOn(client, "post")
      .mockResolvedValueOnce({ data: initial })
      .mockRejectedValueOnce(new Error("Save failed"))
      .mockResolvedValueOnce({ data: saved });
    await store.fetchInfo();
    const update = {
      assetId: null,
      fit: "contain",
      source: "inherit",
      expectedVersion: 0,
    } satisfies Parameters<typeof store.updateBackground>[1];

    await expect(store.updateBackground("personal", update)).rejects.toThrow(
      "Save failed"
    );
    expect(store.info?.personal.background.version).toBe(0);
    await store.updateBackground("personal", update);
    expect(store.info?.personal.background.fit).toBe("contain");
    expect(store.info?.personal.background.version).toBe(1);
  });

  it("uploads a staged image without replacing saved settings", async () => {
    const { store } = createStore();
    const info = buildEnabledInfo();
    const asset = {
      id: "asset-a",
      name: "background.png",
      contentType: "image/png",
      size: 10,
      url: "/api/customizations.background?id=asset-a",
    };
    const post = vi
      .spyOn(client, "post")
      .mockResolvedValueOnce({ data: info })
      .mockResolvedValueOnce({ data: asset });
    await store.fetchInfo();

    const uploaded = await store.uploadBackground(
      new File(["image"], asset.name, { type: asset.contentType }),
      "personal"
    );

    expect(uploaded).toEqual(asset);
    expect(store.info?.personal.background.asset).toBeNull();
    expect(store.enabledScript).toBeNull();
    expect(store.info?.personal.enabledScriptId).toBe("revision-a");
    const body = post.mock.calls[1][1];
    if (!(body instanceof FormData)) {
      throw new Error("Expected multipart upload");
    }
    expect(body.get("scope")).toBe("personal");
    expect(body.get("file")).toBeInstanceOf(File);
  });
});
