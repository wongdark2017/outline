import type { Node, ResolvedPos } from "prosemirror-model";
import type { EditorState, Selection, Transaction } from "prosemirror-state";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { isInlineImageIcon } from "../components/Image";
import { changedDescendants } from "../lib/changedDescendants";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";

interface ImageBlock {
  node: Node;
  pos: number;
  imagePos: number;
}

/**
 * Keeps standalone block images atomic while directing text input below them.
 *
 * @returns the image block selection, decoration, and input plugin.
 */
export function imageBlockPlugin(): Plugin<DecorationSet> {
  const key = new PluginKey<DecorationSet>("image-block");
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => createDecorations(state.doc),
      apply: (tr, decorations) => {
        if (!tr.docChanged) {
          return decorations;
        }
        return hasImageParagraphChange(tr)
          ? createDecorations(tr.doc)
          : decorations.map(tr.mapping, tr.doc);
      },
    },
    appendTransaction: (_transactions, _oldState, state) => {
      if (!(state.selection instanceof TextSelection)) {
        return null;
      }
      const block = selectedImageBlock(state.selection);
      return block
        ? state.tr
            .setSelection(NodeSelection.create(state.doc, block.imagePos))
            .setMeta("addToHistory", false)
        : null;
    },
    props: {
      decorations: (state) => key.getState(state),
      handleDOMEvents: {
        mousedown: (view, event) => {
          if (
            !view.editable ||
            event.button !== 0 ||
            !(event.target instanceof Element) ||
            event.target.closest(
              `.image-wrapper, .${EditorStyleHelper.imageCaption}`
            )
          ) {
            return false;
          }
          const paragraph = event.target.closest('p[data-image-block="true"]');
          if (!paragraph || !view.dom.contains(paragraph)) {
            return false;
          }
          const block = imageBlockAt(
            view.state.doc.resolve(view.posAtDOM(paragraph, 0))
          );
          if (!block) {
            return false;
          }
          event.preventDefault();
          view.dispatch(
            view.state.tr.setSelection(
              NodeSelection.create(view.state.doc, block.imagePos)
            )
          );
          view.focus();
          return true;
        },
        compositionstart: (view, event) => {
          if (!view.editable || isCaptionEvent(event)) {
            return false;
          }
          const block = selectedImageBlock(view.state.selection);
          const tr = block && moveBelow(view.state, block);
          if (tr) {
            view.dispatch(tr);
            view.focus();
          }
          return false;
        },
      },
      handleKeyDown: (view, event) => {
        if (!view.editable || isCaptionEvent(event)) {
          return false;
        }
        const block = selectedImageBlock(view.state.selection);
        if (!block) {
          return false;
        }
        const navigate = event.key === "Enter" || event.key === "ArrowDown";
        const startsComposition =
          event.key === "Process" || event.keyCode === 229;
        const typing =
          event.key?.length === 1 &&
          event.key !== " " &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.isComposing;
        if (!navigate && !typing && !startsComposition) {
          return false;
        }
        const tr = moveBelow(view.state, block, event.key === "ArrowDown");
        if (!tr) {
          return false;
        }
        view.dispatch(tr.scrollIntoView());
        if (navigate) {
          event.preventDefault();
        }
        return navigate;
      },
      handleTextInput: (view, _from, _to, text) => {
        if (!view.editable) {
          return false;
        }
        const block = selectedImageBlock(view.state.selection);
        const tr = block && moveBelow(view.state, block);
        if (!tr) {
          return false;
        }
        view.dispatch(tr.insertText(text).scrollIntoView());
        return true;
      },
      handlePaste: (view, event, slice) => {
        if (!view.editable || isCaptionEvent(event)) {
          return false;
        }
        const block = selectedImageBlock(view.state.selection);
        const tr = block && moveBelow(view.state, block);
        if (!tr) {
          return false;
        }
        view.dispatch(tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
  });
}

/** Whether a paragraph holds exactly one image with block display semantics. */
function isImageParagraph(node: Node): boolean {
  const image = node.firstChild;
  return (
    node.type.name === "paragraph" &&
    node.childCount === 1 &&
    image?.type.name === "image" &&
    !isInlineImageIcon({
      source: image.attrs.source,
      width: image.attrs.width,
      layoutClass: image.attrs.layoutClass,
    })
  );
}

/** Finds the standalone image paragraph containing a document position. */
function imageBlockAt($pos: ResolvedPos): ImageBlock | undefined {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (isImageParagraph(node)) {
      const pos = $pos.before(depth);
      return { node, pos, imagePos: pos + 1 };
    }
  }
  return;
}

/** Accepts image/paragraph node selections and text confined to an image row. */
function selectedImageBlock(selection: Selection): ImageBlock | undefined {
  if (selection instanceof NodeSelection && isImageParagraph(selection.node)) {
    return {
      node: selection.node,
      pos: selection.from,
      imagePos: selection.from + 1,
    };
  }
  if (
    !(selection instanceof TextSelection) &&
    !(
      selection instanceof NodeSelection && selection.node.type.name === "image"
    )
  ) {
    return;
  }
  const block = imageBlockAt(selection.$from);
  if (
    block &&
    selection.from > block.pos &&
    selection.to < block.pos + block.node.nodeSize
  ) {
    return block;
  }
  return;
}

/** Reuses an empty paragraph below the image, or inserts one in the same parent. */
function moveBelow(
  state: EditorState,
  block: ImageBlock,
  navigate = false
): Transaction | undefined {
  const after = block.pos + block.node.nodeSize;
  const next = state.doc.nodeAt(after);
  const tr = state.tr;
  if (
    next?.type.name === "paragraph" &&
    (navigate || next.content.size === 0)
  ) {
    return tr.setSelection(TextSelection.create(tr.doc, after + 1));
  }
  const paragraph = state.schema.nodes.paragraph;
  const $after = state.doc.resolve(after);
  if (
    !paragraph ||
    !$after.parent.canReplaceWith($after.index(), $after.index(), paragraph)
  ) {
    return;
  }
  tr.insert(after, paragraph.create());
  return tr.setSelection(TextSelection.create(tr.doc, after + 1));
}

/** Captions own their editable DOM and must retain their existing input handlers. */
function isCaptionEvent(event: Event): boolean {
  return (
    event.target instanceof Element &&
    !!event.target.closest(`.${EditorStyleHelper.imageCaption}`)
  );
}

/** Rebuilds only when an old or new image paragraph was actually changed. */
function hasImageParagraphChange(tr: Transaction): boolean {
  let changed = false;
  const check = (node: Node) => {
    if (isImageParagraph(node)) {
      changed = true;
    }
  };
  changedDescendants(tr.before, tr.doc, 0, check);
  if (!changed) {
    changedDescendants(tr.doc, tr.before, 0, check);
  }
  return changed;
}

/** Creates view-only boundaries without changing the stored image schema. */
function createDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (isImageParagraph(node)) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          contenteditable: "false",
          "data-image-block": "true",
        })
      );
      return false;
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}
