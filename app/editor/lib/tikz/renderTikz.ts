import { spawn, Thread, Worker } from "threads";
import type { ModuleThread } from "threads";
import { RENDER_TIMEOUT_MS, TIKZJAX_PATH } from "./constants";
import { prepareSource } from "./prepareSource";
import { embedSource } from "./svg";

/** Rendering stages used to select stable, localized UI messages. */
export type RenderFailureReason =
  | "compile"
  | "timeout"
  | "engine"
  | "invalid-svg"
  | "aborted";

/** Result of one isolated compilation. */
export type RenderResult = RenderSuccess | RenderFailure;

/** Successful rendering containing a self-contained image and original source. */
export interface RenderSuccess {
  ok: true;
  svg: string;
}

/** Failed rendering containing diagnostics for the corresponding UI message. */
export interface RenderFailure {
  ok: false;
  error: string;
  reason: RenderFailureReason;
}

/**
 * Compiles source in a fresh, same-origin worker and releases it on every path.
 * Startup and engine loading are included in the compilation timeout.
 *
 * @param source the user's original source to compile and embed.
 * @param signal an optional signal that cancels compilation immediately.
 * @returns a self-contained SVG or a categorized rendering diagnostic.
 */
export async function renderTikz(
  source: string,
  signal?: AbortSignal
): Promise<RenderResult> {
  if (signal?.aborted) {
    return { ok: false, reason: "aborted", error: "Render aborted" };
  }

  let rawWorker: InstanceType<typeof Worker> | undefined;
  let thread: ModuleThread<TexWorker> | undefined;
  let released = false;
  let stage: RenderFailureReason = "engine";
  let diagnostic: string | undefined;
  let fileTrace = "";
  let declaredPackages: string[] = [];
  let noPages = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectInterruption: (reason: RenderInterruption) => void = () =>
    undefined;

  const interruption = new Promise<never>((_resolve, reject) => {
    rejectInterruption = reject;
  });
  const handleAbort = () =>
    rejectInterruption(new RenderInterruption("aborted", "Render aborted"));
  const handleWorkerError = (event: Event) =>
    rejectInterruption(
      new RenderInterruption(
        stage,
        event instanceof ErrorEvent ? event.message : "Rendering worker failed"
      )
    );
  const handleWorkerMessage = (event: Event) => {
    if (
      stage !== "compile" ||
      !(event instanceof MessageEvent) ||
      typeof event.data !== "string"
    ) {
      return;
    }
    const line = event.data;
    if (diagnostic === undefined) {
      fileTrace = `${fileTrace}\n${line}`.slice(-MAX_FILE_TRACE_LENGTH);
      const compactTrace = fileTrace.replace(/[\r\n]/g, "");
      let unavailablePackage: string | undefined;
      let ambiguousPackage = false;
      for (const match of compactTrace.matchAll(
        /\((TeXinputs:)?"([^"()]+)("?)\)/g
      )) {
        const filename = match[2];
        if (match[1] && filename.endsWith(".sty")) {
          unavailablePackage = filename;
          break;
        }
        if (match[3]) {
          continue;
        }
        const candidates = declaredPackages.filter((name) =>
          `${name}.sty`.startsWith(filename)
        );
        if (candidates.length === 1) {
          unavailablePackage = `${candidates[0]}.sty`;
          break;
        }
        if (candidates.length > 1) {
          ambiguousPackage = true;
          break;
        }
      }

      // The pinned engine can turn missing files into empty input. It also
      // truncates long filename traces, sometimes losing the TeXinputs prefix.
      // Only a unique original declaration supplies the untruncated package.
      if (unavailablePackage || ambiguousPackage) {
        const summary = unavailablePackage
          ? `File \`${unavailablePackage}' not found.`
          : "! The rendering engine truncated an ambiguous package filename.";
        diagnostic = `${summary}\n${fileTrace}`.slice(0, MAX_DIAGNOSTIC_LENGTH);
      } else if (/^\s*!\s/.test(line)) {
        diagnostic = line.slice(0, MAX_DIAGNOSTIC_LENGTH);
      }
    } else if (
      diagnostic !== undefined &&
      diagnostic.length < MAX_DIAGNOSTIC_LENGTH
    ) {
      diagnostic += `\n${line}`.slice(
        0,
        MAX_DIAGNOSTIC_LENGTH - diagnostic.length
      );
    }
    if (/^\s*\(?No pages of output\.\)?\s*$/.test(line)) {
      noPages = true;
    }
  };
  const release = async () => {
    if (released) {
      return;
    }
    released = true;
    if (thread) {
      await Thread.terminate(thread);
    } else if (rawWorker) {
      await rawWorker.terminate();
    }
  };

  try {
    timer = setTimeout(() => {
      rejectInterruption(
        new RenderInterruption("timeout", "Rendering exceeded its time limit")
      );
    }, RENDER_TIMEOUT_MS);
    signal?.addEventListener("abort", handleAbort, { once: true });
    const root = new URL(TIKZJAX_PATH, window.location.origin).href;

    // threads otherwise creates a blob wrapper for absolute URLs, which would
    // require broader worker-src permissions than this same-origin worker needs.
    rawWorker = new Worker(`${root}/run-tex.js`, { CORSWorkaround: false });
    rawWorker.addEventListener("error", handleWorkerError);
    rawWorker.addEventListener("message", handleWorkerMessage);
    const worker = rawWorker;
    const run = async () => {
      const spawned = await spawn<TexWorker>(worker, {
        timeout: RENDER_TIMEOUT_MS,
      });
      if (released) {
        throw new RenderInterruption("aborted", "Render aborted");
      }
      thread = spawned;
      await spawned.load(root);
      if (released) {
        throw new RenderInterruption("aborted", "Render aborted");
      }
      const prepared = prepareSource(source);
      declaredPackages = prepared.info.packages;
      stage = "compile";
      return spawned.texify(prepared.tex, {
        embedFonts: true,
        showConsole: true,
      });
    };

    const svg = await Promise.race([run(), interruption]);
    if (diagnostic !== undefined) {
      return { ok: false, reason: "compile", error: diagnostic };
    }
    stage = "invalid-svg";
    return { ok: true, svg: embedSource(svg, source) };
  } catch (error) {
    if (!(error instanceof RenderInterruption) && diagnostic !== undefined) {
      return { ok: false, reason: "compile", error: diagnostic };
    }
    return {
      ok: false,
      reason:
        error instanceof RenderInterruption
          ? error.reason
          : noPages
            ? "invalid-svg"
            : stage,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", handleAbort);
    rawWorker?.removeEventListener("error", handleWorkerError);
    rawWorker?.removeEventListener("message", handleWorkerMessage);

    // Cleanup failure must not replace an actionable compiler diagnostic.
    try {
      await release();
    } catch {
      // The browser may already have torn down the worker during navigation.
    }
  }
}

// threads requires an object type with an implicit method index signature.
type TexWorker = {
  load(root: string): Promise<void>;
  texify(
    source: string,
    options: { embedFonts: boolean; showConsole: boolean }
  ): Promise<string>;
};

const MAX_DIAGNOSTIC_LENGTH = 16_384;
const MAX_FILE_TRACE_LENGTH = 1_024;

class RenderInterruption extends Error {
  reason: RenderFailureReason;

  constructor(reason: RenderFailureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}
