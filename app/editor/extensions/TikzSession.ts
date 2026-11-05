import { action, makeObservable, observable, runInAction } from "mobx";
import type { Transaction } from "prosemirror-state";
import { ReplaceAroundStep } from "prosemirror-transform";
import { ImageSource } from "@shared/editor/lib/FileHelper";

/** The original text and its monotonically increasing local revision. */
export interface TikzSourceRevision {
  text: string;
  revision: number;
}

/** A successful preview tied to the exact revision that produced it. */
export interface TikzPreview extends TikzSourceRevision {
  svg: string;
}

/** A recoverable failure while loading or saving a diagram session. */
export type TikzSessionError = "source" | "metadata" | "save";

/** The source read from an existing diagram, or the reason it was unavailable. */
export type TikzSourceResult =
  | { ok: true; source: string }
  | { ok: false; reason: "source" | "metadata" };

/** Initial source or existing image location for an editing session. */
export interface TikzSessionOptions {
  source?: string;
  imageSrc?: string;
  imagePosition?: number;
}

/**
 * Owns one dialog's asynchronous source load and attachment save lifetime.
 * Closing or superseding the session invalidates every pending operation.
 */
export class TikzSession {
  readonly key = ++nextSessionKey;

  readonly imageSrc: string;

  @observable
  source: string | undefined = undefined;

  @observable
  error: TikzSessionError | undefined = undefined;

  @observable
  loading = false;

  @observable
  saving = false;

  /**
   * Creates a new editing lifetime.
   *
   * @param options - the initial source and image location.
   */
  constructor(options: TikzSessionOptions) {
    this.source = options.source;
    this.imageSrc = options.imageSrc ?? "";
    this.imagePosition = options.imagePosition;
    makeObservable(this);
  }

  /** Whether this session can still accept asynchronous results. */
  get isActive(): boolean {
    return !this.controller.signal.aborted;
  }

  /** The signal used when fetching this session's original SVG. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** The original image position after mapping through document changes. */
  get targetPosition(): number | undefined {
    return this.imagePosition;
  }

  /**
   * Loads source without allowing an obsolete response to update this session.
   *
   * @param loadSource - fetches and extracts source using the session signal.
   * @returns a promise that settles after the active result is recorded.
   */
  @action
  async load(
    loadSource: (signal: AbortSignal) => Promise<TikzSourceResult>
  ): Promise<void> {
    if (!this.isActive) {
      return;
    }

    this.loading = true;
    this.error = undefined;

    try {
      const result = await loadSource(this.signal);
      if (!this.isActive) {
        return;
      }

      runInAction(() => {
        if (result.ok) {
          this.source = result.source;
        } else {
          this.error = result.reason;
        }
      });
    } catch {
      if (this.isActive) {
        runInAction(() => {
          this.error = "source";
        });
      }
    } finally {
      if (this.isActive) {
        runInAction(() => {
          this.loading = false;
        });
      }
    }
  }

  /**
   * Saves a preview only while its upload attempt remains current.
   *
   * @param svg - the current SVG with its original source embedded.
   * @param save - uploads and commits while the supplied signal is active.
   * @returns whether the active attempt completed successfully.
   */
  @action
  async save(
    svg: string,
    save: (svg: string, signal: AbortSignal) => Promise<void>
  ): Promise<boolean> {
    if (
      !this.isActive ||
      this.source === undefined ||
      this.loading ||
      this.saving
    ) {
      return false;
    }

    const controller = new AbortController();
    this.saveController = controller;
    this.saving = true;
    this.error = undefined;

    try {
      await save(svg, controller.signal);
      return (
        this.isActive &&
        !controller.signal.aborted &&
        this.saveController === controller
      );
    } catch {
      if (this.isActive && this.saveController === controller) {
        runInAction(() => {
          this.error = "save";
        });
      }
      return false;
    } finally {
      if (this.saveController === controller) {
        runInAction(() => {
          this.saveController = undefined;
          this.saving = false;
        });
      }
    }
  }

  /**
   * Invalidates an upload when the user changes source or dismisses the dialog.
   */
  @action
  cancelPendingSave(): void {
    this.saveController?.abort();
    this.saveController = undefined;
    this.saving = false;
  }

  /** Clears an upload error after the user edits or produces a new preview. */
  @action
  clearSaveError(): void {
    if (this.error === "save") {
      this.error = undefined;
    }
  }

  /**
   * Tracks the selected image through edits without retargeting a duplicate URL.
   *
   * @param transaction - the document transaction applied by the editor.
   */
  mapImagePosition(transaction: Transaction): void {
    if (
      !this.imageSrc ||
      this.imagePosition === undefined ||
      !transaction.docChanged
    ) {
      return;
    }

    let position = this.imagePosition;
    for (const [index, step] of transaction.steps.entries()) {
      const original = transaction.docs[index].nodeAt(position);
      const mapped = step.getMap().mapResult(position, 1);
      const nextDoc = transaction.docs[index + 1] ?? transaction.doc;
      const node = nextDoc.nodeAt(mapped.pos);

      // setNodeMarkup replaces the image's boundary tokens while preserving its
      // content gap. That is an attribute change, not deletion of the edit target.
      const preservesImage =
        original?.type.name === "image" &&
        original.attrs.src === this.imageSrc &&
        original.attrs.source === ImageSource.Tikz &&
        step instanceof ReplaceAroundStep &&
        step.from === position &&
        step.to === position + original.nodeSize &&
        step.gapFrom === position + 1 &&
        step.gapTo === position + original.nodeSize - 1 &&
        step.insert === 1 &&
        step.slice.openStart === 0 &&
        step.slice.openEnd === 0 &&
        step.slice.content.childCount === 1 &&
        node?.type === original.type;
      if (
        (mapped.deleted && !preservesImage) ||
        node?.type.name !== "image" ||
        node.attrs.src !== this.imageSrc ||
        node.attrs.source !== ImageSource.Tikz
      ) {
        this.imagePosition = undefined;
        return;
      }

      position = mapped.pos;
    }

    this.imagePosition = position;
  }

  /** Invalidates this session and every pending source load or save. */
  @action
  close(): void {
    this.controller.abort();
    this.cancelPendingSave();
  }

  private controller = new AbortController();

  private saveController: AbortController | undefined;

  private imagePosition: number | undefined;
}

/**
 * Checks that a preview belongs to this edit revision, including undo to old text.
 *
 * @param source - the current original source and local revision.
 * @param preview - the last successful preview.
 * @returns whether the preview matches the exact current revision.
 */
export function isCurrentTikzPreview(
  source: TikzSourceRevision | undefined,
  preview: TikzPreview | undefined
): boolean {
  return (
    source !== undefined &&
    preview !== undefined &&
    source.revision === preview.revision &&
    source.text === preview.text
  );
}

let nextSessionKey = 0;
