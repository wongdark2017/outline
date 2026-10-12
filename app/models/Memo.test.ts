import { Node } from "prosemirror-model";
import type { ProsemirrorData } from "@shared/types";
import { schema } from "@shared/test/editor";
import Memo from "./Memo";

describe("Memo model", () => {
  it("preserves content as valid ProseMirror JSON", () => {
    const content: ProsemirrorData = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "memo content" }],
        },
      ],
    };

    const memo = new Memo(
      {
        id: "memo-1",
        content,
        tags: [],
        visibility: "private",
        userId: "user-1",
        teamId: "team-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { rootStore: {} } as never
    );

    expect(() => Node.fromJSON(schema, memo.content)).not.toThrow();
  });
});
