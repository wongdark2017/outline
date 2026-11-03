import { sanitizeThemeTokens } from "@shared/styles/themeTokens";
import type { Theme } from "@server/models";
import presentUser from "./user";

/**
 * Presents a custom theme for the API. Colors are sanitized again on the way
 * out, so a row written around the model, for example by hand in SQL, can
 * never reach a client with unsafe values.
 *
 * @param theme the theme to present.
 * @returns the API representation of the theme.
 */
export default function presentTheme(theme: Theme) {
  return {
    id: theme.id,
    name: theme.name,
    light: sanitizeThemeTokens(theme.light),
    dark: sanitizeThemeTokens(theme.dark),
    teamId: theme.teamId,
    createdBy: theme.createdBy ? presentUser(theme.createdBy) : undefined,
    createdById: theme.createdById,
    createdAt: theme.createdAt,
    updatedAt: theme.updatedAt,
  };
}
