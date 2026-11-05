import { Schema } from "prosemirror-model";
import { schema } from "../../test/editor";
import { ImageSource } from "../lib/FileHelper";
import { findImageNodeBySrc } from "./findImageNodeBySrc";

describe("findImageNodeBySrc", () => {
  const src = "https://example.com/diagram.svg";
  const image = () =>
    schema.nodes.image.create({ src, source: ImageSource.Tikz });

  it("finds an image nested inside a block", () => {
    const node = image();
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.blockquote.create(
        null,
        schema.nodes.paragraph.create(null, [schema.text("Diagram: "), node])
      )
    );
    const found = findImageNodeBySrc(doc, src);
    expect(found?.node).toBe(node);
    expect(found && doc.nodeAt(found.pos)).toBe(node);
  });

  it("returns the first matching image when the URL is reused", () => {
    const first = image();
    const last = image();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, first),
      schema.nodes.paragraph.create(null, last),
    ]);
    expect(findImageNodeBySrc(doc, src)).toEqual({ node: first, pos: 1 });
  });

  it("returns the new position after preceding content changes", () => {
    const node = image();
    const paragraph = schema.nodes.paragraph.create(null, node);
    const updated = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text("New introduction")),
      paragraph,
    ]);
    const found = findImageNodeBySrc(updated, src);
    expect(found?.node).toBe(node);
    expect(found?.pos).toBeGreaterThan(1);
    expect(found && updated.nodeAt(found.pos)).toBe(node);
  });

  it("returns undefined when the target was removed", () => {
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, schema.text("Removed diagram"))
    );
    expect(findImageNodeBySrc(doc, src)).toBeUndefined();
  });

  it("ignores matching src attributes on other node types", () => {
    const testSchema = new Schema({
      nodes: {
        doc: { content: "block*" },
        image: { group: "block", attrs: { src: {} } },
        other: { group: "block", attrs: { src: {} } },
        text: {},
      },
    });
    const expected = testSchema.nodes.image.create({ src });
    const doc = testSchema.nodes.doc.create(null, [
      testSchema.nodes.other.create({ src }),
      expected,
    ]);
    expect(findImageNodeBySrc(doc, src)?.node).toBe(expected);
  });
});
