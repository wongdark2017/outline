import env, { reloadEnvironment } from "@server/env";
import { getEnvironment, setEnvironmentValue } from "./utils/environment";

describe("reloadEnvironment", () => {
  const originalEnvironment = { ...getEnvironment() };
  const originalProcessEnv = { ...process.env };
  const originalDefaultLanguage = env.DEFAULT_LANGUAGE;

  afterEach(() => {
    for (const key of Object.keys(getEnvironment())) {
      delete getEnvironment()[key];
    }

    Object.assign(getEnvironment(), originalEnvironment);
    process.env = { ...originalProcessEnv };
    reloadEnvironment();
  });

  it("should refresh values on the default environment export", () => {
    setEnvironmentValue("DEFAULT_LANGUAGE", "fr_FR");

    const reloaded = reloadEnvironment();

    expect(reloaded).toBe(env);
    expect(env.DEFAULT_LANGUAGE).toBe("fr_FR");
    expect(env.DEFAULT_LANGUAGE).not.toBe(originalDefaultLanguage);
  });

  it("should refresh public environment values", () => {
    setEnvironmentValue("DEFAULT_LANGUAGE", "fr_FR");

    reloadEnvironment();

    expect(env.public.DEFAULT_LANGUAGE).toBe("fr_FR");
  });
});
