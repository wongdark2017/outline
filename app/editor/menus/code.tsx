import { CopyIcon, EditIcon, TextWrapIcon } from "outline-icons";
import { NodeSelection } from "prosemirror-state";
import {
  pluginKey as mermaidPluginKey,
  type MermaidState,
} from "@shared/editor/extensions/Mermaid";
import { getLabelForLanguage } from "@shared/editor/lib/code";
import { isMermaid } from "@shared/editor/lib/isCode";
import { t } from "i18next";
import type { MenuItem, SelectionContext } from "@shared/editor/types";
import { metaDisplay } from "@shared/utils/keyboard";
import { CodeLanguagePicker } from "../components/CodeLanguagePicker";

/**
 * Returns menu items for the code block selection toolbar.
 *
 * @param ctx - the current selection context.
 * @returns an array of menu items.
 */
export default function codeMenuItems(ctx: SelectionContext): MenuItem[] {
  const { state, readOnly } = ctx;
  const node =
    state.selection instanceof NodeSelection
      ? state.selection.node
      : state.selection.$from.node();

  const isEditingMermaid = !!(mermaidPluginKey.getState(state) as MermaidState)
    ?.editingId;

  return [
    {
      name: "copyToClipboard",
      icon: <CopyIcon />,
      label: readOnly
        ? getLabelForLanguage(node.attrs.language ?? "none")
        : undefined,
      tooltip: t("Copy"),
    },
    {
      name: "separator",
    },
    {
      name: "edit_mermaid",
      icon: <EditIcon />,
      tooltip: t("Edit diagram"),
      shortcut: `${metaDisplay} Enter`,
      visible: isMermaid(node) && !isEditingMermaid && !readOnly,
    },
    {
      name: "separator",
    },
    {
      name: "toggleCodeBlockWrap",
      icon: <TextWrapIcon />,
      tooltip: t("Wrap text"),
      active: () => node.attrs.wrap,
      visible: !readOnly && (!isMermaid(node) || isEditingMermaid),
    },
    {
      name: "separator",
    },
    {
      name: "code_block",
      content: <CodeLanguagePicker language={node.attrs.language ?? "none"} />,
      visible: !readOnly,
    },
  ];
}
