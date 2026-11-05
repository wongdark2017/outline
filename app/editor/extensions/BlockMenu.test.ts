import type { Node } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { DecorationSet } from "prosemirror-view";
import { ImageSource } from "@shared/editor/lib/FileHelper";
import { p, schema } from "@shared/test/editor";
import BlockMenu from "./BlockMenu";

vi.mock("../components/BlockMenu", () => ({ default: () => null }));

/** Creates the real block-menu plugins without mounting the menu UI. */
function createState(doc: Node, selection: TextSelection | NodeSelection) {
  const extension = new BlockMenu({
    trigger: "/",
    allowSpaces: false,
    requireSearchTerm: false,
    enabledInCode: false,
    enabledInMarks: false,
  });
  return EditorState.create({ doc, selection, plugins: extension.plugins });
}

/** Collects decorations emitted by the actual trigger and placeholder plugins. */
function decorations(state: EditorState) {
  return state.plugins.flatMap((plugin) => {
    const source = plugin.props.decorations?.call(plugin, state);
    return source instanceof DecorationSet ? source.find() : [];
  });
}

describe("BlockMenu image paragraphs", () => {
  it.each([null, ImageSource.Tikz])(
    "does not decorate a %s image paragraph at any image selection boundary",
    (source) => {
      for (const alt of [null, "Diagram caption"]) {
        const image = schema.nodes.image.create({
          src: "https://example.com/image.png",
          source,
          alt,
          width: 260,
          layoutClass: "left-50",
        });
        const intro = p("Introduction");
        const paragraph = schema.nodes.paragraph.create(null, image);
        const doc = schema.nodes.doc.create(null, [intro, paragraph]);
        const imagePos = intro.nodeSize + 1;

        expect(paragraph.textContent).toBe("");
        expect(paragraph.content.size).toBeGreaterThan(0);
        for (const selection of [
          TextSelection.create(doc, imagePos),
          NodeSelection.create(doc, imagePos),
          TextSelection.create(doc, imagePos + image.nodeSize),
        ]) {
          expect(decorations(createState(doc, selection))).toHaveLength(0);
        }
      }
    }
  );

  it("does not decorate an ordinary inline icon as an empty paragraph", () => {
    const image = schema.nodes.image.create({
      src: "https://example.com/icon.png",
      width: 24,
    });
    const paragraph = schema.nodes.paragraph.create(null, image);
    const doc = schema.nodes.doc.create(null, [p("Introduction"), paragraph]);
    const selection = TextSelection.create(doc, doc.content.size - 1);

    expect(decorations(createState(doc, selection))).toHaveLength(0);
  });

  it("does not show the slash-only hint beside an image and trailing slash", () => {
    const image = schema.nodes.image.create({
      src: "https://example.com/image.png",
    });
    const paragraph = schema.nodes.paragraph.create(null, [
      image,
      schema.text("/"),
    ]);
    const doc = schema.nodes.doc.create(null, paragraph);

    expect(
      decorations(
        createState(doc, TextSelection.create(doc, doc.content.size - 1))
      )
    ).toHaveLength(0);
  });

  it("retains both insertion affordances on the actual empty paragraph below an image", () => {
    const image = schema.nodes.image.create({
      src: "https://example.com/image.png",
      alt: "Caption",
      width: 260,
    });
    const intro = p("Introduction");
    const imageParagraph = schema.nodes.paragraph.create(null, image);
    const empty = p("");
    const emptyPos = intro.nodeSize + imageParagraph.nodeSize;
    const doc = schema.nodes.doc.create(null, [intro, imageParagraph, empty]);
    const state = createState(doc, TextSelection.create(doc, emptyPos + 1));
    const result = decorations(state);

    expect(result).toHaveLength(2);
    expect(result.find((item) => item.spec.key === "block-trigger")?.from).toBe(
      emptyPos
    );
    expect(result.find((item) => item.from !== item.to)?.from).toBe(emptyPos);
    expect(result.find((item) => item.from !== item.to)?.to).toBe(
      emptyPos + empty.nodeSize
    );
  });
});
