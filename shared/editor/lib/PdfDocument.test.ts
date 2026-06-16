import { EditorView } from "prosemirror-view";
import { schema, createEditorState } from "@shared/test/editor";
import { createActivePdfDocument } from "./PdfDocument";

const describeIfDom = typeof document === "undefined" ? describe.skip : describe;

describeIfDom("createActivePdfDocument", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("uses the redirect URL id when the attachment node id is missing", () => {
    const state = createEditorState(
      schema.nodes.doc.create(null, [
        schema.nodes.attachment.create({
          href: "/api/attachments.redirect?id=attachment-id",
          title: "report.pdf",
          size: 100,
          contentType: "application/pdf",
        }),
      ])
    );
    const view = new EditorView(container, { state });

    expect(createActivePdfDocument(view, 0, "document-id")).toMatchObject({
      attachmentId: "attachment-id",
      documentId: "document-id",
    });

    view.destroy();
  });
});
