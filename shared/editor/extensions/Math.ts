import { isNode } from "@shared/utils/browser";
import type { PluginSpec } from "prosemirror-state";
import { Plugin, PluginKey } from "prosemirror-state";
import type { NodeViewConstructor } from "prosemirror-view";
import { KaTeXMathView } from "../components/MathView";

/** Formula macros, node views and the previous cursor position for one editor. */
export interface IMathPluginState {
  macros: { [cmd: string]: string };
  activeNodeViews: KaTeXMathView[];
  prevCursorPos: number;
}

const MATH_PLUGIN_KEY = new PluginKey<IMathPluginState>("prosemirror-math");
const views = new WeakMap<Element, KaTeXMathView>();
let stylesheet: Promise<void> | undefined;

/**
 * Loads the formula styles and fonts needed by the print layout.
 *
 * @param document the page that is about to be printed.
 * @returns a promise that resolves when formulas and their fonts are ready.
 */
export async function prepareMathForPrint(document: Document): Promise<void> {
  const nodes = [...document.querySelectorAll(".math-node")];
  for (const node of nodes) {
    views.get(node)?.renderMath();
  }
  if (nodes.length) {
    await loadMathStyles();
  }

  const window = document.defaultView;
  if (!window || !document.fonts) {
    return;
  }

  const fonts = new Map<string, string>();
  for (const node of nodes) {
    for (const glyph of node.querySelectorAll(".katex-html *")) {
      if (glyph.children.length || !glyph.textContent) {
        continue;
      }
      const style = window.getComputedStyle(glyph);
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      fonts.set(font, (fonts.get(font) ?? "") + glyph.textContent);
    }
  }
  await Promise.all(
    [...fonts].map(([font, text]) => document.fonts.load(font, text))
  );
  await document.fonts.ready;
}

/**
 * Creates a synchronous KaTeX node view with an editable formula source.
 *
 * @param displayMode whether the formula is a block equation.
 * @returns the node view constructor.
 */
export function createMathView(displayMode: boolean): NodeViewConstructor {
  return (node, view, getPos) => {
    void loadMathStyles();

    const pluginState = MATH_PLUGIN_KEY.getState(view.state);
    if (!pluginState) {
      throw new Error("no math plugin!");
    }
    const nodeViews = pluginState.activeNodeViews;
    const nodeView = new KaTeXMathView(
      node,
      view,
      () => {
        const pos = getPos();
        if (pos === undefined) {
          throw new Error("Math node is no longer in the document");
        }
        return pos;
      },
      {
        katexOptions: {
          displayMode,
          output: "htmlAndMathml",
          trust: false,
          macros: pluginState.macros,
        },
      },
      MATH_PLUGIN_KEY,
      () => {
        views.delete(nodeView.dom);
        const index = nodeViews.indexOf(nodeView);
        if (index !== -1) {
          nodeViews.splice(index, 1);
        }
      }
    );

    nodeViews.push(nodeView);
    views.set(nodeView.dom, nodeView);
    return nodeView;
  };
}

function loadMathStyles(): Promise<void> {
  if (isNode) {
    return Promise.resolve();
  }
  return (stylesheet ??= import("katex/dist/katex.min.css").then(
    () => undefined
  ));
}

const mathPluginSpec: PluginSpec<IMathPluginState> = {
  key: MATH_PLUGIN_KEY,
  state: {
    init() {
      return {
        macros: {},
        activeNodeViews: [],
        prevCursorPos: 0,
      };
    },
    apply(tr, value, oldState) {
      return {
        activeNodeViews: value.activeNodeViews,
        macros: value.macros,
        prevCursorPos: oldState.selection.from,
      };
    },
  },
  props: {
    nodeViews: {
      math_inline: createMathView(false),
      math_block: createMathView(true),
    },
  },
};

export default new Plugin(mathPluginSpec);
