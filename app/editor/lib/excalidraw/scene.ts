import type { Excalidraw } from "@excalidraw/excalidraw";
import type { ComponentProps } from "react";

type DrawingChange = NonNullable<ComponentProps<typeof Excalidraw>["onChange"]>;

/** A scene snapshot sufficient to restore editable Excalidraw content. */
export interface DrawingScene {
  elements: Parameters<DrawingChange>[0];
  appState: { viewBackgroundColor?: string };
  files: Parameters<DrawingChange>[2];
}

interface StoredDraft {
  version: 1;
  savedAt: number;
  fingerprint: string;
  scene: DrawingScene;
}

/** Outcome of attempting to save a local drawing draft. */
export type DraftWriteResult = "saved" | "quota" | "unavailable";

/** State carried between autosave attempts for one editing session. */
export interface DrawingAutosaveState {
  pendingCandidate: boolean;
  savedFingerprint?: string;
}

/** Outcome of one autosave attempt. */
export interface DrawingAutosaveResult {
  result: DraftWriteResult | "skipped";
  savedFingerprint?: string;
}

const DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DRAFT_PREFIX = "excalidraw-draft:";

/**
 * Fingerprints the exact live elements and embedded files of a drawing.
 *
 * @param scene - the current drawing scene.
 * @returns a stable fingerprint that distinguishes replacement elements.
 */
export function drawingFingerprint(scene: DrawingScene): string {
  return JSON.stringify({
    elements: scene.elements
      .filter((element) => !element.isDeleted)
      .map((element) => [element.id, element.version, element.versionNonce]),
    files: Object.keys(scene.files).sort(),
    background: scene.appState.viewBackgroundColor,
  });
}

/**
 * Returns whether a scene has visible elements that can be saved.
 *
 * @param scene - the current drawing scene.
 * @returns true when at least one live element exists.
 */
export function hasDrawingContent(scene: DrawingScene): boolean {
  return scene.elements.some((element) => !element.isDeleted);
}

/**
 * Builds the local draft key for one saved drawing.
 *
 * @param documentId - the document containing the drawing.
 * @param src - the saved image URL.
 * @returns the local storage key.
 */
export function drawingDraftKey(documentId: string, src: string): string {
  return `${DRAFT_PREFIX}${documentId}:${src}`;
}

/** Removes all locally stored drawing drafts when the user signs out. */
export function clearDrawingDrafts(): void {
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(DRAFT_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Browsers can deny storage access; signing out must still continue.
  }
}

/**
 * Reads a recent local draft, removing stale or invalid data.
 *
 * @param key - the local storage key for a saved drawing.
 * @param baseline - the fingerprint of the saved drawing.
 * @returns the candidate draft, if it is newer than the saved scene.
 */
export function readDrawingDraft(
  key: string,
  baseline: string
): DrawingScene | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return undefined;
    }
    const draft: StoredDraft = JSON.parse(raw);
    if (
      draft.version !== 1 ||
      Date.now() - draft.savedAt > DRAFT_AGE_MS ||
      !draft.scene ||
      !Array.isArray(draft.scene.elements) ||
      !draft.scene.files ||
      draft.fingerprint === baseline
    ) {
      localStorage.removeItem(key);
      return undefined;
    }
    return draft.scene;
  } catch {
    removeDrawingDraft(key);
    return undefined;
  }
}

/**
 * Persists a changed scene for a previously saved drawing.
 *
 * @param key - the local storage key for a saved drawing.
 * @param scene - the current scene.
 * @param baseline - the fingerprint of the saved drawing.
 * @returns the storage result, distinguishing quota exhaustion.
 */
export function writeDrawingDraft(
  key: string,
  scene: DrawingScene,
  baseline: string
): DraftWriteResult {
  const fingerprint = drawingFingerprint(scene);
  if (fingerprint === baseline) {
    removeDrawingDraft(key);
    return "saved";
  }
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, savedAt: Date.now(), fingerprint, scene })
    );
    return "saved";
  } catch (error) {
    return error instanceof DOMException && error.name === "QuotaExceededError"
      ? "quota"
      : "unavailable";
  }
}

/**
 * Saves only changed scenes without deleting an unresolved restore candidate.
 *
 * @param key - the draft key for an existing drawing.
 * @param scene - the current scene.
 * @param baseline - the saved scene fingerprint.
 * @param state - candidate and prior autosave state.
 * @returns the write result and fingerprint for the next attempt.
 */
export function autosaveDrawingDraft(
  key: string,
  scene: DrawingScene,
  baseline: string,
  state: DrawingAutosaveState
): DrawingAutosaveResult {
  if (state.pendingCandidate) {
    return { result: "skipped", savedFingerprint: state.savedFingerprint };
  }
  const fingerprint = drawingFingerprint(scene);
  if (fingerprint === baseline) {
    if (state.savedFingerprint) {
      removeDrawingDraft(key);
    }
    return { result: "skipped" };
  }
  const result = writeDrawingDraft(key, scene, baseline);
  return {
    result,
    savedFingerprint: result === "saved" ? fingerprint : state.savedFingerprint,
  };
}

/**
 * Removes a successfully saved or discarded candidate draft.
 *
 * @param key - the local storage key for a saved drawing.
 */
export function removeDrawingDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Browsers can deny storage access; the drawing remains usable.
  }
}
