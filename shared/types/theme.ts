import type { ThemeTokens } from "../styles/themeTokens";

/** Special values stored in theme preferences instead of a theme ID. */
export enum ThemeChoice {
  /** Follow the workspace default theme. */
  WorkspaceDefault = "default",
  /** Use Outline's built-in colors. */
  Builtin = "builtin",
}

/** The color overrides of a custom theme, for each appearance. */
export interface ThemeColors {
  /** Overrides used when the interface is light. */
  light: ThemeTokens;
  /** Overrides used when the interface is dark. */
  dark: ThemeTokens;
}

/** A theme as exported to, and imported from, a JSON file. */
export interface ThemeFile extends ThemeColors {
  /** The file format version. */
  version: 1;
  /** The display name of the theme. */
  name: string;
}
