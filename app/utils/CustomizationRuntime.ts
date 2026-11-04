/** A disposer for resources created by a customization script. */
export type CustomizationCleanup = () => void | Promise<void>;

/** The interface appearance exposed to a running script. */
export type CustomizationAppearance = "light" | "dark";

/** A navigation event containing no internal router state or credentials. */
export interface CustomizationNavigation {
  pathname: string;
  search: string;
  hash: string;
}

/** The main-page context passed to an explicitly enabled script. */
export interface CustomizationScriptContext {
  readonly appRoot: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly appearance: CustomizationAppearance;
  readonly signal: AbortSignal;
  onCleanup: (cleanup: CustomizationCleanup) => () => void;
  onNavigation: (
    listener: (location: CustomizationNavigation) => void
  ) => () => void;
  onAppearanceChange: (
    listener: (appearance: CustomizationAppearance) => void
  ) => () => void;
}

/** An immutable module with the supported activation lifecycle. */
export interface CustomizationScriptModule {
  activate: (
    context: CustomizationScriptContext
  ) => void | CustomizationCleanup | Promise<void | CustomizationCleanup>;
}

/** The exact authorized script and authenticated identity to activate. */
export interface CustomizationRuntimeTarget {
  id: string;
  digest: string;
  url: string;
  identity: string;
}

/** Dependencies for loading scripts and locating current application nodes. */
export interface CustomizationRuntimeOptions {
  getAppRoot: () => HTMLElement;
  getToolbar: () => HTMLElement;
  getAppearance: () => CustomizationAppearance;
  onError: (error: Error) => void;
  loadModule?: (url: string) => Promise<CustomizationScriptModule>;
}

/**
 * Owns one consented script lifecycle without evaluating source strings.
 *
 * A generation check prevents delayed imports from activating an older
 * revision. Abort signals and managed disposers are invalidated immediately
 * when consent or the authenticated identity changes.
 */
export class CustomizationRuntime {
  constructor(options: CustomizationRuntimeOptions) {
    this.options = options;
  }

  /**
   * Activates the desired script after disposing the previous managed effects.
   *
   * @param target the exact authorized revision, or null to stop execution.
   * @returns a promise for this transition, including activation errors.
   */
  setScript(target: CustomizationRuntimeTarget | null): Promise<void> {
    const key = target
      ? `${target.identity}:${target.id}:${target.digest}:${target.url}`
      : null;

    if (key === this.desiredKey) {
      return this.pending;
    }

    this.desiredKey = key;
    const generation = ++this.generation;
    const previous = this.instance;
    this.instance = undefined;

    const disposing = previous
      ? this.disposeInstance(previous)
      : Promise.resolve();
    this.stopping = Promise.all([this.stopping, disposing]).then(() => {});
    this.pending = this.start(target, generation, this.stopping);

    return this.pending;
  }

  /**
   * Stops the script and releases all registered lifecycle resources.
   *
   * @returns a promise for managed cleanup completion.
   */
  stop(): Promise<void> {
    return this.setScript(null);
  }

  /**
   * Sends a navigation event without reactivating the current script.
   *
   * @param location the new location, without internal routing state.
   */
  notifyNavigation(location: CustomizationNavigation): void {
    for (const listener of this.navigationListeners) {
      try {
        listener(location);
      } catch (error) {
        this.reportError(error);
      }
    }
  }

  /**
   * Sends an appearance event without changing consent or reactivating code.
   *
   * @param appearance the resolved light or dark appearance.
   */
  notifyAppearance(appearance: CustomizationAppearance): void {
    for (const listener of this.appearanceListeners) {
      try {
        listener(appearance);
      } catch (error) {
        this.reportError(error);
      }
    }
  }

  private options: CustomizationRuntimeOptions;

  private desiredKey: string | null = null;

  private generation = 0;

  private instance?: ScriptInstance;

  private pending: Promise<void> = Promise.resolve();

  private stopping: Promise<void> = Promise.resolve();

  private navigationListeners = new Set<
    (location: CustomizationNavigation) => void
  >();

  private appearanceListeners = new Set<
    (appearance: CustomizationAppearance) => void
  >();

  private async start(
    target: CustomizationRuntimeTarget | null,
    generation: number,
    stopping: Promise<void>
  ): Promise<void> {
    await stopping;

    if (!target || generation !== this.generation) {
      return;
    }

    let instance: ScriptInstance | undefined;

    try {
      const module = await (this.options.loadModule ?? loadModule)(target.url);

      if (generation !== this.generation) {
        return;
      }

      instance = {
        controller: new AbortController(),
        cleanups: new Set(),
        disposed: false,
      };
      this.instance = instance;
      const cleanup = await module.activate(this.createContext(instance));

      if (typeof cleanup === "function") {
        if (instance.disposed) {
          await this.runCleanup(cleanup);
        } else {
          instance.cleanups.add(cleanup);
        }
      }
    } catch (error) {
      if (instance) {
        if (this.instance === instance) {
          this.instance = undefined;
        }
        await this.disposeInstance(instance);
      }

      if (generation === this.generation) {
        this.reportError(error);
      }
    }
  }

  private createContext(instance: ScriptInstance): CustomizationScriptContext {
    const { options } = this;
    const register = (cleanup: CustomizationCleanup) => {
      if (instance.disposed) {
        void this.runCleanup(cleanup);
        return () => {};
      }

      instance.cleanups.add(cleanup);
      return () => {
        instance.cleanups.delete(cleanup);
      };
    };

    return {
      get appRoot() {
        return options.getAppRoot();
      },
      get toolbar() {
        return options.getToolbar();
      },
      get appearance() {
        return options.getAppearance();
      },
      signal: instance.controller.signal,
      onCleanup: register,
      onNavigation: (listener) => {
        if (instance.disposed) {
          return () => {};
        }
        this.navigationListeners.add(listener);
        const remove = () => this.navigationListeners.delete(listener);
        const unregister = register(() => {
          remove();
        });
        return () => {
          remove();
          unregister();
        };
      },
      onAppearanceChange: (listener) => {
        if (instance.disposed) {
          return () => {};
        }
        this.appearanceListeners.add(listener);
        const remove = () => this.appearanceListeners.delete(listener);
        const unregister = register(() => {
          remove();
        });
        return () => {
          remove();
          unregister();
        };
      },
    };
  }

  private disposeInstance(instance: ScriptInstance): Promise<void> {
    if (instance.disposal) {
      return instance.disposal;
    }

    instance.disposed = true;
    instance.controller.abort();
    const cleanups = [...instance.cleanups];
    instance.cleanups.clear();
    instance.disposal = Promise.all(
      cleanups.map((cleanup) => this.runCleanup(cleanup))
    ).then(() => {});
    return instance.disposal;
  }

  private async runCleanup(cleanup: CustomizationCleanup): Promise<void> {
    try {
      await cleanup();
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    this.options.onError(
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

interface ScriptInstance {
  controller: AbortController;
  cleanups: Set<CustomizationCleanup>;
  disposed: boolean;
  disposal?: Promise<void>;
}

/**
 * Imports a consented module through the browser's native module loader.
 *
 * @param url the authenticated, immutable application module URL.
 * @returns a module with the supported activation export.
 * @throws {Error} if the module does not export an activation function.
 */
async function loadModule(url: string): Promise<CustomizationScriptModule> {
  const module: unknown = await import(/* @vite-ignore */ url);

  if (!isCustomizationScriptModule(module)) {
    throw new Error("The script must export an activate function");
  }

  return module;
}

function isCustomizationScriptModule(
  module: unknown
): module is CustomizationScriptModule {
  return (
    !!module &&
    typeof module === "object" &&
    "activate" in module &&
    typeof module.activate === "function"
  );
}
