import { createEditorStateWithSelection, doc, p } from "@shared/test/editor";
import { SuggestionsMenuPlugin } from "./SuggestionsMenuPlugin";

describe("SuggestionsMenuPlugin", () => {
  it("stores an empty string query when only the trigger character is present", async () => {
    const extensionState = {
      open: false,
      query: "previous",
    };
    const regex = /(?:^|\s|\(|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])#([\p{L}\p{M}\d.\-_]+)?$/u;
    const plugin = new SuggestionsMenuPlugin(extensionState, regex);
    const state = createEditorStateWithSelection(doc(p("#")), 2, [plugin]);
    const view = {
      state,
      composing: false,
    } as const;
    const event = {
      key: "#",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    } as const;

    plugin.props.handleKeyDown(view, event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(extensionState.open).toBe(true);
    expect(extensionState.query).toBe("");
  });
});
