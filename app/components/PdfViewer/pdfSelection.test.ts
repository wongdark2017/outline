import { getSelectionAnnotationData } from "./pdfSelection";

function createClientRectList(rects: DOMRect[]): DOMRectList {
  const list = {
    length: rects.length,
    item: (index: number) => rects[index] ?? null,
    [Symbol.iterator]: function* () {
      yield* rects;
    },
  };

  rects.forEach((rect, index) => {
    Object.defineProperty(list, index, {
      configurable: true,
      enumerable: true,
      value: rect,
    });
  });

  return list as DOMRectList;
}

function createSelection(params: {
  anchorNode: Node | null;
  focusNode: Node | null;
  isCollapsed?: boolean;
  rects?: DOMRect[];
  text: string;
}): Selection {
  const { anchorNode, focusNode, isCollapsed = false, rects = [], text } = params;

  return {
    anchorNode,
    focusNode,
    isCollapsed,
    rangeCount: isCollapsed ? 0 : 1,
    getRangeAt: () =>
      ({
        getClientRects: () => createClientRectList(rects),
      }) as Range,
    toString: () => text,
  } as unknown as Selection;
}

describe("pdfSelection", () => {
  it("extracts text and normalized rects from a single-page selection", () => {
    const pageElement = document.createElement("div");
    const textLayerElement = document.createElement("div");
    const startNode = document.createTextNode("Check");
    const endNode = document.createTextNode("section");

    textLayerElement.append(startNode, endNode);
    pageElement.append(textLayerElement);

    Object.defineProperty(pageElement, "getBoundingClientRect", {
      value: () => new DOMRect(100, 200, 200, 100),
    });

    const selection = createSelection({
      anchorNode: startNode,
      focusNode: endNode,
      rects: [new DOMRect(120, 220, 50, 10), new DOMRect(120, 236, 40, 10)],
      text: "Check this section",
    });

    expect(
      getSelectionAnnotationData({
        pageElement,
        selection,
        textLayerElement,
      })
    ).toEqual({
      text: "Check this section",
      rects: [
        { x: 0.1, y: 0.2, width: 0.25, height: 0.1 },
        { x: 0.1, y: 0.36, width: 0.2, height: 0.1 },
      ],
    });
  });

  it("returns null for collapsed selections", () => {
    const pageElement = document.createElement("div");
    const textLayerElement = document.createElement("div");
    const textNode = document.createTextNode("Check");

    textLayerElement.append(textNode);
    pageElement.append(textLayerElement);

    const selection = createSelection({
      anchorNode: textNode,
      focusNode: textNode,
      isCollapsed: true,
      text: "",
    });

    expect(
      getSelectionAnnotationData({
        pageElement,
        selection,
        textLayerElement,
      })
    ).toBeNull();
  });

  it("rejects selections that leave the current page text layer", () => {
    const pageElement = document.createElement("div");
    const textLayerElement = document.createElement("div");
    const insideNode = document.createTextNode("Check");
    const outsideNode = document.createTextNode("Elsewhere");

    textLayerElement.append(insideNode);
    pageElement.append(textLayerElement);

    const selection = createSelection({
      anchorNode: insideNode,
      focusNode: outsideNode,
      rects: [new DOMRect(120, 220, 50, 10)],
      text: "Check elsewhere",
    });

    expect(
      getSelectionAnnotationData({
        pageElement,
        selection,
        textLayerElement,
      })
    ).toBeNull();
  });
});
