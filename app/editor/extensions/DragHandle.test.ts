import { EditorState, NodeSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { ImageSource } from "@shared/editor/lib/FileHelper";
import { schema } from "@shared/test/editor";
import DragHandle from "./DragHandle";

describe("DragHandle editability", () => {
  let view: EditorView;
  let mount: HTMLDivElement;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
    const image = schema.nodes.image.create({
      src: "https://example.com/diagram.svg",
      source: ImageSource.Tikz,
      layoutClass: "right-50",
      width: 260,
    });
    view = new EditorView(mount, {
      state: EditorState.create({
        schema,
        doc: schema.nodes.doc.create(
          null,
          schema.nodes.paragraph.create(null, image)
        ),
        plugins: new DragHandle().plugins,
      }),
    });
    vi.spyOn(view, "posAtCoords").mockReturnValue({ pos: 1, inside: 0 });
  });

  afterEach(() => {
    view.destroy();
    mount.remove();
    vi.restoreAllMocks();
  });

  /** Shows the real plugin handle over the image's paragraph. */
  function showHandle() {
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 1 }));
    const handle = document.querySelector("button.block-drag-handle");
    if (!(handle instanceof HTMLButtonElement)) {
      throw new Error("Expected the block drag handle");
    }
    return handle;
  }

  it("selects the image paragraph through the existing block handle", () => {
    const handle = showHandle();
    expect(handle.classList.contains("visible")).toBe(true);

    handle.click();

    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(view.state.selection.from).toBe(0);
    expect(view.state.selection.to).toBe(view.state.doc.firstChild?.nodeSize);
  });

  it("immediately hides a visible handle when the view becomes read-only", () => {
    const handle = showHandle();
    expect(handle.classList.contains("visible")).toBe(true);
    const selection = view.state.selection;

    view.setProps({ editable: () => false });

    expect(handle.classList.contains("visible")).toBe(false);
    window.dispatchEvent(new Event("scroll"));
    expect(handle.classList.contains("visible")).toBe(false);
    handle.click();
    expect(view.state.selection).toBe(selection);

    const event = new Event("dragstart", { cancelable: true });
    handle.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(view.dragging).toBeNull();
    expect(view.state.selection).toBe(selection);
  });

  it("does not show the handle in a read-only view", () => {
    view.setProps({ editable: () => false });

    expect(showHandle().classList.contains("visible")).toBe(false);
  });
});
