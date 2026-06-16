import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { light } from "@shared/styles/theme";
import type { OutlinePdfAnnotationV2 } from "@shared/types";

const pdfMocks = vi.hoisted(() => {
  const getPage = vi.fn();
  const getDocument = vi.fn();

  return {
    getDocument,
    getPage,
  };
});

vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({
  default: "/static/assets/pdf.worker.js",
}));

vi.mock("pdfjs-dist", () => {
  class TextLayer {
    public canceled = false;

    constructor(
      public readonly params: {
        container: HTMLDivElement;
        textContentSource: unknown;
        viewport: unknown;
      }
    ) {}

    async render() {
      const span = document.createElement("span");
      span.textContent = "Selected text";
      this.params.container.appendChild(span);
    }

    cancel() {
      this.canceled = true;
    }
  }

  return {
    GlobalWorkerOptions: {
      workerSrc: "",
    },
    TextLayer,
    getDocument: pdfMocks.getDocument,
  };
});

import { PdfJsViewer } from "./PdfJsViewer";

class TestIntersectionObserver implements IntersectionObserver {
  public readonly root: Element | Document | null = null;
  public readonly rootMargin = "";
  public readonly thresholds: ReadonlyArray<number> = [];

  private readonly callback: IntersectionObserverCallback;
  private readonly elements = new Set<Element>();

  public constructor(
    callback: IntersectionObserverCallback,
    _options?: IntersectionObserverInit
  ) {
    this.callback = callback;
    TestIntersectionObserver.instances.push(this);
  }

  public static instances: TestIntersectionObserver[] = [];

  public disconnect() {
    this.elements.clear();
  }

  public observe(element: Element) {
    this.elements.add(element);
  }

  public takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  public unobserve(element: Element) {
    this.elements.delete(element);
  }

  public trigger(pageIndexes: number[]) {
    const entries = Array.from(this.elements).map(
      (element) =>
        ({
          boundingClientRect: element.getBoundingClientRect(),
          intersectionRatio: pageIndexes.includes(
            Number((element as HTMLElement).dataset.pageIndex)
          )
            ? 1
            : 0,
          intersectionRect: element.getBoundingClientRect(),
          isIntersecting: pageIndexes.includes(
            Number((element as HTMLElement).dataset.pageIndex)
          ),
          rootBounds: null,
          target: element,
          time: Date.now(),
        }) as IntersectionObserverEntry
    );

    this.callback(entries, this);
  }
}

const annotation: OutlinePdfAnnotationV2 = {
  id: "annotation-1",
  pageIndex: 0,
  type: "text",
  mode: "highlight",
  color: "#ffcc00",
  text: "Selected text",
  selectedText: "Selected text",
  rects: [
    {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.04,
    },
  ],
  createdById: null,
  updatedById: null,
  createdAt: "2026-06-07T00:00:00.000Z",
  updatedAt: "2026-06-07T00:00:00.000Z",
};

function createPdfDocument(pageCount: number) {
  pdfMocks.getPage.mockImplementation(async (pageNumber: number) => ({
    getTextContent: vi.fn().mockResolvedValue({ items: [] }),
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      height: 800 * scale,
      width: 600 * scale,
    })),
    render: vi.fn(() => ({
      cancel: vi.fn(),
      promise: Promise.resolve(),
    })),
    pageNumber,
  }));

  pdfMocks.getDocument.mockReturnValue({
    destroy: vi.fn(),
    promise: Promise.resolve({
      cleanup: vi.fn(),
      getPage: pdfMocks.getPage,
      numPages: pageCount,
    }),
  });
}

describe("PdfJsViewer", () => {
  let container: HTMLDivElement;
  let originalIntersectionObserver: typeof IntersectionObserver;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    pdfMocks.getDocument.mockReset();
    pdfMocks.getPage.mockReset();
    createPdfDocument(3);
    TestIntersectionObserver.instances = [];
    originalIntersectionObserver = window.IntersectionObserver;
    window.IntersectionObserver =
      TestIntersectionObserver as typeof IntersectionObserver;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      setTransform: vi.fn(),
    })) as unknown as HTMLCanvasElement["getContext"];
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    window.IntersectionObserver = originalIntersectionObserver;
    vi.restoreAllMocks();
  });

  async function renderViewer(extraProps: Record<string, unknown> = {}) {
    await act(async () => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <PdfJsViewer
            {...({
              annotations: [annotation],
              canEdit: true,
              src: "/api/attachments.file?id=attachment-id",
              title: "Report.pdf",
              ...extraProps,
            } as React.ComponentProps<typeof PdfJsViewer>)}
          />
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("shows reading controls without annotation tools or overlays", async () => {
    await renderViewer();

    expect(
      document.body.querySelector('button[aria-label="Fit to width"]')
    ).toBeTruthy();
    expect(
      document.body.querySelector('button[aria-label="Text highlight"]')
    ).toBeNull();
    expect(
      document.body.querySelector('button[aria-label="Filled rectangle"]')
    ).toBeNull();
    expect(
      document.body.querySelector('button[aria-label="Border rectangle"]')
    ).toBeNull();
    expect(
      document.body.querySelectorAll('button[aria-label^="Use color"]')
    ).toHaveLength(0);
    expect(
      document.body.querySelector('[data-testid="pdf-annotation-layer"]')
    ).toBeNull();
    expect(document.body.querySelector("[data-annotation-id]")).toBeNull();
  });

  it("fits pages to the available viewport width", async () => {
    await renderViewer({ annotations: [] });

    const viewport = document.body.querySelector(
      "[data-testid='pdf-pages-viewport']"
    ) as HTMLDivElement;
    Object.defineProperty(viewport, "clientWidth", {
      configurable: true,
      value: 940,
    });

    await act(async () => {
      Simulate.click(
        document.body.querySelector(
          'button[aria-label="Fit to width"]'
        ) as HTMLButtonElement
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("150%");
  });

  it("updates the current page from navigation controls", async () => {
    await renderViewer({ annotations: [] });

    const pageInput = document.body.querySelector(
      'input[aria-label="Page number"]'
    ) as HTMLInputElement;

    expect(pageInput.value).toBe("1");

    await act(async () => {
      Simulate.click(
        document.body.querySelector(
          'button[aria-label="Next page"]'
        ) as HTMLButtonElement
      );
      await Promise.resolve();
    });

    expect(pageInput.value).toBe("2");

    await act(async () => {
      Simulate.click(
        document.body.querySelector(
          'button[aria-label="Previous page"]'
        ) as HTMLButtonElement
      );
      await Promise.resolve();
    });

    expect(pageInput.value).toBe("1");
  });

  it("only renders pages near the visible page", async () => {
    createPdfDocument(12);
    await renderViewer({ annotations: [] });

    expect(pdfMocks.getPage).not.toHaveBeenCalledWith(12);

    await act(async () => {
      TestIntersectionObserver.instances[0].trigger([8]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pdfMocks.getPage).toHaveBeenCalledWith(10);
  });

  it("shows an error when the PDF document fails to load", async () => {
    pdfMocks.getDocument.mockReturnValue({
      destroy: vi.fn(),
      promise: Promise.reject(new Error("Could not load PDF")),
    });

    await renderViewer({ annotations: [] });

    expect(document.body.textContent).toContain("Could not load PDF");
  });
});
