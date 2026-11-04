import {
  customizationScriptDigest,
  isCustomizationModulePath,
  validateCustomizationCss,
} from "./customizations";

describe("customization source validation", () => {
  it("accepts normalized managed modules and rejects traversal or reserved syntax", () => {
    expect(isCustomizationModulePath("deps/format.js")).toBe(true);
    expect(isCustomizationModulePath("helper.mjs")).toBe(true);
    for (const path of [
      "../secret.js",
      "/secret.js",
      "deps//x.js",
      "deps/./x.js",
      "x.js?token=a",
      "x.js%00",
      "https://example.com/x.js",
    ]) {
      expect(isCustomizationModulePath(path)).toBe(false);
    }
  });

  it("fingerprints dependency contents and ignores manifest insertion order", () => {
    const source = "export function activate() {}";
    const first = customizationScriptDigest(source, {
      "b.js": "export const b = 1;",
      "a.js": "export const a = 1;",
    });
    const reordered = customizationScriptDigest(source, {
      "a.js": "export const a = 1;",
      "b.js": "export const b = 1;",
    });
    const changed = customizationScriptDigest(source, {
      "a.js": "export const a = 2;",
      "b.js": "export const b = 1;",
    });
    expect(first).toEqual(reordered);
    expect(changed).not.toEqual(first);
  });

  it("rejects invalid JavaScript and a dependency overriding the entry module", () => {
    expect(() => customizationScriptDigest("export function {", {})).toThrow(
      "invalid JavaScript"
    );
    expect(() => customizationScriptDigest("", { "entry.js": "" })).toThrow(
      "reserved"
    );
  });

  it("validates CSS syntax without restricting it to color tokens", () => {
    expect(() =>
      validateCustomizationCss(
        ".editor { padding: 2rem; } @media (min-width: 600px) { body { display: grid; } }"
      )
    ).not.toThrow();
    expect(() => validateCustomizationCss("body { color: red;")).toThrow(
      "syntax error"
    );
  });
});
