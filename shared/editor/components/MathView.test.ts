// @vitest-environment jsdom
import { mathSchemaSpec } from "@benrbray/prosemirror-math";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Schema, type Node } from "prosemirror-model";
import {
  EditorState,
  NodeSelection,
  Plugin,
  TextSelection,
} from "prosemirror-state";
import { DecorationSet, EditorView } from "prosemirror-view";
import {
  prosemirrorToYDoc,
  redoCommand,
  undoCommand,
  ySyncPlugin,
  yUndoPlugin,
} from "y-prosemirror";
import { KaTeXMathView } from "./MathView";
import mathPlugin, {
  createMathView,
  prepareMathForPrint,
} from "../extensions/Math";

const styles = vi.hoisted(() => {
  let finish: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { ready, finish: () => finish() };
});

vi.mock("@shared/utils/browser", () => ({ isNode: false }));
vi.mock("katex/dist/katex.min.css", async () => {
  await styles.ready;
  return {};
});

const schema = new Schema({
  nodes: {
    ...mathSchemaSpec.nodes,
    math_block: mathSchemaSpec.nodes.math_display,
  },
  marks: mathSchemaSpec.marks,
});
const cleanup: (() => void)[] = [];
const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");

function mathNode(source: string, display = false): Node {
  return schema.nodes[display ? "math_block" : "math_inline"].create(
    null,
    source ? schema.text(source) : undefined
  );
}

function createEditor(doc: Node, plugins: Plugin[] = []) {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const editor = new EditorView(mount, {
    state: EditorState.create({ doc, plugins: [mathPlugin, ...plugins] }),
  });
  cleanup.push(() => {
    editor.destroy();
    mount.remove();
  });
  const pluginState = mathPlugin.getState(editor.state);
  if (!pluginState) {
    throw new Error("Missing formula plugin state");
  }
  return { editor, pluginState };
}

function createView(source: string, display = false, plugins: Plugin[] = []) {
  const node = mathNode(source, display);
  const { editor, pluginState } = createEditor(
    schema.nodes.doc.create(
      null,
      display ? [node] : [schema.nodes.paragraph.create(null, [node])]
    ),
    plugins
  );
  const view = pluginState.activeNodeViews[0];
  if (!view) {
    throw new Error("Missing formula view");
  }
  return { view, editor, pluginState, node };
}

function pressSourceKey(
  view: KaTeXMathView,
  key: string,
  modifiers: KeyboardEventInit
): KeyboardEvent {
  const source = view.dom.querySelector(".math-src .ProseMirror");
  if (!source) {
    throw new Error("Missing formula source editor");
  }
  const event = new KeyboardEvent("keydown", {
    key,
    keyCode: key.toUpperCase().charCodeAt(0),
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  source.dispatchEvent(event);
  return event;
}

function mockFonts(ready: Promise<void> = Promise.resolve()) {
  const load = vi
    .fn<(font: string, text?: string) => Promise<FontFace[]>>()
    .mockResolvedValue([]);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load, ready },
  });
  return { load };
}

afterEach(() => {
  styles.finish();
  cleanup.splice(0).forEach((destroy) => destroy());
  vi.restoreAllMocks();
  if (originalFonts) {
    Object.defineProperty(document, "fonts", originalFonts);
  } else {
    Reflect.deleteProperty(document, "fonts");
  }
});

describe("prepareMathForPrint", () => {
  it("waits for the stylesheet, actual glyph fonts and the font set", async () => {
    createView("x^2");
    let finishFonts: () => void = () => undefined;
    let finishReady: () => void = () => undefined;
    const fonts = mockFonts(
      new Promise<void>((resolve) => {
        finishReady = resolve;
      })
    );
    fonts.load.mockReturnValueOnce(
      new Promise<FontFace[]>((resolve) => {
        finishFonts = () => resolve([]);
      })
    );
    const style = document.createElement("span").style;
    style.fontStyle = "italic";
    style.fontWeight = "400";
    style.fontSize = "18px";
    style.fontFamily = "KaTeX_Math";
    vi.spyOn(window, "getComputedStyle").mockReturnValue(style);
    let prepared = false;
    const result = prepareMathForPrint(document).then(() => {
      prepared = true;
    });

    await Promise.resolve();
    expect(fonts.load).not.toHaveBeenCalled();
    styles.finish();
    await vi.waitFor(() => expect(fonts.load).toHaveBeenCalledTimes(1));
    expect(fonts.load).toHaveBeenCalledWith(
      "italic 400 18px KaTeX_Math",
      expect.stringContaining("x")
    );
    expect(prepared).toBe(false);
    finishFonts();
    await Promise.resolve();
    expect(prepared).toBe(false);
    finishReady();
    await result;
    expect(prepared).toBe(true);
  });

  it("refreshes the latest source while a formula remains selected", async () => {
    const { view, editor, node } = createView("x^2");
    editor.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1))
    );
    view.dispatchInner(
      EditorState.create({ doc: node }).tr.insertText("y^3", 0, 3)
    );
    expect(editor.state.doc.textContent).toBe("y^3");
    expect(view.dom.querySelector("annotation")?.textContent).toBe("x^2");

    await prepareMathForPrint(document);

    expect(view.dom.querySelector("annotation")?.textContent).toBe("y^3");
    expect(view.dom.classList.contains("ProseMirror-selectednode")).toBe(true);
    expect(view.dom.querySelector(".math-src .ProseMirror")?.textContent).toBe(
      "y^3"
    );
  });

  it("loads every used font variant with its actual glyphs", async () => {
    createView("x+\\mathbf{A}");
    const fonts = mockFonts();
    vi.spyOn(window, "getComputedStyle").mockImplementation((glyph) => {
      const style = document.createElement("span").style;
      style.fontStyle = glyph.textContent === "x" ? "italic" : "normal";
      style.fontWeight = glyph.textContent === "A" ? "700" : "400";
      style.fontSize = "18px";
      style.fontFamily =
        glyph.textContent === "x" ? "KaTeX_Math" : "KaTeX_Main";
      return style;
    });

    await prepareMathForPrint(document);

    expect(fonts.load).toHaveBeenCalledWith("italic 400 18px KaTeX_Math", "x");
    expect(fonts.load).toHaveBeenCalledWith("normal 700 18px KaTeX_Main", "A");
  });

  it("waits for document fonts without loading formula fonts on a plain page", async () => {
    const fonts = mockFonts();

    await prepareMathForPrint(document);

    expect(fonts.load).not.toHaveBeenCalled();
  });
});

describe("KaTeXMathView", () => {
  it.each([
    [false, "x^2+\\frac{1}{2}"],
    [true, "\\sum_{i=1}^{n}i=\\frac{n(n+1)}{2}"],
    [true, "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}"],
  ])(
    "renders accessible KaTeX synchronously (display=%s)",
    (display, source) => {
      const { view } = createView(source, display);

      expect(view).toBeInstanceOf(KaTeXMathView);
      expect(
        view.dom.querySelector(".katex-html")?.getAttribute("aria-hidden")
      ).toBe("true");
      expect(view.dom.querySelector(".katex-mathml math")).not.toBeNull();
      expect(view.dom.querySelector("annotation")?.textContent).toBe(source);
      expect(!!view.dom.querySelector(".katex-display")).toBe(display);
      expect(view.dom.querySelector(".katex-error")).toBeNull();
      expect(view.dom.contentEditable).toBe("false");
    }
  );

  it("recovers from invalid LaTeX when the source is corrected", () => {
    const { view } = createView("\\frac{");
    expect(view.dom.querySelector(".katex-error")).not.toBeNull();

    expect(view.update(mathNode("\\frac{1}{2}"), [])).toBe(true);

    expect(view.dom.querySelector(".katex-error")).toBeNull();
    expect(view.dom.querySelector("annotation")?.textContent).toBe(
      "\\frac{1}{2}"
    );
  });

  it("clears empty formulas and renders them again after editing", () => {
    const { view } = createView("x");

    view.update(mathNode(""), []);
    expect(view.dom.classList.contains("empty-math")).toBe(true);
    expect(view.dom.querySelector(".math-render")?.textContent).toBe("");

    view.update(mathNode("y"), []);
    expect(view.dom.classList.contains("empty-math")).toBe(false);
    expect(view.dom.querySelector("annotation")?.textContent).toBe("y");
  });

  it("keeps macro definitions within one editor", () => {
    const { pluginState } = createEditor(
      schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [
          mathNode("\\gdef\\example{z}\\example"),
          mathNode("\\example+1"),
        ]),
      ])
    );
    const second = pluginState.activeNodeViews[1];
    expect(second?.dom.querySelector(".katex-html")?.textContent).toContain(
      "z"
    );

    const separate = createView("\\example");
    expect(
      separate.view.dom.querySelector(".katex-html")?.textContent
    ).toContain("\\example");
  });

  it.each([
    "\\href{https://example.com}{x}",
    "\\includegraphics{https://example.com/a.png}",
    "\\htmlClass{custom-formula}{x}",
  ])("keeps trusted commands disabled for %s", (source) => {
    const { view } = createView(source);

    expect(view.dom.querySelector("a, img, .custom-formula")).toBeNull();
  });

  it("synchronizes the nested source editor with the enclosing document", () => {
    const { view, editor, node } = createView("x^2");
    editor.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1))
    );
    expect(view.dom.querySelector(".math-src .ProseMirror")?.textContent).toBe(
      "x^2"
    );

    view.dispatchInner(
      EditorState.create({ doc: node }).tr.insertText("y^3", 0, 3)
    );
    expect(editor.state.doc.textContent).toBe("y^3");
    editor.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 0))
    );

    expect(view.dom.querySelector(".math-src .ProseMirror")).toBeNull();
    expect(view.dom.querySelector("annotation")?.textContent).toBe("y^3");
  });

  it.each(["ctrlKey", "metaKey"])(
    "restricts %s+A to the formula source",
    (key) => {
      const { view } = createView("x^2");
      view.selectNode();
      const event = new KeyboardEvent("keydown", {
        key: "a",
        [key]: true,
        bubbles: true,
        cancelable: true,
      });
      view.dom.querySelector(".math-src .ProseMirror")?.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(document.getSelection()?.toString()).toBe("x^2");
    }
  );

  it("does not intercept select-all outside the nested source editor", () => {
    const { view } = createView("x^2");
    const event = new KeyboardEvent("keydown", {
      key: "a",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    view.dom.querySelector(".math-render")?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it.each([
    [false, "ctrlKey"],
    [false, "metaKey"],
    [true, "ctrlKey"],
    [true, "metaKey"],
  ])(
    "uses the enclosing undo and redo keymaps (display=%s, %s)",
    (display, modifier) => {
      const { view, editor, node } = createView("x^2", display, [
        history(),
        keymap({
          "Ctrl-z": undo,
          "Meta-z": undo,
          "Shift-Ctrl-z": redo,
          "Shift-Meta-z": redo,
          "Ctrl-y": redo,
          "Meta-y": redo,
        }),
      ]);
      editor.dispatch(
        editor.state.tr.setSelection(
          NodeSelection.create(editor.state.doc, display ? 0 : 1)
        )
      );
      view.selectNode();
      view.dispatchInner(
        EditorState.create({ doc: node }).tr.insertText("y^3", 0, 3)
      );
      expect(editor.state.doc.textContent).toBe("y^3");

      expect(
        pressSourceKey(view, "z", { [modifier]: true }).defaultPrevented
      ).toBe(true);
      expect(editor.state.doc.textContent).toBe("x^2");
      expect(
        view.dom.querySelector(".math-src .ProseMirror")?.textContent
      ).toBe("x^2");

      expect(
        pressSourceKey(view, "Z", { [modifier]: true, shiftKey: true })
          .defaultPrevented
      ).toBe(true);
      expect(editor.state.doc.textContent).toBe("y^3");
      expect(
        view.dom.querySelector(".math-src .ProseMirror")?.textContent
      ).toBe("y^3");

      pressSourceKey(view, "z", { [modifier]: true });
      expect(editor.state.doc.textContent).toBe("x^2");
      expect(
        pressSourceKey(view, "y", { [modifier]: true }).defaultPrevented
      ).toBe(true);
      expect(editor.state.doc.textContent).toBe("y^3");
    }
  );

  it("uses the collaboration undo manager configured on the enclosing editor", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [mathNode("x^2")]),
    ]);
    const sharedDoc = prosemirrorToYDoc(doc);
    const { view, editor, node } = createView("x^2", false, [
      ySyncPlugin(sharedDoc.getXmlFragment("prosemirror")),
      yUndoPlugin(),
      keymap({
        "Mod-z": undoCommand,
        "Shift-Mod-z": redoCommand,
      }),
    ]);
    cleanup.push(() => sharedDoc.destroy());
    editor.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 1))
    );
    view.dispatchInner(
      EditorState.create({ doc: node }).tr.insertText("y^3", 0, 3)
    );
    expect(editor.state.doc.textContent).toBe("y^3");

    pressSourceKey(view, "z", { ctrlKey: true });

    expect(editor.state.doc.textContent).toBe("x^2");
    expect(view.dom.querySelector(".math-src .ProseMirror")?.textContent).toBe(
      "x^2"
    );

    pressSourceKey(view, "Z", { ctrlKey: true, shiftKey: true });

    expect(editor.state.doc.textContent).toBe("y^3");
    expect(view.dom.querySelector(".math-src .ProseMirror")?.textContent).toBe(
      "y^3"
    );
  });

  it("preserves configured handler precedence when forwarding source history keys", () => {
    const first = vi.fn(() => false);
    const second = vi.fn(() => true);
    const third = vi.fn(() => true);
    const { view, editor } = createView("x", false, [
      new Plugin({ props: { handleKeyDown: first } }),
      new Plugin({ props: { handleKeyDown: second } }),
      new Plugin({ props: { handleKeyDown: third } }),
    ]);
    view.selectNode();
    const event = pressSourceKey(view, "z", { ctrlKey: true });

    expect(first).toHaveBeenCalledWith(editor, event);
    expect(second).toHaveBeenCalledWith(editor, event);
    expect(third).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    { key: "z", ctrlKey: true, altKey: true },
    { key: "z" },
    { key: "y", ctrlKey: true, shiftKey: true },
    { key: "a", ctrlKey: true, shiftKey: true },
  ])(
    "does not forward unrelated source combinations: %j",
    ({ key, ...modifiers }) => {
      const handleKeyDown = vi.fn(() => true);
      const { view } = createView("x", false, [
        new Plugin({ props: { handleKeyDown } }),
      ]);
      view.selectNode();

      pressSourceKey(view, key, modifiers);

      expect(handleKeyDown).not.toHaveBeenCalled();
    }
  );

  it("keeps rendered formula history keys on the normal editor event path", () => {
    const handleKeyDown = vi.fn(() => false);
    const { view } = createView("x", false, [
      new Plugin({ props: { handleKeyDown } }),
    ]);
    const event = new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    view.dom.querySelector(".math-render")?.dispatchEvent(event);

    expect(handleKeyDown).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it("unregisters only the removed formula and handles repeated destruction", () => {
    const { editor, pluginState } = createEditor(
      schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, [
          mathNode("a"),
          mathNode("b"),
          mathNode("c"),
        ]),
      ])
    );
    const [first, middle, last] = pluginState.activeNodeViews;

    editor.dispatch(editor.state.tr.delete(4, 7));

    expect(pluginState.activeNodeViews).toEqual([first, last]);
    middle?.destroy();
    expect(pluginState.activeNodeViews).toEqual([first, last]);
    editor.destroy();
    expect(pluginState.activeNodeViews).toEqual([]);
  });

  it("reports a removed position without a type assertion", () => {
    const { editor } = createView("x");
    const view = createMathView(false)(
      mathNode("y"),
      editor,
      () => undefined,
      [],
      DecorationSet.empty
    );
    if (!(view instanceof KaTeXMathView)) {
      throw new Error("Missing formula view");
    }
    cleanup.push(() => view.destroy());

    expect(() => view.updateCursorPos(editor.state)).toThrow(
      "Math node is no longer in the document"
    );
  });
});
