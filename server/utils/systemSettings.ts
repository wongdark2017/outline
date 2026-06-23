import { hasExplicitEnvironmentValue, setEnvironmentValue } from "./environment";

export const supportedSystemSettingKeys = [
  "URL",
  "DEFAULT_LANGUAGE",
  "FORCE_HTTPS",
  "FILE_STORAGE",
  "AWS_S3_UPLOAD_BUCKET_NAME",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_S3_UPLOAD_BUCKET_URL",
  "AWS_S3_FORCE_PATH_STYLE",
  "AWS_S3_ACL",
] as const;

export type SupportedSystemSettingKey =
  (typeof supportedSystemSettingKeys)[number];

export interface SystemSettingEntry {
  key: SupportedSystemSettingKey;
  value: string;
}

export type SystemSettingSource = "env" | "database" | "default";

export interface EffectiveSystemSetting {
  key: SupportedSystemSettingKey;
  value: string;
  source: SystemSettingSource;
  isSensitive: boolean;
}

export interface InstallationSetupSettingsInput {
  url: string;
  defaultLanguage: string;
  forceHttps: boolean;
  fileStorage: "local" | "s3";
  s3BucketName?: string;
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3Endpoint?: string;
  s3ForcePathStyle?: boolean;
  s3Acl?: string;
}

const sensitiveSystemSettingKeys = new Set<SupportedSystemSettingKey>([
  "AWS_SECRET_ACCESS_KEY",
]);

const maskedValue = "********";

/**
 * Builds system setting rows from setup wizard input.
 *
 * @param input the validated setup wizard settings payload.
 * @returns setting rows using environment variable keys.
 */
export function buildSystemSettingEntriesFromSetupInput(
  input: InstallationSetupSettingsInput
): SystemSettingEntry[] {
  const entries: Array<SystemSettingEntry | undefined> = [
    { key: "URL", value: input.url },
    { key: "DEFAULT_LANGUAGE", value: input.defaultLanguage },
    { key: "FORCE_HTTPS", value: String(input.forceHttps) },
    { key: "FILE_STORAGE", value: input.fileStorage },
    optionalEntry("AWS_S3_UPLOAD_BUCKET_NAME", input.s3BucketName),
    optionalEntry("AWS_REGION", input.s3Region),
    optionalEntry("AWS_ACCESS_KEY_ID", input.s3AccessKeyId),
    optionalEntry("AWS_SECRET_ACCESS_KEY", input.s3SecretAccessKey),
    optionalEntry("AWS_S3_UPLOAD_BUCKET_URL", input.s3Endpoint),
    optionalEntry(
      "AWS_S3_FORCE_PATH_STYLE",
      input.s3ForcePathStyle === undefined
        ? undefined
        : String(input.s3ForcePathStyle)
    ),
    optionalEntry("AWS_S3_ACL", input.s3Acl),
  ];

  return entries.filter((entry): entry is SystemSettingEntry => !!entry);
}

/**
 * Applies system setting rows to the runtime environment when no explicit
 * operator-provided environment value exists.
 *
 * @param entries the system setting rows to apply.
 */
export function applySystemSettingsToEnvironment(
  entries: SystemSettingEntry[]
): void {
  for (const entry of entries) {
    if (hasExplicitEnvironmentValue(entry.key)) {
      continue;
    }

    setEnvironmentValue(entry.key, entry.value);
  }
}

/**
 * Builds the read-only system settings presentation from persisted settings
 * and currently effective environment values.
 *
 * @param persistedSettings database-backed settings keyed by env name.
 * @param effectiveValues current effective values keyed by env name.
 * @returns presentation-safe system settings with source labels.
 */
export function getEffectiveSystemSettings(
  persistedSettings: Partial<Record<SupportedSystemSettingKey, string>>,
  effectiveValues: Partial<Record<SupportedSystemSettingKey, string>>
): EffectiveSystemSetting[] {
  return supportedSystemSettingKeys.map((key) => {
    const source = getSystemSettingSource(key, persistedSettings);
    const rawValue =
      effectiveValues[key] ??
      (source === "database" ? persistedSettings[key] : undefined) ??
      "";

    return {
      key,
      value: maskSystemSettingValue(key, rawValue),
      source,
      isSensitive: isSensitiveSystemSettingKey(key),
    };
  });
}

/**
 * Returns whether a string is a supported system setting key.
 *
 * @param key the key to inspect.
 * @returns true when the key is supported by setup settings.
 */
export function isSupportedSystemSettingKey(
  key: string
): key is SupportedSystemSettingKey {
  return supportedSystemSettingKeys.includes(
    key as SupportedSystemSettingKey
  );
}

/**
 * Returns whether a system setting key contains sensitive data.
 *
 * @param key the system setting key.
 * @returns true when values for this key must not be exposed.
 */
export function isSensitiveSystemSettingKey(
  key: SupportedSystemSettingKey
): boolean {
  return sensitiveSystemSettingKeys.has(key);
}

/**
 * Masks sensitive system setting values for presentation.
 *
 * @param key the system setting key.
 * @param value the raw setting value.
 * @returns a masked or raw display value.
 */
export function maskSystemSettingValue(
  key: SupportedSystemSettingKey,
  value: string
): string {
  if (isSensitiveSystemSettingKey(key)) {
    return maskedValue;
  }

  return value;
}

function getSystemSettingSource(
  key: SupportedSystemSettingKey,
  persistedSettings: Partial<Record<SupportedSystemSettingKey, string>>
): SystemSettingSource {
  if (hasExplicitEnvironmentValue(key)) {
    return "env";
  }

  if (persistedSettings[key] !== undefined) {
    return "database";
  }

  return "default";
}

function optionalEntry(
  key: SupportedSystemSettingKey,
  value: string | undefined
): SystemSettingEntry | undefined {
  if (value === undefined) {
    return undefined;
  }

  return {
    key,
    value,
  };
}
