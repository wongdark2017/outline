import { createHash } from "node:crypto";
import path from "node:path";
import { parse } from "acorn";
import postcss from "postcss";
import { CustomizationValidation } from "@shared/types";
import { ValidationError } from "@server/errors";

/**
 * Checks whether a managed module path is a normalized JavaScript filename.
 *
 * @param value the untrusted manifest path.
 * @returns whether the path is a safe relative module filename.
 */
export function isCustomizationModulePath(value: string): boolean {
  return (
    value.length <= CustomizationValidation.maxModulePathLength &&
    /^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.m?js$/.test(value) &&
    !value
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..") &&
    path.posix.normalize(value) === value
  );
}

/**
 * Validates CSS syntax without executing or changing the source.
 *
 * @param source the CSS source.
 * @throws {ValidationError} if the source cannot be parsed.
 */
export function validateCustomizationCss(source: string): void {
  try {
    postcss.parse(source);
  } catch {
    throw ValidationError("The CSS contains a syntax error");
  }
}

/**
 * Validates and fingerprints all source bytes in an immutable publication.
 *
 * @param source the entry module source.
 * @param modules the managed dependency sources.
 * @returns a digest of the canonical source manifest.
 * @throws {ValidationError} if a path, size, or JavaScript source is invalid.
 */
export function customizationScriptDigest(
  source: string,
  modules: Record<string, string>
): string {
  if (Object.hasOwn(modules, "entry.js")) {
    throw ValidationError("The entry.js module name is reserved");
  }
  const entries = Object.entries(modules).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  const total =
    source.length + entries.reduce((sum, [, value]) => sum + value.length, 0);
  if (total > CustomizationValidation.maxScriptTotalLength) {
    throw ValidationError("The script and its dependencies are too large");
  }
  for (const [name, code] of [["entry.js", source], ...entries]) {
    if (!isCustomizationModulePath(name)) {
      throw ValidationError("Invalid managed JavaScript module path");
    }
    try {
      parse(code, { ecmaVersion: "latest", sourceType: "module" });
    } catch {
      throw ValidationError(`The ${name} module contains invalid JavaScript`);
    }
  }
  return createHash("sha256")
    .update(JSON.stringify({ source, modules: entries }))
    .digest("hex");
}
