import { EditorView } from "prosemirror-view";
import { doc, createEditorState, p } from "@shared/test/editor";
import uploadPlaceholderPlugin from "../lib/uploadPlaceholder";
import insertFiles from "./insertFiles";

const describeIfDom = typeof document === "undefined" ? describe.skip : describe;

describeIfDom("insertFiles", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("keeps the attachment id on uploaded PDF attachment nodes", async () => {
    const view = new EditorView(container, {
      state: createEditorState(doc(p("")), [uploadPlaceholderPlugin]),
    });
    const file = new File(["%PDF-1.7"], "report.pdf", {
      type: "application/pdf",
    });
    const event = new Event("drop", { cancelable: true });

    await insertFiles(view, event, 2, [file], {
      uploadFile: vi
        .fn()
        .mockResolvedValue("/api/attachments.redirect?id=attachment-id"),
    });
    await Promise.resolve();
    await Promise.resolve();

    const attachment = view.state.doc.nodeAt(2);

    expect(attachment?.type.name).toBe("attachment");
    expect(attachment?.attrs.id).toBe("attachment-id");

    view.destroy();
  });
});
