import { EditorState, NodeSelection } from "prosemirror-state";
import { buildSelectionContext } from "@shared/editor/lib/buildSelectionContext";
import { ImageSource } from "@shared/editor/lib/FileHelper";
import { schema } from "@shared/test/editor";
import imageMenuItems from "./image";

describe("image alignment controls", () => {
  it.each([
    { source: ImageSource.Tikz, width: 38, visible: true },
    { source: ImageSource.Tikz, width: 260, visible: true },
    { source: null, width: 38, visible: false },
    { source: null, width: 48, visible: true },
  ])("uses the image layout for $source at $width px", (testCase) => {
    const image = schema.nodes.image.create({
      src: "https://example.com/image.svg",
      source: testCase.source,
      width: testCase.width,
    });
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, image)
    );
    const state = EditorState.create({
      schema,
      doc,
      selection: NodeSelection.create(doc, 1),
    });
    const items = imageMenuItems(
      buildSelectionContext(state, {
        readOnly: false,
        isTemplate: false,
        rtl: false,
      }),
      false
    );

    for (const name of [
      "alignLeft",
      "alignCenter",
      "alignRight",
      "alignFullWidth",
    ]) {
      expect(items.find((item) => item.name === name)?.visible).toBe(
        testCase.visible
      );
    }
    expect(items.find((item) => item.name === "editTikz")?.visible).toBe(
      testCase.source === ImageSource.Tikz
    );
  });
});
