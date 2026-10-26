// @vitest-isolate true
import { randomUUID } from "node:crypto";
import { z } from "zod";
import nodemailer from "nodemailer";
import { Client, EmailSigninMethod } from "@shared/types";
import mailer, { Mailer } from "@server/emails/mailer";
import Logger from "@server/logging/Logger";
import SigninEmail from "@server/emails/templates/SigninEmail";
import { taskQueue } from "@server/queues";
import Redis from "@server/storage/redis";
import { buildGuestUser } from "@server/test/factories";
import { EmailSigninRequest } from "@server/utils/EmailSigninRequest";
import { VerificationCode } from "@server/utils/VerificationCode";
import { __setRequireDirectoryCache } from "@server/utils/fs";
import { initI18n } from "@server/utils/i18n";
import EmailTask from "./EmailTask";

const queueEnvelopeSchema = z.object({
  name: z.literal("EmailTask"),
  props: z.object({
    templateName: z.literal("SigninEmail"),
    props: z.record(z.string(), z.unknown()),
  }),
});

beforeAll(async () => {
  await initI18n();
  // Supply the compiled basename expected by the existing lazy registry.
  __setRequireDirectoryCache("emails/templates", {
    "SigninEmail.ts": { default: SigninEmail },
  });
});

beforeEach(async () => {
  await Redis.defaultClient.flushall();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function queueSignin() {
  const user = await buildGuestUser();
  if (!user.email) {
    throw new Error("Fixture requires an email");
  }
  const props = {
    userId: user.id,
    teamId: user.teamId,
    to: user.email,
    language: user.language,
    client: Client.Web,
    method: EmailSigninMethod.Code,
    requestId: randomUUID(),
    requestedAt: Date.now(),
    requestIp: "192.0.2.15",
    userAgent: "Original user agent",
  };
  await EmailSigninRequest.admit({ ...props, email: user.email });
  const add = vi.spyOn(taskQueue(), "add");
  await new SigninEmail(props).schedule();
  return { props, add };
}

describe("EmailTask", () => {
  it("executes the captured queue arguments without returning credentials", async () => {
    const { props, add } = await queueSignin();
    const data = queueEnvelopeSchema.parse(add.mock.calls[0][0]);
    const before = JSON.stringify(data);
    const send = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    vi.spyOn(VerificationCode, "generate").mockReturnValue("123456");

    const result = await new EmailTask().perform(data.props);

    expect(result).toBeUndefined();
    expect(send.mock.calls[0][0].text).toContain("123456");
    expect(JSON.stringify(data)).toBe(before);
    expect(JSON.stringify(data)).not.toContain("123456");
    expect(data.props.props).toEqual(props);
  });

  it("sanitizes credential-bearing failures and permits a fresh retry", async () => {
    const { add } = await queueSignin();
    const data = queueEnvelopeSchema.parse(add.mock.calls[0][0]);
    const info = vi.spyOn(Logger, "info");
    const debug = vi.spyOn(Logger, "debug");
    vi.spyOn(VerificationCode, "generate").mockReturnValue("123456");
    const original = Object.assign(
      new Error("SMTP body: 123456 token=private-link-token"),
      {
        cause: new Error("private-link-token"),
      }
    );
    vi.spyOn(mailer, "sendMail")
      .mockRejectedValueOnce(original)
      .mockResolvedValueOnce();

    let thrown: Error | undefined;
    try {
      await new EmailTask().perform(data.props);
    } catch (error) {
      if (error instanceof Error) {
        thrown = error;
      } else {
        throw error;
      }
    }
    expect(thrown?.message).toBe("Sign-in email task failed");
    expect(thrown).not.toHaveProperty("cause");
    for (const value of ["123456", "private-link-token"]) {
      expect(thrown?.stack).not.toContain(value);
      expect(
        JSON.stringify([info.mock.calls, debug.mock.calls, add.mock.calls])
      ).not.toContain(value);
    }
    expect(await new EmailTask().perform(data.props)).toBeUndefined();
  });

  it.each([
    { code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" },
    { code: "ETIMEDOUT", command: "CONN" },
  ])(
    "preserves safe SMTP diagnostics through mailer, SigninEmail and EmailTask: %j",
    async (details) => {
      const { add } = await queueSignin();
      const data = queueEnvelopeSchema.parse(add.mock.calls[0][0]);
      const logs = vi
        .spyOn(Logger, "error")
        .mockImplementation(() => undefined);
      vi.spyOn(VerificationCode, "generate").mockReturnValue("123456");
      vi.spyOn(nodemailer, "createTestAccount").mockRejectedValue(
        new Error("offline")
      );
      const transport = nodemailer.createTransport({ jsonTransport: true });
      const deliver = vi.spyOn(transport, "sendMail").mockRejectedValue(
        Object.assign(new Error("123456 private-link-token"), {
          ...details,
          response: "123456 private-link-token",
          cause: new Error("123456 private-link-token"),
          envelope: { to: "private@example.com" },
        })
      );
      const realMailer = new Mailer();
      realMailer.transporter = transport;
      vi.spyOn(mailer, "sendMail").mockImplementation(realMailer.sendMail);

      let thrown: Error | undefined;
      try {
        await new EmailTask().perform(data.props);
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }
        thrown = error;
      }

      expect(deliver).toHaveBeenCalled();
      expect(logs).toHaveBeenCalledWith(
        "Error sending sign-in email",
        expect.objectContaining(details),
        { templateName: "SigninEmail" }
      );
      expect(thrown).toMatchObject({
        message: "Sign-in email task failed",
        name: "Error",
        ...details,
      });
      expect(thrown).not.toHaveProperty("cause");
      expect(thrown).not.toHaveProperty("response");
      expect(thrown).not.toHaveProperty("envelope");
      expect(
        `${JSON.stringify(logs.mock.calls)} ${JSON.stringify(thrown)} ${thrown?.stack}`
      ).not.toMatch(/123456|private-link-token|private@example/);
    }
  );

  it("skips legacy credential-bearing jobs without returning or logging their contents", async () => {
    const info = vi.spyOn(Logger, "info");
    const send = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    const result = await new EmailTask().perform({
      templateName: "SigninEmail",
      props: {
        to: "legacy@example.com",
        token: "private-token",
        verificationCode: "123456",
      },
    });
    expect(result).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(info.mock.calls).toEqual([
      [
        "email",
        "Sign-in email skipped",
        {
          templateName: "SigninEmail",
          reason: "invalid_request",
        },
      ],
    ]);
  });
});
