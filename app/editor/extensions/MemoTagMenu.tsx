import { action } from "mobx";
import type { Command } from "prosemirror-state";
import type { Primitive } from "utility-types";
import type { WidgetProps } from "@shared/editor/lib/Extension";
import Suggestion from "~/editor/extensions/Suggestion";
import MemoTagMenu from "../components/MemoTagMenu";

export default class MemoTagMenuExtension extends Suggestion {
  get defaultOptions() {
    return {
      trigger: "#",
      allowSpaces: false,
      requireSearchTerm: false,
      enabledInCode: false,
    };
  }

  get name() {
    return "memo-tag-menu";
  }

  widget = ({ rtl }: WidgetProps) => (
    <MemoTagMenu
      rtl={rtl}
      trigger={this.options.trigger}
      isActive={this.state.open}
      search={this.state.query}
      onClose={action(() => {
        this.state.open = false;
      })}
    />
  );

  commands() {
    return {
      insertText:
        (attrs?: Record<string, Primitive | null>): Command =>
        (state, dispatch) => {
          const text = typeof attrs?.text === "string" ? attrs.text : "";
          const label = text.trim().replace(/^#/, "");
          const type = state.schema.nodes.memo_tag;

          if (!label || !type) {
            return false;
          }

          dispatch?.(state.tr.replaceSelectionWith(type.create({ label })));
          return true;
        },
    };
  }
}
