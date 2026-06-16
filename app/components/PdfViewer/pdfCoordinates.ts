import type { OutlinePdfRect } from "@shared/types";

interface ViewportRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

/**
 * Converts a viewport DOM rect into page-local pixel coordinates.
 *
 * @param rect - the viewport-space rectangle.
 * @param pageRect - the page bounds in viewport space.
 * @returns the page-local rectangle in pixels, or null if it does not intersect.
 */
export function domRectToPageLocalRect(
  rect: Pick<DOMRect, "left" | "top" | "width" | "height" | "right" | "bottom">,
  pageRect: Pick<
    DOMRect,
    "left" | "top" | "width" | "height" | "right" | "bottom"
  >
): OutlinePdfRect | null {
  const left = Math.max(rect.left, pageRect.left);
  const top = Math.max(rect.top, pageRect.top);
  const right = Math.min(rect.right, pageRect.right);
  const bottom = Math.min(rect.bottom, pageRect.bottom);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: left - pageRect.left,
    y: top - pageRect.top,
    width,
    height,
  };
}

/**
 * Converts a viewport DOM rect into a normalized page rect.
 *
 * @param rect - the viewport-space rectangle.
 * @param pageRect - the page bounds in viewport space.
 * @returns the normalized page rectangle, or null if it does not intersect.
 */
export function domRectToNormalizedRect(
  rect: Pick<DOMRect, "left" | "top" | "width" | "height" | "right" | "bottom">,
  pageRect: Pick<
    DOMRect,
    "left" | "top" | "width" | "height" | "right" | "bottom"
  >
): OutlinePdfRect | null {
  const localRect = domRectToPageLocalRect(rect, pageRect);

  if (!localRect || pageRect.width <= 0 || pageRect.height <= 0) {
    return null;
  }

  return {
    x: localRect.x / pageRect.width,
    y: localRect.y / pageRect.height,
    width: localRect.width / pageRect.width,
    height: localRect.height / pageRect.height,
  };
}

/**
 * Converts a normalized page rect into current viewport pixel coordinates.
 *
 * @param rect - the normalized page rectangle.
 * @param viewportWidth - the current page width.
 * @param viewportHeight - the current page height.
 * @returns the viewport-space rectangle.
 */
export function normalizedRectToViewportRect(
  rect: OutlinePdfRect,
  viewportWidth: number,
  viewportHeight: number
): ViewportRect {
  return {
    left: rect.x * viewportWidth,
    top: rect.y * viewportHeight,
    width: rect.width * viewportWidth,
    height: rect.height * viewportHeight,
  };
}
