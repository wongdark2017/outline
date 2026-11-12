// @vitest-isolate true
import nodemailer from "nodemailer";
import Oy from "oy-vey";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import { Mailer } from "./mailer";

describe("sign-in mail confidentiality", () => {
  const smtpUsername = env.SMTP_USERNAME;
  const info = vi.fn<typeof Logger.info>();
  const debug = vi.fn<typeof Logger.debug>();
  const errorLog = vi.fn<typeof Logger.error>();

  beforeEach(() => {
    env.SMTP_USERNAME = undefined;
    info.mockClear();
    debug.mockClear();
    errorLog.mockClear();
    vi.spyOn(Logger, "info").mockImplementation(info);
    vi.spyOn(Logger, "debug").mockImplementation(debug);
    vi.spyOn(Logger, "error").mockImplementation(errorLog);
    vi.spyOn(nodemailer, "createTestAccount").mockRejectedValue(
      new Error("offline")
    );
  });

  afterEach(() => {
    env.SMTP_USERNAME = smtpUsername;
    vi.restoreAllMocks();
  });

  function buildMail(template = "SigninEmail") {
    return {
      to: "private-recipient@example.com",
      from: { address: "sender@example.com", name: "Outline" },
      subject: "123456 is your sign-in code",
      previewText: "123456 private preview",
      text: "123456 https://outline.test/auth/email.callback?token=private-token",
      component: <p>123456 private-token</p>,
      tags: { category: "authentication", template },
    };
  }

  function captureLogs() {
    return [...info.mock.calls, ...debug.mock.calls, ...errorLog.mock.calls]
      .map((args) =>
        args
          .map((value) =>
            value instanceof Error
              ? `${value.message} ${value.stack}`
              : JSON.stringify(value)
          )
          .join(" ")
      )
      .join("\n");
  }

  it.each([true, false])(
    "keeps credentials in the delivered mail with development=%s",
    async (development) => {
      vi.spyOn(env, "isDevelopment", "get").mockReturnValue(development);
      vi.spyOn(env, "isProduction", "get").mockReturnValue(!development);
      const transport = nodemailer.createTransport({ jsonTransport: true });
      const send = vi.spyOn(transport, "sendMail");
      const mailer = new Mailer();
      mailer.transporter = transport;

      await mailer.sendMail(buildMail());

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "123456 is your sign-in code",
          text: expect.stringContaining("private-token"),
          html: expect.stringContaining("123456"),
        })
      );
      expect(captureLogs()).not.toMatch(
        /123456|private-token|private-recipient/
      );
      expect(info).toHaveBeenCalledWith("email", "Sending sign-in email", {
        templateName: "SigninEmail",
      });
    }
  );

  it.each([true, false])(
    "drops SMTP error messages, stack, cause and metadata with development=%s",
    async (development) => {
      vi.spyOn(env, "isDevelopment", "get").mockReturnValue(development);
      vi.spyOn(env, "isProduction", "get").mockReturnValue(!development);
      const transport = nodemailer.createTransport({ jsonTransport: true });
      const original = Object.assign(new Error("123456 private-token"), {
        code: "EAUTH",
        responseCode: 535,
        command: "AUTH PLAIN 123456 private-token",
        cause: new Error("123456 private-token"),
        response: "123456 private-token",
        envelope: { to: "private-recipient@example.com" },
      });
      vi.spyOn(transport, "sendMail").mockRejectedValue(original);
      const mailer = new Mailer();
      mailer.transporter = transport;

      const error = await mailer
        .sendMail(buildMail())
        .catch((failure: Error) => failure);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBe(original);
      expect(error).toMatchObject({
        message: "Sign-in email delivery failed",
        name: "Error",
        code: "EAUTH",
        responseCode: 535,
        command: "AUTH PLAIN",
      });
      expect(error).not.toHaveProperty("cause");
      expect(error).not.toHaveProperty("response");
      expect(error).not.toHaveProperty("envelope");
      expect(captureLogs()).not.toMatch(
        /123456|private-token|private-recipient/
      );
    }
  );

  it("retains timeout diagnostics separately from SMTP authentication failures", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    vi.spyOn(transport, "sendMail").mockRejectedValue(
      Object.assign(new Error("123456 private-token"), {
        name: "TimeoutError",
        code: "ETIMEDOUT",
        command: "CONN",
      })
    );
    const mailer = new Mailer();
    mailer.transporter = transport;

    await expect(mailer.sendMail(buildMail())).rejects.toMatchObject({
      message: "Sign-in email delivery failed",
      name: "TimeoutError",
      code: "ETIMEDOUT",
      command: "CONN",
    });
    expect(errorLog).toHaveBeenCalledWith(
      "Error sending sign-in email",
      expect.objectContaining({ code: "ETIMEDOUT", command: "CONN" }),
      { templateName: "SigninEmail" }
    );
    expect(captureLogs()).not.toMatch(/123456|private-token|private-recipient/);
  });

  it("also sanitizes render failures", async () => {
    const mailer = new Mailer();
    mailer.transporter = nodemailer.createTransport({ jsonTransport: true });
    vi.spyOn(Oy, "renderTemplate").mockImplementation(() => {
      throw new Error("123456 private-token");
    });

    await expect(mailer.sendMail(buildMail())).rejects.toThrow(
      "Sign-in email delivery failed"
    );
    expect(captureLogs()).not.toMatch(/123456|private-token|private-recipient/);
  });

  it("preserves only a safe development Ethereal preview URL", async () => {
    vi.spyOn(env, "isDevelopment", "get").mockReturnValue(true);
    vi.spyOn(nodemailer, "getTestMessageUrl").mockReturnValue(
      "https://ethereal.email/message/test-preview"
    );
    const mailer = new Mailer();
    mailer.transporter = nodemailer.createTransport({ jsonTransport: true });

    await mailer.sendMail(buildMail());

    expect(info).toHaveBeenCalledWith(
      "email",
      "Preview Url: https://ethereal.email/message/test-preview"
    );
    expect(captureLogs()).not.toMatch(/123456|private-token|private-recipient/);
  });

  it("does not log an unsafe preview URL or a production preview", async () => {
    vi.spyOn(env, "isDevelopment", "get").mockReturnValue(true);
    vi.spyOn(nodemailer, "getTestMessageUrl").mockReturnValue(
      "https://ethereal.email/message/test?token=private-token"
    );
    const developmentMailer = new Mailer();
    developmentMailer.transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
    await developmentMailer.sendMail(buildMail());
    expect(captureLogs()).not.toContain("Preview Url:");

    vi.spyOn(env, "isDevelopment", "get").mockReturnValue(false);
    vi.mocked(nodemailer.getTestMessageUrl).mockReturnValue(
      "https://ethereal.email/message/test-preview"
    );
    const productionMailer = new Mailer();
    productionMailer.transporter = developmentMailer.transporter;
    await productionMailer.sendMail(buildMail());
    expect(captureLogs()).not.toContain("Preview Url:");
  });

  it("preserves unrelated email logging and transport behavior", async () => {
    vi.spyOn(env, "isDevelopment", "get").mockReturnValue(true);
    const mailer = new Mailer();
    mailer.transporter = nodemailer.createTransport({ jsonTransport: true });
    await mailer.sendMail(buildMail("InviteEmail"));
    expect(captureLogs()).toContain("123456 is your sign-in code");
  });

  it("keeps unavailable sign-in transports retryable", async () => {
    const mailer = new Mailer();
    mailer.transporter = undefined;
    await expect(mailer.sendMail(buildMail())).rejects.toThrow(
      "Sign-in email delivery failed"
    );
    expect(captureLogs()).not.toMatch(/123456|private-token|private-recipient/);
  });
});
