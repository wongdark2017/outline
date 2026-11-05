import { vi } from "vitest";
import { DEFAULT_SOURCE, RENDER_TIMEOUT_MS, TIKZJAX_PATH } from "./constants";
import { extractSource } from "./svg";
import { describeTexError } from "./prepareSource";

const mocks = vi.hoisted(() => {
  const workers: EventTarget[] = [];
  return {
    workers,
    construct: vi.fn(),
    rawTerminate: vi.fn(),
    threadTerminate: vi.fn(),
    load: vi.fn(),
    texify: vi.fn(),
    spawn: vi.fn(),
  };
});

vi.mock("threads", () => ({
  Worker: class extends EventTarget {
    constructor(path: string, options: object) {
      super();
      mocks.construct(path, options);
      mocks.workers.push(this);
    }
    terminate() {
      mocks.rawTerminate();
    }
  },
  Thread: { terminate: mocks.threadTerminate },
  spawn: mocks.spawn,
}));

import { renderTikz } from "./renderTikz";

const workerApi = { load: mocks.load, texify: mocks.texify };
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M0 0"/></svg>';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workers.length = 0;
  mocks.load.mockResolvedValue(undefined);
  mocks.texify.mockResolvedValue(image);
  mocks.spawn.mockResolvedValue(workerApi);
  mocks.threadTerminate.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("renderTikz", () => {
  it("uses a same-origin worker without a blob wrapper and embeds the original source", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const result = await renderTikz(DEFAULT_SOURCE, controller.signal);
    expect(mocks.construct).toHaveBeenCalledWith(
      `http://localhost${TIKZJAX_PATH}/run-tex.js`,
      { CORSWorkaround: false }
    );
    expect(mocks.load).toHaveBeenCalledWith(`http://localhost${TIKZJAX_PATH}`);
    expect(mocks.texify).toHaveBeenCalledWith(
      expect.stringContaining("\\begin{document}"),
      { embedFonts: true, showConsole: true }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(extractSource(result.svg)).toBe(DEFAULT_SOURCE);
    }
    expect(mocks.threadTerminate).toHaveBeenCalledExactlyOnceWith(workerApi);
    expect(mocks.rawTerminate).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
    expect(mocks.threadTerminate).toHaveBeenCalledTimes(1);
  });

  it("does not create a worker for a pre-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await renderTikz("", controller.signal)).toMatchObject({
      ok: false,
      reason: "aborted",
    });
    expect(mocks.construct).not.toHaveBeenCalled();
    expect(mocks.threadTerminate).not.toHaveBeenCalled();
  });

  it("terminates the raw worker when cancellation precedes startup", async () => {
    let finishStartup: (value: typeof workerApi) => void = () => undefined;
    mocks.spawn.mockImplementationOnce(
      () =>
        new Promise<typeof workerApi>((resolve) => {
          finishStartup = resolve;
        })
    );
    const controller = new AbortController();
    const pending = renderTikz("", controller.signal);
    const removeListener = vi.spyOn(
      mocks.workers[0] ?? new EventTarget(),
      "removeEventListener"
    );
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: "aborted" });
    expect(mocks.rawTerminate).toHaveBeenCalledTimes(1);
    expect(mocks.threadTerminate).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function)
    );
    finishStartup(workerApi);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.rawTerminate).toHaveBeenCalledTimes(1);
  });

  it("includes startup in the timeout and terminates the raw worker", async () => {
    vi.useFakeTimers();
    mocks.spawn.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = renderTikz("");
    await vi.advanceTimersByTimeAsync(RENDER_TIMEOUT_MS);
    expect(await pending).toMatchObject({ ok: false, reason: "timeout" });
    expect(mocks.rawTerminate).toHaveBeenCalledTimes(1);
    expect(mocks.threadTerminate).not.toHaveBeenCalled();
  });

  it.each(["load", "compile"])(
    "terminates a worker stuck during %s",
    async (stage) => {
      vi.useFakeTimers();
      const operation = stage === "load" ? mocks.load : mocks.texify;
      operation.mockImplementationOnce(() => new Promise(() => undefined));
      const pending = renderTikz("\\def\\x{\\x}\\x");
      await vi.advanceTimersByTimeAsync(RENDER_TIMEOUT_MS);
      expect(await pending).toMatchObject({ ok: false, reason: "timeout" });
      expect(mocks.threadTerminate).toHaveBeenCalledTimes(1);
      expect(mocks.rawTerminate).not.toHaveBeenCalled();
    }
  );

  it("terminates an active compiler on cancellation", async () => {
    mocks.texify.mockImplementationOnce(() => new Promise(() => undefined));
    const controller = new AbortController();
    const pending = renderTikz(DEFAULT_SOURCE, controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: "aborted" });
    expect(mocks.threadTerminate).toHaveBeenCalledTimes(1);
  });

  it("classifies engine and compiler errors without losing diagnostics", async () => {
    mocks.load.mockRejectedValueOnce(new Error("Engine failed"));
    expect(await renderTikz("")).toMatchObject({
      ok: false,
      reason: "engine",
      error: "Engine failed",
    });
    mocks.texify.mockRejectedValueOnce(
      new Error("! Undefined control sequence.")
    );
    expect(await renderTikz("")).toMatchObject({
      ok: false,
      reason: "compile",
      error: "! Undefined control sequence.",
    });
    expect(mocks.threadTerminate).toHaveBeenCalledTimes(2);
  });

  it("classifies invalid image output and releases its worker", async () => {
    mocks.texify.mockResolvedValueOnce("<html/>");
    expect(await renderTikz("")).toMatchObject({
      ok: false,
      reason: "invalid-svg",
    });
    expect(mocks.threadTerminate).toHaveBeenCalledTimes(1);
  });

  it("rejects partial SVG output when TeX reports a missing package", async () => {
    const source =
      "\\documentclass{standalone}\n% original line 2\n\\usepackage{tikz-missing-acceptance}\n\\begin{document}\\begin{tikzpicture}\\draw(0,0)--(1,1);\\end{tikzpicture}\\end{document}";
    mocks.texify.mockImplementationOnce(async () => {
      const worker = mocks.workers[0];
      worker?.dispatchEvent(
        new MessageEvent("message", {
          data: '(TeXinputs:"tikz-missing-acceptance.sty") ("l3backend-dvips.def")',
        })
      );
      worker?.dispatchEvent(
        new MessageEvent("message", { data: "l.3 \\begin{document}" })
      );
      return image;
    });
    const result = await renderTikz(source);
    expect(result).toMatchObject({ ok: false, reason: "compile" });
    if (!result.ok) {
      expect(result.error).toContain(
        '(TeXinputs:"tikz-missing-acceptance.sty")'
      );
      expect(describeTexError(result.error, source)).toMatchObject({
        missingPackage: "tikz-missing-acceptance",
        line: 3,
      });
    }
    expect(mocks.threadTerminate).toHaveBeenCalledTimes(1);
  });

  it("keeps the first compiler error within a bounded diagnostic", async () => {
    mocks.texify.mockImplementationOnce(async () => {
      const worker = mocks.workers[0];
      worker?.dispatchEvent(
        new MessageEvent("message", { data: "! Undefined control sequence." })
      );
      worker?.dispatchEvent(
        new MessageEvent("message", { data: "l.7 \\notACommand" })
      );
      for (let index = 0; index < 100; index++) {
        worker?.dispatchEvent(
          new MessageEvent("message", { data: "x".repeat(4096) })
        );
      }
      return image;
    });
    const result = await renderTikz(DEFAULT_SOURCE);
    expect(result).toMatchObject({ ok: false, reason: "compile" });
    if (!result.ok) {
      expect(result.error).toMatch(
        /^! Undefined control sequence\.\nl\.7 \\notACommand/
      );
      expect(result.error.length).toBeLessThanOrEqual(16_384);
    }
  });

  it.each(["wrapped", "truncated-fallback", "truncated-request"])(
    "identifies the original missing package from a %s filename trace",
    async (kind) => {
      const name = `tikz-missing-${"x".repeat(
        kind === "truncated-fallback" ? 55 : 75
      )}`;
      const source = `\\usepackage{${name}}\n${DEFAULT_SOURCE}`;
      const logs =
        kind === "wrapped"
          ? [`(TeXinputs:"${name}.st`, 'y")']
          : kind === "truncated-fallback"
            ? [
                `(TeXinputs:"${name.slice(0, 60)}`,
                `${name.slice(60, 68)}.) ("l3backend-dvips.def") (TeXinputs:"input.aux")`,
              ]
            : [
                `("${name.slice(0, 76)}`,
                `${name.slice(76, 79)}) ("l3backend-dvips.def") (TeXinputs:"input.aux")`,
              ];
      mocks.texify.mockImplementationOnce(async () => {
        for (const line of logs) {
          mocks.workers[0]?.dispatchEvent(
            new MessageEvent("message", { data: line })
          );
        }
        return image;
      });

      const result = await renderTikz(source);
      expect(result).toMatchObject({ ok: false, reason: "compile" });
      if (!result.ok) {
        expect(describeTexError(result.error, source)).toMatchObject({
          missingPackage: name,
          line: 1,
        });
        expect(result.error).toContain(logs.join("\n"));
        expect(result.error.length).toBeLessThanOrEqual(16_384);
      }
    }
  );

  it("does not invent a package name when a truncated trace is ambiguous", async () => {
    const prefix = `tikz-missing-${"x".repeat(80)}`;
    const source = `\\usepackage{${prefix}a,${prefix}b}\n${DEFAULT_SOURCE}`;
    mocks.texify.mockImplementationOnce(async () => {
      mocks.workers[0]?.dispatchEvent(
        new MessageEvent("message", { data: `("${prefix.slice(0, 79)})` })
      );
      return image;
    });

    const result = await renderTikz(source);
    expect(result).toMatchObject({ ok: false, reason: "compile" });
    if (!result.ok) {
      expect(
        describeTexError(result.error, source).missingPackage
      ).toBeUndefined();
      expect(describeTexError(result.error, source).line).toBeUndefined();
    }
  });

  it("preserves the first diagnostic when the worker rejects without an image", async () => {
    mocks.texify.mockImplementationOnce(async () => {
      mocks.workers[0]?.dispatchEvent(
        new MessageEvent("message", { data: "! Undefined control sequence." })
      );
      mocks.workers[0]?.dispatchEvent(
        new MessageEvent("message", { data: "l.4 \\unknownCommand" })
      );
      throw new Error(`fail to generate dvi, log:\n${"x".repeat(100_000)}`);
    });
    const pending = renderTikz(DEFAULT_SOURCE);
    const removeListener = vi.spyOn(
      mocks.workers[0] ?? new EventTarget(),
      "removeEventListener"
    );

    expect(await pending).toEqual({
      ok: false,
      reason: "compile",
      error: "! Undefined control sequence.\nl.4 \\unknownCommand",
    });
    expect(removeListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function)
    );
    expect(mocks.threadTerminate).toHaveBeenCalledTimes(1);
  });

  it.each(["aborted", "timeout"])(
    "keeps %s classification and removes the listener after a compiler diagnostic",
    async (reason) => {
      vi.useFakeTimers();
      mocks.texify.mockImplementationOnce(() => {
        mocks.workers[0]?.dispatchEvent(
          new MessageEvent("message", {
            data: "! Undefined control sequence.",
          })
        );
        return new Promise(() => undefined);
      });
      const controller = new AbortController();
      const pending = renderTikz(DEFAULT_SOURCE, controller.signal);
      const removeListener = vi.spyOn(
        mocks.workers[0] ?? new EventTarget(),
        "removeEventListener"
      );
      await vi.advanceTimersByTimeAsync(0);

      if (reason === "aborted") {
        controller.abort();
      } else {
        await vi.advanceTimersByTimeAsync(RENDER_TIMEOUT_MS);
      }

      expect(await pending).toMatchObject({ ok: false, reason });
      expect(removeListener).toHaveBeenCalledWith(
        "message",
        expect.any(Function)
      );
      expect(mocks.threadTerminate).toHaveBeenCalledTimes(1);
      expect(mocks.rawTerminate).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("ignores protocol objects, loading diagnostics, and ordinary compilation warnings", async () => {
    mocks.load.mockImplementationOnce(async () => {
      mocks.workers[0]?.dispatchEvent(
        new MessageEvent("message", { data: "! loading notice" })
      );
    });
    mocks.texify.mockImplementationOnce(async () => {
      const worker = mocks.workers[0];
      worker?.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "result", payload: "! protocol payload" },
        })
      );
      worker?.dispatchEvent(
        new MessageEvent("message", {
          data: "LaTeX Warning: Label(s) may have changed.",
        })
      );
      worker?.dispatchEvent(
        new MessageEvent("message", {
          data: "Package pgfplots Warning: running in backwards compatibility mode.",
        })
      );
      worker?.dispatchEvent(
        new MessageEvent("message", {
          data: '("pgfplots.sty") (TeXinputs:"input.aux")',
        })
      );
      return image;
    });
    const pending = renderTikz(DEFAULT_SOURCE);
    const removeListener = vi.spyOn(
      mocks.workers[0] ?? new EventTarget(),
      "removeEventListener"
    );
    expect(await pending).toMatchObject({ ok: true });
    expect(removeListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function)
    );
  });

  it("classifies an empty document without TeX errors as missing SVG output", async () => {
    mocks.texify.mockImplementationOnce(async () => {
      mocks.workers[0]?.dispatchEvent(
        new MessageEvent("message", { data: "No pages of output." })
      );
      throw new Error("fail to generate dvi, log:\nNo pages of output.");
    });
    expect(await renderTikz("\\begin{document}\\end{document}")).toMatchObject({
      ok: false,
      reason: "invalid-svg",
    });
  });

  it("reports browser worker errors while startup is pending", async () => {
    mocks.spawn.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = renderTikz("");
    mocks.workers[0]?.dispatchEvent(
      new ErrorEvent("error", { message: "Worker script failed" })
    );
    expect(await pending).toMatchObject({
      ok: false,
      reason: "engine",
      error: "Worker script failed",
    });
    expect(mocks.rawTerminate).toHaveBeenCalledTimes(1);
  });
});
