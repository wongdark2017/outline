import type { Node } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import { schema } from "../../test/editor";
import { ImageSource } from "../lib/FileHelper";
import { findImageNodeBySrc } from "../queries/findImageNodeBySrc";
import Diagrams from "./Diagrams";

const src = "https://example.com/diagram.svg";
const uploadedUrl = "https://example.com/updated.svg";

/** Creates a diagram session backed by a real document and live transactions. */
function createSession(content: Node[]) {
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, content),
  });
  const dispatch = (tr: Transaction) => {
    state = state.apply(tr);
  };
  const extension = new Diagrams();
  Object.defineProperty(extension, "editor", {
    value: {
      schema,
      view: {
        get state() {
          return state;
        },
        dispatch,
      },
    },
  });
  return {
    extension,
    dispatch,
    get state() {
      return state;
    },
  };
}

const diagram = (alt: string) =>
  schema.nodes.paragraph.create(
    null,
    schema.nodes.image.create({
      src,
      source: ImageSource.DiagramsNet,
      alt,
      layoutClass: "left-50",
      width: 100,
      height: 80,
    })
  );

describe("Diagrams document updates", () => {
  it("updates the current position and preserves existing image attributes", () => {
    const session = createSession([diagram("Caption")]);
    session.dispatch(
      session.state.tr.insert(
        0,
        schema.nodes.paragraph.create(null, schema.text("New introduction"))
      )
    );
    session.extension["updateDiagramInDocument"](
      uploadedUrl,
      { width: 640, height: 360 },
      src
    );

    const updated = findImageNodeBySrc(session.state.doc, uploadedUrl);
    expect(updated?.pos).toBeGreaterThan(1);
    expect(updated?.node.attrs).toMatchObject({
      alt: "Caption",
      layoutClass: "left-50",
      source: ImageSource.DiagramsNet,
      width: 640,
      height: 360,
    });
  });

  it("uses the shared first-match rule when a URL appears more than once", () => {
    const session = createSession([diagram("First"), diagram("Last")]);
    session.extension["updateDiagramInDocument"](uploadedUrl, {}, src);

    expect(
      findImageNodeBySrc(session.state.doc, uploadedUrl)?.node.attrs.alt
    ).toBe("First");
    expect(findImageNodeBySrc(session.state.doc, src)?.node.attrs.alt).toBe(
      "Last"
    );
  });

  it("retains the existing insert fallback when the source is absent", () => {
    const session = createSession([
      schema.nodes.paragraph.create(null, schema.text("Document")),
    ]);
    session.extension["updateDiagramInDocument"](
      uploadedUrl,
      { width: 320, height: 180 },
      src
    );

    expect(
      findImageNodeBySrc(session.state.doc, uploadedUrl)?.node.attrs
    ).toMatchObject({
      source: ImageSource.DiagramsNet,
      width: 320,
      height: 180,
    });
    expect(session.state.doc.textContent).toBe("Document");
  });
});
