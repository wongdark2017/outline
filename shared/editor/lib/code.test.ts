import Storage from "../../utils/Storage";
import {
  getRefractorLangForLanguage,
  getLabelForLanguage,
  setRecentlyUsedCodeLanguage,
  getRecentlyUsedCodeLanguage,
  getFrequentCodeLanguages,
  searchCodeLanguages,
} from "./code";

describe("searchCodeLanguages", () => {
  it.each(["", "   "])("returns no matches for an empty query %j", (query) => {
    expect(searchCodeLanguages(query, [])).toEqual([]);
  });

  it("ranks an exact keyword above a name prefix", () => {
    expect(searchCodeLanguages("ts", [])).toEqual([
      { value: "typescript", label: "TypeScript", keyword: "ts" },
      { value: "tsx", label: "TSX", labelMatch: [0, 2] },
    ]);
  });

  it("uses frequency to order ties and otherwise keeps registry order", () => {
    expect(searchCodeLanguages("jav", []).map(({ value }) => value)).toEqual([
      "java",
      "javascript",
    ]);
    expect(
      searchCodeLanguages("jav", ["javascript"]).map(({ value }) => value)
    ).toEqual(["javascript", "java"]);
  });

  it("prioritizes the match tier over frequency", () => {
    expect(
      searchCodeLanguages("ts", ["tsx"]).map(({ value }) => value)
    ).toEqual(["typescript", "tsx"]);
  });

  it("returns the keyword for prefix and substring matches", () => {
    expect(searchCodeLanguages("terra", [])).toEqual([
      { value: "hcl", label: "HCL", keyword: "terraform" },
    ]);
    expect(searchCodeLanguages("gres", [])).toEqual([
      { value: "sql", label: "SQL", keyword: "postgres" },
    ]);
  });

  it("returns the name match range at a word boundary", () => {
    expect(searchCodeLanguages("basic", [])).toEqual([
      { value: "vb", label: "Visual Basic", labelMatch: [7, 12] },
    ]);
    expect(searchCodeLanguages("tive", [])).toEqual([
      { value: "objectivec", label: "Objective-C", labelMatch: [5, 9] },
    ]);
  });

  it.each([
    ["script", ["javascript", "typescript"]],
    ["shell", ["bash", "powershell"]],
    ["  PYTHON  ", ["python"]],
    [" C# ", ["csharp"]],
    ["jáva", ["java", "javascript"]],
    ["正则", ["regex"]],
    ["纯", ["none"]],
    ["mermaid", ["mermaid"]],
    ["cobol", []],
  ])("matches %j", (query, expected) => {
    expect(searchCodeLanguages(query, []).map(({ value }) => value)).toEqual(
      expected
    );
  });

  it("limits one-character queries to exact and prefix matches", () => {
    const values = searchCodeLanguages("c", []).map(({ value }) => value);
    expect(values[0]).toBe("clike");
    expect(values).not.toContain("javascript");
    expect(values).not.toContain("objectivec");
  });
});

describe("getRefractorLangForLanguage", () => {
  it("should return the correct lang identifier for a given language", () => {
    expect(getRefractorLangForLanguage("javascript")).toBe("javascript");
    expect(getRefractorLangForLanguage("mermaid")).toBe("mermaid");
    expect(getRefractorLangForLanguage("mermaidjs")).toBe("mermaid");
    expect(getRefractorLangForLanguage("xml")).toBe("markup");
    expect(getRefractorLangForLanguage("diff")).toBe("diff");
    expect(getRefractorLangForLanguage("fortran")).toBe("fortran");
    expect(getRefractorLangForLanguage("unknown")).toBeUndefined();
    expect(getRefractorLangForLanguage("")).toBeUndefined();
  });
});

describe("getLabelForLanguage", () => {
  it("should return the correct human-readable label for a given language", () => {
    expect(getLabelForLanguage("javascript")).toBe("JavaScript");
    expect(getLabelForLanguage("mermaid")).toBe("Mermaid");
    expect(getLabelForLanguage("mermaidjs")).toBe("Mermaid");
    expect(getLabelForLanguage("xml")).toBe("XML");
    expect(getLabelForLanguage("diff")).toBe("Diff");
    expect(getLabelForLanguage("fortran")).toBe("Fortran");
    expect(getLabelForLanguage("unknown")).toBe("Plain text");
    expect(getLabelForLanguage("none")).toBe("Plain text");
    expect(getLabelForLanguage("")).toBe("Plain text");
  });
});

describe("setRecentlyUsedCodeLanguage", () => {
  beforeEach(() => {
    Storage.clear();
  });

  it("should remember the last selected code language", () => {
    setRecentlyUsedCodeLanguage("javascript");
    expect(getRecentlyUsedCodeLanguage()).toBe("javascript");
  });

  it("should not remember mermaid as the last selected code language", () => {
    setRecentlyUsedCodeLanguage("javascript");
    setRecentlyUsedCodeLanguage("mermaid");
    expect(getRecentlyUsedCodeLanguage()).toBe("javascript");
  });

  it("should not remember mermaidjs as the last selected code language", () => {
    setRecentlyUsedCodeLanguage("javascript");
    setRecentlyUsedCodeLanguage("mermaidjs");
    expect(getRecentlyUsedCodeLanguage()).toBe("javascript");
  });

  it("should ignore mermaid that was already persisted", () => {
    Storage.set("rme-code-language", "mermaid");
    expect(getRecentlyUsedCodeLanguage()).toBeUndefined();
  });
});

describe("getFrequentCodeLanguages", () => {
  beforeEach(() => {
    Storage.clear();
  });

  it("should exclude mermaid that was already persisted", () => {
    Storage.set("frequent-code-languages", {
      javascript: 3,
      mermaid: 5,
      mermaidjs: 2,
    });
    expect(getFrequentCodeLanguages()).toEqual(["javascript"]);
  });
});
