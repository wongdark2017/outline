import { pickBy } from "es-toolkit";
import { useEffect, useMemo } from "react";
import { breakpoints } from "@shared/styles";
import {
  buildDarkTheme,
  buildLightTheme,
  buildPitchBlackTheme,
} from "@shared/styles/theme";
import type { ThemeTokens } from "@shared/styles/themeTokens";
import {
  applyThemeTokens,
  sanitizeThemeTokens,
} from "@shared/styles/themeTokens";
import type { CustomTheme } from "@shared/types";
import { validateColorHex } from "@shared/utils/color";
import { Theme } from "~/stores/UiStore";
import useMediaQuery from "~/hooks/useMediaQuery";
import useStores from "./useStores";
import useQuery from "./useQuery";

/**
 * Builds a theme based on the current user's preferences, the current device
 * and the custom theme provided.
 *
 * @param customTheme Custom theme to merge with the default theme
 * @param overrideTheme Optional override the theme to use
 * @param themeTokens Optional color overrides from a user-selected theme
 * @returns The theme to use
 */
export default function useBuildTheme(
  customTheme: Partial<CustomTheme> = {},
  overrideTheme?: Theme,
  themeTokens?: ThemeTokens
) {
  const { ui } = useStores();
  const params = useQuery();
  const isMobile = useMediaQuery(`(max-width: ${breakpoints.tablet}px)`);
  const isPrinting = useMediaQuery("print");
  const queryTheme = (params.get("theme") as Theme) || undefined;

  // Store the theme override in UiStore so it persists during navigation
  useEffect(() => {
    if (
      queryTheme &&
      (queryTheme === Theme.Light || queryTheme === Theme.Dark)
    ) {
      ui.setThemeOverride(queryTheme);
    }
  }, [queryTheme, ui]);

  const resolvedTheme = overrideTheme ?? ui.resolvedTheme;

  // Drop any stored color that is not valid hex so a bad value cannot break rendering.
  const safeTheme = useMemo(
    () =>
      pickBy(
        customTheme,
        (value): value is string =>
          typeof value === "string" && validateColorHex(value)
      ),
    [customTheme]
  );

  const safeTokens = useMemo(
    () => sanitizeThemeTokens(themeTokens),
    [themeTokens]
  );

  const theme = useMemo(() => {
    // Printed pages always use the built-in light colors so documents stay
    // readable whatever theme the user has chosen.
    if (isPrinting) {
      return buildLightTheme(safeTheme);
    }

    // The accent is an input to the builders, which derive selection colors
    // from it, so pass it in rather than only overriding it afterwards. It is
    // only included when set, as spreading an undefined accent would erase the
    // default.
    const input = safeTokens.accent
      ? { ...safeTheme, accent: safeTokens.accent }
      : safeTheme;

    const base = isMobile
      ? resolvedTheme === "dark"
        ? buildPitchBlackTheme(input)
        : buildLightTheme(input)
      : resolvedTheme === "dark"
        ? buildDarkTheme(input)
        : buildLightTheme(input);

    return applyThemeTokens(base, safeTokens);
  }, [safeTheme, safeTokens, isMobile, isPrinting, resolvedTheme]);

  return theme;
}
