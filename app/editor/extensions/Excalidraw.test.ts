import { Slice, type Node } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { ySyncPluginKey } from "y-prosemirror";
import { schema } from "@shared/test/editor";
import FileHelper, { ImageSource } from "@shared/editor/lib/FileHelper";
import { toastNotice } from "../toastNotice";
import { ExcalidrawExtension } from "./Excalidraw";
import { ExcalidrawSession } from "./ExcalidrawSession";

vi.mock("../toastNotice", () => ({ toastNotice: vi.fn() }));

const originalSrc = "/drawing.svg";

function drawing(alt: string) {
  return schema.nodes.paragraph.create(
    null,
    schema.nodes.image.create({
      src: originalSrc,
      source: ImageSource.Excalidraw,
      alt,
      width: 200,
      height: 100,
    })
  );
}

function createHarness(
  content: Node[],
  imagePosition = 1,
  imageSrc = originalSrc,
  open = true
) {
  const extension = new ExcalidrawExtension();
  const state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, content),
    plugins: extension.plugins,
  });
  const view = new EditorView(document.createElement("div"), {
    state,
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction));
    },
  });
  const dispatch = (transaction: Transaction) => {
    view.dispatch(transaction);
  };
  let finishUpload: (src: string) => void = () => undefined;
  const upload = new Promise<string>((resolve) => {
    finishUpload = resolve;
  });
  let uploadCallCount = 0;
  Object.defineProperty(extension, "editor", {
    value: {
      schema,
      props: {
        readOnly: false,
        uploadFile: () => {
          uploadCallCount += 1;
          return upload;
        },
      },
      view,
    },
  });
  const session = new ExcalidrawSession({
    entry: "toolbar",
    imageSrc,
    imagePosition,
  });
  if (open) {
    extension["open"](session);
  }
  return {
    extension,
    session,
    view,
    dispatch,
    finishUpload,
    get uploadCallCount() {
      return uploadCallCount;
    },
    get state() {
      return view.state;
    },
  };
}

function remoteReplace(
  harness: ReturnType<typeof createHarness>,
  content: Node[]
) {
  const nextDoc = schema.nodes.doc.create(null, content);
  harness.dispatch(
    harness.state.tr
      .replace(
        0,
        harness.state.doc.content.size,
        new Slice(nextDoc.content, 0, 0)
      )
      .setMeta(ySyncPluginKey, {})
  );
}

beforeEach(() => {
  vi.mocked(toastNotice).mockClear();
  vi.spyOn(FileHelper, "getImageDimensions").mockResolvedValue({
    width: 400,
    height: 300,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("ExcalidrawExtension", () => {
  it("tracks an empty placeholder inserted inside existing text", () => {
    const harness = createHarness(
      [schema.nodes.paragraph.create(null, schema.text("hello"))],
      3,
      "",
      false
    );
    harness.dispatch(
      harness.state.tr.setSelection(TextSelection.create(harness.state.doc, 3))
    );

    const insert = harness.extension.commands().insertExcalidraw();
    expect(insert(harness.state, harness.dispatch)).toBe(true);
    expect(harness.extension["session"]?.targetPosition).toBe(3);
    expect(harness.state.doc.nodeAt(3)?.attrs).toMatchObject({
      src: "",
      source: ImageSource.Excalidraw,
    });
    expect(harness.state.doc.textContent).toBe("hello");
  });

  it("inserts a persistent empty drawing and reopens it after exit", () => {
    const harness = createHarness(
      [schema.nodes.paragraph.create()],
      1,
      "",
      false
    );
    const insert = harness.extension.commands().insertExcalidraw();
    expect(insert(harness.state, harness.dispatch)).toBe(true);
    expect(harness.state.doc.nodeAt(1)?.attrs).toMatchObject({
      src: "",
      source: ImageSource.Excalidraw,
    });
    expect(harness.extension["session"]?.targetPosition).toBe(1);

    harness.extension["handleClose"]();
    expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe("");

    harness.dispatch(
      harness.state.tr.setSelection(NodeSelection.create(harness.state.doc, 1))
    );
    const reopen = harness.extension.commands().editExcalidraw({
      source: "double_click",
    });
    expect(reopen(harness.state, harness.dispatch)).toBe(true);
    expect(harness.extension["session"]?.imageSrc).toBe("");
    expect(harness.extension["session"]?.targetPosition).toBe(1);
  });

  it("replaces the exact empty placeholder after the first save", async () => {
    const placeholder = schema.nodes.paragraph.create(
      null,
      schema.nodes.image.create({ src: "", source: ImageSource.Excalidraw })
    );
    const harness = createHarness([placeholder], 1, "");
    const saving = harness.extension["handleSave"]("<svg/>", "normal");
    harness.finishUpload("/first.svg");
    expect(await saving).toBe("saved");
    expect(harness.state.doc.firstChild?.content.childCount).toBe(1);
    expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe("/first.svg");
  });

  it("saves only the selected one of two empty placeholders", async () => {
    const placeholder = () =>
      schema.nodes.paragraph.create(
        null,
        schema.nodes.image.create({ src: "", source: ImageSource.Excalidraw })
      );
    const first = placeholder();
    const harness = createHarness(
      [first, placeholder()],
      first.nodeSize + 1,
      ""
    );
    const saving = harness.extension["handleSave"]("<svg/>", "normal");
    harness.finishUpload("/second.svg");
    expect(await saving).toBe("saved");
    expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe("");
    expect(harness.state.doc.nodeAt(first.nodeSize + 1)?.attrs.src).toBe(
      "/second.svg"
    );
  });

  it("keeps a new drawing open when a remote full-document replacement changes another paragraph", async () => {
    const before = schema.nodes.paragraph.create(null, schema.text("Before"));
    const placeholder = schema.nodes.paragraph.create(
      null,
      schema.nodes.image.create({ src: "", source: ImageSource.Excalidraw })
    );
    const harness = createHarness(
      [before, placeholder],
      before.nodeSize + 1,
      ""
    );
    const changed = schema.nodes.paragraph.create(
      null,
      schema.text("Before changed")
    );

    remoteReplace(harness, [changed, placeholder]);

    expect(harness.session.active).toBe(true);
    expect(harness.session.targetPosition).toBe(changed.nodeSize + 1);
    expect(toastNotice).not.toHaveBeenCalled();
    const saving = harness.extension["handleSave"]("<svg/>", "normal");
    harness.finishUpload("/first.svg");
    expect(await saving).toBe("saved");
    expect(harness.state.doc.nodeAt(changed.nodeSize + 1)?.attrs.src).toBe(
      "/first.svg"
    );
  });

  it("keeps an unchanged placeholder when one remote update inserts before it and edits after it", () => {
    const before = schema.nodes.paragraph.create(null, schema.text("Before"));
    const placeholder = schema.nodes.paragraph.create(
      null,
      schema.nodes.image.create({ src: "", source: ImageSource.Excalidraw })
    );
    const after = schema.nodes.paragraph.create(null, schema.text("After"));
    const harness = createHarness(
      [before, placeholder, after],
      before.nodeSize + 1,
      ""
    );
    const inserted = schema.nodes.paragraph.create(
      null,
      schema.text("Inserted")
    );
    const changedAfter = schema.nodes.paragraph.create(
      null,
      schema.text("After changed")
    );

    remoteReplace(harness, [inserted, before, placeholder, changedAfter]);

    expect(harness.session.active).toBe(true);
    expect(harness.session.targetPosition).toBe(
      inserted.nodeSize + before.nodeSize + 1
    );
    expect(toastNotice).not.toHaveBeenCalled();
  });

  it("keeps the selected one of two empty placeholders after a remote edit", async () => {
    const placeholder = () =>
      schema.nodes.paragraph.create(
        null,
        schema.nodes.image.create({ src: "", source: ImageSource.Excalidraw })
      );
    const first = placeholder();
    const middle = schema.nodes.paragraph.create(null, schema.text("Middle"));
    const second = placeholder();
    const after = schema.nodes.paragraph.create(null, schema.text("After"));
    const harness = createHarness(
      [first, middle, second, after],
      first.nodeSize + middle.nodeSize + 1,
      ""
    );
    const changed = schema.nodes.paragraph.create(
      null,
      schema.text("Middle changed")
    );
    const afterChanged = schema.nodes.paragraph.create(
      null,
      schema.text("After changed")
    );

    remoteReplace(harness, [first, changed, second, afterChanged]);

    expect(harness.session.targetPosition).toBe(
      first.nodeSize + changed.nodeSize + 1
    );
    const saving = harness.extension["handleSave"]("<svg/>", "normal");
    harness.finishUpload("/second.svg");
    expect(await saving).toBe("saved");
    expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe("");
    expect(
      harness.state.doc.nodeAt(first.nodeSize + changed.nodeSize + 1)?.attrs.src
    ).toBe("/second.svg");
  });

  it("closes a new drawing when its placeholder is deleted", () => {
    const placeholder = schema.nodes.paragraph.create(
      null,
      schema.nodes.image.create({ src: "", source: ImageSource.Excalidraw })
    );
    const harness = createHarness([placeholder], 1, "");
    harness.dispatch(harness.state.tr.delete(1, 2));
    expect(harness.session.targetPosition).toBeUndefined();
    expect(harness.session.active).toBe(false);
    expect(toastNotice).toHaveBeenCalledWith(
      "The drawing placeholder is no longer available",
      "error"
    );
  });

  it("closes a new drawing when a remote full-document replacement deletes its placeholder", () => {
    const placeholder = schema.nodes.paragraph.create(
      null,
      schema.nodes.image.create({ src: "", source: ImageSource.Excalidraw })
    );
    const harness = createHarness([placeholder], 1, "");

    remoteReplace(harness, [schema.nodes.paragraph.create()]);

    expect(harness.session.targetPosition).toBeUndefined();
    expect(harness.session.active).toBe(false);
    expect(toastNotice).toHaveBeenCalledWith(
      "The drawing placeholder is no longer available",
      "error"
    );
  });

  it("does not run close, toast, or focus during a dry-run state apply", () => {
    const placeholder = schema.nodes.paragraph.create(
      null,
      schema.nodes.image.create({ src: "", source: ImageSource.Excalidraw })
    );
    const harness = createHarness([placeholder], 1, "");
    const focus = vi.spyOn(harness.view, "focus");

    harness.state.apply(harness.state.tr.delete(1, 2));

    expect(harness.session.targetPosition).toBe(1);
    expect(harness.session.active).toBe(true);
    expect(toastNotice).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it("updates only the mapped target and preserves its latest layout", async () => {
    const first = drawing("First");
    const harness = createHarness(
      [first, drawing("Selected")],
      first.nodeSize + 1
    );
    const selected = harness.state.doc.nodeAt(first.nodeSize + 1);
    harness.dispatch(
      harness.state.tr.setNodeMarkup(first.nodeSize + 1, undefined, {
        ...selected?.attrs,
        width: 300,
        layoutClass: "right-50",
      })
    );
    const saving = harness.extension["handleSave"]("<svg/>", "normal");
    harness.finishUpload("/new.svg");
    expect(await saving).toBe("saved");
    expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe(originalSrc);
    expect(harness.state.doc.nodeAt(first.nodeSize + 1)?.attrs).toMatchObject({
      src: "/new.svg",
      alt: "Selected",
      width: 300,
      height: 225,
      layoutClass: "right-50",
    });
  });

  it("saves an existing drawing normally after an unrelated remote edit", async () => {
    const before = schema.nodes.paragraph.create(null, schema.text("Before"));
    const selected = drawing("Selected");
    const after = schema.nodes.paragraph.create(null, schema.text("After"));
    const harness = createHarness(
      [before, selected, after],
      before.nodeSize + 1
    );
    const changed = schema.nodes.paragraph.create(
      null,
      schema.text("Before changed")
    );
    const afterChanged = schema.nodes.paragraph.create(
      null,
      schema.text("After changed")
    );

    remoteReplace(harness, [changed, selected, afterChanged]);

    expect(harness.session.targetPosition).toBe(changed.nodeSize + 1);
    expect(harness.session.conflict(harness.state.doc)).toBe("none");
    const saving = harness.extension["handleSave"]("<svg/>", "normal");
    harness.finishUpload("/new.svg");
    expect(await saving).toBe("saved");
    expect(harness.state.doc.nodeAt(changed.nodeSize + 1)?.attrs.src).toBe(
      "/new.svg"
    );
  });

  it("does not retarget a structurally replaced image with the same URL", async () => {
    const selected = drawing("Selected");
    const harness = createHarness([selected]);
    harness.dispatch(
      harness.state.tr.replaceWith(
        1,
        1 + selected.content.size,
        schema.nodes.image.create({
          src: originalSrc,
          source: ImageSource.Excalidraw,
        })
      )
    );
    expect(harness.session.targetPosition).toBeUndefined();
    expect(await harness.extension["handleSave"]("<svg/>", "normal")).toBe(
      "conflict"
    );
  });

  it("inserts a copy after the selected original instead of replacing it", async () => {
    const harness = createHarness([drawing("Selected")]);
    harness.dispatch(
      harness.state.tr.setSelection(NodeSelection.create(harness.state.doc, 1))
    );
    const saving = harness.extension["handleSave"]("<svg/>", "duplicate");
    harness.finishUpload("/copy.svg");
    expect(await saving).toBe("saved");
    const sources: string[] = [];
    harness.state.doc.descendants((node) => {
      if (node.type.name === "image") {
        sources.push(node.attrs.src);
      }
    });
    expect(sources).toEqual([originalSrc, "/copy.svg"]);
  });

  it("requires an explicit overwrite when the original scene changes", async () => {
    const harness = createHarness([drawing("Selected")]);
    const original = harness.state.doc.nodeAt(1);
    harness.dispatch(
      harness.state.tr.setNodeMarkup(1, undefined, {
        ...original?.attrs,
        src: "/collaborator.svg",
      })
    );
    expect(harness.session.conflict(harness.state.doc)).toBe("modified");
    expect(await harness.extension["handleSave"]("<svg/>", "normal")).toBe(
      "conflict"
    );
    const saving = harness.extension["handleSave"]("<svg/>", "overwrite");
    harness.finishUpload("/mine.svg");
    expect(await saving).toBe("saved");
    expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe("/mine.svg");
  });

  it("reports a remotely deleted existing drawing as missing", () => {
    const harness = createHarness([drawing("Selected")]);

    remoteReplace(harness, [schema.nodes.paragraph.create()]);

    expect(harness.session.active).toBe(true);
    expect(harness.session.conflict(harness.state.doc)).toBe("missing");
    expect(toastNotice).not.toHaveBeenCalled();
  });

  it("does not upload an overwrite when the drawing was deleted", async () => {
    const harness = createHarness([drawing("Selected")]);

    remoteReplace(harness, [schema.nodes.paragraph.create()]);

    expect(await harness.extension["handleSave"]("<svg/>", "overwrite")).toBe(
      "conflict"
    );
    expect(harness.uploadCallCount).toBe(0);
  });

  it("does not upload an overwrite when another image replaced the drawing", async () => {
    const harness = createHarness([drawing("Selected")]);
    const replacement = schema.nodes.paragraph.create(
      null,
      schema.nodes.image.create({ src: "/regular.svg" })
    );

    remoteReplace(harness, [replacement]);

    expect(await harness.extension["handleSave"]("<svg/>", "overwrite")).toBe(
      "conflict"
    );
    expect(harness.uploadCallCount).toBe(0);
  });

  it("does not retarget a different drawing moved into the same remote path", () => {
    const selected = drawing("Selected");
    const other = drawing("Other");
    const harness = createHarness([selected, other]);
    const replacement = schema.nodes.paragraph.create(
      null,
      schema.text("Replacement")
    );

    remoteReplace(harness, [other, replacement]);

    expect(harness.session.targetPosition).toBeUndefined();
    expect(harness.session.conflict(harness.state.doc)).toBe("missing");
    expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe(originalSrc);
  });

  it("does not treat a remote same-position replacement as a source edit", () => {
    const harness = createHarness([drawing("Selected")]);

    remoteReplace(harness, [drawing("Other")]);

    expect(harness.session.targetPosition).toBeUndefined();
    expect(harness.session.conflict(harness.state.doc)).toBe("missing");
  });

  it("reports a remotely changed source as modified and allows overwrite", async () => {
    const selected = drawing("Selected");
    const harness = createHarness([selected]);
    const changed = schema.nodes.paragraph.create(
      null,
      schema.nodes.image.create({
        ...selected.firstChild?.attrs,
        src: "/collaborator.svg",
      })
    );

    remoteReplace(harness, [changed]);

    expect(harness.session.targetPosition).toBe(1);
    expect(harness.session.conflict(harness.state.doc)).toBe("modified");
    expect(await harness.extension["handleSave"]("<svg/>", "normal")).toBe(
      "conflict"
    );
    const saving = harness.extension["handleSave"]("<svg/>", "overwrite");
    harness.finishUpload("/mine.svg");
    expect(await saving).toBe("saved");
    expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe("/mine.svg");
  });

  it("reports a changed source after a remote insertion before the drawing", () => {
    const selected = drawing("Selected");
    const harness = createHarness([selected]);
    const inserted = schema.nodes.paragraph.create(
      null,
      schema.text("Inserted")
    );
    const changed = schema.nodes.paragraph.create(
      null,
      schema.nodes.image.create({
        ...selected.firstChild?.attrs,
        src: "/collaborator.svg",
      })
    );

    remoteReplace(harness, [inserted, changed]);

    expect(harness.session.targetPosition).toBe(inserted.nodeSize + 1);
    expect(harness.session.conflict(harness.state.doc)).toBe("modified");
  });

  it("keeps the exact modified target through later attribute edits", async () => {
    const harness = createHarness([drawing("Selected")]);
    const original = harness.state.doc.nodeAt(1);
    harness.dispatch(
      harness.state.tr.setNodeMarkup(1, undefined, {
        ...original?.attrs,
        src: "/collaborator.svg",
      })
    );
    const modified = harness.state.doc.nodeAt(1);
    harness.dispatch(
      harness.state.tr.setNodeMarkup(1, undefined, {
        ...modified?.attrs,
        width: 280,
      })
    );
    expect(harness.session.targetPosition).toBe(1);
    expect(harness.session.conflict(harness.state.doc)).toBe("modified");
    const saving = harness.extension["handleSave"]("<svg/>", "overwrite");
    harness.finishUpload("/mine.svg");
    expect(await saving).toBe("saved");
    expect(harness.state.doc.nodeAt(1)?.attrs.width).toBe(280);
  });

  it("does not commit an upload after the session closes", async () => {
    const harness = createHarness([drawing("Selected")]);
    const saving = harness.extension["handleSave"]("<svg/>", "normal");
    harness.session.close();
    harness.finishUpload("/late.svg");
    expect(await saving).toBe("cancelled");
    expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe(originalSrc);
  });

  it("ignores a second save while the first upload is pending", async () => {
    const harness = createHarness([drawing("Selected")]);
    const first = harness.extension["handleSave"]("<svg/>", "normal");
    const second = harness.extension["handleSave"]("<svg/>", "normal");
    expect(await second).toBe("cancelled");
    expect(harness.uploadCallCount).toBe(1);
    harness.finishUpload("/saved.svg");
    expect(await first).toBe("saved");
    expect(harness.state.doc.nodeAt(1)?.attrs.src).toBe("/saved.svg");
  });
});
