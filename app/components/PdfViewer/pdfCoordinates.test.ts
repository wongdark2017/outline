import {
  domRectToNormalizedRect,
  domRectToPageLocalRect,
  normalizedRectToViewportRect,
} from "./pdfCoordinates";

describe("pdfCoordinates", () => {
  it("converts a DOM rect into page-local coordinates", () => {
    const pageRect = new DOMRect(100, 200, 240, 320);
    const selectionRect = new DOMRect(120, 236, 48, 24);

    expect(domRectToPageLocalRect(selectionRect, pageRect)).toEqual({
      x: 20,
      y: 36,
      width: 48,
      height: 24,
    });
  });

  it("clips a DOM rect to the page and normalizes it", () => {
    const pageRect = new DOMRect(100, 200, 200, 100);
    const selectionRect = new DOMRect(80, 210, 50, 20);

    expect(domRectToNormalizedRect(selectionRect, pageRect)).toEqual({
      x: 0,
      y: 0.1,
      width: 0.15,
      height: 0.2,
    });
  });

  it("returns null when a rect does not intersect the page", () => {
    const pageRect = new DOMRect(100, 200, 200, 100);
    const selectionRect = new DOMRect(20, 20, 40, 20);

    expect(domRectToNormalizedRect(selectionRect, pageRect)).toBeNull();
  });

  it("rebuilds viewport pixel coordinates from normalized data at different sizes", () => {
    const rect = {
      x: 0.1,
      y: 0.25,
      width: 0.5,
      height: 0.1,
    };

    expect(normalizedRectToViewportRect(rect, 200, 400)).toEqual({
      left: 20,
      top: 100,
      width: 100,
      height: 40,
    });
    expect(normalizedRectToViewportRect(rect, 300, 600)).toEqual({
      left: 30,
      top: 150,
      width: 150,
      height: 60,
    });
  });
});
