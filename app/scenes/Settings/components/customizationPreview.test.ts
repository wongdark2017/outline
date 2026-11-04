import { buildLightTheme } from "@shared/styles/theme";
import {
  buildCustomizationPreviewDocument,
  parseCustomizationModules,
} from "./customizationPreview";

const labels = {
  workspace: "Workspace",
  collection: "Collection",
  home: "Home",
  favorites: "Favorites",
  title: "A document",
  paragraph: "A paragraph",
  link: "A link",
  listItem: "An item",
};

describe("parseCustomizationModules", () => {
  it("retains native JavaScript dependency source", () => {
    expect(
      parseCustomizationModules(
        '{"helpers.js":"export const name = \'team\';"}'
      )
    ).toEqual({
      ok: true,
      modules: { "helpers.js": "export const name = 'team';" },
    });
  });

  it("rejects malformed JSON and non-string mappings", () => {
    expect(parseCustomizationModules("{")).toEqual({
      ok: false,
      reason: "json",
    });
    for (const value of [
      "null",
      "[]",
      '"module"',
      '{"a.js":5}',
      '{"a.js":{}}',
    ]) {
      expect(parseCustomizationModules(value)).toEqual({
        ok: false,
        reason: "mapping",
      });
    }
  });

  it("rejects prototype-related property names", () => {
    expect(parseCustomizationModules('{"__proto__":"code"}')).toEqual({
      ok: false,
      reason: "mapping",
    });
  });
});

describe("buildCustomizationPreviewDocument", () => {
  it("does not include retained workspace or personal CSS in the background preview", () => {
    const retainedStyles = {
      workspaceCss: "p { --retained-workspace-style: 1; }",
      personalCss: "p { --retained-personal-style: 1; }",
    };
    const html = buildCustomizationPreviewDocument({
      theme: buildLightTheme({}),
      appearance: "light",
      direction: "ltr",
      fit: "cover",
      ...retainedStyles,
      labels,
    });
    const document = new DOMParser().parseFromString(html, "text/html");
    const styles = document.querySelectorAll("style[data-customization-scope]");

    expect(styles).toHaveLength(0);
    expect(html).not.toContain("--retained-workspace-style");
    expect(html).not.toContain("--retained-personal-style");
  });

  it("omits retained CSS and escapes labels without adding executable elements", () => {
    const retainedStyles = {
      workspaceCss:
        'p::after { content: "</StYlE><script>alert(1)</script>"; }',
      personalCss: "</style><img src=x onerror=alert(2)>",
    };
    const html = buildCustomizationPreviewDocument({
      theme: buildLightTheme({}),
      appearance: "light",
      direction: "ltr",
      fit: "cover",
      ...retainedStyles,
      labels: { ...labels, title: '<img src=x onerror="alert(3)">' },
    });
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(document.querySelectorAll("script, img")).toHaveLength(0);
    expect(document.querySelectorAll("style")).toHaveLength(1);
    expect(document.querySelector("h2")?.textContent).toBe(
      '<img src=x onerror="alert(3)">'
    );
  });

  it("only allows local image references in the preview", () => {
    const html = buildCustomizationPreviewDocument({
      theme: buildLightTheme({}),
      appearance: "light",
      direction: "ltr",
      backgroundUrl: "javascript:alert(1)",
      fit: "cover",
      labels,
    });
    const document = new DOMParser().parseFromString(html, "text/html");

    expect(html).not.toContain("javascript:alert(1)");
    const policy = document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("img-src blob: data:");
  });
});
