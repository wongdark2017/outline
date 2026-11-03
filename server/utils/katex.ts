import fs from "node:fs/promises";
import path from "node:path";

/**
 * Returns the installed KaTeX stylesheet with embedded WOFF2 fonts for offline
 * HTML exports. The stylesheet is loaded once and reused across exports.
 *
 * @returns the stylesheet with self-contained font URLs.
 */
export function getKatexStylesheet(): Promise<string> {
  stylesheet ??= loadStylesheet();
  return stylesheet;
}

let stylesheet: Promise<string> | undefined;

async function loadStylesheet(): Promise<string> {
  const filename = require.resolve("katex/dist/katex.min.css");
  const styles = (await fs.readFile(filename, "utf8")).replace(
    /,\s*url\([^)]*\)\s*format\(["'](?:woff|truetype)["']\)/g,
    ""
  );
  const pattern = /url\((["']?)(fonts\/[\w-]+\.woff2)\1\)/g;
  const names = new Set([...styles.matchAll(pattern)].map((match) => match[2]));
  const fonts = new Map(
    await Promise.all(
      [...names].map(async (name): Promise<[string, string]> => {
        const data = await fs.readFile(path.join(path.dirname(filename), name));
        return [name, `data:font/woff2;base64,${data.toString("base64")}`];
      })
    )
  );

  return styles.replace(pattern, (match, _quote: string, name: string) => {
    const font = fonts.get(name);
    return font ? `url(${font})` : match;
  });
}
