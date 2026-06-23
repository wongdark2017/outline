import {
  getEnvironment,
  setEnvironmentValue,
} from "./environment";
import {
  bootstrapSystemSettings,
  type SystemSettingsBootstrapDatabase,
} from "./systemSettingsBootstrap";
import { supportedSystemSettingKeys } from "./systemSettings";

describe("bootstrapSystemSettings", () => {
  const originalEnvironment = { ...getEnvironment() };
  const originalProcessEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(getEnvironment())) {
      delete getEnvironment()[key];
    }

    Object.assign(getEnvironment(), originalEnvironment);
    process.env = { ...originalProcessEnv };
  });

  it("should return without changes when database config is missing", async () => {
    const originalSystemSettingValues = getSystemSettingEnvironmentValues();

    await bootstrapSystemSettings(() => undefined);

    expect(getSystemSettingEnvironmentValues()).toEqual(
      originalSystemSettingValues
    );
  });

  it("should return without changes when system settings table is missing", async () => {
    const originalSystemSettingValues = getSystemSettingEnvironmentValues();
    const { close, database, query } = createDatabase([
      [{ exists: false }],
    ]);

    await bootstrapSystemSettings(() => database);

    expect(query).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(getSystemSettingEnvironmentValues()).toEqual(
      originalSystemSettingValues
    );
  });

  it("should apply database rows when environment value is not explicit", async () => {
    delete getEnvironment().AWS_S3_ACL;
    delete process.env.AWS_S3_ACL;

    const { close, database } = createDatabase([
      [{ exists: true }],
      [{ key: "AWS_S3_ACL", value: "public-read" }],
    ]);

    await bootstrapSystemSettings(() => database);

    expect(getEnvironment().AWS_S3_ACL).toBe("public-read");
    expect(process.env.AWS_S3_ACL).toBe("public-read");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("should not override explicit environment values", async () => {
    setEnvironmentValue("FORCE_HTTPS", "false");
    setEnvironmentValue("OUTLINE_EXPLICIT_FORCE_HTTPS", "true");

    const { database } = createDatabase([
      [{ exists: true }],
      [{ key: "FORCE_HTTPS", value: "true" }],
    ]);

    await bootstrapSystemSettings(() => database);

    expect(getEnvironment().FORCE_HTTPS).toBe("false");
    expect(process.env.FORCE_HTTPS).toBe("false");
  });
});

function createDatabase(results: unknown[][]) {
  const query = vi.fn();
  const close = vi
    .fn<SystemSettingsBootstrapDatabase["close"]>()
    .mockResolvedValue(undefined);
  const database: SystemSettingsBootstrapDatabase = {
    query: async <T extends object>() => {
      query();
      return (results.shift() ?? []) as T[];
    },
    close,
  };

  return {
    close,
    database,
    query,
  };
}

function getSystemSettingEnvironmentValues() {
  return Object.fromEntries(
    supportedSystemSettingKeys.map((key) => [key, getEnvironment()[key]])
  );
}
