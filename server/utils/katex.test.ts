import fs from "node:fs/promises";
import { getKatexStylesheet } from "./katex";

describe("getKatexStylesheet", () => {
  it("embeds every font from the installed KaTeX stylesheet as WOFF2", async () => {
    const original = await fs.readFile(
      require.resolve("katex/dist/katex.min.css"),
      "utf8"
    );
    const styles = await getKatexStylesheet();
    const sources = [...styles.matchAll(/url\(([^)]+)\)/g)];

    expect(styles).toContain(".katex{");
    expect(styles.replace(/@font-face\{[^}]+\}/g, "")).toBe(
      original.replace(/@font-face\{[^}]+\}/g, "")
    );
    expect(sources).toHaveLength(
      [...original.matchAll(/@font-face\{/g)].length
    );
    for (const [, source] of sources) {
      expect(source).toMatch(/^data:font\/woff2;base64,/);
      const data = Buffer.from(source.split(",")[1], "base64");
      expect(data.subarray(0, 4).toString()).toBe("wOF2");
    }
    expect(styles).not.toMatch(/format\("(?:woff|truetype)"\)/);
  });

  it("reuses the stylesheet load across exports", async () => {
    const first = getKatexStylesheet();
    const second = getKatexStylesheet();

    expect(second).toBe(first);
    expect(await second).toBe(await first);
  });
});
