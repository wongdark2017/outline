import { action, makeObservable, observable } from "mobx";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { ReplaceAroundStep } from "prosemirror-transform";
import { ImageSource } from "@shared/editor/lib/FileHelper";

/** The entry from which a drawing editor was opened. */
export type DrawingEntry = "slash" | "toolbar" | "double_click" | "enter";

/** The outcome of checking the exact original image before a save. */
export type DrawingConflict = "none" | "modified" | "missing";

/** Location and identity for one drawing editor session. */
export interface ExcalidrawSessionOptions {
  entry: DrawingEntry;
  documentId?: string;
  imageSrc: string;
  imagePosition: number;
}

/**
 * Tracks one exact drawing image, including an empty placeholder, through edits.
 */
export class ExcalidrawSession {
  readonly key = ++nextSessionKey;

  readonly entry: DrawingEntry;

  readonly documentId: string | undefined;

  readonly imageSrc: string;

  @observable
  active = true;

  /**
   * Creates a session tied to the editor state at the time it opened.
   *
   * @param options - the original image position and source.
   */
  constructor(options: ExcalidrawSessionOptions) {
    this.entry = options.entry;
    this.documentId = options.documentId;
    this.imageSrc = options.imageSrc;
    this.currentSrc = options.imageSrc;
    this.imagePosition = options.imagePosition;
    makeObservable(this);
  }

  /** The currently mapped position of the original image. */
  get targetPosition(): number | undefined {
    return this.imagePosition;
  }

  /**
   * Checks whether the exact original image still carries its opening scene.
   *
   * @param doc - the current editor document.
   * @returns none, modified, or missing.
   */
  conflict(doc: ProsemirrorNode): DrawingConflict {
    const node =
      this.imagePosition === undefined
        ? undefined
        : doc.nodeAt(this.imagePosition);
    if (
      !node ||
      node.type.name !== "image" ||
      node.attrs.source !== ImageSource.Excalidraw
    ) {
      return "missing";
    }
    if (node.attrs.src !== this.imageSrc) {
      return "modified";
    }
    return "none";
  }

  /**
   * Maps the target through one ProseMirror transaction without retargeting.
   *
   * @param transaction - the applied editor transaction.
   */
  @action
  map(transaction: Transaction): void {
    if (!transaction.docChanged || !this.active) {
      return;
    }

    if (this.imagePosition !== undefined) {
      let position = this.imagePosition;
      for (const [index, step] of transaction.steps.entries()) {
        const original = transaction.docs[index].nodeAt(position);
        const result = step.getMap().mapResult(position, 1);
        const nextDoc = transaction.docs[index + 1] ?? transaction.doc;
        const next = nextDoc.nodeAt(result.pos);
        const attrUpdate =
          original?.type.name === "image" &&
          original.attrs.src === this.currentSrc &&
          original.attrs.source === ImageSource.Excalidraw &&
          step instanceof ReplaceAroundStep &&
          step.from === position &&
          step.to === position + original.nodeSize &&
          step.gapFrom === position + 1 &&
          step.gapTo === position + original.nodeSize - 1 &&
          step.insert === 1 &&
          step.slice.openStart === 0 &&
          step.slice.openEnd === 0 &&
          step.slice.content.childCount === 1 &&
          next?.type === original.type;
        if (
          (result.deleted && !attrUpdate) ||
          next?.type.name !== "image" ||
          next.attrs.source !== ImageSource.Excalidraw
        ) {
          this.imagePosition = undefined;
          break;
        }
        position = result.pos;
        this.imagePosition = position;
        this.currentSrc = next.attrs.src;
      }
    }
  }

  /** Invalidates pending loads and saves when the dialog closes. */
  @action
  close(): void {
    this.active = false;
    this.controller.abort();
  }

  /** The abort signal for reads bound to this session. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  private imagePosition: number | undefined;

  private currentSrc: string | undefined;

  private controller = new AbortController();
}

let nextSessionKey = 0;
