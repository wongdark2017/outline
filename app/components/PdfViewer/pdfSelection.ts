import type { OutlinePdfRect } from "@shared/types";
import { domRectToNormalizedRect } from "./pdfCoordinates";

export interface SelectionAnnotationData {
  rects: OutlinePdfRect[];
  text: string;
}

interface SelectionAnnotationParams {
  pageElement: HTMLElement;
  selection: Selection | null;
  textLayerElement: HTMLElement;
}

function isNodeWithinContainer(node: Node | null, container: HTMLElement) {
  if (!node) {
    return false;
  }

  return container.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node);
}

/**
 * Extracts normalized rects and selected text from the current page text layer.
 *
 * @param params - selection extraction context.
 * @returns normalized selection data for a single page, or null if invalid.
 */
export function getSelectionAnnotationData({
  pageElement,
  selection,
  textLayerElement,
}: SelectionAnnotationParams): SelectionAnnotationData | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    return null;
  }

  if (
    !isNodeWithinContainer(selection.anchorNode, textLayerElement) ||
    !isNodeWithinContainer(selection.focusNode, textLayerElement)
  ) {
    return null;
  }

  const text = selection.toString().trim();

  if (!text) {
    return null;
  }

  const pageRect = pageElement.getBoundingClientRect();
  const rects = Array.from(selection.getRangeAt(0).getClientRects())
    .map((rect) => domRectToNormalizedRect(rect, pageRect))
    .filter((rect): rect is OutlinePdfRect => !!rect);

  if (!rects.length) {
    return null;
  }

  return {
    text,
    rects,
  };
}
