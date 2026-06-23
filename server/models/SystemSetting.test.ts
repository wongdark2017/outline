import SystemSetting from "./SystemSetting";

beforeEach(async () => {
  await SystemSetting.destroy({ where: {}, force: true });
});

describe("#SystemSetting", () => {
  describe("bulkSet", () => {
    it("should create setting rows", async () => {
      await SystemSetting.bulkSet([
        { key: "URL", value: "https://docs.example.com" },
        { key: "FILE_STORAGE", value: "local" },
      ]);

      const settings = await SystemSetting.getAll();

      expect(settings).toEqual({
        URL: "https://docs.example.com",
        FILE_STORAGE: "local",
      });
    });

    it("should update existing setting rows", async () => {
      await SystemSetting.bulkSet([{ key: "FILE_STORAGE", value: "local" }]);
      await SystemSetting.bulkSet([{ key: "FILE_STORAGE", value: "s3" }]);

      const settings = await SystemSetting.findAll({
        where: {
          key: "FILE_STORAGE",
        },
      });

      expect(settings).toHaveLength(1);
      expect(settings[0].value).toBe("s3");
    });
  });

  describe("getAll", () => {
    it("should return a key/value record", async () => {
      await SystemSetting.bulkSet([
        { key: "DEFAULT_LANGUAGE", value: "en_US" },
        { key: "FORCE_HTTPS", value: "true" },
      ]);

      await expect(SystemSetting.getAll()).resolves.toEqual({
        DEFAULT_LANGUAGE: "en_US",
        FORCE_HTTPS: "true",
      });
    });
  });

  describe("get", () => {
    it("should return a single setting value", async () => {
      await SystemSetting.bulkSet([{ key: "AWS_REGION", value: "us-east-1" }]);

      await expect(SystemSetting.get("AWS_REGION")).resolves.toBe("us-east-1");
    });

    it("should return undefined for a missing setting", async () => {
      await expect(SystemSetting.get("MISSING_SETTING")).resolves.toBe(
        undefined
      );
    });
  });
});
