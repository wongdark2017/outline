import { TIKZ_SOURCE_TYPE } from "./constants";

/**
 * Removes active SVG content and embeds the exact original TikZ source.
 * Font styles remain self-contained so previews and exported images match.
 *
 * @param svg the image returned by the rendering worker.
 * @param source the unmodified source entered by the user.
 * @returns sanitized SVG with SiYuan-compatible inert source metadata.
 * @throws Error when the renderer did not return a valid SVG.
 */
export function embedSource(svg: string, source: string): string {
  const document = parseSvg(svg);
  const root = document.documentElement;

  for (const element of [root, ...root.querySelectorAll("*")]) {
    const name = element.localName.toLowerCase();
    if (element.namespaceURI !== SVG_NAMESPACE || ACTIVE_ELEMENTS.has(name)) {
      element.remove();
      continue;
    }

    if (name === "style" && !isSafeCss(element.textContent ?? "")) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.localName.toLowerCase();
      const value = attribute.value;
      const normalized = value.replace(/[\p{Cc}\s]/gu, "").toLowerCase();
      if (
        attributeName.startsWith("on") ||
        attribute.name.toLowerCase() === "xml:base" ||
        /^(?:javascript|vbscript):/.test(normalized) ||
        (attributeName === "style" && !isSafeCss(value)) ||
        (URL_PRESENTATION_ATTRIBUTES.has(attributeName) && !isSafeCss(value)) ||
        ((attributeName === "href" || attributeName === "src") &&
          !isLocalReference(value) &&
          !(name === "image" && isRasterData(value)))
      ) {
        element.removeAttributeNode(attribute);
      }
    }
  }

  const metadata = document.createElementNS(SVG_NAMESPACE, "metadata");
  const script = document.createElementNS(SVG_NAMESPACE, "script");
  script.setAttribute("type", TIKZ_SOURCE_TYPE);
  script.textContent = source;
  metadata.appendChild(script);
  root.insertBefore(metadata, root.firstChild);

  // XML normalizes literal carriage returns when reparsed. Character references
  // preserve the original source's CRLF or CR line endings through that parse.
  return new XMLSerializer().serializeToString(root).replace(/\r/g, "&#13;");
}

/**
 * Reads original TikZ source from Outline or siyuan-embed-tikz SVG metadata.
 *
 * @param svg the fetched SVG attachment markup.
 * @returns the original source, or undefined when source metadata is absent.
 * @throws Error when the attachment is not valid SVG.
 */
export function extractSource(svg: string): string | undefined {
  const document = parseSvg(svg);
  for (const metadata of document.getElementsByTagNameNS(
    SVG_NAMESPACE,
    "metadata"
  )) {
    for (const script of metadata.getElementsByTagNameNS(
      SVG_NAMESPACE,
      "script"
    )) {
      if (script.getAttribute("type") === TIKZ_SOURCE_TYPE) {
        return script.textContent ?? "";
      }
    }
  }
  return;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ACTIVE_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "audio",
  "video",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
  "discard",
]);
const URL_PRESENTATION_ATTRIBUTES = new Set([
  "fill",
  "stroke",
  "filter",
  "mask",
  "clip-path",
  "marker",
  "marker-start",
  "marker-mid",
  "marker-end",
  "cursor",
]);

function parseSvg(svg: string): Document {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (
    document.doctype ||
    document.querySelector("parsererror") ||
    document.documentElement.localName !== "svg" ||
    document.documentElement.namespaceURI !== SVG_NAMESPACE
  ) {
    throw new Error("The renderer did not produce valid SVG");
  }
  return document;
}

function isLocalReference(value: string): boolean {
  return /^#[^\s]+$/.test(value.trim());
}

function isRasterData(value: string): boolean {
  return /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=\s]+$/i.test(
    value.trim()
  );
}

function isFontData(value: string): boolean {
  return /^data:font\/woff2?;base64,[a-z\d+/=\s]+$/i.test(value.trim());
}

function isSafeCss(value: string): boolean {
  const css = value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(
      /\\([\da-f]{1,6})\s?|\\([^\r\n])/gi,
      (_match, hex: string | undefined, escaped: string | undefined) => {
        if (!hex) {
          return escaped ?? "";
        }
        const codePoint = Number.parseInt(hex, 16);
        return codePoint > 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : "";
      }
    )
    .replace(/\p{Cc}/gu, "");
  if (
    /@import|expression\s*\(|(?:javascript|vbscript)\s*:|(?:-moz-binding|behavior)\s*:/i.test(
      css
    )
  ) {
    return false;
  }

  const urlPattern = /url\s*\(\s*(['"]?)(.*?)\1\s*\)/gis;
  const urls = [...css.matchAll(urlPattern)];
  if (urls.length !== (css.match(/url\s*\(/gi)?.length ?? 0)) {
    return false;
  }
  return urls.every(
    (match) => isLocalReference(match[2]) || isFontData(match[2])
  );
}
