import { deburr } from "es-toolkit/compat";
import type { RefractorSyntax } from "refractor";
import { FrequencyTracker } from "../../utils/FrequencyTracker";

/** A language search result with the matching name range or keyword. */
export interface CodeLanguageMatch {
  /** The language identifier. */
  value: string;

  /** The language name shown in the selector. */
  label: string;

  /** The start and exclusive end of the matching name range. */
  labelMatch?: [number, number];

  /** The matching keyword when it ranks above the name match. */
  keyword?: string;
}

/**
 * Describes a code language supported by the editor.
 */
interface CodeLanguage {
  /** The language identifier used by Refractor for syntax highlighting. */
  lang: string;
  /** The human-readable label shown in the language selector. */
  label: string;

  /** Extra search terms, including file extensions and abbreviations. */
  keywords?: string[];

  /** Lazily loads the Refractor syntax definition for the language. */
  loader?: () => Promise<RefractorSyntax>;
  /**
   * Whether this entry is a backwards-compatible alias for another language.
   * Aliases remain resolvable for existing documents but are hidden from the
   * language selector to avoid duplicate options.
   */
  alias?: boolean;
}

/**
 * List of supported code languages.
 *
 * Object key is the language identifier used in the editor, lang is the
 * language identifier used by Refractor. Note mismatches such as `markup` and
 * `mermaid`.
 */
export const codeLanguages: Record<string, CodeLanguage> = {
  none: {
    lang: "",
    label: "Plain text",
    keywords: ["plain", "text", "txt", "纯文本"],
  },
  abap: {
    lang: "abap",
    label: "ABAP",
    loader: () => import("refractor/lang/abap").then((m) => m.default),
  },
  bash: {
    lang: "bash",
    label: "Bash",
    keywords: ["sh", "shell", "zsh"],
    loader: () => import("refractor/lang/bash").then((m) => m.default),
  },
  clike: {
    lang: "clike",
    label: "C",
    loader: () => import("refractor/lang/clike").then((m) => m.default),
  },
  cpp: {
    lang: "cpp",
    label: "C++",
    keywords: ["cpp", "cc", "cxx", "hpp"],
    loader: () => import("refractor/lang/cpp").then((m) => m.default),
  },
  csharp: {
    lang: "csharp",
    label: "C#",
    keywords: ["csharp", "cs", "dotnet"],
    loader: () => import("refractor/lang/csharp").then((m) => m.default),
  },
  css: {
    lang: "css",
    label: "CSS",
    loader: () => import("refractor/lang/css").then((m) => m.default),
  },
  csv: {
    lang: "csv",
    label: "CSV",
    loader: () => import("refractor/lang/csv").then((m) => m.default),
  },
  dart: {
    lang: "dart",
    label: "Dart",
    loader: () => import("refractor/lang/dart").then((m) => m.default),
  },
  diff: {
    lang: "diff",
    label: "Diff",
    keywords: ["patch", "差异"],
    loader: () => import("refractor/lang/diff").then((m) => m.default),
  },
  docker: {
    lang: "docker",
    label: "Docker",
    keywords: ["dockerfile"],
    loader: () => import("refractor/lang/docker").then((m) => m.default),
  },
  elixir: {
    lang: "elixir",
    label: "Elixir",
    keywords: ["ex", "exs"],
    loader: () => import("refractor/lang/elixir").then((m) => m.default),
  },
  erb: {
    lang: "erb",
    label: "ERB",
    loader: () => import("refractor/lang/erb").then((m) => m.default),
  },
  erlang: {
    lang: "erlang",
    label: "Erlang",
    keywords: ["erl"],
    loader: () => import("refractor/lang/erlang").then((m) => m.default),
  },
  fortran: {
    lang: "fortran",
    label: "Fortran",
    loader: () => import("refractor/lang/fortran").then((m) => m.default),
  },
  go: {
    lang: "go",
    label: "Go",
    keywords: ["golang"],
    loader: () => import("refractor/lang/go").then((m) => m.default),
  },
  graphql: {
    lang: "graphql",
    label: "GraphQL",
    keywords: ["gql"],
    loader: () => import("refractor/lang/graphql").then((m) => m.default),
  },
  groovy: {
    lang: "groovy",
    label: "Groovy",
    keywords: ["gradle"],
    loader: () => import("refractor/lang/groovy").then((m) => m.default),
  },
  haskell: {
    lang: "haskell",
    label: "Haskell",
    keywords: ["hs"],
    loader: () => import("refractor/lang/haskell").then((m) => m.default),
  },
  hcl: {
    lang: "hcl",
    label: "HCL",
    keywords: ["terraform", "tf"],
    loader: () => import("refractor/lang/hcl").then((m) => m.default),
  },
  markup: {
    lang: "markup",
    label: "HTML",
    keywords: ["markup", "htm", "xhtml"],
    loader: () => import("refractor/lang/markup").then((m) => m.default),
  },
  ini: {
    lang: "ini",
    label: "INI",
    keywords: ["cfg", "conf"],
    loader: () => import("refractor/lang/ini").then((m) => m.default),
  },
  java: {
    lang: "java",
    label: "Java",
    loader: () => import("refractor/lang/java").then((m) => m.default),
  },
  javascript: {
    lang: "javascript",
    label: "JavaScript",
    keywords: ["js", "node"],
    loader: () => import("refractor/lang/javascript").then((m) => m.default),
  },
  json: {
    lang: "json",
    label: "JSON",
    loader: () => import("refractor/lang/json").then((m) => m.default),
  },
  jsx: {
    lang: "jsx",
    label: "JSX",
    loader: () => import("refractor/lang/jsx").then((m) => m.default),
  },
  kotlin: {
    lang: "kotlin",
    label: "Kotlin",
    keywords: ["kt"],
    loader: () => import("refractor/lang/kotlin").then((m) => m.default),
  },
  kusto: {
    lang: "kusto",
    label: "Kusto",
    keywords: ["kql"],
    // @ts-expect-error Mermaid is not in types but exists
    loader: () => import("refractor/lang/kusto").then((m) => m.default),
  },
  lisp: {
    lang: "lisp",
    label: "Lisp",
    keywords: ["elisp"],
    loader: () => import("refractor/lang/lisp").then((m) => m.default),
  },
  lua: {
    lang: "lua",
    label: "Lua",
    loader: () => import("refractor/lang/lua").then((m) => m.default),
  },
  makefile: {
    lang: "makefile",
    label: "Makefile",
    keywords: ["make"],
    loader: () => import("refractor/lang/makefile").then((m) => m.default),
  },
  markdown: {
    lang: "markdown",
    label: "Markdown",
    keywords: ["md"],
    loader: () => import("refractor/lang/markdown").then((m) => m.default),
  },
  mermaid: {
    lang: "mermaid",
    label: "Mermaid",
    keywords: ["mmd", "流程图"],
    // @ts-expect-error Mermaid is not in types but exists
    loader: () => import("refractor/lang/mermaid").then((m) => m.default),
  },
  mermaidjs: {
    lang: "mermaid",
    label: "Mermaid",
    alias: true,
    // @ts-expect-error Mermaid is not in types but exists
    loader: () => import("refractor/lang/mermaid").then((m) => m.default),
  },
  nginx: {
    lang: "nginx",
    label: "Nginx",
    loader: () => import("refractor/lang/nginx").then((m) => m.default),
  },
  nix: {
    lang: "nix",
    label: "Nix",
    loader: () => import("refractor/lang/nix").then((m) => m.default),
  },
  objectivec: {
    lang: "objectivec",
    label: "Objective-C",
    keywords: ["objc"],
    loader: () => import("refractor/lang/objectivec").then((m) => m.default),
  },
  ocaml: {
    lang: "ocaml",
    label: "OCaml",
    keywords: ["ml"],
    loader: () => import("refractor/lang/ocaml").then((m) => m.default),
  },
  perl: {
    lang: "perl",
    label: "Perl",
    keywords: ["pl"],
    loader: () => import("refractor/lang/perl").then((m) => m.default),
  },
  php: {
    lang: "php",
    label: "PHP",
    loader: () => import("refractor/lang/php").then((m) => m.default),
  },
  powershell: {
    lang: "powershell",
    label: "Powershell",
    keywords: ["ps1", "pwsh"],
    loader: () => import("refractor/lang/powershell").then((m) => m.default),
  },
  promql: {
    lang: "promql",
    label: "PromQL",
    keywords: ["prometheus"],
    // @ts-expect-error PromQL is not in types but exists
    loader: () => import("refractor/lang/promql").then((m) => m.default),
  },
  protobuf: {
    lang: "protobuf",
    label: "Protobuf",
    keywords: ["proto"],
    loader: () => import("refractor/lang/protobuf").then((m) => m.default),
  },
  python: {
    lang: "python",
    label: "Python",
    keywords: ["py"],
    loader: () => import("refractor/lang/python").then((m) => m.default),
  },
  r: {
    lang: "r",
    label: "R",
    loader: () => import("refractor/lang/r").then((m) => m.default),
  },
  regex: {
    lang: "regex",
    label: "Regex",
    keywords: ["regexp", "正则"],
    loader: () => import("refractor/lang/regex").then((m) => m.default),
  },
  ruby: {
    lang: "ruby",
    label: "Ruby",
    keywords: ["rb"],
    loader: () => import("refractor/lang/ruby").then((m) => m.default),
  },
  rust: {
    lang: "rust",
    label: "Rust",
    keywords: ["rs"],
    loader: () => import("refractor/lang/rust").then((m) => m.default),
  },
  scala: {
    lang: "scala",
    label: "Scala",
    loader: () => import("refractor/lang/scala").then((m) => m.default),
  },
  sass: {
    lang: "sass",
    label: "Sass",
    loader: () => import("refractor/lang/sass").then((m) => m.default),
  },
  scss: {
    lang: "scss",
    label: "SCSS",
    loader: () => import("refractor/lang/scss").then((m) => m.default),
  },
  "splunk-spl": {
    lang: "splunk-spl",
    label: "Splunk SPL",
    keywords: ["spl"],
    loader: () => import("refractor/lang/splunk-spl").then((m) => m.default),
  },
  sql: {
    lang: "sql",
    label: "SQL",
    keywords: ["mysql", "postgres", "sqlite"],
    loader: () => import("refractor/lang/sql").then((m) => m.default),
  },
  solidity: {
    lang: "solidity",
    label: "Solidity",
    keywords: ["sol"],
    loader: () => import("refractor/lang/solidity").then((m) => m.default),
  },
  swift: {
    lang: "swift",
    label: "Swift",
    loader: () => import("refractor/lang/swift").then((m) => m.default),
  },
  toml: {
    lang: "toml",
    label: "TOML",
    loader: () => import("refractor/lang/toml").then((m) => m.default),
  },
  tsx: {
    lang: "tsx",
    label: "TSX",
    loader: () => import("refractor/lang/tsx").then((m) => m.default),
  },
  typescript: {
    lang: "typescript",
    label: "TypeScript",
    keywords: ["ts"],
    loader: () => import("refractor/lang/typescript").then((m) => m.default),
  },
  vb: {
    lang: "vbnet",
    label: "Visual Basic",
    keywords: ["vb", "vba"],
    loader: () => import("refractor/lang/vbnet").then((m) => m.default),
  },
  verilog: {
    lang: "verilog",
    label: "Verilog",
    loader: () => import("refractor/lang/verilog").then((m) => m.default),
  },
  vhdl: {
    lang: "vhdl",
    label: "VHDL",
    loader: () => import("refractor/lang/vhdl").then((m) => m.default),
  },
  yaml: {
    lang: "yaml",
    label: "YAML",
    keywords: ["yml"],
    loader: () => import("refractor/lang/yaml").then((m) => m.default),
  },
  xml: {
    lang: "markup",
    label: "XML",
    loader: () => import("refractor/lang/markup").then((m) => m.default),
  },
  zig: {
    lang: "zig",
    label: "Zig",
    loader: () => import("refractor/lang/zig").then((m) => m.default),
  },
};

/**
 * Searches supported languages by name and keyword, ordered by match quality.
 *
 * @param query the language name, extension, or keyword to search for.
 * @param frequent language identifiers in order of usage frequency.
 * @return matching languages, ordered by match tier and frequency.
 */
export const searchCodeLanguages = (
  query: string,
  frequent: string[] = getFrequentCodeLanguages()
): CodeLanguageMatch[] => {
  const normalizedQuery = deburr(query).trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const matches: {
    match: CodeLanguageMatch;
    tier: number;
    frequency: number;
  }[] = [];

  for (const [value, language] of Object.entries(codeLanguages)) {
    if (language.alias) {
      continue;
    }

    const label = deburr(language.label).trim().toLowerCase();
    let labelIndex = label.indexOf(normalizedQuery);
    let labelTier: number | undefined;
    if (label === normalizedQuery) {
      labelTier = 0;
    } else if (labelIndex === 0) {
      labelTier = 1;
    } else if (normalizedQuery.length > 1 && labelIndex !== -1) {
      let wordIndex = labelIndex;
      while (
        wordIndex !== -1 &&
        !/[ \-+#./]/.test(label.charAt(wordIndex - 1))
      ) {
        wordIndex = label.indexOf(normalizedQuery, wordIndex + 1);
      }
      labelTier = wordIndex === -1 ? 4 : 3;
      if (wordIndex !== -1) {
        labelIndex = wordIndex;
      }
    }

    let keyword: string | undefined;
    let keywordTier: number | undefined;
    for (const term of language.keywords ?? []) {
      const normalizedTerm = deburr(term).trim().toLowerCase();
      const tier =
        normalizedTerm === normalizedQuery
          ? 0
          : normalizedTerm.startsWith(normalizedQuery)
            ? 2
            : normalizedQuery.length > 1 &&
                normalizedTerm.includes(normalizedQuery)
              ? 5
              : undefined;
      if (
        tier !== undefined &&
        (keywordTier === undefined || tier < keywordTier)
      ) {
        keyword = term;
        keywordTier = tier;
      }
    }

    const useKeyword =
      keywordTier !== undefined &&
      (labelTier === undefined || keywordTier < labelTier);
    const tier = useKeyword ? keywordTier : labelTier;
    if (tier === undefined) {
      continue;
    }

    const match: CodeLanguageMatch = { value, label: language.label };
    if (useKeyword) {
      match.keyword = keyword;
    } else {
      match.labelMatch = [labelIndex, labelIndex + normalizedQuery.length];
    }
    const frequency = frequent.indexOf(value);
    matches.push({
      match,
      tier,
      frequency: frequency === -1 ? frequent.length : frequency,
    });
  }

  return matches
    .sort((a, b) => a.tier - b.tier || a.frequency - b.frequency)
    .map(({ match }) => match);
};

/**
 * Get the human-readable label for a given language.
 *
 * @param language The language identifier.
 * @returns The human-readable label for the language.
 */
export const getLabelForLanguage = (language: string) => {
  const lang =
    codeLanguages[language as keyof typeof codeLanguages] ?? codeLanguages.none;
  return lang.label;
};

/**
 * Get the Refractor language identifier for a given language.
 *
 * @param language The language identifier.
 * @returns The Refractor language identifier for the language.
 */
export const getRefractorLangForLanguage = (
  language: string
): string | undefined =>
  codeLanguages[language as keyof typeof codeLanguages]?.lang;

/**
 * Get the loader function for a given language.
 *
 * @param language The language identifier.
 * @returns The loader function for the language, or undefined if not available.
 */
export const getLoaderForLanguage = (language: string) =>
  codeLanguages[language as keyof typeof codeLanguages]?.loader;

// Mermaid diagrams have a separate insertion entry point, so they should never
// be remembered as a recently or frequently used code language.
const nonPersistableLanguages = ["mermaid", "mermaidjs"];

const isPersistableCodeLanguage = (language: string) =>
  !nonPersistableLanguages.includes(language);

const codeLanguageFrequency = new FrequencyTracker<keyof typeof codeLanguages>({
  key: "frequent-code-languages",
  recentKey: "rme-code-language",
  track: 10,
  get: 5,
  filter: isPersistableCodeLanguage,
});

/**
 * Set the most recent code language used.
 *
 * @param language The language identifier.
 */
export const setRecentlyUsedCodeLanguage = (language: string) =>
  codeLanguageFrequency.track(language as keyof typeof codeLanguages);

/**
 * Get the most recent code language used.
 *
 * @returns The most recent code language used, or undefined if none is set.
 */
export const getRecentlyUsedCodeLanguage = () => codeLanguageFrequency.recent;

/**
 * Get the most frequent code languages used.
 *
 * @returns An array of the most frequent code languages used.
 */
export const getFrequentCodeLanguages = () => codeLanguageFrequency.frequent;

export const languagesWithFourSpaceIndent = [
  "python",
  "java",
  "cpp",
  "csharp",
  "rust",
];
