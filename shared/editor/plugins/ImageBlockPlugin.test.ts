import type { Node } from "prosemirror-model";
import {
  EditorState,
  NodeSelection,
  Plugin,
  TextSelection,
} from "prosemirror-state";
import type { Selection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { p, schema } from "../../test/editor";
import { ImageSource } from "../lib/FileHelper";
import { imageBlockPlugin } from "./ImageBlockPlugin";

/** Builds a standalone image paragraph using the production image schema. */
function imageParagraph(source: string | null = ImageSource.Tikz, width = 260) {
  return schema.nodes.paragraph.create(
    null,
    schema.nodes.image.create({
      src: "https://example.com/image.svg",
      source,
      width,
      height: 180,
      layoutClass: "right-50",
      alt: "Caption",
    })
  );
}

/** Builds an editor state with its image selected by default. */
function createState(content: Node[], selection?: (doc: Node) => Selection) {
  const doc = schema.nodes.doc.create(null, content);
  const plugin = imageBlockPlugin();
  return {
    plugin,
    state: EditorState.create({
      doc,
      selection: selection?.(doc) ?? NodeSelection.create(doc, 1),
      plugins: [plugin],
    }),
  };
}

describe("imageBlockPlugin state", () => {
  it.each([null, ImageSource.Tikz])(
    "marks a standalone %s image row",
    (source) => {
      const { state, plugin } = createState([imageParagraph(source)]);
      expect(plugin.getState(state)?.find()).toHaveLength(1);
    }
  );

  it("keeps small TikZ figures atomic while preserving ordinary inline icons", () => {
    const tikz = createState([imageParagraph(ImageSource.Tikz, 24)]);
    const icon = createState([imageParagraph(null, 24)]);
    expect(tikz.plugin.getState(tikz.state)?.find()).toHaveLength(1);
    expect(icon.plugin.getState(icon.state)?.find()).toHaveLength(0);
  });

  it("does not mark mixed paragraphs or normalize selections across blocks", () => {
    const image = imageParagraph().firstChild;
    if (!image) {
      throw new Error("Expected an image");
    }
    const mixed = schema.nodes.paragraph.create(null, [
      image,
      schema.text("Text"),
    ]);
    const { state, plugin } = createState([mixed, p("Next")]);
    expect(plugin.getState(state)?.find()).toHaveLength(0);

    const selected = TextSelection.create(
      state.doc,
      1,
      state.doc.content.size - 1
    );
    const next = state.apply(state.tr.setSelection(selected));
    expect(next.selection).toBeInstanceOf(TextSelection);
    expect(next.selection.from).toBe(selected.from);
    expect(next.selection.to).toBe(selected.to);
  });

  it("normalizes text cursors at either end of the image row to its image", () => {
    const { state } = createState([imageParagraph(), p("")]);
    for (const pos of [1, 3]) {
      const next = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, pos))
      );
      expect(next.selection).toBeInstanceOf(NodeSelection);
      expect(next.selection.from).toBe(1);
      expect(next.doc).toBe(state.doc);
    }
  });

  it("preserves a cross-block text selection starting inside an atomic image row", () => {
    const { state, plugin } = createState([imageParagraph(), p("Next")]);
    expect(plugin.getState(state)?.find()).toHaveLength(1);
    const selection = TextSelection.create(
      state.doc,
      1,
      state.doc.content.size - 1
    );
    const next = state.apply(state.tr.setSelection(selection));

    expect(next.selection).toBeInstanceOf(TextSelection);
    expect(next.selection.eq(selection)).toBe(true);
    expect(next.doc).toBe(state.doc);
  });

  it("caches decorations across selection changes and maps unchanged image rows", () => {
    const { state, plugin } = createState([imageParagraph(), p("")]);
    const decorations = plugin.getState(state);
    const selected = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, 0))
    );
    expect(plugin.getState(selected)).toBe(decorations);

    const introduction = p("Introduction");
    const moved = selected.apply(selected.tr.insert(0, introduction));
    expect(plugin.getState(moved)?.find()[0]?.from).toBe(introduction.nodeSize);
  });

  it("releases the row decoration when an ordinary image becomes an inline icon", () => {
    const { state, plugin } = createState([imageParagraph(null)]);
    const image = state.doc.nodeAt(1);
    if (!image) {
      throw new Error("Expected an image");
    }
    const resized = state.apply(
      state.tr.setNodeMarkup(1, undefined, { ...image.attrs, width: 24 })
    );
    expect(plugin.getState(resized)?.find()).toHaveLength(0);
  });

  it("updates decorations when an image row becomes mixed and then atomic again", () => {
    const { state, plugin } = createState([imageParagraph(), p("")]);
    const image = state.doc.nodeAt(1);
    if (!image) {
      throw new Error("Expected an image");
    }
    const afterImage = 1 + image.nodeSize;
    const mixed = state.apply(state.tr.insertText("Text", afterImage));
    expect(plugin.getState(mixed)?.find()).toHaveLength(0);

    const atomic = mixed.apply(mixed.tr.delete(afterImage, afterImage + 4));
    expect(plugin.getState(atomic)?.find()).toHaveLength(1);
    expect(atomic.doc).toEqual(state.doc);
  });
});

describe.runIf(typeof document !== "undefined")(
  "imageBlockPlugin EditorView",
  () => {
    let view: EditorView;
    let mount: HTMLDivElement;

    beforeEach(() => {
      mount = document.createElement("div");
      document.body.appendChild(mount);
      vi.stubGlobal("ClipboardEvent", class extends Event {});
    });

    afterEach(() => {
      view.destroy();
      mount.remove();
      vi.unstubAllGlobals();
    });

    /** Mounts the real production schema and plugin in a ProseMirror view. */
    function mountEditor(
      content: Node[],
      paragraphSelection = false,
      extraPlugins: Plugin[] = []
    ) {
      const { state } = createState(content, (doc) =>
        NodeSelection.create(doc, paragraphSelection ? 0 : 1)
      );
      view = new EditorView(mount, {
        state: state.reconfigure({
          plugins: [...state.plugins, ...extraPlugins],
        }),
        handleScrollToSelection: () => true,
      });
      return view;
    }

    /** Runs text through the same plugin input hook used by ProseMirror. */
    function typeText(text: string) {
      return view.someProp("handleTextInput", (handler) =>
        handler(
          view,
          view.state.selection.from,
          view.state.selection.to,
          text,
          () => view.state.tr.insertText(text)
        )
      );
    }

    it("renders a non-editable row and selects the image when its blank area is clicked", () => {
      mountEditor([imageParagraph(), p("")], true);
      const paragraph = view.nodeDOM(0);
      if (!(paragraph instanceof HTMLElement)) {
        throw new Error("Expected the image paragraph DOM");
      }
      expect(paragraph.getAttribute("contenteditable")).toBe("false");
      expect(paragraph.getAttribute("data-image-block")).toBe("true");

      const event = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      paragraph.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(view.state.selection).toBeInstanceOf(NodeSelection);
      expect(view.state.selection.from).toBe(1);
    });

    it.each([false, true])(
      "preserves the image during text input with paragraph selection=%s",
      (paragraphSelection) => {
        const paragraph = imageParagraph();
        mountEditor([paragraph, p("Existing text")], paragraphSelection);

        expect(typeText("New text")).toBe(true);

        expect(view.state.doc.childCount).toBe(3);
        expect(view.state.doc.firstChild).toBe(paragraph);
        expect(view.state.doc.child(1).textContent).toBe("New text");
        expect(view.state.doc.child(2).textContent).toBe("Existing text");
        expect(view.state.selection).toBeInstanceOf(TextSelection);
        expect(view.dom.querySelector("img")).not.toBeNull();
      }
    );

    it.each(["Enter", "ArrowDown"])(
      "moves %s into the actual empty paragraph below",
      (key) => {
        const paragraph = imageParagraph();
        mountEditor([paragraph, p("")]);

        const event = new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        });
        view.dom.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(view.state.doc.childCount).toBe(2);
        expect(view.state.doc.firstChild).toBe(paragraph);
        expect(view.state.selection).toBeInstanceOf(TextSelection);
        expect(view.state.selection.from).toBe(paragraph.nodeSize + 1);
      }
    );

    it("moves printable key input below the image before the browser inserts text", () => {
      const paragraph = imageParagraph();
      mountEditor([paragraph]);
      view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { key: "x", bubbles: true })
      );

      expect(view.state.doc.childCount).toBe(2);
      expect(view.state.doc.firstChild).toBe(paragraph);
      expect(view.state.selection.from).toBe(paragraph.nodeSize + 1);
    });

    it("pastes text into the empty paragraph below without replacing the image", () => {
      const paragraph = imageParagraph();
      mountEditor([paragraph, p("")]);

      expect(view.pasteText("Copied text")).toBe(true);

      expect(view.state.doc.childCount).toBe(2);
      expect(view.state.doc.firstChild).toBe(paragraph);
      expect(view.state.doc.child(1).textContent).toBe("Copied text");
    });

    it("directs IME composition to the paragraph below the image", () => {
      const paragraph = imageParagraph();
      mountEditor([paragraph]);
      view.dom.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true })
      );

      expect(view.state.doc.firstChild).toBe(paragraph);
      expect(view.state.selection).toBeInstanceOf(TextSelection);
      expect(view.state.selection.from).toBe(paragraph.nodeSize + 1);
    });

    it.each([
      { key: "Process", keyCode: 0 },
      { key: "Unidentified", keyCode: 229 },
    ])(
      "prepares an editable paragraph for IME startup $key/$keyCode",
      (keyboard) => {
        const paragraph = imageParagraph();
        mountEditor([paragraph]);
        const event = new KeyboardEvent("keydown", {
          ...keyboard,
          bubbles: true,
          cancelable: true,
        });

        view.dom.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(view.state.doc.firstChild).toBe(paragraph);
        expect(view.state.selection).toBeInstanceOf(TextSelection);
        expect(view.state.selection.from).toBe(paragraph.nodeSize + 1);
        const target = view.nodeDOM(paragraph.nodeSize);
        if (!(target instanceof HTMLElement)) {
          throw new Error("Expected the text paragraph DOM");
        }
        expect(target.getAttribute("contenteditable")).not.toBe("false");
      }
    );

    it("preserves caption editing events and the existing Space shortcut", () => {
      const zoom = vi.fn();
      mountEditor([imageParagraph(), p("")], false, [
        new Plugin({
          props: {
            handleKeyDown: (_view, event) => {
              if (event.key === " ") {
                zoom();
                return true;
              }
              return false;
            },
          },
        }),
      ]);
      const caption = view.dom.querySelector(".caption");
      if (!(caption instanceof HTMLElement)) {
        throw new Error("Expected a caption");
      }
      caption.setAttribute("contenteditable", "true");
      const selection = view.state.selection;
      caption.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
      expect(view.state.selection).toBe(selection);

      view.dom.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true })
      );
      expect(zoom).toHaveBeenCalledOnce();
      expect(view.state.selection).toBe(selection);
    });

    it("does not intercept an inline icon or text in the real paragraph below", () => {
      mountEditor([imageParagraph(null, 24), p("")]);
      expect(view.dom.querySelector("[data-image-block]")).toBeNull();
      expect(typeText("Normal")).toBeFalsy();

      const below = view.state.doc.firstChild?.nodeSize;
      if (below === undefined) {
        throw new Error("Expected the first paragraph");
      }
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, below + 1)
        )
      );
      expect(typeText("Normal")).toBeFalsy();
    });

    it("does not change a read-only document through its input hooks", () => {
      mountEditor([imageParagraph(), p("")]);
      view.setProps({ editable: () => false });
      const original = view.state;
      expect(typeText("Blocked text")).toBeFalsy();

      const slice = schema.nodes.paragraph
        .create(null, schema.text("Blocked paste"))
        .slice(0);
      expect(
        view.someProp("handlePaste", (handler) =>
          handler(view, new ClipboardEvent("paste"), slice)
        )
      ).toBeFalsy();
      view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      );
      view.dom.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true })
      );

      expect(view.state.doc).toBe(original.doc);
      expect(view.state.selection.eq(original.selection)).toBe(true);
    });
  }
);
