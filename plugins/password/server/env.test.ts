describe("password plugin environment", () => {
  const originalPasswordAuthEnabled = process.env.PASSWORD_AUTH_ENABLED;

  afterEach(() => {
    vi.resetModules();

    if (originalPasswordAuthEnabled === undefined) {
      delete process.env.PASSWORD_AUTH_ENABLED;
      return;
    }

    process.env.PASSWORD_AUTH_ENABLED = originalPasswordAuthEnabled;
  });

  it("defaults password auth to enabled", async () => {
    delete process.env.PASSWORD_AUTH_ENABLED;

    const env = (await import("./env")).default;

    expect(env.PASSWORD_AUTH_ENABLED).toBe(true);
  });

  it("allows explicitly disabling password auth", async () => {
    process.env.PASSWORD_AUTH_ENABLED = "false";

    const env = (await import("./env")).default;

    expect(env.PASSWORD_AUTH_ENABLED).toBe(false);
  });
});
