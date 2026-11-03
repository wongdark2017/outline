import { MathView, type IMathPluginState } from "@benrbray/prosemirror-math";
import type { Node } from "prosemirror-model";
import type { PluginKey } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

/** Keeps formula source editing isolated from the enclosing document editor. */
export class KaTeXMathView extends MathView {
  /**
   * Creates a formula view with a nested editor for the original LaTeX.
   *
   * @param node the formula node.
   * @param view the enclosing editor.
   * @param getPos the formula's current document position.
   * @param options the KaTeX rendering options.
   * @param key the math plugin state key.
   * @param onDestroy the callback that unregisters the node view.
   */
  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number,
    options: ConstructorParameters<typeof MathView>[3],
    key: PluginKey<IMathPluginState>,
    onDestroy: () => void
  ) {
    super(node, view, getPos, options, key);
    this.outerView = view;
    this.onDestroy = onDestroy;
    this.dom.contentEditable = "false";
    this.dom.addEventListener("keydown", this.handleKeyDown);
  }

  /** Unregisters the view and closes its nested source editor. */
  override destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.dom.removeEventListener("keydown", this.handleKeyDown);
    this.onDestroy();
    super.destroy();
  }

  private readonly outerView: EditorView;

  private readonly onDestroy: () => void;

  private destroyed = false;

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }

    const source = this.dom.querySelector(".math-src .ProseMirror");
    if (
      !source ||
      !(event.target instanceof globalThis.Node) ||
      !source.contains(event.target)
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "z" || (key === "y" && !event.shiftKey)) {
      if (
        this.outerView.someProp("handleKeyDown", (handleKeyDown) =>
          handleKeyDown(this.outerView, event)
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (key !== "a" || event.shiftKey) {
      return;
    }

    const selection = this.dom.ownerDocument.getSelection();
    if (!selection) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const range = this.dom.ownerDocument.createRange();
    range.selectNodeContents(source);
    selection.removeAllRanges();
    selection.addRange(range);
  };
}
