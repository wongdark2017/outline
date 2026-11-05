import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { ImageSource } from "@shared/editor/lib/FileHelper";
import {
  isCurrentTikzPreview,
  TikzSession,
  type TikzSourceResult,
} from "./TikzSession";

describe("TikzSession", () => {
  it("discards source that finishes loading after close", async () => {
    const session = new TikzSession({ imageSrc: "/diagram.svg" });
    const load = deferred<TikzSourceResult>();
    const pending = session.load(() => load.promise);

    session.close();
    load.resolve({ ok: true, source: "obsolete" });
    await pending;

    expect(session.source).toBeUndefined();
    expect(session.isActive).toBe(false);
    expect(session.signal.aborted).toBe(true);
  });

  it("keeps metadata failures distinct from network failures", async () => {
    const session = new TikzSession({ imageSrc: "/diagram.svg" });
    await session.load(async () => ({ ok: false, reason: "metadata" }));
    expect(session.error).toBe("metadata");
    expect(session.source).toBeUndefined();
    expect(session.loading).toBe(false);
  });

  it("keeps failed uploads recoverable without losing the original source", async () => {
    const session = new TikzSession({ source: "original" });
    const success = await session.save("<svg/>", async () => {
      throw new Error("network failed");
    });

    expect(success).toBe(false);
    expect(session.source).toBe("original");
    expect(session.error).toBe("save");
    expect(session.saving).toBe(false);
  });

  it("aborts upload commits when closed", async () => {
    const session = new TikzSession({ source: "original" });
    const upload = deferred<void>();
    const commit = vi.fn();
    const pending = session.save("<svg/>", async (_svg, signal) => {
      await upload.promise;
      if (!signal.aborted) {
        commit();
      }
    });

    session.close();
    upload.resolve();

    expect(await pending).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not let a cancelled upload finish or clear a newer attempt", async () => {
    const session = new TikzSession({ source: "original" });
    const oldUpload = deferred<void>();
    const newUpload = deferred<void>();
    const oldAttempt = session.save("old", () => oldUpload.promise);
    session.cancelPendingSave();
    const newAttempt = session.save("new", () => newUpload.promise);

    oldUpload.resolve();
    expect(await oldAttempt).toBe(false);
    expect(session.saving).toBe(true);

    newUpload.resolve();
    expect(await newAttempt).toBe(true);
    expect(session.saving).toBe(false);
  });

  it("ignores old failures after the user starts another session", async () => {
    const previous = new TikzSession({ source: "old" });
    const upload = deferred<void>();
    const pending = previous.save("<svg/>", () => upload.promise);
    previous.close();
    const next = new TikzSession({ source: "new" });

    upload.reject(new Error("late failure"));
    expect(await pending).toBe(false);
    expect(previous.error).toBeUndefined();
    expect(next.error).toBeUndefined();
    expect(next.source).toBe("new");
  });

  it("does not upload before existing source loads successfully", async () => {
    const session = new TikzSession({ imageSrc: "/diagram.svg" });
    const upload = vi.fn();

    expect(await session.save("<svg/>", upload)).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it("maps the selected duplicate URL rather than the first image", () => {
    const { state, schema } = documentWithImages();
    const session = new TikzSession({
      source: "original",
      imageSrc: "/same.svg",
      imagePosition: 1,
    });

    session.mapImagePosition(
      state.tr.insert(0, schema.nodes.image.create({ src: "/other.svg" }))
    );
    expect(session.targetPosition).toBe(2);
  });

  it("never retargets the next duplicate after the selected image is deleted", () => {
    const { state } = documentWithImages();
    const session = new TikzSession({
      source: "original",
      imageSrc: "/same.svg",
      imagePosition: 0,
    });

    session.mapImagePosition(state.tr.delete(0, 1));
    expect(session.targetPosition).toBeUndefined();
  });

  it("invalidates an image replaced while its dialog was open", () => {
    const { state, schema } = documentWithImages();
    const session = new TikzSession({
      source: "original",
      imageSrc: "/same.svg",
      imagePosition: 0,
    });

    session.mapImagePosition(
      state.tr.replaceWith(
        0,
        1,
        schema.nodes.image.create({ src: "/replacement.svg" })
      )
    );
    expect(session.targetPosition).toBeUndefined();
  });
});

describe("isCurrentTikzPreview", () => {
  it("rejects the stale preview immediately after an edit", () => {
    expect(
      isCurrentTikzPreview(
        { text: "changed", revision: 1 },
        { text: "original", revision: 0, svg: "<svg/>" }
      )
    ).toBe(false);
  });

  it("requires a new render even when undo restores old text during debounce", () => {
    expect(
      isCurrentTikzPreview(
        { text: "original", revision: 2 },
        { text: "original", revision: 0, svg: "<svg/>" }
      )
    ).toBe(false);
  });

  it("accepts only a completed preview of the current revision", () => {
    expect(
      isCurrentTikzPreview(
        { text: "original", revision: 2 },
        { text: "original", revision: 2, svg: "<svg/>" }
      )
    ).toBe(true);
    expect(isCurrentTikzPreview(undefined, undefined)).toBe(false);
  });
});

function deferred<T>() {
  let resolveValue: (value: T | PromiseLike<T>) => void = () => undefined;
  let rejectValue: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
}

function documentWithImages() {
  const schema = new Schema({
    nodes: {
      doc: { content: "image*" },
      text: {},
      image: {
        attrs: { src: {}, source: { default: ImageSource.Tikz } },
        atom: true,
      },
    },
  });
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.image.create({ src: "/same.svg" }),
    schema.nodes.image.create({ src: "/same.svg" }),
  ]);
  return { schema, state: EditorState.create({ schema, doc }) };
}
