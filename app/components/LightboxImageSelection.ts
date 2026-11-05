import { NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { ImageSource } from "@shared/editor/lib/FileHelper";

/**
 * Resolves the exact TikZ image displayed by a lightbox from its live editor DOM.
 *
 * @param view - the editor whose current document contains the image.
 * @param src - the source URL captured by the lightbox.
 * @param element - the original image element in the editor.
 * @returns a selection for that image, or undefined if the target is no longer valid.
 */
export function getTikzImageSelection(
  view: EditorView,
  src: string,
  element: Element | null | undefined
): NodeSelection | undefined {
  if (view.isDestroyed || !element || !view.dom.contains(element)) {
    return;
  }

  const { doc } = view.state;
  const $pos = doc.resolve(view.posAtDOM(element, 0));
  const pos = $pos.parent.type.name === "image" ? $pos.before() : $pos.pos;
  const node = doc.nodeAt(pos);
  if (
    node?.type.name !== "image" ||
    node.attrs.source !== ImageSource.Tikz ||
    node.attrs.src !== src
  ) {
    return;
  }

  return NodeSelection.create(doc, pos);
}
