import { DOMParser, DOMSerializer } from "prosemirror-model";
import { findNodes, parser, schema, serializer } from "../../test/editor";
import { ImageSource } from "../lib/FileHelper";

const findImageNode = (doc: ReturnType<typeof parser.parse>) => {
  const imageNode = findNodes(doc?.toJSON(), "image")[0];
  if (!imageNode?.attrs) {
    throw new Error("Expected image node with attributes");
  }
  return { ...imageNode, attrs: imageNode.attrs };
};

describe("Image node source attribute round-trip", () => {
  it("round-trips TikZ source, layout, dimensions, and caption", () => {
    const original = `![Caption](https://example.com/tikz.svg "source=${ImageSource.Tikz} left-50 =640x360")`;
    const doc = parser.parse(serializer.serialize(parser.parse(original)));
    expect(findImageNode(doc).attrs).toMatchObject({
      source: ImageSource.Tikz,
      src: "https://example.com/tikz.svg",
      layoutClass: "left-50",
      width: 640,
      height: 360,
      alt: "Caption",
    });
    expect(serializer.serialize(doc)).toContain("Caption");
  });

  it.runIf(typeof document !== "undefined")(
    "preserves a linked TikZ image through static HTML serialization",
    () => {
      const image = schema.nodes.image.create({
        src: "https://example.com/tikz.svg",
        source: ImageSource.Tikz,
        alt: "Caption",
        width: 640,
        height: 360,
        marks: [{ type: "link", attrs: { href: "https://example.com" } }],
      });
      const doc = schema.nodes.doc.create(
        null,
        schema.nodes.paragraph.create(null, image)
      );
      const wrapper = document.createElement("div");
      wrapper.appendChild(
        DOMSerializer.fromSchema(schema).serializeFragment(doc.content)
      );
      expect(wrapper.querySelector("img")?.getAttribute("data-source")).toBe(
        ImageSource.Tikz
      );
      expect(wrapper.querySelector("a")?.getAttribute("href")).toBe(
        "https://example.com"
      );
      expect(
        findImageNode(DOMParser.fromSchema(schema).parse(wrapper)).attrs
      ).toMatchObject({
        src: "https://example.com/tikz.svg",
        source: ImageSource.Tikz,
        width: 640,
        height: 360,
      });
    }
  );

  it("preserves diagrams.net source through markdown serialize → parse", () => {
    const doc = parser.parse(
      `![](https://example.com/diagram.svg "source=${ImageSource.DiagramsNet}")`
    );
    const imageNode = findImageNode(doc);
    expect(imageNode).toBeDefined();
    expect(imageNode.attrs.source).toBe(ImageSource.DiagramsNet);
  });

  it("serializes source tag back into markdown", () => {
    const doc = parser.parse(
      `![](https://example.com/diagram.svg "source=${ImageSource.DiagramsNet}")`
    );
    const markdown = serializer.serialize(doc);
    expect(markdown).toContain(`source=${ImageSource.DiagramsNet}`);
  });

  it("round-trips a diagrams.net image without losing source", () => {
    const original = `![](https://example.com/diagram.svg "source=${ImageSource.DiagramsNet}")`;
    const doc1 = parser.parse(original);
    const md1 = serializer.serialize(doc1);
    const doc2 = parser.parse(md1);
    const imageNode = findImageNode(doc2);
    expect(imageNode.attrs.source).toBe(ImageSource.DiagramsNet);
  });

  it("preserves source alongside size and title", () => {
    const doc = parser.parse(
      `![](https://example.com/diagram.svg "source=${ImageSource.DiagramsNet} Caption =100x100")`
    );
    const imageNode = findImageNode(doc);
    expect(imageNode.attrs.source).toBe(ImageSource.DiagramsNet);
    expect(imageNode.attrs.width).toBe(100);
    expect(imageNode.attrs.height).toBe(100);
  });

  it("does not set source for regular images", () => {
    const doc = parser.parse(`![](https://example.com/photo.png)`);
    const imageNode = findImageNode(doc);
    expect(imageNode.attrs.source).toBeFalsy();
  });

  it("does not leak source token into title", () => {
    const doc = parser.parse(
      `![](https://example.com/diagram.svg "source=${ImageSource.DiagramsNet} My Caption")`
    );
    const imageNode = findImageNode(doc);
    expect(imageNode.attrs.source).toBe(ImageSource.DiagramsNet);
    expect(imageNode.attrs.title).not.toContain("source=");
  });

  it("preserves source-like text inside a caption", () => {
    const doc = parser.parse(
      `![](https://example.com/diagram.svg "Caption source=example")`
    );
    const imageNode = findImageNode(doc);
    expect(imageNode.attrs.source).toBeFalsy();
    expect(imageNode.attrs.title).toBe("Caption source=example");
  });
});
