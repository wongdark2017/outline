// @vitest-isolate true
import Koa from "koa";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import logger from "koa-logger";
import {
  createEmailSigninError,
  isSigninEmailTask,
  redactEmailSigninUrl,
} from "./emailSigninRedaction";

describe("email sign-in confidentiality", () => {
  const reasons: Parameters<typeof createEmailSigninError>[0][] = [
    "transport",
    "render",
    "task",
    "callback",
    "queue",
  ];

  it.each(reasons)("creates a fresh safe %s error", (reason) => {
    const error = createEmailSigninError(reason);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBe(createEmailSigninError(reason));
    expect(Object.keys(error)).toEqual([]);
    expect(error).not.toHaveProperty("cause");
    expect(error.message).toMatch(/failed$/);
  });

  it.each([
    { name: "Error", code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" },
    { name: "TimeoutError", code: "ETIMEDOUT", command: "CONN" },
  ])(
    "preserves only safe diagnostics through repeated wrappers: %j",
    (details) => {
      const original = Object.assign(new Error("123456 private-token"), {
        ...details,
        response: "123456 private-token",
        cause: new Error("123456 private-token"),
        privateMetadata: "123456 private-token",
      });
      let safe = createEmailSigninError("transport", original);

      for (const reason of reasons) {
        safe = createEmailSigninError(reason, safe);
        expect(safe).toMatchObject(details);
        expect(safe).not.toBe(original);
        expect(safe).not.toHaveProperty("cause");
        expect(safe).not.toHaveProperty("response");
        expect(safe).not.toHaveProperty("privateMetadata");
        expect(
          `${JSON.stringify(safe)} ${safe.message} ${safe.stack}`
        ).not.toMatch(/123456|private-token/);
      }
    }
  );

  it.each([
    ["AUTH PLAIN 123456 private-token", "AUTH PLAIN"],
    ["AUTH LOGIN", "AUTH LOGIN"],
    ["STARTTLS", "STARTTLS"],
    ["MAIL FROM:<private@example.com>", "MAIL FROM"],
    ["RCPT TO:<private@example.com>", "RCPT TO"],
    ["AUTH private-token", "AUTH"],
    ["123456 private-token", undefined],
    ["CONN-private-token", undefined],
  ])(
    "normalizes SMTP command %s without retaining arguments",
    (command, expected) => {
      const error = createEmailSigninError("transport", { command });
      expect(error.command).toBe(expected);
      expect(JSON.stringify(error)).not.toMatch(
        /123456|private-token|private@example/
      );
    }
  );

  it.each([99, 600, 535.5, NaN, "535 private-token", undefined])(
    "rejects untrusted diagnostics and invalid SMTP response %s",
    (responseCode) => {
      const error = createEmailSigninError("transport", {
        name: "Error private-token 123456",
        code: "EAUTH private-token 123456",
        command: "private-token 123456",
        responseCode,
      });
      expect(error.name).toBe("Error");
      expect(error.code).toBeUndefined();
      expect(error.command).toBeUndefined();
      expect(error.responseCode).toBeUndefined();
      expect(`${JSON.stringify(error)} ${error.stack}`).not.toMatch(
        /123456|private-token/
      );
    }
  );

  it.each([
    { name: "EmailTask", props: { templateName: "SigninEmail", props: {} } },
    { props: { templateName: "SigninEmail", props: { token: "secret" } } },
    { templateName: "SigninEmail", code: "123456" },
  ])("recognizes legacy sign-in envelopes before logging", (data) => {
    expect(isSigninEmailTask(data)).toBe(true);
  });

  it.each([
    undefined,
    null,
    {},
    { props: null },
    { props: { templateName: "InviteEmail" } },
  ])("leaves unrelated and unidentified envelopes alone", (data) =>
    expect(isSigninEmailTask(data)).toBe(false)
  );

  it("redacts repeated and encoded credentials without masking other values", () => {
    const url =
      "/auth/email.callback?token=first%2Fsecret&%74oken=second%26secret&code=123456&%63%6fde=654321&client=desktop&count=123456";
    expect(redactEmailSigninUrl(url)).toBe(
      "/auth/email.callback?token=[REDACTED]&%74oken=[REDACTED]&code=[REDACTED]&%63%6fde=[REDACTED]&client=desktop&count=123456"
    );
    expect(url).toContain("token=first%2Fsecret");
    expect(redactEmailSigninUrl("/?%ZZ=ok&token=secret")).toBe(
      "/?%ZZ=ok&token=[REDACTED]"
    );
  });

  it("redacts actual HTTP debug logs while the handler receives the original URL", async () => {
    const originalUrl = "/auth/email.callback?token=private-link&code=123456";
    const log = vi.fn();
    const app = new Koa();
    app.use(logger((message) => log(redactEmailSigninUrl(message))));
    const request = new IncomingMessage(new Socket());
    request.url = originalUrl;
    request.method = "GET";
    const response = new ServerResponse(request);
    const ctx = app.createContext(request, response);
    const middleware = app.middleware[0];
    if (!middleware) {
      throw new Error("HTTP logger middleware is missing");
    }

    await middleware(ctx, async () => {
      expect(ctx.originalUrl).toBe(originalUrl);
      expect(ctx.query.token).toBe("private-link");
      expect(ctx.query.code).toBe("123456");
      ctx.body = "ok";
    });

    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-link");
    expect(JSON.stringify(log.mock.calls)).not.toContain("123456");
    expect(request.url).toBe(originalUrl);
  });
});
