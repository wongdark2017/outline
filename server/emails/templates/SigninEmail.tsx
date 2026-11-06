import type Bull from "bull";
import { z } from "zod";
import { Client, EmailSigninMethod } from "@shared/types";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import { User } from "@server/models";
import { EmailSigninRequest } from "@server/utils/EmailSigninRequest";
import { VerificationCode } from "@server/utils/VerificationCode";
import { createEmailSigninError } from "@server/utils/emailSigninRedaction";
import BaseEmail, { EmailMessageCategory } from "./BaseEmail";
import Body from "./components/Body";
import Button from "./components/Button";
import EmailTemplate from "./components/EmailLayout";
import EmptySpace from "./components/EmptySpace";
import Footer from "./components/Footer";
import Header from "./components/Header";
import Heading from "./components/Heading";

/** Credential-free metadata accepted by the sign-in email worker. */
export interface SigninEmailProps {
  userId: string;
  teamId: string;
  to: string;
  language?: string | null;
  client: Client;
  method: EmailSigninMethod;
  requestId: string;
  requestedAt: number;
  requestIp: string;
  userAgent: string;
}

type RenderData = { teamUrl: string } & (
  | {
      method: EmailSigninMethod.Code;
      verificationCode: string;
      token?: never;
    }
  | {
      method: EmailSigninMethod.Link;
      token: string;
      verificationCode?: never;
    }
);

type RenderProps = SigninEmailProps & RenderData;
type SkipReason =
  | "invalid_request"
  | "ineligible"
  | "superseded_or_expired"
  | "attempts_exhausted"
  | "daily_locked";

const signinEmailSchema = z.strictObject({
  userId: z.uuid(),
  teamId: z.uuid(),
  to: z.email(),
  language: z.string().nullable().optional(),
  client: z.enum(Client),
  method: z.enum(EmailSigninMethod),
  requestId: z.uuid(),
  requestedAt: z.number().int().nonnegative(),
  requestIp: z.string().min(1).max(128),
  userAgent: z.string().max(512),
});

/** Email that generates a sign-in credential only immediately before delivery. */
export default class SigninEmail extends BaseEmail<
  SigninEmailProps,
  RenderData
> {
  /**
   * Create an email from credential-free request metadata.
   *
   * @param inputProps the original sign-in request metadata.
   */
  public constructor(private readonly inputProps: SigninEmailProps) {
    super(inputProps);
  }

  /**
   * Schedule only the allowed credential-free input shape.
   *
   * @param options the queue's scheduling options.
   * @returns the queued job when email is configured.
   * @throws if the input contains legacy or unexpected properties.
   */
  public schedule(options?: Bull.JobOptions) {
    if (!signinEmailSchema.safeParse(this.inputProps).success) {
      throw createEmailSigninError("queue");
    }
    return super.schedule(options);
  }

  /**
   * Send without allowing rendered credentials into task errors.
   *
   * @returns a promise resolving after delivery or a business skip.
   * @throws a safe retryable error if generation or delivery fails.
   */
  public async send(): Promise<void> {
    try {
      await super.send();
    } catch (error) {
      throw createEmailSigninError("task", error);
    }
  }

  protected async beforeSend(
    input: SigninEmailProps
  ): Promise<RenderData | false> {
    const parsed = signinEmailSchema.safeParse(input);
    if (!parsed.success) {
      this.skipReason = "invalid_request";
      return false;
    }

    const props = parsed.data;
    const request = {
      teamId: props.teamId,
      email: props.to.trim().toLowerCase(),
      requestId: props.requestId,
      requestedAt: props.requestedAt,
    };
    if (!(await EmailSigninRequest.isCurrent(request))) {
      this.skipReason = "superseded_or_expired";
      return false;
    }

    const user = await User.scope(["withTeam", "withAuthentications"]).findByPk(
      props.userId
    );
    if (
      !user ||
      user.teamId !== props.teamId ||
      user.email?.trim().toLowerCase() !== request.email ||
      user.isSuspended ||
      user.team.isSuspended ||
      !user.team.emailSigninEnabled ||
      user.authentications.length > 0
    ) {
      this.skipReason = "ineligible";
      return false;
    }

    if (props.method === EmailSigninMethod.Code) {
      if (await VerificationCode.isLocked(props.teamId, request.email)) {
        this.skipReason = "daily_locked";
        return false;
      }
      const verificationCode = VerificationCode.generate();
      const publication = await VerificationCode.publish(
        request,
        verificationCode
      );
      if (!publication.published) {
        this.skipReason = publication.reason;
        return false;
      }
      return {
        method: EmailSigninMethod.Code,
        teamUrl: user.team.url,
        verificationCode,
      };
    }

    const token = user.getEmailSigninToken({
      requestIp: props.requestIp,
      requestId: props.requestId,
      requestedAt: props.requestedAt,
    });
    if (!(await EmailSigninRequest.isCurrent(request))) {
      this.skipReason = "superseded_or_expired";
      return false;
    }
    return { method: EmailSigninMethod.Link, teamUrl: user.team.url, token };
  }

  protected logSkipped(): void {
    Logger.info("email", "Sign-in email skipped", {
      templateName: "SigninEmail",
      reason: this.skipReason,
    });
  }

  protected get category() {
    return EmailMessageCategory.Authentication;
  }

  protected subject({ token }: RenderProps) {
    return token
      ? this.t("Magic Sign-in Link")
      : this.t("Sign in verification code");
  }

  protected preview(): string {
    return this.t("Here’s your link to sign in to {{ appName }}.", {
      appName: env.APP_NAME,
    });
  }

  protected renderAsText({
    token,
    teamUrl,
    client,
    verificationCode,
  }: RenderProps): string {
    if (token) {
      return `
${this.t("Use the link below to sign in")}:

${this.signinLink(teamUrl, token, client)}

${this.t("If the link expired you can request a new one from your team’s sign-in page at")}: ${teamUrl}
`;
    }

    return `
${this.t("Enter this verification code")}: ${verificationCode}

${this.t("If the code expired you can request a new one from your team’s sign-in page at")}: ${teamUrl}
`;
  }

  protected render({ token, client, teamUrl, verificationCode }: RenderProps) {
    return (
      <EmailTemplate
        previewText={this.preview()}
        goToAction={
          token
            ? {
                url: this.signinLink(teamUrl, token, client),
                name: this.t("Sign In"),
              }
            : undefined
        }
      >
        <Header />

        {token ? (
          <Body>
            <Heading>{this.t("Magic Sign-in Link")}</Heading>
            <p>
              {this.t("Click the button below to sign in to {{ appName }}.", {
                appName: env.APP_NAME,
              })}
            </p>
            <EmptySpace height={10} />
            <p>
              <Button href={this.signinLink(teamUrl, token, client)}>
                {this.t("Sign In")}
              </Button>
            </p>
            <EmptySpace height={20} />
            <p>
              {this.t(
                "If the link expired you can request a new one from your team’s sign-in page at"
              )}
              : <a href={teamUrl}>{teamUrl}</a>
            </p>
          </Body>
        ) : (
          <Body>
            <Heading>{this.t("Sign-in Code")}</Heading>
            <p>
              {this.t(
                "Enter this code on your team’s sign-in page to continue."
              )}
            </p>
            <EmptySpace height={10} />
            <p
              style={{
                fontSize: "24px",
                letterSpacing: "0.25em",
                fontWeight: "bold",
                backgroundColor: "#F9FAFB",
                padding: "12px",
                borderRadius: "4px",
              }}
            >
              {verificationCode}
            </p>
            <EmptySpace height={20} />
            <p>
              {this.t(
                "If the code expired you can request a new one from your team’s sign-in page at"
              )}
              : <a href={teamUrl}>{teamUrl}</a>
            </p>
          </Body>
        )}
        <Footer />
      </EmailTemplate>
    );
  }

  private skipReason: SkipReason = "invalid_request";

  private signinLink(teamUrl: string, token: string, client: Client): string {
    return `${teamUrl}/auth/email.callback?token=${token}&client=${client}`;
  }
}
