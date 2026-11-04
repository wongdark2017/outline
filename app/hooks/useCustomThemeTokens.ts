import { useEffect, useMemo, useState } from "react";
import type { ThemeTokens } from "@shared/styles/themeTokens";
import { TeamPreference, UserPreference } from "@shared/types";
import { AuthorizationError, NotFoundError } from "~/utils/errors";
import {
  clearThemeCache,
  readThemeCache,
  resolveThemeId,
  writeThemeCache,
} from "~/utils/themes";
import useStores from "./useStores";

/**
 * Returns the color overrides of the custom theme the signed-in user has
 * chosen for the current light or dark mode, if any. Must be called from an
 * observer component.
 *
 * @returns sanitized color overrides, or undefined for built-in colors.
 */
export default function useCustomThemeTokens(): ThemeTokens | undefined {
  const { auth, ui, themes } = useStores();
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const isDark = ui.resolvedTheme === "dark";

  // Custom themes only apply in the signed-in app.
  const themeId = auth.user
    ? resolveThemeId(
        auth.user.getPreference(
          isDark ? UserPreference.DarkTheme : UserPreference.LightTheme
        ),
        auth.team?.getPreference(
          isDark
            ? TeamPreference.DefaultDarkTheme
            : TeamPreference.DefaultLightTheme
        ),
        unavailable
      )
    : undefined;
  const theme = themeId ? themes.get(themeId) : undefined;
  const tokens = theme ? (isDark ? theme.dark : theme.light) : undefined;

  useEffect(() => {
    if (!themeId || theme) {
      return;
    }

    themes.fetch(themeId).catch((err) => {
      // A deleted or inaccessible theme falls back to the next choice. Other
      // failures, such as being offline, keep the cached colors.
      if (err instanceof NotFoundError || err instanceof AuthorizationError) {
        clearThemeCache(isDark);
        setUnavailable((ids) =>
          ids.includes(themeId) ? ids : [...ids, themeId]
        );
      }
    });
  }, [themeId, theme, themes, isDark]);

  useEffect(() => {
    if (themeId && tokens) {
      writeThemeCache(isDark, themeId, tokens);
    }
  }, [themeId, tokens, isDark]);

  const cached = useMemo(
    () => (themeId ? readThemeCache(isDark, themeId) : undefined),
    [isDark, themeId]
  );

  if (!themeId) {
    return undefined;
  }
  return tokens ?? cached;
}
