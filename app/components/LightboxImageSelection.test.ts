import { Schema } from "prosemirror-model";
import { EditorState, NodeSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { ImageSource } from "@shared/editor/lib/FileHelper";
import {
  getEditableImageSelection,
  getTikzImageSelection,
} from "./LightboxImageSelection";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: {
      content: "inline*",
      toDOM: () => ["p", 0],
    },
    image: {
      inline: true,
      group: "inline",
      attrs: { src: {}, source: {}, alt: {} },
      toDOM: (node) => ["img", { ...node.attrs }],
    },
    text: { group: "inline" },
  },
});
const src = "https://example.com/diagram.svg";

describe("getTikzImageSelection", () => {
  let view: EditorView;

  beforeEach(() => {
    const paragraph = (alt: string, source = ImageSource.Tikz) =>
      schema.nodes.paragraph.create(
        null,
        schema.nodes.image.create({ src, source, alt })
      );
    view = new EditorView(document.body, {
      state: EditorState.create({
        schema,
        doc: schema.nodes.doc.create(null, [
          paragraph("first"),
          paragraph("second"),
          paragraph("ordinary", ImageSource.DiagramsNet),
          paragraph("excalidraw", ImageSource.Excalidraw),
        ]),
      }),
    });
  });

  afterEach(() => {
    view.destroy();
  });

  it("selects the displayed instance when images reuse a source URL", () => {
    const second = view.dom.querySelectorAll("img[src]")[1];
    const selection = getTikzImageSelection(view, src, second);
    expect(selection?.node.attrs.alt).toBe("second");
    expect(selection?.from).toBe(4);
  });

  it("selects only the exact Excalidraw image in the lightbox", () => {
    const images = view.dom.querySelectorAll("img[src]");
    expect(
      getEditableImageSelection(view, src, images[3], ImageSource.Excalidraw)
        ?.node.attrs.alt
    ).toBe("excalidraw");
    expect(
      getEditableImageSelection(view, src, images[1], ImageSource.Excalidraw)
    ).toBeUndefined();
  });

  it("resolves the current position after preceding content changes", () => {
    const second = view.dom.querySelectorAll("img[src]")[1];
    view.dispatch(view.state.tr.insertText("Introduction", 1));
    const selection = getTikzImageSelection(view, src, second);
    expect(selection?.node.attrs.alt).toBe("second");
    expect(selection?.from).toBe(4 + "Introduction".length);
  });

  it("keeps that NodeSelection mapped while the close animation runs", () => {
    const second = view.dom.querySelectorAll("img[src]")[1];
    const selection = getTikzImageSelection(view, src, second);
    if (!selection) {
      throw new Error("Expected a TikZ image selection");
    }
    view.dispatch(view.state.tr.setSelection(selection));
    view.dispatch(view.state.tr.insertText("New text", 1));

    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(view.state.selection.from).toBe(4 + "New text".length);
    expect(getTikzImageSelection(view, src, second)?.node.attrs.alt).toBe(
      "second"
    );
  });

  it("does not retarget a duplicate after the displayed image was deleted", () => {
    const second = view.dom.querySelectorAll("img[src]")[1];
    const selection = getTikzImageSelection(view, src, second);
    if (!selection) {
      throw new Error("Expected a TikZ image selection");
    }
    view.dispatch(view.state.tr.setSelection(selection).deleteSelection());
    expect(getTikzImageSelection(view, src, second)).toBeUndefined();
  });

  it("rejects mismatched source URLs and non-TikZ nodes", () => {
    const images = view.dom.querySelectorAll("img[src]");
    expect(
      getTikzImageSelection(view, "https://example.com/other.svg", images[0])
    ).toBeUndefined();
    expect(getTikzImageSelection(view, src, images[2])).toBeUndefined();
  });

  it("rejects elements outside the editor", () => {
    expect(
      getTikzImageSelection(view, src, document.createElement("img"))
    ).toBeUndefined();
    expect(getTikzImageSelection(view, src, null)).toBeUndefined();
  });
});
