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
  it("round-trips an empty Excalidraw placeholder through Markdown and HTML", () => {
    const image = schema.nodes.image.create({
      src: "",
      source: ImageSource.Excalidraw,
    });
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, image)
    );
    const markdown = serializer.serialize(doc);
    expect(markdown).toContain("![](<>");
    expect(findImageNode(parser.parse(markdown)).attrs).toMatchObject({
      src: "",
      source: ImageSource.Excalidraw,
    });

    if (typeof document !== "undefined") {
      const wrapper = document.createElement("div");
      wrapper.appendChild(
        DOMSerializer.fromSchema(schema).serializeFragment(doc.content)
      );
      expect(
        wrapper.querySelector(".excalidraw-placeholder")?.textContent
      ).toBe("Empty Excalidraw drawing");
      expect(wrapper.querySelector("img")).toBeNull();
      const parsed = findImageNode(DOMParser.fromSchema(schema).parse(wrapper));
      expect(parsed.attrs).toMatchObject({
        src: "",
        source: ImageSource.Excalidraw,
      });
      expect(parsed.content).toBeUndefined();
    }
  });

  it("preserves the existing Markdown form for an empty diagrams.net image", () => {
    const image = schema.nodes.image.create({
      src: "",
      source: ImageSource.DiagramsNet,
    });
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, image)
    );

    expect(serializer.serialize(doc)).not.toContain("![](<>");
  });

  it("round-trips an Excalidraw image through Markdown and static HTML", () => {
    const original = `![Drawing](https://example.com/drawing.svg "source=${ImageSource.Excalidraw} right-50 =480x320")`;
    const doc = parser.parse(serializer.serialize(parser.parse(original)));
    expect(findImageNode(doc).attrs).toMatchObject({
      source: ImageSource.Excalidraw,
      src: "https://example.com/drawing.svg",
      layoutClass: "right-50",
      width: 480,
      height: 320,
      alt: "Drawing",
    });
    if (typeof document !== "undefined") {
      const wrapper = document.createElement("div");
      wrapper.appendChild(
        DOMSerializer.fromSchema(schema).serializeFragment(doc.content)
      );
      expect(wrapper.querySelector("img")?.getAttribute("data-source")).toBe(
        ImageSource.Excalidraw
      );
    }
  });

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

  describe.runIf(typeof document !== "undefined")("small image HTML", () => {
    it.each([null, "left-50", "right-50"])(
      "keeps a small TikZ figure as a block with its caption (%s)",
      (layoutClass) => {
        const image = schema.nodes.image.create({
          src: "https://example.com/tikz.svg",
          source: ImageSource.Tikz,
          width: 38,
          height: 26,
          layoutClass,
          alt: "Diagram caption",
        });
        const wrapper = document.createElement("div");
        wrapper.appendChild(
          DOMSerializer.fromSchema(schema).serializeNode(image)
        );

        expect(wrapper.querySelector("div.image")).not.toBeNull();
        expect(wrapper.querySelector(".image-icon")).toBeNull();
        expect(wrapper.querySelector(".caption")?.textContent).toBe(
          "Diagram caption"
        );
        expect(
          findImageNode(DOMParser.fromSchema(schema).parse(wrapper)).attrs
        ).toMatchObject({
          source: ImageSource.Tikz,
          width: 38,
          height: 26,
          layoutClass,
          alt: "Diagram caption",
        });
      }
    );

    it("preserves ordinary small images as inline icons", () => {
      const image = schema.nodes.image.create({
        src: "https://example.com/icon.png",
        width: 38,
        height: 26,
        alt: "Icon",
      });
      const wrapper = document.createElement("div");
      wrapper.appendChild(
        DOMSerializer.fromSchema(schema).serializeNode(image)
      );

      expect(wrapper.querySelector("span.image-icon")).not.toBeNull();
      expect(wrapper.querySelector(".caption")).toBeNull();
    });
  });

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
