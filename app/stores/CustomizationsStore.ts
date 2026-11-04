import {
  action,
  computed,
  makeObservable,
  observable,
  runInAction,
} from "mobx";
import type {
  CustomizationAssetInfo,
  CustomizationBackground,
  CustomizationBackgroundFit,
  CustomizationScope,
  CustomizationScript,
  CustomizationsInfo,
  WorkspaceCustomizationsInfo,
} from "@shared/types/customizations";
import { client } from "~/utils/ApiClient";

interface StoreRoot {
  auth: {
    currentUserId?: string | null;
    currentTeamId?: string | null;
  };
}

interface ApiResponse<T> {
  data: T;
}

interface FetchOptions {
  force?: boolean;
}

interface BackgroundUpdate {
  assetId: string | null;
  fit: CustomizationBackgroundFit;
  source?: "inherit" | "personal";
  expectedVersion: number;
}

/**
 * Stores independently saved appearance and exact-revision script consent.
 */
export class CustomizationsStore {
  @observable.ref
  info: CustomizationsInfo | undefined = undefined;

  @observable.ref
  workspaceInfo: WorkspaceCustomizationsInfo | undefined = undefined;

  @observable
  isFetching = false;

  @observable
  scriptError: string | undefined = undefined;

  constructor(rootStore: StoreRoot) {
    this.rootStore = rootStore;
    makeObservable(this);
  }

  /** The saved background resolved from the current user's inheritance choice. */
  @computed
  get effectiveBackground(): CustomizationBackground | undefined {
    if (!this.info) {
      return undefined;
    }

    return this.info.personal.background.source === "personal"
      ? this.info.personal.background
      : this.info.workspace.background;
  }

  /** CSS remains paused even when an older response contains saved source. */
  @computed
  get workspaceCss(): string {
    return "";
  }

  /** Personal styles remain paused independently of retained saved settings. */
  @computed
  get personalCss(): string {
    return "";
  }

  /** Published scripts remain paused even when older consent is still stored. */
  @computed
  get enabledScript(): CustomizationScript | null {
    return null;
  }

  /** Script consent controls are unavailable while script execution is paused. */
  @computed
  get scriptRequiresConsent(): boolean {
    return false;
  }

  /**
   * Loads the current user's settings, sharing an in-flight read.
   *
   * @param options whether to refresh an already loaded response.
   * @returns the fresh response, or undefined after the session changes.
   */
  fetchInfo = async ({ force = false }: FetchOptions = {}) => {
    this.prepareSession();
    if (!this.identity) {
      return undefined;
    }
    if (!force && this.info) {
      return this.info;
    }
    if (this.infoRequest) {
      return this.infoRequest;
    }

    const identity = this.identity;
    const generation = this.generation;
    const writeVersion = this.writeVersion;
    runInAction(() => {
      this.isFetching = true;
    });

    const request = client
      .post<ApiResponse<CustomizationsInfo>>("/customizations.info", {})
      .then(({ data }) => {
        if (!this.isCurrent(identity, generation, writeVersion)) {
          return undefined;
        }

        this.applyInfo(data);
        return data;
      })
      .finally(() => {
        if (this.infoRequest === request) {
          this.infoRequest = undefined;
          runInAction(() => {
            this.isFetching = false;
          });
        }
      });

    this.infoRequest = request;
    return request;
  };

  /**
   * Revalidates saved state before runtime execution or after invalidation.
   *
   * @returns the authorized response, or undefined after the session changes.
   */
  revalidate = () => this.fetchInfo({ force: true });

  /**
   * Loads the administrator's settings and unpublished script draft.
   *
   * @param options whether to refresh an already loaded response.
   * @returns the response, or undefined after the session changes.
   */
  fetchWorkspaceInfo = async ({ force = false }: FetchOptions = {}) => {
    this.prepareSession();
    if (!this.identity) {
      return undefined;
    }
    if (!force && this.workspaceInfo) {
      return this.workspaceInfo;
    }
    if (this.workspaceRequest) {
      return this.workspaceRequest;
    }

    const identity = this.identity;
    const generation = this.generation;
    const writeVersion = this.writeVersion;
    const request = client
      .post<ApiResponse<WorkspaceCustomizationsInfo>>(
        "/customizations.workspaceInfo",
        {}
      )
      .then(({ data }) => {
        if (!this.isCurrent(identity, generation, writeVersion)) {
          return undefined;
        }

        this.applyWorkspaceInfo(data);
        return data;
      })
      .finally(() => {
        if (this.workspaceRequest === request) {
          this.workspaceRequest = undefined;
        }
      });

    this.workspaceRequest = request;
    return request;
  };

  /**
   * Saves only the selected background field.
   *
   * @param scope the setting owner.
   * @param update the image, fit, inheritance, and expected saved version.
   * @returns the authorized settings after the write.
   */
  updateBackground = (scope: CustomizationScope, update: BackgroundUpdate) =>
    this.saveInfo("/customizations.updateBackground", { scope, ...update });

  /**
   * Saves only the selected CSS field.
   *
   * @param scope the setting owner.
   * @param css the stylesheet source.
   * @param expectedVersion the version displayed when editing began.
   * @returns the authorized settings after the write.
   */
  updateCss = (
    scope: CustomizationScope,
    css: string,
    expectedVersion: number
  ) =>
    this.saveInfo("/customizations.updateCss", {
      scope,
      css,
      expectedVersion,
    });

  /**
   * Saves an administrator's unpublished source and dependency files.
   *
   * @param source the entry module source.
   * @param modules the managed module path/source mapping.
   * @param expectedVersion the draft version displayed when editing began.
   * @returns the administrator's updated settings.
   */
  saveScriptDraft = (
    source: string,
    modules: Record<string, string>,
    expectedVersion: number
  ) =>
    this.saveWorkspaceInfo("/customizations.saveScriptDraft", {
      source,
      modules,
      expectedVersion,
    });

  /**
   * Publishes the saved draft as an immutable revision.
   *
   * @param expectedVersion the saved draft version to publish.
   * @returns the administrator's updated settings.
   */
  publishScript = (expectedVersion: number) =>
    this.saveWorkspaceInfo("/customizations.publishScript", {
      expectedVersion,
    });

  /**
   * Confirms the exact published revision displayed to the user.
   *
   * @param revisionId the reviewed revision identifier.
   * @param digest the reviewed source and dependency digest.
   * @returns the current user's updated settings.
   */
  enableScript = (revisionId: string, digest: string) =>
    this.saveInfo("/customizations.enableScript", { revisionId, digest });

  /**
   * Removes the current user's script consent.
   *
   * @returns the current user's updated settings.
   */
  disableScript = () => this.saveInfo("/customizations.disableScript", {});

  /**
   * Uploads an image without changing the saved background configuration.
   *
   * @param file the selected image.
   * @param scope the intended image owner.
   * @returns the ready image, or undefined after the session changes.
   */
  uploadBackground = async (file: File, scope: CustomizationScope) => {
    this.prepareSession();
    const identity = this.identity;
    const generation = this.generation;
    const body = new FormData();
    body.append("file", file);
    body.append("scope", scope);

    const { data } = await client.post<ApiResponse<CustomizationAssetInfo>>(
      "/customizations.uploadBackground",
      body,
      { retry: false }
    );

    return this.isCurrent(identity, generation) ? data : undefined;
  };

  /**
   * Exposes native-module or activation failures to the settings page.
   *
   * @param message the runtime error, or undefined to clear it.
   */
  @action
  setScriptError = (message?: string) => {
    this.scriptError = message;
  };

  /** Clears session-bound settings and invalidates unfinished responses. */
  @action
  clear = () => {
    this.generation += 1;
    this.writeVersion += 1;
    this.info = undefined;
    this.workspaceInfo = undefined;
    this.infoRequest = undefined;
    this.workspaceRequest = undefined;
    this.isFetching = false;
    this.scriptError = undefined;
    this.sessionIdentity = this.identity;
    this.writeQueue = Promise.resolve();
  };

  private readonly rootStore: StoreRoot;

  private generation = 0;

  private writeVersion = 0;

  private sessionIdentity: string | undefined;

  private writeQueue: Promise<void> = Promise.resolve();

  private infoRequest: Promise<CustomizationsInfo | undefined> | undefined;

  private workspaceRequest:
    | Promise<WorkspaceCustomizationsInfo | undefined>
    | undefined;

  private get identity(): string | undefined {
    const { currentUserId, currentTeamId } = this.rootStore.auth;
    return currentUserId && currentTeamId
      ? `${currentTeamId}:${currentUserId}`
      : undefined;
  }

  private prepareSession() {
    if (this.sessionIdentity !== this.identity) {
      this.clear();
    }
  }

  private isCurrent(
    identity: string | undefined,
    generation: number,
    writeVersion?: number
  ): boolean {
    return !!(
      identity &&
      identity === this.identity &&
      generation === this.generation &&
      (writeVersion === undefined || writeVersion === this.writeVersion)
    );
  }

  @action
  private applyInfo(data: CustomizationsInfo) {
    if (
      this.info?.workspace.script?.id !== data.workspace.script?.id ||
      this.info?.scriptEnabled !== data.scriptEnabled ||
      this.info?.scriptsAllowed !== data.scriptsAllowed
    ) {
      this.scriptError = undefined;
    }

    this.info = {
      workspace: data.workspace,
      personal: data.personal,
      scriptsAllowed: data.scriptsAllowed,
      scriptEnabled: data.scriptEnabled,
      canManage: data.canManage,
    };
    if (this.workspaceInfo) {
      this.workspaceInfo = { ...this.info, draft: this.workspaceInfo.draft };
    }
  }

  @action
  private applyWorkspaceInfo(data: WorkspaceCustomizationsInfo) {
    this.applyInfo(data);
    this.workspaceInfo = data;
  }

  private saveInfo(path: string, body: Parameters<typeof client.post>[1]) {
    this.prepareSession();
    const identity = this.identity;
    const generation = this.generation;
    return this.enqueueWrite(async () => {
      if (!this.isCurrent(identity, generation)) {
        return undefined;
      }

      this.writeVersion += 1;
      try {
        const { data } = await client.post<ApiResponse<CustomizationsInfo>>(
          path,
          body,
          { retry: false }
        );
        if (!this.isCurrent(identity, generation)) {
          return undefined;
        }

        this.applyInfo(data);
        return data;
      } finally {
        if (generation === this.generation) {
          this.writeVersion += 1;
        }
      }
    });
  }

  private saveWorkspaceInfo(
    path: string,
    body: Parameters<typeof client.post>[1]
  ) {
    this.prepareSession();
    const identity = this.identity;
    const generation = this.generation;
    return this.enqueueWrite(async () => {
      if (!this.isCurrent(identity, generation)) {
        return undefined;
      }

      this.writeVersion += 1;
      try {
        const { data } = await client.post<
          ApiResponse<WorkspaceCustomizationsInfo>
        >(path, body, { retry: false });
        if (!this.isCurrent(identity, generation)) {
          return undefined;
        }

        this.applyWorkspaceInfo(data);
        return data;
      } finally {
        if (generation === this.generation) {
          this.writeVersion += 1;
        }
      }
    });
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const request = this.writeQueue.then(operation, operation);
    this.writeQueue = request.then(
      () => undefined,
      () => undefined
    );
    return request;
  }
}
