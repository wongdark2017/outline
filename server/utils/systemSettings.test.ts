import {
  buildSystemSettingEntriesFromSetupInput,
  getEffectiveSystemSettings,
  isSensitiveSystemSettingKey,
  maskSystemSettingValue,
} from "./systemSettings";
import { getEnvironment, setEnvironmentValue } from "./environment";

describe("systemSettings", () => {
  const originalEnvironment = { ...getEnvironment() };
  const originalProcessEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(getEnvironment())) {
      delete getEnvironment()[key];
    }

    Object.assign(getEnvironment(), originalEnvironment);
    process.env = { ...originalProcessEnv };
  });

  describe("buildSystemSettingEntriesFromSetupInput", () => {
    it("should map setup input fields to environment setting rows", () => {
      const entries = buildSystemSettingEntriesFromSetupInput({
        url: "https://docs.example.com",
        defaultLanguage: "en_US",
        forceHttps: true,
        fileStorage: "s3",
        s3BucketName: "outline-files",
        s3Region: "us-east-1",
        s3AccessKeyId: "access-key",
        s3SecretAccessKey: "secret-key",
        s3Endpoint: "https://s3.example.com",
        s3ForcePathStyle: false,
        s3Acl: "private",
      });

      expect(entries).toEqual([
        { key: "URL", value: "https://docs.example.com" },
        { key: "DEFAULT_LANGUAGE", value: "en_US" },
        { key: "FORCE_HTTPS", value: "true" },
        { key: "FILE_STORAGE", value: "s3" },
        { key: "AWS_S3_UPLOAD_BUCKET_NAME", value: "outline-files" },
        { key: "AWS_REGION", value: "us-east-1" },
        { key: "AWS_ACCESS_KEY_ID", value: "access-key" },
        { key: "AWS_SECRET_ACCESS_KEY", value: "secret-key" },
        { key: "AWS_S3_UPLOAD_BUCKET_URL", value: "https://s3.example.com" },
        { key: "AWS_S3_FORCE_PATH_STYLE", value: "false" },
        { key: "AWS_S3_ACL", value: "private" },
      ]);
    });

    it("should omit undefined optional S3 fields", () => {
      const entries = buildSystemSettingEntriesFromSetupInput({
        url: "https://docs.example.com",
        defaultLanguage: "en_US",
        forceHttps: false,
        fileStorage: "local",
      });

      expect(entries).toEqual([
        { key: "URL", value: "https://docs.example.com" },
        { key: "DEFAULT_LANGUAGE", value: "en_US" },
        { key: "FORCE_HTTPS", value: "false" },
        { key: "FILE_STORAGE", value: "local" },
      ]);
    });
  });

  describe("maskSystemSettingValue", () => {
    it("should mask sensitive values", () => {
      expect(maskSystemSettingValue("AWS_SECRET_ACCESS_KEY", "secret")).toBe(
        "********"
      );
    });

    it("should not mask non-sensitive values", () => {
      expect(maskSystemSettingValue("FILE_STORAGE", "s3")).toBe("s3");
    });
  });

  describe("isSensitiveSystemSettingKey", () => {
    it("should identify sensitive keys", () => {
      expect(isSensitiveSystemSettingKey("AWS_SECRET_ACCESS_KEY")).toBe(true);
      expect(isSensitiveSystemSettingKey("AWS_ACCESS_KEY_ID")).toBe(false);
    });
  });

  describe("getEffectiveSystemSettings", () => {
    it("should label explicit environment values", () => {
      setEnvironmentValue("OUTLINE_EXPLICIT_FILE_STORAGE", "true");

      const settings = getEffectiveSystemSettings(
        {
          FILE_STORAGE: "s3",
        },
        {
          FILE_STORAGE: "local",
        }
      );

      expect(settings.find((setting) => setting.key === "FILE_STORAGE")).toEqual(
        {
          key: "FILE_STORAGE",
          value: "local",
          source: "env",
          isSensitive: false,
        }
      );
    });

    it("should label database and default values", () => {
      const settings = getEffectiveSystemSettings(
        {
          DEFAULT_LANGUAGE: "fr_FR",
        },
        {
          DEFAULT_LANGUAGE: "fr_FR",
        }
      );

      expect(
        settings.find((setting) => setting.key === "DEFAULT_LANGUAGE")?.source
      ).toBe("database");
      expect(
        settings.find((setting) => setting.key === "AWS_REGION")?.source
      ).toBe("default");
    });

    it("should mask sensitive values", () => {
      const settings = getEffectiveSystemSettings(
        {
          AWS_SECRET_ACCESS_KEY: "secret",
        },
        {
          AWS_SECRET_ACCESS_KEY: "secret",
        }
      );

      expect(
        settings.find((setting) => setting.key === "AWS_SECRET_ACCESS_KEY")
      ).toMatchObject({
        value: "********",
        isSensitive: true,
      });
    });
  });
});
