import { action, makeObservable, observable } from "mobx";
import type { Command } from "prosemirror-state";
import { NodeSelection, Plugin, TextSelection } from "prosemirror-state";
import { lazy, Suspense } from "react";
import { t } from "i18next";
import styled from "styled-components";
import type { CommandFactory, WidgetProps } from "@shared/editor/lib/Extension";
import Extension from "@shared/editor/lib/Extension";
import FileHelper, { ImageSource } from "@shared/editor/lib/FileHelper";
import Button from "~/components/Button";
import Analytics from "~/utils/Analytics";
import { toastNotice } from "../toastNotice";
import type { ExcalidrawEditorProps } from "../components/ExcalidrawEditor";
import { ExcalidrawSession, type DrawingEntry } from "./ExcalidrawSession";

/** How a saved drawing should be committed after a concurrent edit. */
export type DrawingSaveChoice = "normal" | "duplicate" | "overwrite";

/** Result of a drawing upload and document commit. */
export type DrawingSaveResult = "saved" | "conflict" | "cancelled";

/**
 * Opens Excalidraw on demand and commits only a successfully uploaded SVG.
 */
export class ExcalidrawExtension extends Extension {
  /** Renders the lazy canvas for this extension's active session. */
  widget = ({ readOnly }: WidgetProps) => (
    <Suspense
      fallback={
        <>
          <CanvasBackdrop />
          <CanvasLoading role="status">{t("Loading drawing…")}</CanvasLoading>
        </>
      }
    >
      {this.session?.active && !readOnly ? (
        <ExcalidrawEditor
          key={this.session.key}
          session={this.session}
          onSave={this.handleSave}
          onClose={this.handleClose}
          getConflict={this.getConflict}
        />
      ) : null}
    </Suspense>
  );

  /** Initializes the observable dialog lifecycle. */
  constructor(options = {}) {
    super(options);
    makeObservable(this);
  }

  /** The extension identifier. */
  get name() {
    return "excalidraw";
  }

  /** Prevents editor focus from replacing canvas focus after a command. */
  get focusAfterExecution() {
    return false;
  }

  /**
   * Provides commands for new and selected Excalidraw drawings.
   *
   * @returns the drawing commands.
   */
  commands(): Record<string, CommandFactory> {
    return {
      insertExcalidraw: (): Command => (state, dispatch) => {
        if (!this.canEdit) {
          return false;
        }
        if (dispatch) {
          const $from = state.doc.resolve(state.selection.from);
          this.open(
            new ExcalidrawSession({
              entry: "slash",
              documentId: this.editor.props.id,
              insertPosition: state.selection.from,
              paragraphPosition: $from.start() - 1,
            })
          );
        }
        return true;
      },
      editExcalidraw:
        (options?: { source?: DrawingEntry }): Command =>
        (state, dispatch) => {
          if (!this.canEdit || !(state.selection instanceof NodeSelection)) {
            return false;
          }
          const node = state.selection.node;
          if (
            node.type.name !== "image" ||
            node.attrs.source !== ImageSource.Excalidraw ||
            !node.attrs.src
          ) {
            return false;
          }
          if (dispatch) {
            this.open(
              new ExcalidrawSession({
                entry: options?.source ?? "toolbar",
                documentId: this.editor.props.id,
                imageSrc: node.attrs.src,
                imagePosition: state.selection.from,
              })
            );
          }
          return true;
        },
    };
  }

  /** Maps one active target through document changes and editor teardown. */
  get plugins() {
    return [
      new Plugin<null>({
        state: {
          init: () => null,
          apply: (transaction) => {
            this.session?.map(transaction);
            if (this.session?.insertionLost) {
              this.close(true);
              toastNotice(
                t("The drawing insertion point is no longer available"),
                "error"
              );
            }
            return null;
          },
        },
        view: () => ({
          update: (view) => {
            if (!view.editable) {
              this.close(false);
            }
          },
          destroy: () => this.close(false),
        }),
      }),
    ];
  }

  @observable.ref
  private session: ExcalidrawSession | undefined = undefined;

  private savingSession: ExcalidrawSession | undefined;

  private get canEdit(): boolean {
    const view = this.editor.view;
    return (
      !!view &&
      !view.isDestroyed &&
      view.editable &&
      !this.editor.props.readOnly &&
      !!this.editor.props.uploadFile
    );
  }

  @action
  private open(session: ExcalidrawSession): void {
    this.session?.close();
    this.session = session;
    Analytics.track("excalidraw", "open", {
      mode: session.imageSrc ? "edit" : "new",
      source: session.entry,
    });
  }

  private getConflict = (): ReturnType<ExcalidrawSession["conflict"]> => {
    const session = this.session;
    if (!session?.active || !this.canEdit) {
      return "missing";
    }
    return session.conflict(this.editor.view.state.doc);
  };

  private handleSave = async (
    svg: string,
    choice: DrawingSaveChoice
  ): Promise<DrawingSaveResult> => {
    const session = this.session;
    const uploadFile = this.editor.props.uploadFile;
    if (
      !session?.active ||
      !uploadFile ||
      !this.canEdit ||
      this.savingSession === session
    ) {
      return "cancelled";
    }
    if (
      choice === "normal" &&
      session.imageSrc &&
      session.conflict(this.editor.view.state.doc) !== "none"
    ) {
      return "conflict";
    }
    this.savingSession = session;
    try {
      const file = new File([svg], "drawing.svg", { type: "image/svg+xml" });
      const [src, dimensions] = await Promise.all([
        uploadFile(file),
        FileHelper.getImageDimensions(file),
      ]);
      if (!session.active || this.session !== session || !this.canEdit) {
        return "cancelled";
      }
      const { state, dispatch } = this.editor.view;
      if (
        choice === "normal" &&
        session.imageSrc &&
        session.conflict(state.doc) !== "none"
      ) {
        return "conflict";
      }
      const image = this.editor.schema.nodes.image;
      if (session.imageSrc && choice !== "duplicate") {
        const position = session.targetPosition;
        const node =
          position === undefined ? undefined : state.doc.nodeAt(position);
        if (
          position === undefined ||
          node?.type.name !== "image" ||
          node.attrs.source !== ImageSource.Excalidraw
        ) {
          return "conflict";
        }
        const width = node.attrs.width ?? dimensions?.width;
        const height =
          width && dimensions?.width && dimensions.height
            ? Math.round((width * dimensions.height) / dimensions.width)
            : dimensions?.height;
        dispatch(
          state.tr.setNodeMarkup(position, undefined, {
            ...node.attrs,
            src,
            source: ImageSource.Excalidraw,
            width,
            height,
          })
        );
      } else if (choice === "duplicate") {
        const position =
          state.selection instanceof NodeSelection
            ? state.selection.to
            : state.selection.from;
        dispatch(
          state.tr.insert(
            position,
            image.create({ ...dimensions, src, source: ImageSource.Excalidraw })
          )
        );
      } else {
        const position = session.insertionPosition;
        if (position === undefined) {
          return "cancelled";
        }
        const tr = state.tr.setSelection(
          TextSelection.create(state.doc, position)
        );
        dispatch(
          tr.replaceSelectionWith(
            image.create({ ...dimensions, src, source: ImageSource.Excalidraw })
          )
        );
      }
      return "saved";
    } finally {
      if (this.savingSession === session) {
        this.savingSession = undefined;
      }
    }
  };

  private handleClose = (): void => this.close(true);

  @action
  private close(restoreFocus: boolean): void {
    if (!this.session) {
      return;
    }
    this.session.close();
    this.session = undefined;
    const view = this.editor.view;
    if (restoreFocus && view && !view.isDestroyed) {
      view.focus();
    }
  }
}

const ExcalidrawEditor = lazy(() =>
  import("../components/ExcalidrawEditor")
    .then((module) => ({ default: module.ExcalidrawEditor }))
    .catch(() => ({ default: DrawingLoadError }))
);

function DrawingLoadError({ onClose }: ExcalidrawEditorProps) {
  return (
    <>
      <CanvasBackdrop />
      <CanvasLoading role="alert">
        <span>{t("The drawing editor could not be loaded")}</span>
        <Button onClick={onClose}>{t("Exit")}</Button>
      </CanvasLoading>
    </>
  );
}

const CanvasBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(0, 0, 0, 0.65);
`;

const CanvasLoading = styled.div`
  position: fixed;
  inset: 16px;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border-radius: 8px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.text};
`;
