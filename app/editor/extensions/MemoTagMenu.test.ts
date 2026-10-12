import { TextSelection } from "prosemirror-state";
import { createEditorStateWithSelection, schema } from "@shared/test/editor";

vi.mock("../components/MemoTagMenu", () => ({
  default: () => null,
}));

import MemoTagMenuExtension from "./MemoTagMenu";

describe("MemoTagMenuExtension", () => {
  it("inserts a memo_tag node instead of plain text", () => {
    const extension = new MemoTagMenuExtension({});
    const state = createEditorStateWithSelection(
      schema.node("doc", null, [schema.node("paragraph")]),
      1
    );

    let nextState = state;
    const dispatch = (tr: typeof state.tr) => {
      nextState = nextState.apply(tr);
    };

    const command = extension.commands().insertText({
      text: "#alpha/beta",
    });

    expect(command(nextState, dispatch)).toBe(true);

    const paragraph = nextState.doc.firstChild;
    expect(paragraph?.childCount).toBe(1);
    expect(paragraph?.firstChild?.type.name).toBe("memo_tag");
    expect(paragraph?.firstChild?.attrs.label).toBe("alpha/beta");
    expect(nextState.selection).toBeInstanceOf(TextSelection);
  });
});
