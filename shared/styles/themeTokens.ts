import type { DefaultTheme } from "styled-components";
import { validateColorHex } from "../utils/color";

/** The groups of theme keys, in the order they appear in the theme editor. */
export const ThemeTokenGroupOrder = [
  "brand",
  "surfaces",
  "text",
  "sidebar",
  "menus",
  "inputs",
  "editor",
] as const;

/** The name of a group of theme keys. */
export type ThemeTokenGroup = (typeof ThemeTokenGroupOrder)[number];

/**
 * The theme keys a custom theme may override, grouped as they appear in the
 * theme editor. Every key must be a plain color in `DefaultTheme`.
 */
export const ThemeTokenGroups = {
  brand: ["accent", "accentText", "link", "selected"],
  surfaces: [
    "background",
    "backgroundSecondary",
    "backgroundTertiary",
    "backgroundQuaternary",
    "divider",
    "titleBarDivider",
  ],
  text: [
    "text",
    "textSecondary",
    "textTertiary",
    "placeholder",
    "cursor",
    "textHighlight",
    "textHighlightForeground",
  ],
  sidebar: [
    "sidebarBackground",
    "sidebarHoverBackground",
    "sidebarActiveBackground",
    "sidebarText",
  ],
  menus: [
    "menuBackground",
    "menuItemSelected",
    "modalBackground",
    "tooltipBackground",
    "tooltipText",
    "toastBackground",
    "toastText",
  ],
  inputs: [
    "inputBorder",
    "inputBorderFocused",
    "inputBackground",
    "buttonNeutralBackground",
    "buttonNeutralHoverBackground",
    "buttonNeutralText",
    "buttonNeutralBorder",
    "listItemHoverBackground",
  ],
  editor: [
    "quote",
    "code",
    "codeBackground",
    "codeBorder",
    "horizontalRule",
    "mentionBackground",
    "mentionHoverBackground",
    "noticeInfoBackground",
    "noticeTipBackground",
    "noticeWarningBackground",
    "noticeSuccessBackground",
  ],
} as const satisfies Record<ThemeTokenGroup, ReadonlyArray<keyof DefaultTheme>>;

/** Every key a custom theme may override. */
export const ThemeTokenKeys = [
  ...ThemeTokenGroups.brand,
  ...ThemeTokenGroups.surfaces,
  ...ThemeTokenGroups.text,
  ...ThemeTokenGroups.sidebar,
  ...ThemeTokenGroups.menus,
  ...ThemeTokenGroups.inputs,
  ...ThemeTokenGroups.editor,
] as const;

/** A key a custom theme may override. */
export type ThemeTokenKey = (typeof ThemeTokenKeys)[number];

/** Color overrides for one appearance, keyed by theme key, hex values only. */
export type ThemeTokens = Partial<Record<ThemeTokenKey, string>>;

/**
 * Returns true if the given string is a key a custom theme may override.
 *
 * @param key the key to check.
 * @returns true if the key is a theme token key.
 */
export function isThemeTokenKey(key: string): key is ThemeTokenKey {
  return ThemeTokenKeys.some((tokenKey) => tokenKey === key);
}

/**
 * Keeps only allowed keys with valid hex color values. Used on every path
 * where theme colors enter the system: saving, presenting, caching and
 * importing. The input is untrusted, so it is accepted as unknown.
 *
 * @param input untrusted color overrides.
 * @returns the safe subset of the overrides.
 */
export function sanitizeThemeTokens(input: unknown): ThemeTokens {
  const tokens: ThemeTokens = {};

  if (!input || typeof input !== "object") {
    return tokens;
  }

  for (const key of ThemeTokenKeys) {
    const value: unknown = Reflect.get(input, key);
    if (typeof value === "string" && validateColorHex(value)) {
      tokens[key] = value;
    }
  }

  return tokens;
}

/**
 * Applies color overrides on top of a built theme.
 *
 * @param theme the theme produced by one of the theme builders.
 * @param tokens sanitized color overrides.
 * @returns a new theme with the overrides applied.
 */
export function applyThemeTokens(
  theme: DefaultTheme,
  tokens: ThemeTokens
): DefaultTheme {
  return { ...theme, ...tokens };
}
