import type { Node } from "prosemirror-model";
import type { NodeWithPos } from "../types";

/**
 * Finds the first image in the current document with the requested source URL.
 *
 * @param doc - the document to search.
 * @param src - the image source URL to match.
 * @returns the image and its current position, or undefined when not found.
 */
export function findImageNodeBySrc(
  doc: Node,
  src: string
): NodeWithPos | undefined {
  let found: NodeWithPos | undefined;
  doc.descendants((node, pos) => {
    if (found) {
      return false;
    }
    if (node.type.name === "image" && node.attrs.src === src) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}
