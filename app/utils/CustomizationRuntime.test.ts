import {
  CustomizationRuntime,
  type CustomizationScriptContext,
  type CustomizationScriptModule,
  type CustomizationRuntimeTarget,
} from "./CustomizationRuntime";

const revision: CustomizationRuntimeTarget = {
  id: "revision-one",
  digest: "digest-one",
  url: "/api/customizations.module/revision-one/entry.js",
  identity: "team-one:user-one",
};

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function setup(
  loadModule: (url: string) => Promise<CustomizationScriptModule>
) {
  const root = document.createElement("div");
  const toolbar = document.createElement("div");
  root.append(toolbar);
  document.body.append(root);
  const onError = vi.fn();
  const runtime = new CustomizationRuntime({
    loadModule,
    getAppRoot: () => root,
    getToolbar: () => toolbar,
    getAppearance: () => "light",
    onError,
  });
  return { runtime, root, toolbar, onError };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("CustomizationRuntime", () => {
  it("does not load code without an authorized target", async () => {
    const loadModule = vi.fn();
    const { runtime } = setup(loadModule);

    await runtime.setScript(null);
    await runtime.stop();

    expect(loadModule).not.toHaveBeenCalled();
  });

  it("activates a revision once across repeated revalidation and navigation", async () => {
    const onNavigation = vi.fn();
    const onAppearance = vi.fn();
    const activate = vi.fn((context: CustomizationScriptContext) => {
      context.onNavigation(onNavigation);
      context.onAppearanceChange(onAppearance);
    });
    const loadModule = vi.fn(async () => ({ activate }));
    const { runtime } = setup(loadModule);

    await Promise.all([
      runtime.setScript(revision),
      runtime.setScript({ ...revision }),
    ]);
    await runtime.setScript({ ...revision });
    runtime.notifyNavigation({ pathname: "/doc/test", search: "", hash: "" });
    runtime.notifyAppearance("dark");

    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(onNavigation).toHaveBeenCalledWith({
      pathname: "/doc/test",
      search: "",
      hash: "",
    });
    expect(onAppearance).toHaveBeenCalledWith("dark");

    await runtime.stop();
    runtime.notifyNavigation({ pathname: "/home", search: "", hash: "" });
    runtime.notifyAppearance("light");
    expect(onNavigation).toHaveBeenCalledTimes(1);
    expect(onAppearance).toHaveBeenCalledTimes(1);
  });

  it("aborts effects and disposes registered and returned cleanup once", async () => {
    const registeredCleanup = vi.fn();
    const returnedCleanup = vi.fn();
    let signal: AbortSignal | undefined;
    const { runtime, toolbar } = setup(async () => ({
      activate: (context) => {
        signal = context.signal;
        context.onCleanup(registeredCleanup);
        const button = document.createElement("button");
        button.textContent = "Custom tool";
        context.toolbar.append(button);
        return () => {
          button.remove();
          returnedCleanup();
        };
      },
    }));

    await runtime.setScript(revision);
    expect(toolbar.children).toHaveLength(1);

    const stopping = runtime.stop();
    expect(signal?.aborted).toBe(true);
    expect(toolbar.children).toHaveLength(0);
    await stopping;
    await runtime.stop();

    expect(registeredCleanup).toHaveBeenCalledTimes(1);
    expect(returnedCleanup).toHaveBeenCalledTimes(1);
  });

  it("does not activate an outdated import after consent is removed", async () => {
    const imported = deferred<CustomizationScriptModule>();
    const activate = vi.fn();
    const loadModule = vi.fn(() => imported.promise);
    const { runtime } = setup(loadModule);

    const starting = runtime.setScript(revision);
    await vi.waitFor(() => expect(loadModule).toHaveBeenCalledTimes(1));
    await runtime.stop();
    imported.resolve({ activate });
    await starting;

    expect(activate).not.toHaveBeenCalled();
  });

  it("ignores a late old revision and activates the replacement only once", async () => {
    const oldImport = deferred<CustomizationScriptModule>();
    const oldActivate = vi.fn();
    const newActivate = vi.fn();
    const { runtime } = setup((url) =>
      url === revision.url
        ? oldImport.promise
        : Promise.resolve({ activate: newActivate })
    );

    const oldStarting = runtime.setScript(revision);
    await Promise.resolve();
    const next = {
      ...revision,
      id: "revision-two",
      digest: "digest-two",
      url: "/api/customizations.module/revision-two/entry.js",
    };
    await runtime.setScript(next);
    oldImport.resolve({ activate: oldActivate });
    await oldStarting;
    await runtime.setScript(next);

    expect(oldActivate).not.toHaveBeenCalled();
    expect(newActivate).toHaveBeenCalledTimes(1);
    await runtime.stop();
  });

  it("cleans an activation that resolves after the user identity changes", async () => {
    const activation = deferred<void | (() => void)>();
    const cleanup = vi.fn();
    const lateRegistered = vi.fn();
    let oldContext: CustomizationScriptContext | undefined;
    const { runtime } = setup(async () => ({
      activate: (context) => {
        if (oldContext) {
          return;
        }
        oldContext = context;
        return activation.promise;
      },
    }));

    const first = runtime.setScript(revision);
    await vi.waitFor(() => expect(oldContext).toBeDefined());
    await runtime.setScript({ ...revision, identity: "team-two:user-two" });
    expect(oldContext?.signal.aborted).toBe(true);
    oldContext?.onCleanup(lateRegistered);
    activation.resolve(cleanup);
    await first;

    expect(lateRegistered).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    await runtime.stop();
  });

  it("waits for managed cleanup before activating another revision", async () => {
    const disposed = deferred<void>();
    const order: string[] = [];
    const { runtime } = setup(async (url) => ({
      activate: () => {
        order.push(url);
        if (url === revision.url) {
          return () => disposed.promise;
        }
        return undefined;
      },
    }));

    await runtime.setScript(revision);
    const next = runtime.setScript({ ...revision, id: "two", url: "/two.js" });
    await Promise.resolve();
    expect(order).toEqual([revision.url]);
    disposed.resolve();
    await next;
    expect(order).toEqual([revision.url, "/two.js"]);
    await runtime.stop();
  });

  it("resumes an authorized module with a fresh activation context", async () => {
    const contexts: CustomizationScriptContext[] = [];
    const cleanup = vi.fn();
    const module = {
      activate: (context: CustomizationScriptContext) => {
        contexts.push(context);
        return cleanup;
      },
    };
    const { runtime } = setup(async () => module);

    await runtime.setScript(revision);
    await runtime.stop();
    await runtime.setScript(revision);

    expect(contexts).toHaveLength(2);
    expect(contexts[0].signal.aborted).toBe(true);
    expect(contexts[1].signal.aborted).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
    await runtime.stop();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("reports module and activation failures without an unhandled rejection", async () => {
    const { runtime, onError } = setup(async () => {
      throw new Error("Module failed");
    });

    await runtime.setScript(revision);
    expect(onError).toHaveBeenCalledWith(new Error("Module failed"));
    await runtime.stop();

    const failed = setup(async () => ({
      activate: (context) => {
        context.onCleanup(() => {});
        throw new Error("Activation failed");
      },
    }));
    await failed.runtime.setScript(revision);
    expect(failed.onError).toHaveBeenCalledWith(new Error("Activation failed"));
    await failed.runtime.stop();
  });
});
