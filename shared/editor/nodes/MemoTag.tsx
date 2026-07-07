import type { Node as ProsemirrorNode, NodeSpec } from "prosemirror-model";
import type { MarkdownSerializerState } from "../lib/markdown/serializer";
import Node from "./Node";

/**
 * Inline memo tag node used for quick-capture tags such as `#tag/subtag`.
 */
export default class MemoTag extends Node {
  get name() {
    return "memo_tag";
  }

  get schema(): NodeSpec {
    return {
      attrs: {
        label: {
          default: "",
          validate: "string",
        },
      },
      inline: true,
      marks: "",
      group: "inline",
      atom: true,
      parseDOM: [
        {
          priority: 100,
          tag: "span.memo-tag",
          preserveWhitespace: "full",
          getAttrs: (dom: HTMLElement) => {
            const label = dom.dataset.label ?? dom.innerText.replace(/^#/, "");
            return label
              ? {
                  label,
                }
              : false;
          },
        },
      ],
      toDOM: (node) => [
        "span",
        {
          class: "memo-tag mention",
          "data-label": node.attrs.label,
        },
        `#${node.attrs.label}`,
      ],
      leafText: (node) => `#${node.attrs.label}`,
    };
  }

  toMarkdown(state: MarkdownSerializerState, node: ProsemirrorNode) {
    state.write(`#${node.attrs.label}`);
  }
}
