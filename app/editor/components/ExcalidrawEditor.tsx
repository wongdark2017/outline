import * as Dialog from "@radix-ui/react-dialog";
import "@excalidraw/excalidraw/index.css";
import {
  Excalidraw,
  MainMenu,
  exportToSvg,
  getNonDeletedElements,
  languages,
  loadFromBlob,
} from "@excalidraw/excalidraw";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styled, { useTheme } from "styled-components";
import { s } from "@shared/styles";
import { cdnPath } from "@shared/utils/urls";
import Button from "~/components/Button";
import env from "~/env";
import Analytics from "~/utils/Analytics";
import type {
  DrawingSaveChoice,
  DrawingSaveResult,
} from "../extensions/Excalidraw";
import type {
  DrawingConflict,
  ExcalidrawSession,
} from "../extensions/ExcalidrawSession";
import {
  autosaveDrawingDraft,
  drawingDraftKey,
  drawingFingerprint,
  hasDrawingContent,
  readDrawingDraft,
  removeDrawingDraft,
  type DrawingScene,
} from "../lib/excalidraw/scene";

Object.assign(window, {
  EXCALIDRAW_ASSET_PATH: cdnPath("/static/excalidraw/"),
});

type DrawingApi = Parameters<
  NonNullable<ComponentProps<typeof Excalidraw>["excalidrawAPI"]>
>[0];
type LibraryItems = Parameters<
  NonNullable<ComponentProps<typeof Excalidraw>["onLibraryChange"]>
>[0];

/** Properties for one full-window drawing editor. */
export interface ExcalidrawEditorProps {
  session: ExcalidrawSession;
  onSave: (
    svg: string,
    choice: DrawingSaveChoice
  ) => Promise<DrawingSaveResult>;
  onClose: () => void;
  getConflict: () => DrawingConflict;
}

/**
 * Loads, edits, drafts, and saves one Excalidraw scene in the current window.
 *
 * @param props - the active drawing session and editor callbacks.
 * @returns the drawing dialog.
 */
export function ExcalidrawEditor({
  session,
  onSave,
  onClose,
  getConflict,
}: ExcalidrawEditorProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const apiRef = useRef<DrawingApi | null>(null);
  const sceneRef = useRef<DrawingScene | undefined>(undefined);
  const baselineRef = useRef<string | undefined>(undefined);
  const draftFingerprintRef = useRef<string | undefined>(undefined);
  const readyTrackedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const conflictRef = useRef<DrawingConflict | undefined>(undefined);
  const draftRestoredRef = useRef(false);
  const [loadedScene, setLoadedScene] = useState<DrawingScene>();
  const [candidateDraft, setCandidateDraft] = useState<DrawingScene>();
  const [loading, setLoading] = useState(!!session.imageSrc);
  const [loadError, setLoadError] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number>();
  const [draftTooLarge, setDraftTooLarge] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [conflict, setConflict] = useState<DrawingConflict>();
  const [error, setError] = useState<string>();
  const mode = session.imageSrc ? "edit" : "new";
  const draftKey =
    session.imageSrc && session.documentId
      ? drawingDraftKey(session.documentId, session.imageSrc)
      : undefined;
  const canSave =
    ready && !loading && !loadError && !saving && !candidateDraft && hasContent;
  const language = languages.some((item) => item.code === i18n.language)
    ? i18n.language
    : "en";

  useEffect(() => {
    const imageSrc = session.imageSrc;
    if (!imageSrc) {
      return;
    }
    const load = async () => {
      try {
        const response = await fetch(imageSrc, {
          cache: "no-store",
          signal: session.signal,
        });
        if (!response.ok) {
          throw new Error("Drawing source unavailable");
        }
        const blob = await response.blob();
        const restored = await loadFromBlob(blob, null, null);
        if (!restored.elements.length || session.signal.aborted) {
          throw new Error("Drawing scene unavailable");
        }
        const scene: DrawingScene = {
          elements: restored.elements,
          appState: restored.appState,
          files: restored.files,
        };
        const baseline = drawingFingerprint(scene);
        baselineRef.current = baseline;
        sceneRef.current = scene;
        setLoadedScene(scene);
        setHasContent(hasDrawingContent(scene));
        if (draftKey) {
          setCandidateDraft(readDrawingDraft(draftKey, baseline));
        }
      } catch {
        if (!session.signal.aborted) {
          setLoadError(true);
        }
      } finally {
        if (!session.signal.aborted) {
          setLoading(false);
        }
      }
    };
    void load();
  }, [session, draftKey]);

  const handleApi = useCallback(
    (api: DrawingApi) => {
      apiRef.current = api;
      setReady(true);
      if (!readyTrackedRef.current) {
        readyTrackedRef.current = true;
        Analytics.track("excalidraw", "ready", { mode });
      }
    },
    [mode]
  );

  const handleChange = useCallback(
    (
      elements: DrawingScene["elements"],
      appState: Parameters<
        NonNullable<ComponentProps<typeof Excalidraw>["onChange"]>
      >[1],
      files: DrawingScene["files"]
    ) => {
      const scene: DrawingScene = {
        elements,
        appState: { viewBackgroundColor: appState.viewBackgroundColor },
        files,
      };
      sceneRef.current = scene;
      const fingerprint = drawingFingerprint(scene);
      setHasContent(hasDrawingContent(scene));
      setDirty(
        fingerprint !==
          (baselineRef.current ??
            drawingFingerprint({
              elements: [],
              appState: { viewBackgroundColor: appState.viewBackgroundColor },
              files: {},
            }))
      );
      if (fingerprint !== draftFingerprintRef.current) {
        setDraftSavedAt(undefined);
      }
      setError(undefined);
    },
    []
  );

  const saveDraft = useCallback(() => {
    const scene = sceneRef.current;
    const baseline = baselineRef.current;
    if (!draftKey || !scene || !baseline) {
      return;
    }
    const { result, savedFingerprint } = autosaveDrawingDraft(
      draftKey,
      scene,
      baseline,
      {
        pendingCandidate: !!candidateDraft,
        savedFingerprint: draftFingerprintRef.current,
      }
    );
    draftFingerprintRef.current = savedFingerprint;
    setDraftTooLarge(result === "quota");
    if (result === "saved") {
      setDraftSavedAt(Date.now());
    } else if (!savedFingerprint) {
      setDraftSavedAt(undefined);
    }
  }, [draftKey, candidateDraft]);

  useEffect(() => {
    if (!draftKey) {
      return;
    }
    const timer = window.setInterval(saveDraft, 30_000);
    window.addEventListener("pagehide", saveDraft);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", saveDraft);
    };
  }, [draftKey, saveDraft]);

  const handleRestoreDraft = useCallback(() => {
    if (!candidateDraft || !apiRef.current || draftRestoredRef.current) {
      return;
    }
    draftRestoredRef.current = true;
    apiRef.current.addFiles(Object.values(candidateDraft.files));
    apiRef.current.updateScene({
      elements: candidateDraft.elements,
      appState: {
        viewBackgroundColor:
          candidateDraft.appState.viewBackgroundColor ?? "#ffffff",
      },
    });
    sceneRef.current = candidateDraft;
    setDirty(true);
    setCandidateDraft(undefined);
    Analytics.track("excalidraw", "draft_restore", { mode: "edit" });
  }, [candidateDraft]);

  const handleDiscardDraft = useCallback(() => {
    if (draftKey) {
      removeDrawingDraft(draftKey);
    }
    setCandidateDraft(undefined);
  }, [draftKey]);

  const handleExit = useCallback(() => {
    if (saving) {
      return;
    }
    if (dirty) {
      setConfirmExit(true);
      return;
    }
    onClose();
  }, [saving, dirty, onClose]);

  const handleDiscardChanges = useCallback(() => {
    saveDraft();
    onClose();
  }, [saveDraft, onClose]);

  const showConflict = useCallback((next: DrawingConflict) => {
    if (conflictRef.current) {
      return;
    }
    conflictRef.current = next;
    setConflict(next);
    Analytics.track("excalidraw", "conflict_shown", { mode: "edit" });
  }, []);

  const handleSave = useCallback(
    async (choice: DrawingSaveChoice = "normal") => {
      const scene = sceneRef.current;
      if (!canSave || !scene || !session.active || saveInFlightRef.current) {
        return;
      }
      if (mode === "edit" && choice === "normal") {
        const currentConflict = getConflict();
        if (currentConflict !== "none") {
          showConflict(currentConflict);
          return;
        }
      }
      saveInFlightRef.current = true;
      setSaving(true);
      setError(undefined);
      let failure: "export" | "size" | "upload" = "export";
      try {
        const liveElements = getNonDeletedElements(scene.elements);
        const svg = await exportToSvg({
          elements: liveElements,
          appState: {
            ...scene.appState,
            exportEmbedScene: true,
            exportWithDarkMode: false,
          },
          files: scene.files,
        });
        const serialized = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([serialized], { type: "image/svg+xml" });
        if (blob.size > Number(env.FILE_STORAGE_UPLOAD_MAX_SIZE)) {
          failure = "size";
          throw new Error("Drawing exceeds the attachment upload limit");
        }
        const restored = await loadFromBlob(blob, null, null);
        const restoredIds = new Set(
          restored.elements.map((element) => element.id)
        );
        const imageFileIds = liveElements
          .filter((element) => element.type === "image")
          .map((element) => element.fileId);
        if (
          restoredIds.size !== liveElements.length ||
          liveElements.some((element) => !restoredIds.has(element.id)) ||
          imageFileIds.some((id) => id && !restored.files[id])
        ) {
          throw new Error("Drawing scene did not survive SVG export");
        }
        failure = "upload";
        const result = await onSave(serialized, choice);
        if (result === "conflict") {
          showConflict(getConflict());
          return;
        }
        if (result !== "saved") {
          return;
        }
        if (draftKey) {
          removeDrawingDraft(draftKey);
        }
        Analytics.track("excalidraw", "save_success", { mode });
        onClose();
      } catch {
        setError(
          failure === "size"
            ? t("Drawing is too large; remove or compress embedded images")
            : t("Drawing could not be saved. Please try again")
        );
        Analytics.track("excalidraw", "save_failure", {
          mode,
          reason: failure,
        });
      } finally {
        saveInFlightRef.current = false;
        setSaving(false);
      }
    },
    [
      canSave,
      session,
      mode,
      getConflict,
      showConflict,
      onSave,
      draftKey,
      onClose,
      t,
    ]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        void handleSave();
      }
    },
    [handleSave]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  const handleResolveConflict = useCallback(
    (choice: "continue" | "duplicate" | "overwrite") => {
      if (!conflictRef.current) {
        return;
      }
      conflictRef.current = undefined;
      Analytics.track("excalidraw", "conflict_resolved", {
        mode: "edit",
        result: choice,
      });
      setConflict(undefined);
      if (choice !== "continue") {
        void handleSave(choice);
      }
    },
    [handleSave]
  );

  const handleLibraryChange = useCallback((items: LibraryItems) => {
    try {
      localStorage.setItem("excalidraw-library", JSON.stringify(items));
    } catch {
      // The library remains usable for the current browser session.
    }
  }, []);

  const [libraryItems] = useState(readLibraryItems);
  const status = loading
    ? t("Loading drawing…")
    : saving
      ? t("Saving…")
      : draftTooLarge
        ? t("Draft too large to autosave")
        : !hasContent
          ? t("Draw something to save")
          : draftSavedAt
            ? t("Draft saved at {{time}}", {
                time: new Date(draftSavedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })
            : dirty
              ? t("Unsaved changes")
              : t("Drawing ready");

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Backdrop />
        <CanvasDialog
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <Header>
            <Dialog.Title>{t("Excalidraw drawing")}</Dialog.Title>
            <Status role="status" aria-live="polite">
              {status}
            </Status>
            <HeaderActions>
              <Button neutral onClick={handleExit} disabled={saving}>
                {t("Exit")}
              </Button>
              <Button onClick={() => void handleSave()} disabled={!canSave}>
                {t("Save & exit")}
              </Button>
            </HeaderActions>
          </Header>
          {candidateDraft && (
            <DraftBar role="status">
              <span>{t("A local drawing draft is available")}</span>
              <Button neutral onClick={handleRestoreDraft}>
                {t("Restore draft")}
              </Button>
              <Button neutral onClick={handleDiscardDraft}>
                {t("Discard")}
              </Button>
            </DraftBar>
          )}
          {error && <ErrorNotice role="alert">{error}</ErrorNotice>}
          <CanvasArea>
            {loading ? (
              <Centered role="status">{t("Loading drawing…")}</Centered>
            ) : loadError ? (
              <Centered role="alert">
                {t("The drawing scene could not be restored")}
              </Centered>
            ) : (
              <>
                <Excalidraw
                  initialData={{
                    ...loadedScene,
                    libraryItems,
                  }}
                  excalidrawAPI={handleApi}
                  onChange={handleChange}
                  onLibraryChange={handleLibraryChange}
                  langCode={language}
                  theme={theme.isDark ? "dark" : "light"}
                  viewModeEnabled={saving || !!candidateDraft}
                  autoFocus
                  UIOptions={{
                    canvasActions: {
                      toggleTheme: false,
                      saveToActiveFile: true,
                    },
                  }}
                >
                  <MainMenu>
                    <MainMenu.DefaultItems.LoadScene />
                    <MainMenu.DefaultItems.SaveToActiveFile />
                    <MainMenu.DefaultItems.Export />
                    <MainMenu.DefaultItems.SearchMenu />
                    <MainMenu.DefaultItems.Help />
                    <MainMenu.DefaultItems.ClearCanvas />
                    <MainMenu.DefaultItems.ChangeCanvasBackground />
                  </MainMenu>
                </Excalidraw>
                {(saving || candidateDraft) && (
                  <CanvasLock aria-hidden="true" $saving={saving} />
                )}
              </>
            )}
          </CanvasArea>
          {confirmExit && (
            <DecisionBackdrop>
              <Decision role="alertdialog" aria-label={t("Unsaved changes")}>
                <strong>{t("Discard unsaved drawing changes?")}</strong>
                <DecisionActions>
                  <Button neutral onClick={() => setConfirmExit(false)}>
                    {t("Continue editing")}
                  </Button>
                  <Button onClick={handleDiscardChanges}>{t("Discard")}</Button>
                </DecisionActions>
              </Decision>
            </DecisionBackdrop>
          )}
          {conflict && (
            <DecisionBackdrop>
              <Decision role="alertdialog" aria-label={t("Drawing changed")}>
                <strong>
                  {t("This drawing changed while you were editing")}
                </strong>
                <DecisionActions>
                  <Button
                    neutral
                    onClick={() => handleResolveConflict("continue")}
                  >
                    {t("Continue editing")}
                  </Button>
                  <Button
                    neutral
                    onClick={() => handleResolveConflict("duplicate")}
                  >
                    {t("Insert as copy")}
                  </Button>
                  {conflict === "modified" && (
                    <Button onClick={() => handleResolveConflict("overwrite")}>
                      {t("Overwrite")}
                    </Button>
                  )}
                </DecisionActions>
              </Decision>
            </DecisionBackdrop>
          )}
        </CanvasDialog>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function readLibraryItems(): LibraryItems {
  try {
    const raw = localStorage.getItem("excalidraw-library");
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as LibraryItems) : [];
  } catch {
    return [];
  }
}

const Backdrop = styled(Dialog.Overlay)`
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(0, 0, 0, 0.65);
`;

const CanvasDialog = styled(Dialog.Content)`
  position: fixed;
  inset: 16px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 8px;
  background: ${s("background")};
  color: ${s("text")};
  box-shadow: 0 20px 70px rgba(0, 0, 0, 0.35);

  @media (max-width: 736px) {
    inset: max(16px, env(safe-area-inset-top)) 16px
      max(16px, env(safe-area-inset-bottom));
  }
`;

const Header = styled.header`
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 56px;
  padding: 8px 16px;
  border-bottom: 1px solid ${s("inputBorder")};

  @media (max-width: 736px) {
    flex-wrap: wrap;
  }
`;

const Status = styled.span`
  flex: 1;
  color: ${s("textSecondary")};
  font-size: 12px;
`;

const HeaderActions = styled.div`
  display: flex;
  gap: 8px;
`;

const DraftBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: ${s("backgroundSecondary")};
  font-size: 12px;
`;

const ErrorNotice = styled.div`
  padding: 8px 16px;
  color: ${(props) => props.theme.danger};
`;

const CanvasArea = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;

  .excalidraw {
    width: 100%;
    height: 100%;
  }
`;

const Centered = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
`;

const CanvasLock = styled.div<{ $saving: boolean }>`
  position: absolute;
  inset: 0;
  z-index: 10;
  cursor: ${(props) => (props.$saving ? "progress" : "default")};
`;

const DecisionBackdrop = styled.div`
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
`;

const Decision = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: min(420px, calc(100% - 32px));
  padding: 24px;
  border-radius: 8px;
  background: ${s("background")};
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
`;

const DecisionActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
`;
