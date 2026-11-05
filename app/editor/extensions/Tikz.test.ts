import type { Node } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import { schema } from "@shared/test/editor";
import ExtensionManager from "@shared/editor/lib/ExtensionManager";
import FileHelper, { ImageSource } from "@shared/editor/lib/FileHelper";
import { findImageNodeBySrc } from "@shared/editor/queries/findImageNodeBySrc";
import { TikzExtension } from "./Tikz";
import { TikzSession } from "./TikzSession";

const originalSrc = "/diagram.svg";
const uploadedSrc = "/updated.svg";

/** Creates an extension with live document transactions and a deferred upload. */
function createSession(content: Node[], imagePosition?: number) {
  const extension = new TikzExtension();
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, content),
    plugins: extension.plugins,
  });
  const dispatch = (transaction: Transaction) => {
    state = state.apply(transaction);
  };
  let completeUpload: (src: string) => void = () => undefined;
  const upload = new Promise<string>((resolve) => {
    completeUpload = resolve;
  });
  Object.defineProperty(extension, "editor", {
    value: {
      schema,
      props: { readOnly: false, uploadFile: () => upload },
      view: {
        get state() {
          return state;
        },
        dispatch,
        editable: true,
        isDestroyed: false,
        focus: vi.fn(),
      },
    },
  });
  const session = new TikzSession({
    source: "original",
    imageSrc: imagePosition === undefined ? undefined : originalSrc,
    imagePosition,
  });
  extension["open"](session);

  return {
    extension,
    session,
    dispatch,
    completeUpload,
    save: () => session.save("<svg/>", extension["handleSave"]),
    get state() {
      return state;
    },
  };
}

const diagram = (alt: string) =>
  schema.nodes.paragraph.create(
    null,
    schema.nodes.image.create({
      src: originalSrc,
      source: ImageSource.Tikz,
      alt,
      width: 100,
      height: 80,
      layoutClass: "left-50",
      marks: [{ type: "link", attrs: { href: "https://example.com" } }],
    })
  );

beforeEach(() => {
  vi.spyOn(FileHelper, "getImageDimensions").mockResolvedValue({
    width: 640,
    height: 360,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("TikzExtension", () => {
  it("registers its widget before any editing session is opened", () => {
    const manager = new ExtensionManager([TikzExtension]);

    expect(manager.widgets).toHaveProperty("tikz");
  });

  it("updates the selected duplicate after position changes and preserves its attributes", async () => {
    const first = diagram("First");
    const position = first.nodeSize + 1;
    const harness = createSession([first, diagram("Selected")], position);
    const saving = harness.save();
    const introduction = schema.nodes.paragraph.create(
      null,
      schema.text("Introduction")
    );
    harness.dispatch(harness.state.tr.insert(0, introduction));
    harness.completeUpload(uploadedSrc);

    expect(await saving).toBe(true);
    expect(harness.state.doc.nodeAt(introduction.nodeSize + 1)?.attrs.src).toBe(
      originalSrc
    );
    expect(
      harness.state.doc.nodeAt(introduction.nodeSize + position)?.attrs
    ).toMatchObject({
      src: uploadedSrc,
      alt: "Selected",
      width: 100,
      height: 80,
      layoutClass: "left-50",
      source: ImageSource.Tikz,
      marks: [{ type: "link", attrs: { href: "https://example.com" } }],
    });
  });

  it("does not retarget a duplicate after the original is deleted during upload", async () => {
    const first = diagram("First");
    const selected = diagram("Selected");
    const position = first.nodeSize + 1;
    const harness = createSession([first, selected], position);
    const saving = harness.save();
    harness.dispatch(
      harness.state.tr.delete(position, position + selected.content.size)
    );
    harness.completeUpload(uploadedSrc);

    expect(await saving).toBe(false);
    expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe(originalSrc);
    expect(findImageNodeBySrc(harness.state.doc, uploadedSrc)).toBeUndefined();
    expect(harness.session.error).toBe("save");
  });

  it("preserves resizing and alignment changes made before and during upload", async () => {
    const harness = createSession([diagram("Selected")], 1);
    const original = harness.state.doc.nodeAt(1);
    harness.dispatch(
      harness.state.tr.setNodeMarkup(1, undefined, {
        ...original?.attrs,
        width: 240,
        height: 120,
      })
    );
    expect(harness.session.targetPosition).toBe(1);
    const saving = harness.save();
    const resized = harness.state.doc.nodeAt(1);
    const introduction = schema.nodes.paragraph.create(
      null,
      schema.text("Introduction")
    );
    harness.dispatch(
      harness.state.tr
        .setNodeMarkup(1, undefined, {
          ...resized?.attrs,
          layoutClass: "right-50",
        })
        .insert(0, introduction)
    );
    harness.completeUpload(uploadedSrc);

    expect(await saving).toBe(true);
    expect(
      harness.state.doc.nodeAt(introduction.nodeSize + 1)?.attrs
    ).toMatchObject({
      src: uploadedSrc,
      alt: "Selected",
      width: 240,
      height: 120,
      layoutClass: "right-50",
    });
  });

  it.each([originalSrc, "/replacement.svg"])(
    "rejects structural image replacement even when its URL is %s",
    async (replacementSrc) => {
      const selected = diagram("Selected");
      const harness = createSession([selected], 1);
      const saving = harness.save();
      harness.dispatch(
        harness.state.tr.replaceWith(
          1,
          1 + selected.content.size,
          schema.nodes.image.create({
            src: replacementSrc,
            source: ImageSource.Tikz,
          })
        )
      );
      harness.completeUpload(uploadedSrc);

      expect(await saving).toBe(false);
      expect(harness.session.targetPosition).toBeUndefined();
      expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe(replacementSrc);
    }
  );

  it("rejects an image source-type change during upload", async () => {
    const harness = createSession([diagram("Selected")], 1);
    const saving = harness.save();
    const original = harness.state.doc.nodeAt(1);
    harness.dispatch(
      harness.state.tr.setNodeMarkup(1, undefined, {
        ...original?.attrs,
        source: ImageSource.DiagramsNet,
      })
    );
    harness.completeUpload(uploadedSrc);

    expect(await saving).toBe(false);
    expect(harness.session.targetPosition).toBeUndefined();
    expect(harness.state.doc.nodeAt(1)?.attrs.source).toBe(
      ImageSource.DiagramsNet
    );
  });

  it("does not commit an upload after a source edit invalidates it", async () => {
    const harness = createSession([diagram("Selected")], 1);
    const saving = harness.save();
    harness.session.cancelPendingSave();
    harness.completeUpload(uploadedSrc);

    expect(await saving).toBe(false);
    expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe(originalSrc);
    expect(harness.session.error).toBeUndefined();
  });

  it("does not commit an upload or change a newer editing session", async () => {
    const harness = createSession([diagram("Selected")], 1);
    const saving = harness.save();
    const next = new TikzSession({ source: "new session" });
    harness.extension["open"](next);
    harness.completeUpload(uploadedSrc);

    expect(await saving).toBe(false);
    expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe(originalSrc);
    expect(harness.extension["session"]).toBe(next);
    expect(next.isActive).toBe(true);
  });
});
