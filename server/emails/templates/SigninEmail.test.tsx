import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Client, EmailSigninMethod } from "@shared/types";
import mailer from "@server/emails/mailer";
import Logger from "@server/logging/Logger";
import { AuthenticationProvider } from "@server/models";
import { taskQueue } from "@server/queues";
import Redis from "@server/storage/redis";
import { buildGuestUser, buildTeam, buildUser } from "@server/test/factories";
import { EmailSigninRequest } from "@server/utils/EmailSigninRequest";
import { VerificationCode } from "@server/utils/VerificationCode";
import BaseEmail, { EmailMessageCategory } from "./BaseEmail";
import SigninEmail from "./SigninEmail";
import type { SigninEmailProps } from "./SigninEmail";

const queueEnvelopeSchema = z.object({
  name: z.literal("EmailTask"),
  props: z.object({
    templateName: z.literal("SigninEmail"),
    props: z.record(z.string(), z.unknown()),
  }),
});

async function buildRequest(method = EmailSigninMethod.Code) {
  const team = await buildTeam();
  const user = await buildGuestUser({ teamId: team.id });
  if (!user.email) {
    throw new Error("Fixture requires an email");
  }
  const props: SigninEmailProps = {
    userId: user.id,
    teamId: team.id,
    to: user.email,
    language: user.language,
    client: Client.Web,
    method,
    requestId: randomUUID(),
    requestedAt: Date.now(),
    requestIp: "192.0.2.15",
    userAgent: "Private user agent",
  };
  const request = { ...props, email: props.to };
  await EmailSigninRequest.admit(request);
  return { team, user, props, request };
}

beforeEach(async () => {
  await Redis.defaultClient.flushall();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SigninEmail", () => {
  it("queues only request metadata and generates a code when sending", async () => {
    const { props } = await buildRequest();
    const original = JSON.stringify(props);
    const add = vi.spyOn(taskQueue(), "add");
    const generate = vi.spyOn(VerificationCode, "generate");
    const send = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    const email = new SigninEmail(props);

    await email.schedule();

    expect(generate).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      { name: "EmailTask", props: { templateName: "SigninEmail", props } },
      expect.objectContaining({ attempts: 5 })
    );
    expect(
      Object.keys(
        queueEnvelopeSchema.parse(add.mock.calls[0][0]).props.props
      ).sort()
    ).toEqual([
      "client",
      "language",
      "method",
      "requestId",
      "requestIp",
      "requestedAt",
      "teamId",
      "to",
      "userAgent",
      "userId",
    ]);
    expect(await email.send()).toBeUndefined();
    expect(generate).toHaveBeenCalledOnce();
    const code = generate.mock.results[0].value;
    expect(send.mock.calls[0][0].text).toContain(code);
    expect(JSON.stringify(props)).toBe(original);
    expect(JSON.stringify(add.mock.calls)).not.toContain(code);
    const stored = await Redis.defaultClient.hgetall(
      EmailSigninRequest.getKeys(props.teamId, props.to).verifier
    );
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(await VerificationCode.verify(props.teamId, props.to, code)).toBe(
      true
    );
    expect(await VerificationCode.verify(props.teamId, props.to, code)).toBe(
      false
    );
  });

  it("generates a fresh code on a retry without charging another send", async () => {
    const { props } = await buildRequest();
    const generate = vi
      .spyOn(VerificationCode, "generate")
      .mockReturnValueOnce("123456")
      .mockReturnValueOnce("654321");
    const send = vi
      .spyOn(mailer, "sendMail")
      .mockRejectedValueOnce(new Error("SMTP failed with 123456"))
      .mockResolvedValueOnce();
    const key = EmailSigninRequest.getKeys(props.teamId, props.to).hourly;

    await expect(new SigninEmail(props).send()).rejects.toThrow(
      "Sign-in email task failed"
    );
    await expect(new SigninEmail(props).send()).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await Redis.defaultClient.get(key)).toBe("1");
    expect(
      await VerificationCode.verify(props.teamId, props.to, "123456")
    ).toBe(false);
    expect(
      await VerificationCode.verify(props.teamId, props.to, "654321")
    ).toBe(true);
  });

  it("generates magic links transiently with original IP and deadline", async () => {
    const { props } = await buildRequest(EmailSigninMethod.Link);
    const send = vi.spyOn(mailer, "sendMail").mockResolvedValue();

    const add = vi.spyOn(taskQueue(), "add");
    const email = new SigninEmail(props);
    await email.schedule();
    expect(send).not.toHaveBeenCalled();

    await email.send();

    const text = send.mock.calls[0][0].text ?? "";
    const match = text.match(/token=([^&\s]+)/);
    const issuedToken = match?.[1];
    expect(issuedToken).toBeDefined();
    const payload = issuedToken
      ? JSON.parse(
          Buffer.from(issuedToken.split(".")[1], "base64url").toString()
        )
      : {};
    expect(payload).toMatchObject({
      ip: props.requestIp,
      requestedAt: props.requestedAt,
      requestId: props.requestId,
    });
    expect(send.mock.calls[0][0].text).toContain(issuedToken);
    expect(JSON.stringify(add.mock.calls)).not.toContain(issuedToken);
    expect(props).not.toHaveProperty("token");
  });

  it.each(["stale", "expired", "missing", "legacy"])(
    "safely skips %s jobs",
    async (kind) => {
      const { props } = await buildRequest();
      const info = vi.spyOn(Logger, "info");
      const generate = vi.spyOn(VerificationCode, "generate");
      const send = vi.spyOn(mailer, "sendMail").mockResolvedValue();
      if (kind === "stale") {
        await Redis.defaultClient.set(
          EmailSigninRequest.getKeys(props.teamId, props.to).latest,
          randomUUID()
        );
      } else if (kind === "expired") {
        props.requestedAt = Date.now() - 600000;
      } else if (kind === "missing") {
        await Redis.defaultClient.del(
          EmailSigninRequest.getKeys(props.teamId, props.to).latest
        );
      }
      const input =
        kind === "legacy" ? { ...props, token: "private-legacy-token" } : props;

      expect(await new SigninEmail(input).send()).toBeUndefined();
      expect(generate).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith("email", "Sign-in email skipped", {
        templateName: "SigninEmail",
        reason: kind === "legacy" ? "invalid_request" : "superseded_or_expired",
      });
      const logs = JSON.stringify(info.mock.calls);
      for (const privateValue of [
        props.to,
        props.requestIp,
        props.userAgent,
        props.userId,
        props.requestId,
        "private-legacy-token",
      ]) {
        expect(logs).not.toContain(privateValue);
      }
    }
  );

  it.each(["email", "user", "team", "disabled", "sso", "deleted"])(
    "rechecks %s eligibility before generation",
    async (kind) => {
      const { props, team, user } = await buildRequest();
      if (kind === "email") {
        await user.update({ email: "changed@example.com" });
      } else if (kind === "user") {
        await user.update({ suspendedAt: new Date(), suspendedById: user.id });
      } else if (kind === "team") {
        await team.update({ suspendedAt: new Date() });
      } else if (kind === "disabled") {
        await team.update({ guestSignin: false });
      } else if (kind === "sso") {
        const ssoUser = await buildUser({ teamId: team.id });
        props.userId = ssoUser.id;
        if (!ssoUser.email) {
          throw new Error("Fixture requires an email");
        }
        props.to = ssoUser.email;
        await EmailSigninRequest.admit({ ...props, email: props.to });
      } else {
        await user.destroy({ hooks: false });
      }
      const info = vi.spyOn(Logger, "info");
      const send = vi.spyOn(mailer, "sendMail").mockResolvedValue();
      const generate = vi.spyOn(VerificationCode, "generate");

      await new SigninEmail(props).send();

      expect(send).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith("email", "Sign-in email skipped", {
        templateName: "SigninEmail",
        reason: "ineligible",
      });
    }
  );

  it("continues allowing email when an SSO provider is disabled", async () => {
    const { props, team } = await buildRequest();
    const user = await buildUser({ teamId: team.id });
    props.userId = user.id;
    if (!user.email) {
      throw new Error("Fixture requires an email");
    }
    props.to = user.email;
    await EmailSigninRequest.admit({ ...props, email: props.to });
    await AuthenticationProvider.update(
      { enabled: false },
      { where: { teamId: team.id } }
    );
    const send = vi.spyOn(mailer, "sendMail").mockResolvedValue();

    await new SigninEmail(props).send();

    expect(send).toHaveBeenCalledOnce();
  });

  it("skips locked code requests without generating a credential", async () => {
    const { props } = await buildRequest();
    await Redis.defaultClient.set(
      EmailSigninRequest.getKeys(props.teamId, props.to).failures,
      "30",
      "PX",
      86400000
    );
    const generate = vi.spyOn(VerificationCode, "generate");
    const send = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    const info = vi.spyOn(Logger, "info");
    await new SigninEmail(props).send();
    expect(generate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith("email", "Sign-in email skipped", {
      templateName: "SigninEmail",
      reason: "daily_locked",
    });
  });

  it.each([
    ["attempts", "5", "attempts_exhausted"],
    ["failures", "30", "daily_locked"],
  ] as const)(
    "logs the atomic %s publication refusal without private metadata",
    async (counter, value, reason) => {
      const { props } = await buildRequest();
      const keys = EmailSigninRequest.getKeys(props.teamId, props.to);
      const publish = VerificationCode.publish.bind(VerificationCode);
      vi.spyOn(VerificationCode, "publish").mockImplementationOnce(
        async (request, code) => {
          await Redis.defaultClient.set(keys[counter], value, "PX", 600000);
          return publish(request, code);
        }
      );
      const send = vi.spyOn(mailer, "sendMail").mockResolvedValue();
      const info = vi.spyOn(Logger, "info");

      await new SigninEmail(props).send();

      expect(send).not.toHaveBeenCalled();
      expect(info.mock.calls).toEqual([
        [
          "email",
          "Sign-in email skipped",
          { templateName: "SigninEmail", reason },
        ],
      ]);
    }
  );

  it("keeps the same request's attempts through worker retries", async () => {
    const { props } = await buildRequest();
    const keys = EmailSigninRequest.getKeys(props.teamId, props.to);
    vi.spyOn(VerificationCode, "generate")
      .mockReturnValueOnce("123456")
      .mockReturnValue("654321");
    const send = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    const info = vi.spyOn(Logger, "info");
    await new SigninEmail(props).send();
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(
        await VerificationCode.verify(props.teamId, props.to, "000000")
      ).toBe(false);
    }

    await new SigninEmail(props).send();

    expect(await Redis.defaultClient.get(keys.attempts)).toBe("2");
    for (let attempt = 0; attempt < 3; attempt++) {
      await VerificationCode.verify(props.teamId, props.to, "000000");
    }
    await new SigninEmail(props).send();

    expect(send).toHaveBeenCalledTimes(2);
    expect(await Redis.defaultClient.get(keys.attempts)).toBe("5");
    expect(await Redis.defaultClient.get(keys.failures)).toBe("5");
    expect(await Redis.defaultClient.get(keys.hourly)).toBe("1");
    expect(info).toHaveBeenCalledWith("email", "Sign-in email skipped", {
      templateName: "SigninEmail",
      reason: "attempts_exhausted",
    });
  });

  it("retains safe transport diagnostics while dropping credential-bearing details", async () => {
    const { props } = await buildRequest();
    const original = Object.assign(
      new Error("SMTP AUTH body 123456 token=private-token"),
      {
        code: "EAUTH",
        responseCode: 535,
        command: "AUTH PLAIN",
        cause: new Error("private-token"),
        response: "123456 private-token",
      }
    );
    vi.spyOn(mailer, "sendMail").mockRejectedValue(original);

    let failure: Error | undefined;
    try {
      await new SigninEmail(props).send();
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      failure = error;
    }

    expect(failure).toMatchObject({
      message: "Sign-in email task failed",
      name: "Error",
      code: "EAUTH",
      responseCode: 535,
      command: "AUTH PLAIN",
    });
    expect(failure).not.toHaveProperty("cause");
    expect(failure).not.toHaveProperty("response");
    expect(JSON.stringify(failure)).not.toMatch(/123456|private-token/);
    expect(failure?.stack).not.toMatch(/123456|private-token/);
  });

  it("sanitizes errors before rendering and from rendering itself", async () => {
    const { props } = await buildRequest();
    const info = vi.spyOn(Logger, "info");
    const debug = vi.spyOn(Logger, "debug");
    const current = vi
      .spyOn(EmailSigninRequest, "isCurrent")
      .mockRejectedValueOnce(new Error("private-token 123456"));
    await expect(new SigninEmail(props).send()).rejects.toThrow(
      "Sign-in email task failed"
    );
    current.mockRestore();

    class BrokenSigninEmail extends SigninEmail {
      protected render(): React.JSX.Element {
        throw Object.assign(new Error("private-token 123456"), {
          cause: new Error("123456"),
        });
      }
    }
    let failure: Error | undefined;
    try {
      await new BrokenSigninEmail(props).send();
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      failure = error;
    }
    expect(failure?.message).toBe("Sign-in email task failed");
    expect(failure).not.toHaveProperty("cause");
    expect(failure?.stack).not.toMatch(/private-token|123456/);
    expect(JSON.stringify([info.mock.calls, debug.mock.calls])).not.toMatch(
      /private-token|123456/
    );
  });

  it("rechecks eligibility on a transport retry", async () => {
    const { props, user } = await buildRequest();
    const send = vi
      .spyOn(mailer, "sendMail")
      .mockRejectedValueOnce(new Error("SMTP body 123456"));
    const generate = vi.spyOn(VerificationCode, "generate");
    await expect(new SigninEmail(props).send()).rejects.toThrow(
      "Sign-in email task failed"
    );
    await user.update({ suspendedAt: new Date(), suspendedById: user.id });
    await expect(new SigninEmail(props).send()).resolves.toBeUndefined();
    expect(generate).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  it("never leaks secrets or context in repeated superseded skip logs", async () => {
    const { props, request } = await buildRequest();
    await EmailSigninRequest.clear(request);
    const info = vi.spyOn(Logger, "info");
    await new SigninEmail(props).send();
    await new SigninEmail(props).send();
    expect(info.mock.calls).toEqual(
      Array.from({ length: 2 }, () => [
        "email",
        "Sign-in email skipped",
        { templateName: "SigninEmail", reason: "superseded_or_expired" },
      ])
    );
  });

  it("skips when superseded during database lookup", async () => {
    const { props } = await buildRequest();
    vi.spyOn(VerificationCode, "generate").mockImplementation(() => {
      void Redis.defaultClient.del(
        EmailSigninRequest.getKeys(props.teamId, props.to).latest
      );
      return "123456";
    });
    const send = vi.spyOn(mailer, "sendMail").mockResolvedValue();
    await new SigninEmail(props).send();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects unexpected properties at the actual scheduling boundary", async () => {
    const { props } = await buildRequest();
    const add = vi.spyOn(taskQueue(), "add");
    const unexpected = { ...props, token: "legacy-token" };
    expect(() => new SigninEmail(unexpected).schedule()).toThrow(
      "Sign-in email scheduling failed"
    );
    expect(add).not.toHaveBeenCalled();
  });

  it("preserves ordinary templates' existing skip logging", async () => {
    class OrdinaryEmail extends BaseEmail<{ to: string }> {
      protected get category() {
        return EmailMessageCategory.Notification;
      }
      protected async beforeSend() {
        return false as const;
      }
      protected subject() {
        return "Subject";
      }
      protected preview() {
        return "Preview";
      }
      protected renderAsText() {
        return "Body";
      }
      protected render() {
        return <p>Body</p>;
      }
    }
    const info = vi.spyOn(Logger, "info");
    await new OrdinaryEmail({ to: "ordinary@example.com" }).send();
    expect(info).toHaveBeenCalledWith(
      "email",
      "Email OrdinaryEmail not sent due to beforeSend hook",
      { to: "ordinary@example.com" }
    );
  });
});
