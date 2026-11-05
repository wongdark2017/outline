import { NodeSelection } from "prosemirror-state";
import { ImageSource } from "@shared/editor/lib/FileHelper";
import {
  bulletList,
  createEditorState,
  createEditorStateWithSelection,
  doc,
  heading,
  hr,
  p,
  schema,
  table,
  td,
  tr,
} from "@shared/test/editor";
import { DragTarget } from "./DragTarget";

describe("DragTarget.resolvePos", () => {
  it("resolves a position in a top-level block to the block", () => {
    const state = createEditorState(doc([p("one"), heading("two")]));

    // Inside the heading text, which starts after the 5-size paragraph.
    expect(DragTarget.resolvePos(state, 7)).toEqual({ pos: 5, kind: "block" });
  });

  it("resolves a position in a list item to the list item", () => {
    const state = createEditorState(doc([bulletList(["one", "two"])]));
    const items: number[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name === "list_item") {
        items.push(pos);
      }
    });
    expect(DragTarget.resolvePos(state, items[1] + 3)).toEqual({
      pos: items[1],
      kind: "listItem",
    });
  });

  it("resolves a position in a checkbox item to the checkbox item", () => {
    const list = schema.nodes.checkbox_list.create(null, [
      schema.nodes.checkbox_item.create(null, p("todo")),
    ]);
    const state = createEditorState(doc([list]));
    expect(DragTarget.resolvePos(state, 4)).toEqual({
      pos: 1,
      kind: "checkboxItem",
    });
  });

  it("returns null for an empty top-level paragraph", () => {
    const state = createEditorState(doc([p("one"), p("")]));
    expect(DragTarget.resolvePos(state, 6)).toBeNull();
  });

  it.each([null, ImageSource.Tikz])(
    "resolves every alignment of a %s image to its paragraph block",
    (source) => {
      for (const layoutClass of [null, "left-50", "right-50", "full-width"]) {
        const image = schema.nodes.image.create({
          src: "https://example.com/image.png",
          source,
          layoutClass,
          width: 260,
          height: 180,
          alt: "Caption",
        });
        const paragraph = schema.nodes.paragraph.create(null, image);
        const state = createEditorState(doc([p("one"), paragraph]));
        const target = DragTarget.resolvePos(state, 6);

        expect(target).toEqual({ pos: 5, kind: "block" });
        expect(
          NodeSelection.create(state.doc, 5).content().content.firstChild
        ).toBe(paragraph);
      }
    }
  );

  it.each([null, ImageSource.Tikz])(
    "keeps mixed text and a %s image together as one paragraph block",
    (source) => {
      const image = schema.nodes.image.create({
        src: "https://example.com/image.png",
        source,
        layoutClass: "right-50",
        width: 260,
      });
      const paragraph = schema.nodes.paragraph.create(null, [
        schema.text("Before "),
        image,
        schema.text(" after"),
      ]);
      const state = createEditorState(doc([paragraph]));
      const imagePos = 1 + "Before ".length;

      expect(DragTarget.resolvePos(state, imagePos)).toEqual({
        pos: 0,
        kind: "block",
      });
      const slice = NodeSelection.create(state.doc, 0).content();
      expect(slice.content.firstChild).toBe(paragraph);
      expect(slice.content.textBetween(0, slice.content.size)).toBe(
        "Before  after"
      );
    }
  );

  it("keeps an ordinary inline icon attached to its text paragraph", () => {
    const icon = schema.nodes.image.create({
      src: "https://example.com/icon.png",
      width: 24,
      layoutClass: "left-50",
    });
    const paragraph = schema.nodes.paragraph.create(null, [
      schema.text("Status "),
      icon,
      schema.text(" ready"),
    ]);
    const state = createEditorState(doc([paragraph]));

    expect(DragTarget.resolvePos(state, 8)).toEqual({ pos: 0, kind: "block" });
    expect(
      NodeSelection.create(state.doc, 0).content().content.firstChild
    ).toBe(paragraph);
  });

  it("keeps an image inside a nested list attached to the nearest list item", () => {
    const image = schema.nodes.image.create({
      src: "https://example.com/image.png",
      layoutClass: "right-50",
    });
    const innerItem = schema.nodes.list_item.create(
      null,
      schema.nodes.paragraph.create(null, image)
    );
    const innerList = schema.nodes.bullet_list.create(null, innerItem);
    const outerItem = schema.nodes.list_item.create(null, [
      p("Parent"),
      innerList,
    ]);
    const state = createEditorState(
      doc([schema.nodes.bullet_list.create(null, outerItem)])
    );
    let imagePos = 0;
    let itemPos = 0;
    state.doc.descendants((node, pos) => {
      if (node === image) {
        imagePos = pos;
      }
      if (node === innerItem) {
        itemPos = pos;
      }
    });

    expect(DragTarget.resolvePos(state, imagePos)).toEqual({
      pos: itemPos,
      kind: "listItem",
    });
  });

  it("keeps images inside table cells attached to the table target", () => {
    const image = schema.nodes.image.create({
      src: "https://example.com/image.png",
      layoutClass: "left-50",
    });
    const cell = schema.nodes.td.create(
      null,
      schema.nodes.paragraph.create(null, image)
    );
    const state = createEditorState(doc([table([tr([cell])])]));

    expect(DragTarget.resolvePos(state, 4)).toEqual({ pos: 0, kind: "block" });
    const target = new DragTarget(0, document.createElement("div"), "block");
    expect(
      target.hasOwnControls(createEditorStateWithSelection(state.doc, 4))
    ).toBe(true);
  });

  it("resolves a position between top-level atoms to the adjacent atom", () => {
    const state = createEditorState(doc([p("one"), hr()]));
    expect(DragTarget.resolvePos(state, 5)).toEqual({ pos: 5, kind: "block" });
    expect(DragTarget.resolvePos(state, 6)).toEqual({ pos: 5, kind: "block" });
  });
});

describe("DragTarget#hasOwnControls", () => {
  const testDoc = doc([p("one"), table([tr([td("a"), td("b")])])]);

  // The table starts after the 5-size paragraph.
  const target = new DragTarget(5, document.createElement("div"), "block");

  it("returns true when the selection is inside the table", () => {
    const state = createEditorStateWithSelection(testDoc, 9);
    expect(target.hasOwnControls(state)).toBe(true);
  });

  it("returns false when the selection is outside the table", () => {
    const state = createEditorStateWithSelection(testDoc, 2);
    expect(target.hasOwnControls(state)).toBe(false);
  });

  it("returns false for a block that is not a table", () => {
    const state = createEditorStateWithSelection(testDoc, 2);
    const paragraph = new DragTarget(0, document.createElement("div"), "block");
    expect(paragraph.hasOwnControls(state)).toBe(false);
  });
});
