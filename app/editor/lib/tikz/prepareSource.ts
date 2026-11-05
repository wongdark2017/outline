/** Information recognized in the user's original source. */
export interface SourceInfo {
  isDocument: boolean;
  documentClass?: string;
  border?: string;
  libraries: string[];
  packages: string[];
  skippedPackages: string[];
  hasWideChars: boolean;
}

/** Compilation input and status, without changing the original source. */
export interface PreparedSource {
  tex: string;
  info: SourceInfo;
}

/** Relevant TeX diagnostics and a location in the original source. */
export interface TexProblem {
  detail: string;
  missingPackage?: string;
  line?: number;
}

/**
 * Adapts a TikZ snippet or document to the engine's preloaded standalone format.
 * The caller must store the original source rather than this compilation input.
 *
 * @param source the unmodified source entered by the user.
 * @returns compilation input and recognized source information.
 */
export function prepareSource(source: string): PreparedSource {
  const commands = readCommands(maskSource(source));
  const info: SourceInfo = {
    isDocument: commands.some(
      (command) => command.name === "begin" && command.argument === "document"
    ),
    libraries: [],
    packages: [],
    skippedPackages: [],
    hasWideChars: Array.from(source).some(
      (character) => (character.codePointAt(0) ?? 0) > 0xff
    ),
  };
  const replacements: SourceReplacement[] = [];
  const preamble: string[] = [];

  for (const command of commands) {
    const removed = preserveNewlines(source.slice(command.from, command.to));

    if (command.name === "documentclass") {
      info.documentClass = command.argument.trim();
      if (info.documentClass === "standalone") {
        info.border = readBorder(command.options ?? "");
      }

      // The worker removes an entire line containing documentclass. Remove
      // only the declaration here so adjacent user code survives that behavior.
      replacements.push({ ...command, text: removed });
      continue;
    }

    if (
      isFontSetup(command.name) ||
      ((command.name === "begin" || command.name === "end") &&
        /^CJK\*?$/.test(command.argument))
    ) {
      replacements.push({ ...command, text: removed });
      continue;
    }

    if (command.name === "usepackage") {
      const names = splitNames(command.argument);
      appendUnique(
        info.packages,
        names.filter((name) => !CJK_PACKAGES.has(name))
      );
      appendUnique(
        info.skippedPackages,
        names.filter((name) => CJK_PACKAGES.has(name))
      );
      const remaining = names.filter(
        (name) => !CJK_PACKAGES.has(name) && !PRELOADED_PACKAGES.has(name)
      );
      const options = command.options ? `[${command.options.trim()}]` : "";
      const declaration = remaining.length
        ? `\\usepackage${options}{${remaining.join(",")}}`
        : "";

      if (info.isDocument) {
        replacements.push({ ...command, text: declaration + removed });
      } else {
        if (declaration) {
          preamble.push(declaration);
        }
        replacements.push({ ...command, text: removed });
      }
      continue;
    }

    if (command.name === "usetikzlibrary") {
      const names = splitNames(command.argument);
      appendUnique(info.libraries, names);
      if (!info.isDocument) {
        preamble.push(`\\usetikzlibrary{${names.join(",")}}`);
        replacements.push({ ...command, text: removed });
      }
    }
  }

  const body = stripCommentContent(
    applyReplacements(source, replacements)
  ).trim();
  const tex = info.isDocument
    ? body
    : [...preamble, "\\begin{document}", body, "\\end{document}"].join("\n");

  return {
    tex: info.border
      ? `\\standaloneconfig{border=${info.border}}\n${tex}`
      : tex,
    info,
  };
}

/**
 * Extracts a readable TeX diagnostic and locates a missing package declaration.
 * Log line numbers refer to rewritten input and are deliberately not reused.
 *
 * @param error the diagnostic returned by the worker.
 * @param source the user's original source.
 * @returns relevant log text and the original package declaration location.
 */
export function describeTexError(error: string, source: string): TexProblem {
  const lines = error.split(/\r?\n/);
  const first = lines.findIndex((line) => /^\s*!/.test(line));
  const last = lines.findIndex(
    (line, index) => index > first && /^\s*l\.\d+/.test(line)
  );
  const detail =
    first >= 0
      ? lines
          .slice(first, last >= 0 ? last + 1 : first + 12)
          .join("\n")
          .trim()
      : error;
  const missing = error.match(/File\s+[`'"]([^`'"]+)\.sty['"`]\s+not found/i);
  const name = missing?.[1];
  if (!name) {
    return { detail };
  }

  const declaration = readCommands(maskSource(source)).find(
    (command) =>
      command.name === "usepackage" &&
      splitNames(command.argument).includes(name)
  );
  return {
    detail,
    missingPackage: name,
    line: declaration
      ? source.slice(0, declaration.from).split(/\r?\n/).length
      : undefined,
  };
}

interface SourceReplacement {
  from: number;
  to: number;
  text: string;
}

interface SourceGroup {
  value: string;
  to: number;
}

interface SourceCommand {
  name: string;
  from: number;
  to: number;
  argument: string;
  options?: string;
}

const CJK_PACKAGES = new Set([
  "ctex",
  "xeCJK",
  "CJKutf8",
  "CJK",
  "fontspec",
  "xunicode",
  "xltxtra",
]);
const PRELOADED_PACKAGES = new Set(["tikz", "pgf", "xcolor"]);
const DECLARATIONS = new Set([
  "documentclass",
  "usepackage",
  "usetikzlibrary",
  "begin",
  "end",
]);

function isFontSetup(name: string): boolean {
  return /^(?:setCJK\w*font|set(?:main|sans|mono)font|ctexset|xeCJKsetup)$/.test(
    name
  );
}

function isEscaped(source: string, index: number): boolean {
  let preceding = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === "\\";
    cursor--
  ) {
    preceding++;
  }
  return preceding % 2 === 1;
}

function maskSource(
  source: string,
  onComment?: (from: number, to: number) => void
): string {
  const characters = source.split("");
  const mask = (from: number, to: number) => {
    for (let index = from; index < to; index++) {
      if (characters[index] !== "\n" && characters[index] !== "\r") {
        characters[index] = " ";
      }
    }
  };
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "%" && !isEscaped(source, index)) {
      const newline = source.indexOf("\n", index);
      const end = newline < 0 ? source.length : newline;
      onComment?.(index, end);
      mask(index, end);
      index = end - 1;
      continue;
    }
    if (source[index] !== "\\" || isEscaped(source, index)) {
      continue;
    }
    const verbatim = source
      .slice(index)
      .match(/^\\begin\s*\{(verbatim\*?|Verbatim)\}/);
    if (verbatim) {
      const ending = `\\end{${verbatim[1]}}`;
      const found = source.indexOf(ending, index + verbatim[0].length);
      const end = found < 0 ? source.length : found + ending.length;
      mask(index, end);
      index = end - 1;
      continue;
    }
    const verb = source.slice(index).match(/^\\verb\*?([^a-zA-Z\s])/);
    if (verb) {
      const delimiter = verb[1];
      const found = source.indexOf(delimiter, index + verb[0].length);
      const newline = source.indexOf("\n", index);
      const end =
        found >= 0 && (newline < 0 || found < newline)
          ? found + 1
          : index + verb[0].length;
      mask(index, end);
      index = end - 1;
    }
  }
  return characters.join("");
}

function stripCommentContent(source: string): string {
  const replacements: SourceReplacement[] = [];
  maskSource(source, (from, to) => {
    replacements.push({ from: from + 1, to, text: "" });
  });

  // Keep the percent marker so TeX still consumes the following newline.
  // The worker inspects raw lines before TeX and must not see comment commands.
  return applyReplacements(source, replacements);
}

function skipWhitespace(source: string, from: number): number {
  let index = from;
  while (index < source.length && /\s/.test(source[index])) {
    index++;
  }
  return index;
}

function readGroup(
  source: string,
  from: number,
  open = "{",
  close = "}"
): SourceGroup | undefined {
  const start = skipWhitespace(source, from);
  if (source[start] !== open) {
    return;
  }
  let depth = 1;
  for (let index = start + 1; index < source.length; index++) {
    if (isEscaped(source, index)) {
      continue;
    }
    if (source[index] === open) {
      depth++;
    } else if (source[index] === close) {
      depth--;
      if (!depth) {
        return { value: source.slice(start + 1, index), to: index + 1 };
      }
    }
  }
  return;
}

function readCommands(source: string): SourceCommand[] {
  const commands: SourceCommand[] = [];
  const pattern = /\\([a-zA-Z]+)\b/g;
  let coveredUntil = 0;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    if (
      match.index < coveredUntil ||
      isEscaped(source, match.index) ||
      (!DECLARATIONS.has(name) && !isFontSetup(name))
    ) {
      continue;
    }
    const options = readGroup(source, match.index + match[0].length, "[", "]");
    const argument = readGroup(
      source,
      options?.to ?? match.index + match[0].length
    );
    if (!argument) {
      continue;
    }
    let to = argument.to;
    const count =
      name === "begin" && /^CJK\*?$/.test(argument.value.trim())
        ? 2
        : name === "setCJKfamilyfont"
          ? 1
          : 0;
    for (let index = 0; index < count; index++) {
      const option = readGroup(source, to, "[", "]");
      const next = readGroup(source, option?.to ?? to);
      if (next) {
        to = next.to;
      }
    }
    if (isFontSetup(name)) {
      to = readGroup(source, to, "[", "]")?.to ?? to;
    }
    commands.push({
      name,
      from: match.index,
      to,
      argument: argument.value.trim(),
      options: options?.value,
    });
    coveredUntil = to;
  }
  return commands;
}

function splitNames(value: string): string[] {
  return value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function appendUnique(target: string[], names: string[]): void {
  for (const name of names) {
    if (!target.includes(name)) {
      target.push(name);
    }
  }
}

function readBorder(options: string): string | undefined {
  const match = options.match(
    /(?:^|,)\s*(?:border|margin)\s*=\s*(\{[^}]*\}|[^,]+)/
  );
  return match?.[1].trim();
}

function preserveNewlines(source: string): string {
  return source.replace(/[^\r\n]/g, " ");
}

function applyReplacements(
  source: string,
  replacements: SourceReplacement[]
): string {
  return replacements
    .sort((left, right) => right.from - left.from)
    .reduce(
      (value, replacement) =>
        value.slice(0, replacement.from) +
        replacement.text +
        value.slice(replacement.to),
      source
    );
}
