import { action, makeObservable, observable } from "mobx";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { ReplaceAroundStep, ReplaceStep } from "prosemirror-transform";
import { ySyncPluginKey } from "y-prosemirror";
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

/** The mapped location and current source of the opened drawing. */
export interface DrawingTarget {
  position: number | undefined;
  src: string | undefined;
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

  /** The current target state for pure transaction mapping. */
  get target(): DrawingTarget {
    return { position: this.imagePosition, src: this.currentSrc };
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
   * Computes the target after one transaction without changing this session.
   *
   * @param transaction - the applied editor transaction.
   * @param target - the target before the transaction.
   * @returns the mapped target.
   */
  map(transaction: Transaction, target: DrawingTarget): DrawingTarget {
    if (
      !transaction.docChanged ||
      !this.active ||
      target.position === undefined
    ) {
      return target;
    }

    let { position, src } = target;
    for (const [index, step] of transaction.steps.entries()) {
      const before = transaction.docs[index];
      const original = before.nodeAt(position);
      const nextDoc = transaction.docs[index + 1] ?? transaction.doc;
      const result = step.getMap().mapResult(position, 1);
      let mappedPosition = result.pos;
      let deleted = result.deleted;
      let remoteAttrUpdate = false;

      if (
        transaction.getMeta(ySyncPluginKey) &&
        step instanceof ReplaceStep &&
        step.from === 0 &&
        step.to === before.content.size &&
        step.slice.openStart === 0 &&
        step.slice.openEnd === 0
      ) {
        const start = before.content.findDiffStart(nextDoc.content);
        const end = before.content.findDiffEnd(nextDoc.content);
        if (start === null || end === null) {
          mappedPosition = position;
          deleted = false;
        } else if (position < start) {
          mappedPosition = position;
          deleted = false;
        } else if (position >= end.a) {
          mappedPosition = position + end.b - end.a;
          deleted = false;
        } else {
          mappedPosition = start;
          deleted = true;
          const remoteNext = nextDoc.nodeAt(mappedPosition);
          remoteAttrUpdate =
            original?.type.name === "image" &&
            start === position &&
            end.a === position + original.nodeSize &&
            end.b === mappedPosition + original.nodeSize &&
            !!remoteNext &&
            sameImageExceptSrc(original, remoteNext);
          if (!remoteAttrUpdate && original?.type.name === "image") {
            const samePathPosition = mapSamePath(before, nextDoc, position);
            if (samePathPosition !== undefined) {
              const samePathNode = nextDoc.nodeAt(samePathPosition);
              if (samePathNode && sameImageExceptSrc(original, samePathNode)) {
                mappedPosition = samePathPosition;
                remoteAttrUpdate = true;
              }
            }
            if (!remoteAttrUpdate) {
              const matchingPosition =
                mapUniqueImageBlock(before, nextDoc, position, false) ??
                mapUniqueImageBlock(before, nextDoc, position, true);
              if (matchingPosition !== undefined) {
                mappedPosition = matchingPosition;
                remoteAttrUpdate = true;
              }
            }
          }
        }
      }

      const next = nextDoc.nodeAt(mappedPosition);
      const attrUpdate =
        original?.type.name === "image" &&
        original.attrs.src === src &&
        original.attrs.source === ImageSource.Excalidraw &&
        (remoteAttrUpdate ||
          (step instanceof ReplaceAroundStep &&
            step.from === position &&
            step.to === position + original.nodeSize &&
            step.gapFrom === position + 1 &&
            step.gapTo === position + original.nodeSize - 1 &&
            step.insert === 1 &&
            step.slice.openStart === 0 &&
            step.slice.openEnd === 0 &&
            step.slice.content.childCount === 1 &&
            next?.type === original.type));
      if (
        (deleted && !attrUpdate) ||
        next?.type.name !== "image" ||
        next.attrs.source !== ImageSource.Excalidraw
      ) {
        return { position: undefined, src };
      }
      position = mappedPosition;
      src = next.attrs.src;
    }

    return { position, src };
  }

  /** Applies a mapped target after the editor view accepted the transaction. */
  @action
  setTarget(target: DrawingTarget): void {
    this.imagePosition = target.position;
    this.currentSrc = target.src;
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

function mapSamePath(
  before: ProsemirrorNode,
  after: ProsemirrorNode,
  position: number
): number | undefined {
  const resolved = before.resolve(position);
  let previousParent = before;
  let currentParent = after;
  let mappedPosition = 0;

  for (let depth = 0; depth <= resolved.depth; depth++) {
    const index = resolved.index(depth);
    if (
      previousParent.type !== currentParent.type ||
      previousParent.childCount !== currentParent.childCount ||
      index >= currentParent.childCount
    ) {
      return undefined;
    }
    for (let sibling = 0; sibling < index; sibling++) {
      mappedPosition += currentParent.child(sibling).nodeSize;
    }
    if (depth < resolved.depth) {
      previousParent = previousParent.child(index);
      currentParent = currentParent.child(index);
      mappedPosition += 1;
    }
  }

  return mappedPosition;
}

function mapUniqueImageBlock(
  before: ProsemirrorNode,
  after: ProsemirrorNode,
  position: number,
  allowSourceChange: boolean
): number | undefined {
  const resolved = before.resolve(position);
  const block = before.child(resolved.index(0));
  const matches = (candidate: ProsemirrorNode) => {
    if (block.eq(candidate)) {
      return true;
    }
    if (
      !allowSourceChange ||
      resolved.depth !== 1 ||
      !block.sameMarkup(candidate) ||
      block.childCount !== 1 ||
      candidate.childCount !== 1
    ) {
      return false;
    }
    const originalImage = block.firstChild;
    const candidateImage = candidate.firstChild;
    return (
      !!originalImage &&
      !!candidateImage &&
      sameImageExceptSrc(originalImage, candidateImage)
    );
  };
  let matchesBefore = 0;
  before.forEach((candidate) => {
    if (matches(candidate)) {
      matchesBefore++;
    }
  });
  if (matchesBefore !== 1) {
    return undefined;
  }

  const offset = position - (resolved.depth ? resolved.before(1) : position);
  let matchesAfter = 0;
  let mappedPosition: number | undefined;
  after.forEach((candidate, blockPosition) => {
    if (matches(candidate)) {
      matchesAfter++;
      mappedPosition = blockPosition + offset;
    }
  });
  return matchesAfter === 1 ? mappedPosition : undefined;
}

function sameImageExceptSrc(
  original: ProsemirrorNode,
  candidate: ProsemirrorNode
): boolean {
  return (
    original.type.name === "image" &&
    candidate.type === original.type &&
    original.eq(
      candidate.type.create(
        { ...candidate.attrs, src: original.attrs.src },
        candidate.content,
        candidate.marks
      )
    )
  );
}
