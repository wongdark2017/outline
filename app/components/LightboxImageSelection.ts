import { NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { ImageSource } from "@shared/editor/lib/FileHelper";

/**
 * Resolves the exact editable image shown by a lightbox from its editor DOM.
 *
 * @param view - the editor containing the image.
 * @param src - the image URL captured by the lightbox.
 * @param element - the original image element in the editor.
 * @param source - the expected editable image source.
 * @returns a selection for the matching image, if it still exists.
 */
export function getEditableImageSelection(
  view: EditorView,
  src: string,
  element: Element | null | undefined,
  source: ImageSource
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
    node.attrs.source !== source ||
    node.attrs.src !== src
  ) {
    return;
  }

  return NodeSelection.create(doc, pos);
}
