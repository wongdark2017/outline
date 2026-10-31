// @vitest-isolate true
import env from "@server/env";
import { createEmailSigninError } from "@server/utils/emailSigninRedaction";
import Logger from "./Logger";

describe("sign-in production error diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { code: "EAUTH", responseCode: 535, command: "AUTH LOGIN" },
    { code: "ETIMEDOUT", command: "CONN" },
  ])("emits safe transport details in the production output: %j", (details) => {
    vi.spyOn(env, "isProduction", "get").mockReturnValue(true);
    const output = vi
      .spyOn(Logger.output, "error")
      .mockReturnValue(Logger.output);
    const original = Object.assign(new Error("123456 private-token"), {
      ...details,
      response: "123456 private-token",
      cause: new Error("123456 private-token"),
    });
    const safe = createEmailSigninError(
      "task",
      createEmailSigninError("transport", original)
    );

    Logger.error("Sign-in email job failed", safe, {
      templateName: "SigninEmail",
    });

    expect(output).toHaveBeenCalledWith(
      "Sign-in email job failed",
      expect.objectContaining({
        error: "Sign-in email task failed",
        name: "Error",
        ...details,
      })
    );
    expect(JSON.stringify(output.mock.calls)).not.toMatch(
      /123456|private-token|response"|cause/
    );
  });

  it("keeps unrelated errors on the existing production output path", () => {
    vi.spyOn(env, "isProduction", "get").mockReturnValue(true);
    const output = vi
      .spyOn(Logger.output, "error")
      .mockReturnValue(Logger.output);
    const error = Object.assign(new Error("ordinary failure"), {
      code: "EAUTH",
    });

    Logger.error("Ordinary task failed", error);

    expect(output).toHaveBeenCalledWith("Ordinary task failed", {
      error: error.message,
      stack: error.stack,
    });
  });
});
