import { ThemeProvider } from "styled-components";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { light } from "@shared/styles/theme";

const mocks = vi.hoisted(() => ({
  getPdfAttachmentState: vi.fn(),
  updatePdfAttachmentState: vi.fn(),
}));

vi.mock("@radix-ui/react-dialog", async () => {
  const ReactActual = (await vi.importActual("react")) as {
    createElement: typeof React.createElement;
    Fragment: typeof React.Fragment;
  };

  return {
    Content: ({ children, ...props }: React.ComponentProps<"div">) =>
      ReactActual.createElement("div", props, children),
    Overlay: (props: React.ComponentProps<"div">) =>
      ReactActual.createElement("div", props),
    Portal: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
    Root: ({
      children,
      open,
    }: {
      children?: React.ReactNode;
      open?: boolean;
    }) =>
      open
        ? ReactActual.createElement(ReactActual.Fragment, null, children)
        : null,
    Title: ({ children, ...props }: React.ComponentProps<"div">) =>
      ReactActual.createElement("div", props, children),
  };
});

vi.mock("~/utils/pdfAttachmentState", () => ({
  getPdfAttachmentState: mocks.getPdfAttachmentState,
  updatePdfAttachmentState: mocks.updatePdfAttachmentState,
}));

vi.mock("~/components/NudeButton", () => ({
  default: React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(
    function MockNudeButton(props, ref) {
      return <button {...props} ref={ref} />;
    }
  ),
}));

const viewerMocks = vi.hoisted(() => ({
  renderError: false,
}));

vi.mock("./PdfViewer/PdfJsViewer", () => ({
  PdfJsViewer: ({
    src,
    title,
  }: {
    src: string;
    title: string;
  }) => (
    <div data-testid="pdfjs-viewer" data-src={src} data-title={title}>
      {viewerMocks.renderError ? <div>Could not load PDF</div> : null}
    </div>
  ),
}));

import PdfViewerDialog from "./PdfViewerDialog";

describe("PdfViewerDialog", () => {
  const baseDocument = {
    attachmentId: "attachment-id",
    contentType: "application/pdf",
    documentId: "document-id",
    element: null,
    pos: 1,
    size: 1000,
    src: "/api/attachments.redirect?id=attachment-id",
    title: "Report.pdf",
  };
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.getPdfAttachmentState.mockReset();
    mocks.updatePdfAttachmentState.mockReset();
    viewerMocks.renderError = false;
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    document.body.innerHTML = "";
  });

  async function renderDialog(
    props: Partial<React.ComponentProps<typeof PdfViewerDialog>> = {}
  ) {
    await act(async () => {
      ReactDOM.render(
        <ThemeProvider theme={light}>
          <PdfViewerDialog
            document={baseDocument}
            onRequestClose={vi.fn()}
            userId="user-id"
            {...props}
          />
        </ThemeProvider>,
        container
      );
      await Promise.resolve();
    });
  }

  it("renders the pdfjs viewer instead of the native pdf iframe", async () => {
    await renderDialog();

    const viewer = document.body.querySelector(
      '[data-testid="pdfjs-viewer"]'
    ) as HTMLDivElement;

    expect(viewer).toBeTruthy();
    expect(viewer.dataset.src).toContain(
      "/api/attachments.file?id=attachment-id"
    );
    expect(document.body.querySelector("iframe")).toBeNull();
  });

  it("does not read or save pdf annotation state in display-only mode", async () => {
    await renderDialog();

    expect(mocks.getPdfAttachmentState).not.toHaveBeenCalled();
    expect(mocks.updatePdfAttachmentState).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Annotations");
    expect(document.body.textContent).not.toContain("Save annotations");
    expect(document.body.textContent).not.toContain("Reload");
    expect(document.body.querySelector("form")).toBeNull();
  });

  it("allows viewing without state calls when attachment id is missing", async () => {
    await renderDialog({
      document: {
        ...baseDocument,
        attachmentId: undefined,
      },
    });

    expect(
      document.body.querySelector('[data-testid="pdfjs-viewer"]')
    ).toBeTruthy();
    expect(mocks.getPdfAttachmentState).not.toHaveBeenCalled();
    expect(mocks.updatePdfAttachmentState).not.toHaveBeenCalled();
  });

  it("keeps the original file action visible when PDF loading fails", async () => {
    viewerMocks.renderError = true;

    await renderDialog();

    expect(document.body.textContent).toContain("Could not load PDF");
    expect(
      document.body.querySelector(
        'a[href="/api/attachments.redirect?id=attachment-id"]'
      )
    ).toBeTruthy();
  });
});
