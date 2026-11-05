import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  defaultHighlightStyle,
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { observer } from "mobx-react";
import { lighten } from "polished";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import styled, { useTheme } from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Modal from "~/components/Modal";
import {
  isCurrentTikzPreview,
  type TikzPreview,
  type TikzSession,
  type TikzSourceRevision,
} from "../extensions/TikzSession";
import { PREVIEW_DELAY_MS } from "../lib/tikz/constants";
import { describeTexError, prepareSource } from "../lib/tikz/prepareSource";
import type { SourceInfo } from "../lib/tikz/prepareSource";
import { renderTikz } from "../lib/tikz/renderTikz";
import type { RenderFailure } from "../lib/tikz/renderTikz";
import { getTikzErrorMessage } from "./tikzErrors";

/** Properties for a single original-source editing dialog. */
export interface TikzEditorProps {
  session: TikzSession;
  onSave: (svg: string, signal: AbortSignal) => Promise<void>;
  onClose: () => void;
}

/**
 * Edits TikZ source with an isolated worker preview and an inline error region.
 *
 * @param props - the current session and its save/close callbacks.
 * @returns the accessible source and preview dialog.
 */
export const TikzEditor = observer(function TikzEditor({
  session,
  onSave,
  onClose,
}: TikzEditorProps) {
  const { t } = useTranslation();
  const initialSource = session.source;
  const [source, setSource] = useState<TikzSourceRevision | undefined>(() =>
    initialSource === undefined
      ? undefined
      : { text: initialSource, revision: 0 }
  );
  const [preview, setPreview] = useState<TikzPreview>();
  const [renderError, setRenderError] = useState<RenderFailure>();
  const [rendering, setRendering] = useState(false);
  const sourceText = source?.text;
  const info = useMemo(
    () =>
      sourceText === undefined ? undefined : prepareSource(sourceText).info,
    [sourceText]
  );
  const problem = useMemo(
    () =>
      renderError?.reason === "compile"
        ? describeTexError(renderError.error, sourceText ?? "")
        : undefined,
    [renderError, sourceText]
  );
  const message = getTikzErrorMessage(t, session.error, renderError, problem);
  const previewURL = useMemo(
    () =>
      preview
        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`
        : undefined,
    [preview]
  );
  const canSave =
    session.isActive &&
    isCurrentTikzPreview(source, preview) &&
    !rendering &&
    !renderError &&
    !session.error &&
    !session.saving;

  useEffect(() => {
    if (initialSource !== undefined) {
      setSource((previous) => previous ?? { text: initialSource, revision: 0 });
    }
  }, [initialSource]);

  useEffect(() => {
    if (!source) {
      return;
    }

    const controller = new AbortController();
    setRendering(false);
    const run = async () => {
      setRendering(true);
      const result = await renderTikz(source.text, controller.signal);
      if (controller.signal.aborted || !session.isActive) {
        return;
      }

      setRendering(false);
      if (result.ok) {
        setPreview({ ...source, svg: result.svg });
        setRenderError(undefined);
        session.clearSaveError();
      } else if (result.reason !== "aborted") {
        setRenderError(result);
      }
    };
    const timer = setTimeout(() => void run(), PREVIEW_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [source, session]);

  useEffect(() => () => session.cancelPendingSave(), [session]);

  const handleSourceChange = useCallback(
    (text: string) => {
      session.cancelPendingSave();
      session.clearSaveError();
      setRenderError(undefined);
      setSource((previous) => ({
        text,
        revision: (previous?.revision ?? 0) + 1,
      }));
    },
    [session]
  );

  const handleSave = useCallback(async () => {
    if (!canSave || !preview) {
      return;
    }

    const saved = await session.save(preview.svg, onSave);
    if (saved && session.isActive) {
      onClose();
    }
  }, [canSave, preview, session, onSave, onClose]);

  return (
    <Modal
      isOpen
      expanded
      width="min(1100px, 90vw)"
      title={t("TikZ diagram")}
      onRequestClose={onClose}
    >
      <Content>
        <Panels>
          <Panel aria-label={t("Code")}>
            <PanelHeader>
              <span>{t("Code")}</span>
              <Language>LaTeX</Language>
            </PanelHeader>
            {initialSource === undefined ? (
              <SourcePlaceholder>
                {session.loading
                  ? t("Loading diagram source…")
                  : t("Source not loaded")}
              </SourcePlaceholder>
            ) : (
              <TikzCodeEditor
                initialSource={initialSource}
                onChange={handleSourceChange}
              />
            )}
            <SourceStatus
              info={info}
              missingPackage={problem?.missingPackage}
            />
          </Panel>
          <Panel aria-label={t("Preview")}>
            <PreviewHeader>
              <span>{t("Preview")}</span>
              {rendering && (
                <RenderStatus role="status">{t("Rendering…")}</RenderStatus>
              )}
            </PreviewHeader>
            <PreviewArea>
              {previewURL ? (
                <PreviewImage src={previewURL} alt={t("Preview")} />
              ) : (
                <PreviewPlaceholder>{t("Preview")}</PreviewPlaceholder>
              )}
            </PreviewArea>
          </Panel>
        </Panels>
        {message && (
          <ErrorRegion role="alert" aria-live="polite">
            <ErrorHint>{message}</ErrorHint>
            {problem?.detail && !session.error && (
              <ErrorDetails>{problem.detail}</ErrorDetails>
            )}
          </ErrorRegion>
        )}
        <Footer justify="flex-end" gap={8}>
          <Button onClick={onClose} neutral>
            {t("Cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {session.saving ? t("Saving…") : t("Save")}
          </Button>
        </Footer>
      </Content>
    </Modal>
  );
});

interface TikzCodeEditorProps {
  initialSource: string;
  onChange: (source: string) => void;
}

const TikzCodeEditor = memo(function TikzCodeEditor({
  initialSource,
  onChange,
}: TikzCodeEditorProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [view, setView] = useState<EditorView | null>(null);
  const appearance = useMemo(() => new Compartment(), []);

  const handleEditorMount = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) {
        return;
      }

      const editor = new EditorView({
        parent: element,
        state: EditorState.create({
          doc: initialSource,
          extensions: [
            lineNumbers(),
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            StreamLanguage.define(stex),
            appearance.of([]),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                onChange(update.state.doc.toString());
              }
            }),
          ],
        }),
      });
      setView(editor);

      return () => editor.destroy();
    },
    [initialSource, onChange, appearance]
  );

  useEffect(() => {
    if (view?.dom.isConnected) {
      view.focus();
    }
  }, [view]);

  useEffect(() => {
    if (!view?.dom.isConnected) {
      return;
    }

    const highlights = HighlightStyle.define(
      defaultHighlightStyle.specs.map((style) => ({
        ...style,
        color:
          theme.isDark && typeof style.color === "string"
            ? lighten(0.3, style.color)
            : style.color,
      }))
    );
    view.dispatch({
      effects: appearance.reconfigure([
        syntaxHighlighting(highlights),
        EditorView.contentAttributes.of({
          "aria-label": t("TikZ source"),
          spellcheck: "false",
        }),
        EditorView.theme(
          {
            "&": { height: "100%", color: theme.text },
            ".cm-scroller": { fontFamily: theme.fontFamilyMono },
            ".cm-content": { caretColor: theme.text },
            ".cm-gutters": {
              backgroundColor: theme.backgroundSecondary,
              color: theme.textTertiary,
              borderColor: theme.inputBorder,
            },
            ".cm-cursor": { borderLeftColor: theme.text },
            ".cm-selectionBackground": {
              backgroundColor: theme.sidebarActiveBackground,
            },
            "&.cm-focused": {
              outline: `2px solid ${theme.selected}`,
              outlineOffset: "-2px",
            },
          },
          { dark: theme.isDark }
        ),
      ]),
    });
  }, [appearance, view, theme, t]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" && event.key !== "Escape") {
      event.stopPropagation();
    }
  }, []);

  return <CodeHost ref={handleEditorMount} onKeyDown={handleKeyDown} />;
});

interface SourceStatusProps {
  info?: SourceInfo;
  missingPackage?: string;
}

function SourceStatus({ info, missingPackage }: SourceStatusProps) {
  const { t } = useTranslation();
  return (
    <StatusBar align="center" gap={8}>
      {info ? (
        <>
          <Badge>
            {info.isDocument ? t("Full document") : t("TikZ snippet")}
          </Badge>
          {missingPackage && (
            <Badge $danger>
              {t("{{name}} unavailable", { name: missingPackage })}
            </Badge>
          )}
          {info.libraries.length > 0 && (
            <span>
              {t("Libraries")} {info.libraries.join(" · ")}
            </span>
          )}
          {info.skippedPackages.length > 0 && (
            <span>
              {t("Skipped {{names}}", {
                names: info.skippedPackages.join(", "),
              })}
            </span>
          )}
          {info.hasWideChars && (
            <span>{t("Non-Latin text uses the system font")}</span>
          )}
          {info.border && (
            <span>{t("Border {{border}}", { border: info.border })}</span>
          )}
          {!info.isDocument && info.libraries.length === 0 && (
            <span>{t("You can also paste a full .tex document")}</span>
          )}
        </>
      ) : (
        <span>{t("Waiting for the original diagram source")}</span>
      )}
    </StatusBar>
  );
}

const Content = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 14px;
`;

const Panels = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  flex: 1;
  min-height: 0;

  @media (max-width: 736px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(130px, 1.25fr) minmax(110px, 1fr);
    gap: 12px;
  }
`;

const Panel = styled.section`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  flex-shrink: 0;
  padding: 0 12px;
  color: ${s("textSecondary")};
  font-size: 12px;
  border-bottom: 1px solid ${s("inputBorder")};
`;

const Language = styled.span`
  font-size: 11px;
  color: ${s("textTertiary")};
`;

const CodeHost = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  font-family: ${s("fontFamilyMono")};
  font-size: 13px;

  .cm-content {
    padding: 12px 0;
  }

  .cm-line {
    padding-inline: 8px;
  }

  @media (max-width: 736px) {
    font-size: 12px;
  }
`;

const SourcePlaceholder = styled.div`
  flex: 1;
  min-height: 0;
  padding: 16px;
  color: ${s("textSecondary")};
  font-size: 13px;
`;

const StatusBar = styled(Flex)`
  flex-shrink: 0;
  min-height: 34px;
  overflow-x: auto;
  padding: 5px 8px;
  border-top: 1px solid ${s("inputBorder")};
  white-space: nowrap;
  color: ${s("textSecondary")};
  font-size: 11px;
`;

const Badge = styled.span<{ $danger?: boolean }>`
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  background: ${s("backgroundSecondary")};
  color: ${(props) =>
    props.$danger ? props.theme.danger : props.theme.textSecondary};
`;

const PreviewHeader = styled(PanelHeader)`
  background: white;
  color: #55555a;
`;

const PreviewArea = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  padding: 16px;
  overflow: auto;
  background: white;
`;

const PreviewImage = styled.img`
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
`;

const PreviewPlaceholder = styled.span`
  color: #76767c;
  font-size: 13px;
`;

const RenderStatus = styled.span`
  color: #55555a;
  font-size: 11px;
`;

const ErrorRegion = styled.div`
  flex-shrink: 0;
  max-height: 120px;
  overflow: auto;
  color: ${(props) => (props.theme.isDark ? "#ff93aa" : "#c61d41")};
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
`;

const ErrorHint = styled.p`
  margin: 0;
  font-weight: 500;
`;

const ErrorDetails = styled.pre`
  margin: 5px 0 0;
  white-space: pre-wrap;
  font-family: ${s("fontFamilyMono")};
  font-size: 12px;
  line-height: 1.6;
`;

const Footer = styled(Flex)`
  flex-shrink: 0;
  padding: 4px 0 22px;

  @media (max-width: 736px) {
    padding-bottom: max(14px, env(safe-area-inset-bottom));
  }
`;
