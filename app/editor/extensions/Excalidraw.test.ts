import type { Node } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import type { Transaction } from "prosemirror-state";
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
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, content),
    plugins: extension.plugins,
  });
  const dispatch = (transaction: Transaction) => {
    state = state.apply(transaction);
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
    dispatch,
    finishUpload,
    get uploadCallCount() {
      return uploadCallCount;
    },
    get state() {
      return state;
    },
  };
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
