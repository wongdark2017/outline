import fs from "node:fs";
import path from "node:path";
import dotenv from "@dotenvx/dotenvx";

let environment: Record<string, string> = {};
const explicitEnvironmentKeys = new Set(Object.keys(process.env));
const explicitMarkerKeys: Record<string, string> = {
  FILE_STORAGE: "OUTLINE_EXPLICIT_FILE_STORAGE",
  FORCE_HTTPS: "OUTLINE_EXPLICIT_FORCE_HTTPS",
};

const envPath = path.resolve(process.cwd(), `.env`);
const envDefault = fs.existsSync(envPath)
  ? dotenv.parse(fs.readFileSync(envPath, "utf8"))
  : {};

for (const key of Object.keys(envDefault)) {
  explicitEnvironmentKeys.add(key);
}

// Load environment specific variables, in reverse order of precedence
const environments = ["production", "development", "local", "test"];

for (const env of environments) {
  const isEnv = process.env.NODE_ENV === env || envDefault.NODE_ENV === env;
  const isLocalDevelopment =
    env === "local" &&
    (process.env.NODE_ENV === "development" ||
      envDefault.NODE_ENV === "development");

  if (isEnv || isLocalDevelopment) {
    const resolvedPath = path.resolve(process.cwd(), `.env.${env}`);
    if (fs.existsSync(resolvedPath)) {
      const parsed = dotenv.parse(fs.readFileSync(resolvedPath, "utf8"));
      for (const key of Object.keys(parsed)) {
        explicitEnvironmentKeys.add(key);
      }

      environment = {
        ...environment,
        ...parsed,
      };
    }
  }
}

process.env = {
  ...envDefault,
  ...environment,
  ...process.env,
};

environment = process.env as Record<string, string>;

/**
 * Returns the mutable environment snapshot used to construct the typed
 * Environment instance.
 *
 * @returns the current environment snapshot.
 */
export function getEnvironment() {
  return environment;
}

/**
 * Sets an environment value in both the snapshot and process.env.
 *
 * @param key the environment key to set.
 * @param value the value to set.
 */
export function setEnvironmentValue(key: string, value: string): void {
  environment[key] = value;
  process.env[key] = value;
}

/**
 * Returns whether a value was explicitly provided by the operator.
 *
 * @param key the environment key to inspect.
 * @returns true if the key has an explicit environment value.
 */
export function hasExplicitEnvironmentValue(key: string) {
  if (explicitEnvironmentKeys.has(key)) {
    return true;
  }

  const markerKey = explicitMarkerKeys[key];
  if (!markerKey) {
    return false;
  }

  return process.env[markerKey] === "true";
}

/**
 * Process environment variables with _FILE suffix by reading the referenced
 * file and setting the base variable. If the base variable is already set, the
 * file is not read. File contents are trimmed of leading/trailing whitespace.
 *
 * @param env - the environment record to process.
 */
export function resolveFileSecrets(
  env: Record<string, string | undefined>
): void {
  for (const key of Object.keys(env)) {
    if (key.endsWith("_FILE")) {
      const baseKey = key.slice(0, -5);
      if (!baseKey.length) {
        continue;
      }

      const filePath = env[key];

      if (!filePath) {
        continue;
      }

      if (env[baseKey] !== undefined) {
        continue;
      }

      try {
        env[baseKey] = fs.readFileSync(filePath, "utf8").trim();
      } catch (err) {
        // oxlint-disable-next-line no-console
        console.error(
          `Failed to read file for ${key} (${filePath}): ${(err as Error).message}`
        );
      }
    }
  }
}

resolveFileSecrets(process.env);

export default environment;
