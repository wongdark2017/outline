import { ThemeChoice } from "@shared/types";
import Storage from "@shared/utils/Storage";
import {
  clearThemeCache,
  parseThemeFile,
  readThemeCache,
  resolveThemeId,
  themeFileName,
  writeThemeCache,
} from "./themes";

const themeId = "6f1c1f0e-2b8a-4c1e-9a55-0d3f6a2b9c11";
const teamThemeId = "0a9e8a5c-7f2d-4b0e-8a61-3c5d2e1f4b77";

describe("resolveThemeId", () => {
  it("uses the user's theme", () => {
    expect(resolveThemeId(themeId, teamThemeId)).toEqual(themeId);
    expect(resolveThemeId(themeId, ThemeChoice.Builtin)).toEqual(themeId);
  });

  it("follows the workspace default when unset", () => {
    expect(resolveThemeId(false, teamThemeId)).toEqual(teamThemeId);
    expect(resolveThemeId(undefined, teamThemeId)).toEqual(teamThemeId);
    expect(resolveThemeId(ThemeChoice.WorkspaceDefault, teamThemeId)).toEqual(
      teamThemeId
    );
  });

  it("uses built-in colors when asked", () => {
    expect(resolveThemeId(ThemeChoice.Builtin, teamThemeId)).toBeUndefined();
    expect(resolveThemeId(false, ThemeChoice.Builtin)).toBeUndefined();
    expect(resolveThemeId(false, false)).toBeUndefined();
    expect(resolveThemeId(undefined, undefined)).toBeUndefined();
  });

  it("falls back to the workspace default when the user's theme is gone", () => {
    expect(resolveThemeId(themeId, teamThemeId, [themeId])).toEqual(
      teamThemeId
    );
  });

  it("falls back to built-in colors when the workspace default is gone", () => {
    expect(resolveThemeId(themeId, teamThemeId, [themeId, teamThemeId])).toBe(
      undefined
    );
    expect(resolveThemeId(false, teamThemeId, [teamThemeId])).toBeUndefined();
  });

  it("ignores unavailable themes that are not in use", () => {
    expect(resolveThemeId(themeId, teamThemeId, [teamThemeId])).toEqual(
      themeId
    );
  });
});

describe("parseThemeFile", () => {
  it("reads a valid file and drops unsafe values", () => {
    const file = parseThemeFile(
      JSON.stringify({
        version: 1,
        name: " Sunset ",
        light: { accent: "#d23f31", text: "expression(alert(1))" },
        dark: { background: "#101010", fontFamily: "#000000" },
      })
    );

    expect(file).toEqual({
      version: 1,
      name: "Sunset",
      light: { accent: "#d23f31" },
      dark: { background: "#101010" },
    });
  });

  it("tolerates missing color sets", () => {
    const file = parseThemeFile(JSON.stringify({ name: "Plain" }));

    expect(file).toEqual({ version: 1, name: "Plain", light: {}, dark: {} });
  });

  it("shortens a name that is too long", () => {
    const file = parseThemeFile(JSON.stringify({ name: "x".repeat(80) }));

    expect(file.name).toHaveLength(50);
  });

  it("throws without a name", () => {
    expect(() => parseThemeFile(JSON.stringify({ light: {} }))).toThrow();
    expect(() => parseThemeFile(JSON.stringify({ name: "  " }))).toThrow();
    expect(() => parseThemeFile(JSON.stringify({ name: 12 }))).toThrow();
  });

  it("throws on JSON that is not an object", () => {
    expect(() => parseThemeFile("null")).toThrow();
    expect(() => parseThemeFile("42")).toThrow();
  });

  it("throws on invalid JSON", () => {
    expect(() => parseThemeFile("not json")).toThrow();
  });
});

describe("theme cache", () => {
  afterEach(() => {
    clearThemeCache(true);
    clearThemeCache(false);
  });

  it("returns the colors cached for the same theme", () => {
    writeThemeCache(false, themeId, { accent: "#d23f31" });

    expect(readThemeCache(false, themeId)).toEqual({ accent: "#d23f31" });
  });

  it("keeps light and dark apart", () => {
    writeThemeCache(false, themeId, { accent: "#d23f31" });
    writeThemeCache(true, teamThemeId, { background: "#101010" });

    expect(readThemeCache(false, themeId)).toEqual({ accent: "#d23f31" });
    expect(readThemeCache(true, teamThemeId)).toEqual({
      background: "#101010",
    });
    expect(readThemeCache(true, themeId)).toBeUndefined();
  });

  it("ignores colors cached for another theme", () => {
    writeThemeCache(false, themeId, { accent: "#d23f31" });

    expect(readThemeCache(false, teamThemeId)).toBeUndefined();
  });

  it("does not trust what is in storage", () => {
    Storage.set("CUSTOM_THEME_LIGHT", {
      id: themeId,
      tokens: {
        accent: "red",
        text: "#111111",
        link: "url(https://example.com/x)",
        fontFamily: "#000000",
      },
    });

    expect(readThemeCache(false, themeId)).toEqual({ text: "#111111" });
  });

  it("ignores entries that have the wrong shape", () => {
    for (const value of ["text", 12, null, [], { id: themeId }]) {
      Storage.set("CUSTOM_THEME_LIGHT", value);

      const cached = readThemeCache(false, themeId);
      expect(cached === undefined || Object.keys(cached).length === 0).toBe(
        true
      );
    }
  });

  it("forgets the colors once cleared", () => {
    writeThemeCache(false, themeId, { accent: "#d23f31" });
    clearThemeCache(false);

    expect(readThemeCache(false, themeId)).toBeUndefined();
  });

  it("only stores valid colors", () => {
    const tokens: Record<string, string> = {
      accent: "#d23f31",
      text: "expression(alert(1))",
    };
    writeThemeCache(false, themeId, tokens);

    expect(readThemeCache(false, themeId)).toEqual({ accent: "#d23f31" });
  });
});

describe("themeFileName", () => {
  it("keeps letters, numbers, dashes and underscores", () => {
    expect(themeFileName("Sunset_2-dark")).toEqual("Sunset_2-dark.json");
  });

  it("replaces unsafe characters", () => {
    expect(themeFileName("My theme / v2!")).toEqual("My-theme-v2.json");
  });

  it("keeps letters from other scripts", () => {
    expect(themeFileName("日落 主题")).toEqual("日落-主题.json");
  });

  it("falls back to a default name", () => {
    expect(themeFileName("")).toEqual("theme.json");
    expect(themeFileName("///")).toEqual("theme.json");
  });
});
