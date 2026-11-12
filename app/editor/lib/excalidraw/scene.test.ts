import type { DrawingScene } from "./scene";
import {
  autosaveDrawingDraft,
  clearDrawingDrafts,
  drawingDraftKey,
  drawingFingerprint,
  hasDrawingContent,
  readDrawingDraft,
  removeDrawingDraft,
  writeDrawingDraft,
} from "./scene";

function scene(id: string, version = 1): DrawingScene {
  const parsed: DrawingScene = JSON.parse(
    JSON.stringify({
      elements: [{ id, version, versionNonce: 1, isDeleted: false }],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    })
  );
  return parsed;
}

describe("Excalidraw local drafts", () => {
  beforeEach(() => {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key) {
        localStorage.removeItem(key);
      }
    }
  });

  it("distinguishes deleted and replacement elements with equal versions", () => {
    expect(drawingFingerprint(scene("old", 1))).not.toBe(
      drawingFingerprint(scene("new", 1))
    );
    expect(hasDrawingContent(scene("new"))).toBe(true);
  });

  it("restores a recent changed draft and removes it after a save", () => {
    const key = drawingDraftKey("doc", "/drawing.svg");
    const original = scene("old");
    const edited = scene("new");
    expect(writeDrawingDraft(key, edited, drawingFingerprint(original))).toBe(
      "saved"
    );
    expect(readDrawingDraft(key, drawingFingerprint(original))).toEqual(edited);
    removeDrawingDraft(key);
    expect(readDrawingDraft(key, drawingFingerprint(original))).toBeUndefined();
  });

  it("clears drawing drafts on sign-out while preserving the library", () => {
    const first = drawingDraftKey("first", "/one.svg");
    const second = drawingDraftKey("second", "/two.svg");
    localStorage.setItem(first, "first draft");
    localStorage.setItem(second, "second draft");
    localStorage.setItem("excalidraw-library", "saved library");

    clearDrawingDrafts();

    expect(localStorage.getItem(first)).toBeNull();
    expect(localStorage.getItem(second)).toBeNull();
    expect(localStorage.getItem("excalidraw-library")).toBe("saved library");
  });

  it("expires drafts older than seven days", () => {
    const key = drawingDraftKey("doc", "/drawing.svg");
    const baseline = drawingFingerprint(scene("old"));
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      expect(writeDrawingDraft(key, scene("new"), baseline)).toBe("saved");
      vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 + 1);
      expect(readDrawingDraft(key, baseline)).toBeUndefined();
      expect(localStorage.getItem(key)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes malformed stored drafts", () => {
    const key = drawingDraftKey("doc", "/drawing.svg");
    localStorage.setItem(key, "{invalid-json");
    expect(
      readDrawingDraft(key, drawingFingerprint(scene("old")))
    ).toBeUndefined();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("reports quota failure without discarding the last successful draft", () => {
    const key = drawingDraftKey("doc", "/drawing.svg");
    const baseline = drawingFingerprint(scene("old"));
    expect(writeDrawingDraft(key, scene("first"), baseline)).toBe("saved");
    const saved = localStorage.getItem(key);
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    try {
      expect(writeDrawingDraft(key, scene("second"), baseline)).toBe("quota");
      expect(localStorage.getItem(key)).toBe(saved);
    } finally {
      spy.mockRestore();
    }
  });

  it("removes an obsolete draft when changes are undone", () => {
    const key = drawingDraftKey("doc", "/drawing.svg");
    const original = scene("old");
    const baseline = drawingFingerprint(original);
    expect(writeDrawingDraft(key, scene("new"), baseline)).toBe("saved");
    expect(writeDrawingDraft(key, original, baseline)).toBe("saved");
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("preserves an unresolved restore candidate on timer and pagehide attempts", () => {
    const key = drawingDraftKey("doc", "/drawing.svg");
    const original = scene("old");
    const baseline = drawingFingerprint(original);
    const candidate = scene("candidate");
    expect(writeDrawingDraft(key, candidate, baseline)).toBe("saved");
    const stored = localStorage.getItem(key);
    expect(
      autosaveDrawingDraft(key, original, baseline, {
        pendingCandidate: true,
      }).result
    ).toBe("skipped");
    expect(
      autosaveDrawingDraft(key, scene("new"), baseline, {
        pendingCandidate: true,
      }).result
    ).toBe("skipped");
    expect(localStorage.getItem(key)).toBe(stored);
    expect(
      autosaveDrawingDraft(key, scene("new"), baseline, {
        pendingCandidate: false,
      }).result
    ).toBe("saved");
    expect(readDrawingDraft(key, baseline)).toEqual(scene("new"));
  });
});
