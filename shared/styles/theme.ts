import { darken, lighten, transparentize } from "polished";
import type { DefaultTheme, Colors } from "styled-components";
import breakpoints from "./breakpoints";

/** Font stacks shared by the application and generated emails. */
export const fontFamilies = {
  body: '"Anthropic Serif", Georgia, "Times New Roman", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "PingFang SC", "Hiragino Sans GB", serif',
  ui: '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif',
  mono: 'Menlo, Monaco, "SF Mono", Consolas, "Sarasa Mono SC", "Cascadia Code", monospace',
};

const defaultColors: Colors = {
  transparent: "transparent",
  almostBlack: "#333333",
  lightBlack: "#3D3D41",
  almostWhite: "#EEEEF0",
  veryDarkBlue: "#1B1B1F",
  slate: "#76767C",
  slateLight: "#DEDEE2",
  slateDark: "#55555A",
  smoke: "#F5F5F7",
  smokeLight: "#F8F9FA",
  smokeDark: "#E6E6EA",
  white: "#FFFFFF",
  white05: "rgba(255, 255, 255, 0.05)",
  white10: "rgba(255, 255, 255, 0.1)",
  white50: "rgba(255, 255, 255, 0.5)",
  white75: "rgba(255, 255, 255, 0.75)",
  black: "#000",
  black05: "rgba(0, 0, 0, 0.05)",
  black10: "rgba(0, 0, 0, 0.1)",
  black50: "rgba(0, 0, 0, 0.50)",
  black75: "rgba(0, 0, 0, 0.75)",
  accent: "#7719AA",
  yellow: "#EDBA07",
  warmGrey: "#F8F9FA",
  danger: "#ed2651",
  warning: "#f08a24",
  success: "#3ad984",
  info: "#a0d3e8",
  brand: {
    red: "#FF5C80",
    pink: "#FF4DFA",
    purple: "#9E5CF7",
    blue: "#3633FF",
    marine: "#2BC2FF",
    dusk: "#2930FF",
    green: "#3ad984",
    yellow: "#F5BE31",
  },
};

/** The narrowest the content of a sidebar can be, excluding its padding. */
const sidebarMinWidth = 240;

const sidebarPadding = 16;

const spacing = {
  sidebarWidth: 260,
  sidebarRightWidth: 300,
  sidebarCollapsedWidth: 16,
  sidebarMinWidth,
  sidebarMaxWidth: 500,
  /** The narrowest a sidebar can be resized to, including its padding. */
  sidebarResizeMinWidth: sidebarMinWidth + sidebarPadding,
};

const buildBaseTheme = (input: Partial<Colors>) => {
  const colors = {
    ...defaultColors,
    ...input,
  };

  return {
    fontFamily: "var(--font-ui)",
    fontFamilyMono: "var(--font-mono)",
    fontFamilyEmoji:
      "Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Segoe UI, Twemoji Mozilla, Noto Color Emoji, Android Emoji",
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 600,
    accentText: colors.white,
    selected: colors.accent,
    textHighlight: "#FFF29D",
    textHighlightForeground: colors.almostBlack,
    commentMarkBackground: transparentize(0.5, colors.brand.marine),
    commentedImageOutlineDark: colors.brand.marine,
    commentedImageOutlineLight: transparentize(0.7, colors.brand.marine),
    code: colors.lightBlack,
    codeComment: "#008000",
    codePunctuation: "#393a34",
    codeNumber: "#0550ae",
    codeProperty: "#C42B33",
    codeTag: "#800000",
    codeClassName: "#00578a",
    codeString: "#a31515",
    codeSelector: "#800000",
    codeAttrName: "#C42B33",
    codeAttrValue: colors.lightBlack,
    codeEntity: "#C42B33",
    codeKeyword: "#00009f",
    codeFunction: "#393A34",
    codeStatement: "#C42B33",
    codePlaceholder: "#276CA2",
    codeInserted: "#0550ae",
    codeImportant: "#B028A4",
    codeConstant: "#0550ae",
    codeParameter: colors.lightBlack,
    codeOperator: "#393a34",
    noticeInfoBackground: colors.brand.blue,
    noticeInfoText: colors.almostBlack,
    noticeTipBackground: "#f5be31",
    noticeTipText: colors.almostBlack,
    noticeWarningBackground: "#d73a49",
    noticeWarningText: colors.almostBlack,
    noticeSuccessBackground: colors.brand.green,
    noticeSuccessText: colors.almostBlack,
    tableSelectedBackground: transparentize(0.9, colors.accent),
    breakpoints,
    ...colors,
    ...spacing,
  };
};

/**
 * Builds the light theme with the requested palette overrides.
 *
 * @param input custom palette colors.
 * @returns the resolved light theme.
 */
export const buildLightTheme = (input: Partial<Colors>): DefaultTheme => {
  const colors = buildBaseTheme(input);

  return {
    ...colors,
    isDark: false,
    background: colors.white,
    backgroundSecondary: colors.warmGrey,
    backgroundTertiary: colors.smokeDark,
    backgroundQuaternary: darken(0.05, colors.smokeDark),
    link: colors.accent,
    cursor: colors.almostBlack,
    text: colors.almostBlack,
    textSecondary: colors.slateDark,
    textTertiary: colors.slate,
    textDiffInserted: colors.almostBlack,
    textDiffInsertedBackground: "rgba(18, 138, 41, 0.16)",
    textDiffDeleted: colors.slateDark,
    textDiffDeletedBackground: "rgba(255, 180, 173, 0.25)",
    placeholder: colors.slate,
    sidebarBackground: colors.warmGrey,
    sidebarHoverBackground: "#EDEDEF",
    sidebarActiveBackground: transparentize(0.9, colors.accent),
    sidebarControlHoverBackground: colors.black05,
    sidebarDraftBorder: "#CFCED2",
    sidebarText: colors.slateDark,
    backdrop: "rgba(0, 0, 0, 0.2)",
    shadow: "rgba(0, 0, 0, 0.2)",

    modalBackdrop: "rgba(0, 0, 0, 0.25)",
    modalBackground: colors.white,
    modalShadow: "0 0 0 1px rgb(0 0 0 / 7%), 0 8px 24px rgb(0 0 0 / 12%)",

    menuItemSelected: "#EDEDEF",
    menuBackground: colors.warmGrey,
    menuShadow: "0 0 0 1px rgb(0 0 0 / 7%), 0 4px 16px rgb(0 0 0 / 12%)",
    divider: colors.slateLight,
    titleBarDivider: colors.slateLight,
    inputBorder: colors.slateLight,
    inputBorderFocused: colors.accent,
    inputBackground: colors.white,
    listItemHoverBackground: colors.warmGrey,
    mentionBackground: transparentize(0.94, colors.accent),
    mentionHoverBackground: transparentize(0.88, colors.accent),
    tableSelected: colors.accent,
    buttonNeutralBackground: colors.white,
    buttonNeutralHoverBackground: colors.warmGrey,
    buttonNeutralText: colors.almostBlack,
    buttonNeutralBorder: colors.slateLight,
    tooltipBackground: colors.almostBlack,
    tooltipText: colors.white,
    toastBackground: colors.white,
    toastText: colors.almostBlack,
    quote: transparentize(0.65, colors.accent),
    codeBackground: colors.smoke,
    codeBorder: colors.smokeDark,
    embedBorder: colors.slateLight,
    horizontalRule: colors.smokeDark,
    progressBarBackground: colors.slateLight,
    scrollbarBackground: colors.warmGrey,
    scrollbarThumb: "#C6C6CC",
  };
};

/**
 * Builds the dark theme with the requested palette overrides.
 *
 * @param input custom palette colors.
 * @returns the resolved dark theme.
 */
export const buildDarkTheme = (input: Partial<Colors>): DefaultTheme => {
  const colors = buildBaseTheme(input);
  const accentLight = lighten(0.3, colors.accent);

  return {
    ...colors,
    isDark: true,
    background: "#242428",
    backgroundSecondary: "#2C2C31",
    backgroundTertiary: "#38383E",
    backgroundQuaternary: "#44444C",
    link: accentLight,
    selected: accentLight,
    text: colors.almostWhite,
    cursor: colors.almostWhite,
    textSecondary: "#C0C0C6",
    textTertiary: "#A0A0A8",
    textDiffInserted: colors.almostWhite,
    textDiffInsertedBackground: "rgba(63,185,80,0.25)",
    textDiffDeleted: darken(0.1, colors.almostWhite),
    textDiffDeletedBackground: "rgba(248,81,73,0.15)",
    placeholder: "#A0A0A8",
    sidebarBackground: colors.veryDarkBlue,
    sidebarHoverBackground: lighten(0.05, colors.veryDarkBlue),
    sidebarActiveBackground: transparentize(0.88, accentLight),
    sidebarControlHoverBackground: colors.white10,
    sidebarDraftBorder: lighten(0.2, colors.veryDarkBlue),
    sidebarText: "#C0C0C6",
    backdrop: "rgba(0, 0, 0, 0.5)",
    shadow: "rgba(0, 0, 0, 0.6)",

    modalBackdrop: colors.black50,
    modalBackground: "#2C2C31",
    modalShadow:
      "0 0 0 1px rgba(0, 0, 0, 0.1), 0 8px 16px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.08)",

    menuItemSelected: "#3B3B42",
    menuBackground: "#2C2C31",
    menuShadow:
      "0 0 0 1px rgb(68 68 76), 0 8px 16px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.08)",
    divider: "#414147",
    titleBarDivider: "#414147",
    inputBorder: "#55555D",
    inputBorderFocused: accentLight,
    inputBackground: "#303036",
    listItemHoverBackground: colors.white05,
    mentionBackground: transparentize(0.86, accentLight),
    mentionHoverBackground: transparentize(0.76, accentLight),
    tableSelected: accentLight,
    tableSelectedBackground: transparentize(0.85, accentLight),
    buttonNeutralBackground: "#2C2C31",
    buttonNeutralHoverBackground: "#3B3B42",
    buttonNeutralText: colors.white,
    buttonNeutralBorder: "#55555D",
    tooltipBackground: colors.white,
    tooltipText: colors.lightBlack,
    toastBackground: colors.veryDarkBlue,
    toastText: colors.almostWhite,
    quote: transparentize(0.5, accentLight),
    code: colors.almostWhite,
    codeBackground: "#2B2B30",
    codeBorder: colors.white10,
    codeComment: "#7DAD68",
    codePunctuation: "#b3b3b3",
    codeProperty: "#b5cea8",
    codeNumber: "#b5cea8",
    codeTag: "#b5cea8",
    codeOperator: "#d4d4d4",
    codeConstant: "#9cdcfe",
    codeParameter: "#9cdcfe",
    codeSelector: "#ce9178",
    codeEntity: "#d4d4d4",
    codeStatement: "#E08484",
    codePlaceholder: "#6AA9DC",
    codeInserted: "#b5cea8",
    codeString: "#ce9178",
    codeKeyword: "#569Cd6",
    codeFunction: "#dcdcaa",
    codeClassName: "#4ec9b0",
    codeImportant: "#569Cd6",
    codeAttrName: "#9cdcfe",
    codeAttrValue: "#ce9178",
    embedBorder: "#414147",
    horizontalRule: "#414147",
    noticeInfoText: colors.white,
    noticeTipText: colors.white,
    noticeWarningText: colors.white,
    noticeSuccessText: colors.white,
    progressBarBackground: colors.slate,
    scrollbarBackground: colors.veryDarkBlue,
    scrollbarThumb: "#55555D",
  };
};

/**
 * Builds the pitch black theme for dark mobile layouts.
 *
 * @param input custom palette colors.
 * @returns the resolved pitch black theme.
 */
export const buildPitchBlackTheme = (input: Partial<Colors>) => {
  const colors = buildDarkTheme(input);

  return {
    ...colors,
    background: colors.black,
    backgroundSecondary: colors.veryDarkBlue,
    codeBackground: colors.veryDarkBlue,
  };
};

export const light = buildLightTheme(defaultColors);

export default light as DefaultTheme;
