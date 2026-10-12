import { createEditorState, doc, p, schema } from "@shared/test/editor";
import Suggestion from "./Suggestion";

class TestSuggestion extends Suggestion {
  get defaultOptions() {
    return {
      trigger: "#",
      allowSpaces: false,
      requireSearchTerm: false,
      enabledInCode: false,
    };
  }

  get query() {
    return this.state.query;
  }
}

describe("Suggestion", () => {
  it("keeps an empty query string when only the trigger character is typed", () => {
    const extension = new TestSuggestion({});
    const [rule] = extension.inputRules({
      type: schema.nodes.paragraph,
      schema,
    });
    const state = createEditorState(doc(p("#")));
    const match = rule.match.exec("#");

    expect(match).toBeTruthy();
    expect(match?.[1]).toBeUndefined();

    rule.handler(state, match!, 0, 0);

    expect(extension.isOpen).toBe(true);
    expect(extension.query).toBe("");
  });
});
