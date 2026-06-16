import {
  AlignFullWidthIcon,
  NextIcon,
  PlusIcon,
  ReturnIcon,
  ShrinkIcon,
} from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import {
  getDocument,
  GlobalWorkerOptions,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PageViewport,
} from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import { s } from "@shared/styles";

GlobalWorkerOptions.workerSrc = workerSrc;

/**
 * Props for the PDF.js-based fullscreen reader.
 */
export interface PdfJsViewerProps {
  src: string;
  title: string;
}

interface PageSize {
  height: number;
  width: number;
}

interface PageProps {
  onPageRendered: (pageIndex: number, size: PageSize) => void;
  pageIndex: number;
  pageSize?: PageSize;
  pdfDocument: PDFDocumentProxy;
  registerPageElement: (
    pageIndex: number,
    element: HTMLDivElement | null
  ) => void;
  scale: number;
  shouldRender: boolean;
}

const DefaultPageSize: PageSize = {
  height: 920,
  width: 690,
};
const PageRenderBuffer = 2;
const MaxConcurrentPageRenders = 2;
const queuedPageRenders: Array<() => void> = [];
let activePageRenderCount = 0;

function runNextQueuedPageRender() {
  if (activePageRenderCount >= MaxConcurrentPageRenders) {
    return;
  }

  const next = queuedPageRenders.shift();

  if (next) {
    next();
  }
}

function enqueuePageRender<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activePageRenderCount += 1;

      void task()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          activePageRenderCount -= 1;
          runNextQueuedPageRender();
        });
    };

    queuedPageRenders.push(run);
    runNextQueuedPageRender();
  });
}

/**
 * PDF.js fullscreen reader with page canvas and reading controls.
 *
 * @param props - viewer props.
 * @returns the viewer shell.
 */
export function PdfJsViewer({ src, title }: PdfJsViewerProps) {
  const { t } = useTranslation();
  const [pdfDocument, setPdfDocument] = React.useState<PDFDocumentProxy | null>(
    null
  );
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [scale, setScale] = React.useState(1.15);
  const [currentPage, setCurrentPage] = React.useState(0);
  const [pageCount, setPageCount] = React.useState(0);
  const [pageSizes, setPageSizes] = React.useState<Record<number, PageSize>>(
    {}
  );
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const pageRefs = React.useRef<Record<number, HTMLDivElement | null>>({});

  React.useEffect(() => {
    let canceled = false;
    let documentProxy: PDFDocumentProxy | null = null;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    setLoading(true);
    setError("");
    setPdfDocument(null);
    setPageCount(0);
    setCurrentPage(0);

    loadingTask = getDocument({
      url: src,
      withCredentials: true,
    });

    void loadingTask.promise
      .then((loadedDocument) => {
        if (canceled) {
          return;
        }

        documentProxy = loadedDocument;
        setPdfDocument(loadedDocument);
        setPageCount(loadedDocument.numPages);
      })
      .catch((err: Error) => {
        if (canceled) {
          return;
        }

        setError(err.message);
      })
      .finally(() => {
        if (!canceled) {
          setLoading(false);
        }
      });

    return () => {
      canceled = true;
      void loadingTask?.destroy();
      if (documentProxy) {
        void documentProxy.cleanup();
      }
    };
  }, [src]);

  React.useEffect(() => {
    const container = containerRef.current;

    if (!container || !pageCount) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        let bestEntry: IntersectionObserverEntry | null = null;

        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }

          if (
            !bestEntry ||
            entry.intersectionRatio > bestEntry.intersectionRatio
          ) {
            bestEntry = entry;
          }
        }

        if (!bestEntry) {
          return;
        }

        const pageIndex = Number(
          (bestEntry.target as HTMLElement).dataset.pageIndex ?? 0
        );

        if (!Number.isNaN(pageIndex)) {
          setCurrentPage(pageIndex);
        }
      },
      {
        root: container,
        threshold: [0.25, 0.5, 0.75],
      }
    );

    Object.values(pageRefs.current).forEach((page) => {
      if (page) {
        observer.observe(page);
      }
    });

    return () => {
      observer.disconnect();
    };
  }, [pageCount, scale]);

  const registerPageElement = React.useCallback(
    (pageIndex: number, element: HTMLDivElement | null) => {
      pageRefs.current[pageIndex] = element;
    },
    []
  );

  const handlePageRendered = React.useCallback(
    (pageIndex: number, size: PageSize) => {
      setPageSizes((current) => {
        const currentSize = current[pageIndex];

        if (
          currentSize &&
          currentSize.width === size.width &&
          currentSize.height === size.height
        ) {
          return current;
        }

        return {
          ...current,
          [pageIndex]: size,
        };
      });
    },
    []
  );

  const scrollToPage = React.useCallback((pageIndex: number) => {
    setCurrentPage(pageIndex);
    pageRefs.current[pageIndex]?.scrollIntoView?.({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const handleZoomIn = React.useCallback(() => {
    setScale((current) => Math.min(3, current + 0.15));
  }, []);

  const handleZoomOut = React.useCallback(() => {
    setScale((current) => Math.max(0.5, current - 0.15));
  }, []);

  const handleFitWidth = React.useCallback(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const containerWidth =
      container.clientWidth || container.getBoundingClientRect().width;
    const availableWidth = containerWidth - 40;
    const currentPageSize = pageSizes[currentPage] ?? pageSizes[0];
    const currentPageWidth = currentPageSize?.width ?? DefaultPageSize.width;
    const unscaledPageWidth = currentPageWidth / scale;

    if (availableWidth <= 0 || unscaledPageWidth <= 0) {
      return;
    }

    setScale(Math.min(3, Math.max(0.5, availableWidth / unscaledPageWidth)));
  }, [currentPage, pageSizes, scale]);

  const handlePageInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextPage = Number(event.currentTarget.value);

      if (Number.isNaN(nextPage) || nextPage < 1 || nextPage > pageCount) {
        return;
      }

      scrollToPage(nextPage - 1);
    },
    [pageCount, scrollToPage]
  );

  const shouldRenderPage = React.useCallback(
    (pageIndex: number) => Math.abs(pageIndex - currentPage) <= PageRenderBuffer,
    [currentPage]
  );

  return (
    <ViewerShell data-testid="pdfjs-viewer" data-src={src} data-title={title}>
      <Toolbar>
        <ToolbarGroup>
          <ToolbarButton
            type="button"
            aria-label={t("Previous page")}
            disabled={!pageCount || currentPage <= 0}
            onClick={() => {
              scrollToPage(Math.max(0, currentPage - 1));
            }}
          >
            <ReturnIcon />
          </ToolbarButton>
          <PageInput
            aria-label={t("Page number")}
            type="number"
            min={1}
            max={pageCount || 1}
            value={pageCount ? currentPage + 1 : 1}
            onChange={handlePageInputChange}
          />
          <PageCount>/ {pageCount || 1}</PageCount>
          <ToolbarButton
            type="button"
            aria-label={t("Next page")}
            disabled={!pageCount || currentPage >= pageCount - 1}
            onClick={() => {
              scrollToPage(Math.min(pageCount - 1, currentPage + 1));
            }}
          >
            <NextIcon />
          </ToolbarButton>
        </ToolbarGroup>
        <ToolbarGroup>
          <ToolbarButton
            type="button"
            aria-label={t("Zoom out")}
            onClick={handleZoomOut}
          >
            <ShrinkIcon />
          </ToolbarButton>
          <ZoomValue>{Math.round(scale * 100)}%</ZoomValue>
          <ToolbarButton
            type="button"
            aria-label={t("Zoom in")}
            onClick={handleZoomIn}
          >
            <PlusIcon />
          </ToolbarButton>
          <ToolbarButton
            type="button"
            aria-label={t("Fit to width")}
            onClick={handleFitWidth}
          >
            <AlignFullWidthIcon />
          </ToolbarButton>
        </ToolbarGroup>
      </Toolbar>
      <PagesViewport ref={containerRef} data-testid="pdf-pages-viewport">
        {loading ? <ViewerMessage>{t("Loading PDF")}</ViewerMessage> : null}
        {error ? <ViewerMessage>{error}</ViewerMessage> : null}
        {pdfDocument
          ? Array.from({ length: pageCount }, (_, pageIndex) => (
              <PdfJsPage
                key={pageIndex}
                onPageRendered={handlePageRendered}
                pageIndex={pageIndex}
                pageSize={pageSizes[pageIndex] ?? pageSizes[0]}
                pdfDocument={pdfDocument}
                registerPageElement={registerPageElement}
                scale={scale}
                shouldRender={shouldRenderPage(pageIndex)}
              />
            ))
          : null}
      </PagesViewport>
    </ViewerShell>
  );
}

async function renderTextLayer(
  page: PDFPageProxy,
  container: HTMLDivElement,
  viewport: PageViewport
) {
  const textContent = await page.getTextContent();
  const textLayer = new TextLayer({
    textContentSource: textContent,
    container,
    viewport,
  });

  await textLayer.render();

  return textLayer;
}

function PdfJsPage({
  onPageRendered,
  pageIndex,
  pageSize,
  pdfDocument,
  registerPageElement,
  scale,
  shouldRender,
}: PageProps) {
  const [error, setError] = React.useState("");
  const [viewport, setViewport] = React.useState<PageViewport | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let canceled = false;
    let renderTask: { cancel?: () => void; promise: Promise<unknown> } | null =
      null;
    let renderedTextLayer: TextLayer | null = null;

    if (!shouldRender) {
      setViewport(null);
      setError("");
      return;
    }

    const render = async () => {
      const page = await pdfDocument.getPage(pageIndex + 1);

      if (canceled || !canvasRef.current || !textLayerRef.current) {
        return;
      }

      const nextViewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.ceil(nextViewport.width * outputScale);
      canvas.height = Math.ceil(nextViewport.height * outputScale);
      canvas.style.width = `${nextViewport.width}px`;
      canvas.style.height = `${nextViewport.height}px`;
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

      textLayerRef.current.replaceChildren();
      textLayerRef.current.style.width = `${nextViewport.width}px`;
      textLayerRef.current.style.height = `${nextViewport.height}px`;

      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport: nextViewport,
      });

      await renderTask.promise;

      if (canceled || !textLayerRef.current) {
        return;
      }

      renderedTextLayer = await renderTextLayer(
        page,
        textLayerRef.current,
        nextViewport
      );

      if (canceled) {
        return;
      }

      setViewport(nextViewport);
      setError("");
      onPageRendered(pageIndex, {
        height: nextViewport.height,
        width: nextViewport.width,
      });
    };

    void enqueuePageRender(async () => {
      if (canceled) {
        return;
      }

      await render();
    }).catch((err: Error) => {
      if (!canceled) {
        setError(err.message);
      }
    });

    return () => {
      canceled = true;
      renderTask?.cancel?.();
      renderedTextLayer?.cancel();
    };
  }, [onPageRendered, pageIndex, pdfDocument, scale, shouldRender]);

  const resolvedPageSize = viewport ?? pageSize ?? DefaultPageSize;

  return (
    <PageSection
      ref={(element: HTMLDivElement | null) =>
        registerPageElement(pageIndex, element)
      }
      data-page-index={pageIndex}
    >
      <PageShadow
        data-testid="pdf-page-shadow"
        style={{
          height: resolvedPageSize.height,
          width: resolvedPageSize.width,
        }}
      >
        {error ? <PageError>{error}</PageError> : null}
        {shouldRender ? (
          <>
            <CanvasLayer ref={canvasRef} />
            <TextLayerContainer ref={textLayerRef} />
          </>
        ) : (
          <PagePlaceholder aria-hidden />
        )}
      </PageShadow>
    </PageSection>
  );
}

const ViewerShell = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  background: ${s("sidebarBackground")};
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid ${s("divider")};
  background: ${s("background")};
`;

const ToolbarGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ToolbarButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: ${s("textSecondary")};
  cursor: var(--pointer);

  &:hover:not(:disabled) {
    background: ${s("sidebarControlHoverBackground")};
    color: ${s("text")};
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

const PageInput = styled.input`
  width: 72px;
  min-width: 0;
  border: 1px solid ${s("divider")};
  border-radius: 4px;
  background: ${s("background")};
  color: ${s("text")};
  font-size: 13px;
  line-height: 20px;
  padding: 6px 8px;
`;

const PageCount = styled.span`
  color: ${s("textSecondary")};
  font-size: 13px;
  line-height: 20px;
`;

const ZoomValue = styled.span`
  min-width: 56px;
  text-align: center;
  color: ${s("textSecondary")};
  font-size: 13px;
  line-height: 20px;
`;

const PagesViewport = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  overflow: auto;
  padding: 20px;
`;

const ViewerMessage = styled.div`
  color: ${s("textSecondary")};
  font-size: 14px;
  line-height: 20px;
`;

const PageSection = styled.section`
  display: flex;
  justify-content: center;
`;

const PageShadow = styled.div`
  position: relative;
  background: white;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
`;

const PagePlaceholder = styled.div`
  position: absolute;
  inset: 0;
  background: white;
`;

const CanvasLayer = styled.canvas`
  display: block;
  max-width: 100%;
`;

const TextLayerContainer = styled.div`
  position: absolute;
  inset: 0;
  overflow: hidden;
  opacity: 1;
  line-height: 1;

  span,
  br {
    position: absolute;
    color: transparent;
    cursor: text;
    transform-origin: 0 0;
    white-space: pre;
  }
`;

const PageError = styled.div`
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 1;
  color: ${s("danger")};
  font-size: 13px;
  line-height: 18px;
`;
