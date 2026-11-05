import { embedSource, extractSource } from "./svg";

const source = String.raw`\begin{tikzpicture}\node {$a<b \& c$};\end{tikzpicture}`;
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><path d="M0 0h10"/></svg>';

describe("TikZ SVG metadata", () => {
  it("round-trips XML characters, Unicode, whitespace, and literal script delimiters", () => {
    const original = `${source}\r\n% 中文🙂 & < > </script>\r\n`;
    const output = embedSource(svg, original);
    expect(extractSource(output)).toBe(original);
    expect(output).toContain('type="text/x-tikz"');
    expect(
      new DOMParser()
        .parseFromString(output, "image/svg+xml")
        .querySelectorAll("script")
    ).toHaveLength(1);
  });

  it("reads the escaped metadata format emitted by SiYuan", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg"><metadata><script type="text/x-tikz">\\node {$a&lt;b &amp; c$};</script></metadata></svg>';
    expect(extractSource(input)).toBe("\\node {$a<b & c$};");
  });

  it("distinguishes absent metadata from an empty original source", () => {
    expect(extractSource(svg)).toBeUndefined();
    expect(extractSource(embedSource(svg, ""))).toBe("");
  });

  it("rejects malformed, wrong-namespace, and non-SVG markup", () => {
    for (const input of [
      "<html/>",
      '<svg xmlns="https://wrong.example"/>',
      '<svg xmlns="http://www.w3.org/2000/svg"><path></svg>',
    ]) {
      expect(() => embedSource(input, source)).toThrow();
      expect(() => extractSource(input)).toThrow();
    }
  });

  it("replaces old source metadata and removes active content and unsafe attributes", () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)" xml:base="https://remote.example/">' +
      '<metadata><script type="text/x-tikz">old</script></metadata>' +
      "<script>alert(1)</script><foreignObject><p>active HTML</p></foreignObject>" +
      '<animate attributeName="href" values="javascript:alert(1)"/>' +
      '<a xlink:href="java&#x0a;script:alert(1)"><text onclick="alert(1)">label</text></a>' +
      '<image href="https://remote.example/pixel"/><use href="https://remote.example/#glyph"/></svg>';
    const output = embedSource(input, source);
    expect(output).not.toMatch(
      /alert\(1\)|foreignObject|active HTML|animate|onclick|onload|remote\.example|xml:base/
    );
    expect(output).toContain("label");
    expect(extractSource(output)).toBe(source);
  });

  it("keeps embedded fonts and local glyph references while stripping remote CSS", () => {
    const font =
      "@font-face{font-family:cmr10;src:url(data:font/woff2;base64,AA==)}";
    const input =
      `<svg xmlns="http://www.w3.org/2000/svg"><style>${font}</style>` +
      '<style>@import "https://remote.example/style.css";</style>' +
      '<defs><path id="glyph" d="M0 0"/></defs><use href="#glyph" style="fill:url(#color)"/>' +
      '<path style="fill:u\\72l(https://remote.example/paint)"/></svg>';
    const output = embedSource(input, source);
    expect(output).toContain(font);
    expect(output).toContain('href="#glyph"');
    expect(output).toContain('style="fill:url(#color)"');
    expect(output).not.toContain("remote.example");
  });

  it("rejects XML document type declarations", () => {
    expect(() =>
      extractSource(
        '<!DOCTYPE svg [<!ENTITY sample "test">]><svg xmlns="http://www.w3.org/2000/svg"/>'
      )
    ).toThrow();
  });
});
