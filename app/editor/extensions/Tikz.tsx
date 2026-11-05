import { action, makeObservable, observable } from "mobx";
import type { Command } from "prosemirror-state";
import { NodeSelection, Plugin } from "prosemirror-state";
import { lazy, Suspense } from "react";
import type { CommandFactory, WidgetProps } from "@shared/editor/lib/Extension";
import Extension from "@shared/editor/lib/Extension";
import FileHelper, { ImageSource } from "@shared/editor/lib/FileHelper";
import { findImageNodeBySrc } from "@shared/editor/queries/findImageNodeBySrc";
import { DEFAULT_SOURCE } from "../lib/tikz/constants";
import { extractSource } from "../lib/tikz/svg";
import { TikzSession } from "./TikzSession";

/**
 * Creates and edits ordinary SVG image nodes carrying their original TikZ source.
 */
export class TikzExtension extends Extension {
  /**
   * Renders the lazy dialog for this extension's current editing session.
   *
   * @param props - the current editor widget permissions.
   * @returns a registered widget that mounts its dialog only during a session.
   */
  widget = ({ readOnly }: WidgetProps) => (
    <Suspense fallback={null}>
      {this.session && !readOnly ? (
        <TikzEditor
          key={this.session.key}
          session={this.session}
          onSave={this.handleSave}
          onClose={this.handleClose}
        />
      ) : null}
    </Suspense>
  );

  /**
   * Initializes the observable dialog lifecycle.
   *
   * @param options - the extension's editor options.
   */
  constructor(options = {}) {
    super(options);
    makeObservable(this);
  }

  /** The identifier used by the extension manager. */
  get name() {
    return "tikz";
  }

  /** Keeps command execution from stealing focus back from the dialog. */
  get focusAfterExecution() {
    return false;
  }

  /**
   * Provides commands for a new diagram and the selected TikZ image.
   *
   * @returns commands that open the appropriate editing session.
   */
  commands(): Record<string, CommandFactory> {
    return {
      insertTikz: (): Command => (_state, dispatch) => {
        if (!this.canEdit) {
          return false;
        }
        if (dispatch) {
          this.open(new TikzSession({ source: DEFAULT_SOURCE }));
        }
        return true;
      },
      editTikz: (): Command => (state, dispatch) => {
        if (!this.canEdit || !(state.selection instanceof NodeSelection)) {
          return false;
        }

        const node = state.selection.node;
        if (
          node.type.name !== "image" ||
          node.attrs.source !== ImageSource.Tikz ||
          typeof node.attrs.src !== "string" ||
          !node.attrs.src
        ) {
          return false;
        }

        if (dispatch) {
          const session = new TikzSession({
            imageSrc: node.attrs.src,
            imagePosition: state.selection.from,
          });
          this.open(session);
          void this.loadExistingSource(session);
        }
        return true;
      },
    };
  }

  /**
   * Maps image positions and invalidates sessions when the editor is destroyed.
   *
   * @returns plugins that preserve the active editing session's lifetime.
   */
  get plugins() {
    return [
      new Plugin<null>({
        state: {
          init: () => null,
          apply: (transaction) => {
            this.session?.mapImagePosition(transaction);
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
  private session: TikzSession | undefined = undefined;

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
  private open(session: TikzSession): void {
    this.session?.close();
    this.session = session;
  }

  private async loadExistingSource(session: TikzSession): Promise<void> {
    await session.load(async (signal) => {
      const response = await fetch(session.imageSrc, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        return { ok: false, reason: "source" };
      }

      const source = extractSource(await response.text());
      return source === undefined
        ? { ok: false, reason: "metadata" }
        : { ok: true, source };
    });
  }

  private handleSave = async (
    svg: string,
    signal: AbortSignal
  ): Promise<void> => {
    const session = this.session;
    const { uploadFile } = this.editor.props;
    if (!session?.isActive || !uploadFile || !this.canEdit) {
      throw new Error("The diagram editing session is unavailable");
    }

    const file = new File([svg], "diagram.svg", { type: "image/svg+xml" });
    const [src, dimensions] = await Promise.all([
      uploadFile(file),
      FileHelper.getImageDimensions(file),
    ]);

    if (
      signal.aborted ||
      !session.isActive ||
      this.session !== session ||
      !this.canEdit
    ) {
      return;
    }

    const { state, dispatch } = this.editor.view;
    if (session.imageSrc) {
      const existing = findImageNodeBySrc(state.doc, session.imageSrc);
      const position = session.targetPosition;
      const node =
        position === undefined ? undefined : state.doc.nodeAt(position);
      if (
        !existing ||
        position === undefined ||
        node?.type.name !== "image" ||
        node.attrs.src !== session.imageSrc ||
        node.attrs.source !== ImageSource.Tikz
      ) {
        throw new Error("The original diagram is no longer available");
      }

      dispatch(
        state.tr.setNodeMarkup(position, undefined, {
          ...node.attrs,
          src,
          source: ImageSource.Tikz,
          width: node.attrs.width ?? dimensions?.width,
          height: node.attrs.height ?? dimensions?.height,
        })
      );
      return;
    }

    dispatch(
      state.tr.replaceSelectionWith(
        this.editor.schema.nodes.image.create({
          ...dimensions,
          src,
          source: ImageSource.Tikz,
        })
      )
    );
  };

  private handleClose = (): void => {
    this.close(true);
  };

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

const TikzEditor = lazy(() =>
  import("../components/TikzEditor").then((module) => ({
    default: module.TikzEditor,
  }))
);
