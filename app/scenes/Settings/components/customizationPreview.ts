import type { DefaultTheme } from "styled-components";
import type { CustomizationBackgroundFit } from "@shared/types/customizations";
import { fontFamilies } from "@shared/styles/theme";

interface PreviewLabels {
  workspace: string;
  collection: string;
  home: string;
  favorites: string;
  title: string;
  paragraph: string;
  link: string;
  listItem: string;
}

interface PreviewDocumentOptions {
  theme: DefaultTheme;
  appearance: "light" | "dark";
  direction: "ltr" | "rtl";
  backgroundUrl?: string;
  fit: CustomizationBackgroundFit;
  labels: PreviewLabels;
}

interface ParsedModules {
  ok: true;
  modules: Record<string, string>;
}

interface InvalidModules {
  ok: false;
  reason: "json" | "mapping";
}

/**
 * Decodes the editable managed-dependency mapping without type assertions.
 *
 * @param source the JSON object displayed in the dependency editor.
 * @returns the module mapping, or a validation failure.
 */
export function parseCustomizationModules(
  source: string
): ParsedModules | InvalidModules {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return { ok: false, reason: "json" };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "mapping" };
  }

  const modules: Record<string, string> = {};
  for (const path of Object.keys(value)) {
    const moduleSource: unknown = Reflect.get(value, path);
    if (
      typeof moduleSource !== "string" ||
      ["__proto__", "constructor", "prototype"].includes(path)
    ) {
      return { ok: false, reason: "mapping" };
    }
    modules[path] = moduleSource;
  }

  return { ok: true, modules };
}

/**
 * Creates an isolated background preview without user CSS or scripts.
 *
 * @param options the colors, local image, and translated sample text.
 * @returns an HTML document restricted to inline styles and local image URLs.
 */
export function buildCustomizationPreviewDocument({
  theme,
  appearance,
  direction,
  backgroundUrl,
  fit,
  labels,
}: PreviewDocumentOptions): string {
  const safeBackground =
    backgroundUrl?.startsWith("blob:") ||
    /^data:image\/(?:jpeg|png|webp);base64,[a-z\d+/=]+$/i.test(
      backgroundUrl ?? ""
    )
      ? backgroundUrl
      : undefined;
  const background = safeBackground
    ? `url(${JSON.stringify(safeBackground)})`
    : "none";

  return `<!doctype html>
<html dir="${direction}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src blob: data:; font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<style>
  :root { color-scheme: ${appearance}; --font-ui: ${fontFamilies.ui}; --font-body: ${fontFamilies.body}; --font-mono: ${fontFamilies.mono}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { color: ${theme.text}; background: ${theme.background}; font: 12px/1.65 var(--font-ui); overflow-wrap: anywhere; }
  .preview-toolbar { padding: 9px 12px; background: ${theme.background}; border-bottom: 1px solid ${theme.divider}; color: ${theme.textSecondary}; }
  .preview-layout { display: grid; grid-template-columns: 78px minmax(0, 1fr); min-height: 290px; background-image: ${background}; background-position: center; background-size: ${fit === "repeat" ? "110px auto" : fit}; background-repeat: ${fit === "repeat" ? "repeat" : "no-repeat"}; }
  .preview-sidebar { padding: 16px 10px; background: color-mix(in srgb, ${theme.sidebarBackground} 90%, transparent); color: ${theme.sidebarText}; }
  .preview-sidebar div { margin-bottom: 14px; }
  .preview-sidebar .selected { color: ${theme.accent}; font-weight: 600; }
  .preview-editor { margin: 16px 10px; padding: 16px 12px; min-width: 0; border-radius: 5px; background: color-mix(in srgb, ${theme.background} 92%, transparent); }
  .preview-editor h2 { margin: 0 0 12px; font-size: 18px; line-height: 1.5; }
  .preview-editor p { margin: 0 0 14px; color: ${theme.textSecondary}; }
  .preview-editor .preview-link { color: ${theme.link}; }
  .preview-editor ul { padding-inline-start: 16px; color: ${theme.textSecondary}; }
</style>
</head>
<body data-outline-part="app">
  <div class="preview-toolbar" data-outline-part="document-toolbar">${escapeHtml(labels.workspace)} / ${escapeHtml(labels.collection)}</div>
  <div class="preview-layout">
    <aside class="preview-sidebar" data-outline-part="sidebar"><div>${escapeHtml(labels.home)}</div><div class="selected">${escapeHtml(labels.collection)}</div><div>${escapeHtml(labels.favorites)}</div></aside>
    <article class="preview-editor" data-outline-part="editor"><h2>${escapeHtml(labels.title)}</h2><p>${escapeHtml(labels.paragraph)}</p><p class="preview-link">${escapeHtml(labels.link)}</p><ul><li>${escapeHtml(labels.listItem)}</li></ul></article>
  </div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
