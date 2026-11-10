import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { LazyMotion, domAnimation } from "framer-motion";
import { Schema } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history } from "prosemirror-history";
import toggleBlockType from "@shared/editor/commands/toggleBlockType";
import { setRecentlyUsedCodeLanguage } from "@shared/editor/lib/code";
import EditorContext from "~/editor/components/EditorContext";
import { SelectionToolbar } from "~/editor/components/SelectionToolbar";
import codeMenuItems from "~/editor/menus/code";
import { light, buildDarkTheme } from "@shared/styles/theme";
import * as Dialog from "@radix-ui/react-dialog";
import { ActionContext } from "~/hooks/useActionContext";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "@shared/i18n/locales/zh_CN/translation.json";

await i18next
  .use(initReactI18next)
  .init({
    lng: "zh_CN",
    fallbackLng: "en_US",
    resources: { zh_CN: { translation: zh } },
    interpolation: { escapeValue: false },
  });
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", toDOM: () => ["p", 0] },
    text: { group: "inline" },
    code_block: {
      content: "text*",
      group: "block",
      code: true,
      attrs: { language: { default: "none" }, wrap: { default: false } },
      toDOM: (node) => [
        "pre",
        { "data-language": node.attrs.language },
        ["code", 0],
      ],
    },
  },
  marks: {
    link: {
      attrs: { href: { default: "" } },
      toDOM: (mark) => ["a", { href: mark.attrs.href }, 0],
    },
  },
});
const params = new URLSearchParams(location.search);
const readOnly = params.has("readonly");
const theme = params.has("dark") ? buildDarkTheme({}) : light;
const first = schema.node(
  "paragraph",
  null,
  schema.text("语言选择器浏览器验收")
);
const code = schema.node(
  "code_block",
  { language: "javascript" },
  schema.text('const message = "Hello";\nconsole.log(message);')
);
const doc = schema.node("doc", null, [first, code]);

function Fixture() {
  const [editor, setEditor] = useState(null);
  const [, render] = useState(0);
  useEffect(() => {
    const initial = EditorState.create({ schema, doc, plugins: [history()] });
    const view = new EditorView(document.querySelector("#editor"), {
      state: initial.apply(
        initial.tr.setSelection(TextSelection.create(doc, first.nodeSize + 2))
      ),
      editable: () => !readOnly,
      dispatchTransaction: (tr) => {
        view.updateState(view.state.apply(tr));
        render((n) => n + 1);
      },
    });
    const fixture = {
      view,
      commandCalls: 0,
      commands: {
        code_block: (attrs) => {
          fixture.commandCalls++;
          setRecentlyUsedCodeLanguage(attrs.language);
          toggleBlockType(
            schema.nodes.code_block,
            schema.nodes.paragraph,
            attrs
          )(view.state, view.dispatch);
        },
        copyToClipboard: () => {},
        toggleCodeBlockWrap: () => {},
        edit_mermaid: () => {},
      },
      extensions: { extensions: [] },
      selectionToolbarMenus: [
        { matches: () => true, getItems: codeMenuItems, sticky: true },
      ],
    };
    window.fixture = fixture;
    setEditor(fixture);
    view.focus();
    return () => view.destroy();
  }, []);
  return (
    <ThemeProvider theme={theme}>
      <ActionContext.Provider value={{}}>
        <LazyMotion features={domAnimation}>
          <style>
            {"body{margin:0;padding:80px 24px;background:" +
              theme.background +
              ";color:" +
              theme.text +
              ";font-family:Arial,sans-serif}#editor{max-width:760px;margin:auto}.ProseMirror{outline:none}pre{padding:48px 20px 30px;background:" +
              theme.codeBackground +
              ";white-space:pre-wrap;font:15px/1.6 monospace;min-height:180px}button,input{font:inherit}*{box-sizing:border-box}"}
          </style>
          {editor && (
            <EditorContext.Provider value={editor}>
              <SelectionToolbar
                rtl={false}
                isTemplate={false}
                isActive
                isEditorFocused
                selection={editor.view.state.selection}
                readOnly={readOnly}
              />
            </EditorContext.Provider>
          )}
          <Dialog.Root>
            <Dialog.Trigger id="dialog-trigger">Dialog smoke</Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay
                style={{ position: "fixed", inset: 0, background: "#0006" }}
              />
              <Dialog.Content
                style={{
                  position: "fixed",
                  top: "20%",
                  left: "20%",
                  background: theme.menuBackground,
                  padding: 24,
                }}
              >
                <Dialog.Title>Dialog smoke</Dialog.Title>
                <Dialog.Description>Focus regression</Dialog.Description>
                <input id="dialog-input" />
                <Dialog.Close id="dialog-close">Close</Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </LazyMotion>
      </ActionContext.Provider>
    </ThemeProvider>
  );
}
createRoot(document.querySelector("#root")).render(<Fixture />);
