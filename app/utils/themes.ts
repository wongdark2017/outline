import type { ThemeTokens } from "@shared/styles/themeTokens";
import { sanitizeThemeTokens } from "@shared/styles/themeTokens";
import type { ThemeFile } from "@shared/types";
import { ThemeChoice } from "@shared/types";
import { ThemeValidation } from "@shared/validations";
import Storage from "@shared/utils/Storage";
import { download } from "./download";

const cacheKey = (isDark: boolean) =>
  `CUSTOM_THEME_${isDark ? "DARK" : "LIGHT"}`;

/**
 * Works out which theme to use from the user's choice and the workspace
 * default. A chosen theme that is known to be unavailable, for example because
 * it was deleted, is treated as if the user follows the workspace default.
 *
 * @param userChoice the user's preference for the current mode.
 * @param teamDefault the workspace default for the current mode.
 * @param unavailable the IDs of themes that could not be loaded.
 * @returns a theme ID, or undefined for the built-in colors.
 */
export function resolveThemeId(
  userChoice: string | false | undefined,
  teamDefault: string | false | undefined,
  unavailable: readonly string[] = []
): string | undefined {
  const choice = userChoice || ThemeChoice.WorkspaceDefault;

  if (choice === ThemeChoice.Builtin) {
    return undefined;
  }
  if (
    choice !== ThemeChoice.WorkspaceDefault &&
    !unavailable.includes(choice)
  ) {
    return choice;
  }
  if (
    !teamDefault ||
    teamDefault === ThemeChoice.Builtin ||
    unavailable.includes(teamDefault)
  ) {
    return undefined;
  }
  return teamDefault;
}

/**
 * Parses an exported theme file. Unknown keys and invalid colors are dropped.
 *
 * @param text the file contents.
 * @returns the theme name and colors.
 * @throws {Error} if the file is not JSON or has no name.
 */
export function parseThemeFile(text: string): ThemeFile {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object") {
    throw new Error("Theme file must contain a JSON object");
  }

  const name: unknown = Reflect.get(data, "name");
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Theme file must have a name");
  }

  return {
    version: 1,
    name: Array.from(name.trim())
      .slice(0, ThemeValidation.maxNameLength)
      .join(""),
    light: sanitizeThemeTokens(Reflect.get(data, "light")),
    dark: sanitizeThemeTokens(Reflect.get(data, "dark")),
  };
}

/**
 * Builds a file name for an exported theme. Letters and numbers from any
 * script are kept, anything else is replaced.
 *
 * @param name the display name of the theme.
 * @returns a file name ending in .json.
 */
export function themeFileName(name: string): string {
  const base = name
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return `${base || "theme"}.json`;
}

/**
 * Caches the colors of the theme in use, so that the next page load can apply
 * them before the theme has been fetched.
 *
 * @param isDark whether the colors are for dark mode.
 * @param themeId the theme the colors belong to.
 * @param tokens the colors to cache.
 */
export function writeThemeCache(
  isDark: boolean,
  themeId: string,
  tokens: ThemeTokens
) {
  Storage.set(cacheKey(isDark), {
    id: themeId,
    tokens: sanitizeThemeTokens(tokens),
  });
}

/**
 * Reads the cached colors for a theme, so a reload doesn't flash the built-in
 * colors. Local storage is not trusted, so only sanitized colors that were
 * cached for the requested theme are returned.
 *
 * @param isDark whether the colors are for dark mode.
 * @param themeId the theme the cache must belong to.
 * @returns the cached colors, or undefined.
 */
export function readThemeCache(
  isDark: boolean,
  themeId: string
): ThemeTokens | undefined {
  const cached: unknown = Storage.get(cacheKey(isDark));
  if (!cached || typeof cached !== "object") {
    return undefined;
  }
  if (Reflect.get(cached, "id") !== themeId) {
    return undefined;
  }
  return sanitizeThemeTokens(Reflect.get(cached, "tokens"));
}

/**
 * Removes the cached colors, for example because the theme no longer exists.
 *
 * @param isDark whether to clear the dark or the light cache.
 */
export function clearThemeCache(isDark: boolean) {
  Storage.remove(cacheKey(isDark));
}

/**
 * Downloads a theme as a JSON file.
 *
 * @param theme the theme name and colors.
 */
export function downloadThemeFile(theme: {
  name: string;
  light: ThemeTokens;
  dark: ThemeTokens;
}) {
  const file: ThemeFile = {
    version: 1,
    name: theme.name,
    light: sanitizeThemeTokens(theme.light),
    dark: sanitizeThemeTokens(theme.dark),
  };

  download(
    JSON.stringify(file, null, 2),
    themeFileName(theme.name),
    "application/json"
  );
}
