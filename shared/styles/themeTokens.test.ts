import { buildDarkTheme, buildLightTheme } from "./theme";
import {
  applyThemeTokens,
  isThemeTokenKey,
  sanitizeThemeTokens,
  ThemeTokenGroupOrder,
  ThemeTokenGroups,
  ThemeTokenKeys,
} from "./themeTokens";

describe("ThemeTokenKeys", () => {
  it("lists every key once", () => {
    expect(new Set(ThemeTokenKeys).size).toEqual(ThemeTokenKeys.length);
  });

  it("contains the keys of every group", () => {
    const grouped = ThemeTokenGroupOrder.flatMap(
      (group) => ThemeTokenGroups[group]
    );

    expect(grouped).toEqual([...ThemeTokenKeys]);
  });

  it("only lists keys that are string colors in the light theme", () => {
    const theme = buildLightTheme({});

    for (const key of ThemeTokenKeys) {
      expect(typeof theme[key]).toEqual("string");
    }
  });

  it("only lists keys that are string colors in the dark theme", () => {
    const theme = buildDarkTheme({});

    for (const key of ThemeTokenKeys) {
      expect(typeof theme[key]).toEqual("string");
    }
  });
});

describe("sanitizeThemeTokens", () => {
  it("keeps allowed keys with hex values", () => {
    expect(
      sanitizeThemeTokens({ accent: "#d23f31", background: "#ffffff80" })
    ).toEqual({ accent: "#d23f31", background: "#ffffff80" });
  });

  it("accepts three, four, six and eight digit hex values", () => {
    expect(
      sanitizeThemeTokens({
        accent: "#fff",
        accentText: "#ffff",
        text: "#112233",
        background: "#11223344",
      })
    ).toEqual({
      accent: "#fff",
      accentText: "#ffff",
      text: "#112233",
      background: "#11223344",
    });
  });

  it("drops unknown keys", () => {
    expect(sanitizeThemeTokens({ fontFamily: "#000000" })).toEqual({});
    expect(sanitizeThemeTokens({ menuShadow: "#000000" })).toEqual({});
  });

  it("drops values that are not hex colors", () => {
    expect(
      sanitizeThemeTokens({
        accent: "red",
        text: "url(https://example.com/x)",
        link: "#fff;background:red",
        background: "rgb(0, 0, 0)",
        divider: "",
        cursor: 12,
        quote: null,
      })
    ).toEqual({});
  });

  it("handles input that is not an object", () => {
    expect(sanitizeThemeTokens(null)).toEqual({});
    expect(sanitizeThemeTokens(undefined)).toEqual({});
    expect(sanitizeThemeTokens("#ffffff")).toEqual({});
    expect(sanitizeThemeTokens(42)).toEqual({});
  });

  it("returns a new object", () => {
    const input = { accent: "#d23f31" };
    const output = sanitizeThemeTokens(input);

    expect(output).toEqual(input);
    expect(output).not.toBe(input);
  });
});

describe("applyThemeTokens", () => {
  it("overrides only the given keys", () => {
    const base = buildLightTheme({});
    const theme = applyThemeTokens(base, { sidebarBackground: "#000000" });

    expect(theme.sidebarBackground).toEqual("#000000");
    expect(theme.text).toEqual(base.text);
  });

  it("does not modify the base theme", () => {
    const base = buildLightTheme({});
    const original = base.sidebarBackground;
    applyThemeTokens(base, { sidebarBackground: "#000000" });

    expect(base.sidebarBackground).toEqual(original);
  });
});

describe("isThemeTokenKey", () => {
  it("recognizes allowed keys", () => {
    expect(isThemeTokenKey("accent")).toBe(true);
    expect(isThemeTokenKey("sidebarBackground")).toBe(true);
  });

  it("rejects other keys", () => {
    expect(isThemeTokenKey("menuShadow")).toBe(false);
    expect(isThemeTokenKey("fontFamily")).toBe(false);
    expect(isThemeTokenKey("")).toBe(false);
  });
});
