type EmailSigninErrorReason =
  | "transport"
  | "render"
  | "task"
  | "callback"
  | "queue";

/** A sign-in failure containing only bounded operational diagnostics. */
export class EmailSigninError extends Error {
  public readonly code?: string;

  public readonly responseCode?: number;

  public readonly command?: string;

  /**
   * Replaces private failure details while retaining safe SMTP diagnostics.
   *
   * @param reason the bounded operation that failed.
   * @param source the untrusted original or previously sanitized error.
   */
  public constructor(reason: EmailSigninErrorReason, source?: unknown) {
    super(messages[reason]);

    if (!isRecord(source)) {
      return;
    }

    if (typeof source.name === "string" && errorNames.has(source.name)) {
      this.name = source.name;
    }
    if (typeof source.code === "string" && errorCodes.has(source.code)) {
      this.code = source.code;
    }
    if (
      typeof source.responseCode === "number" &&
      Number.isInteger(source.responseCode) &&
      source.responseCode >= 100 &&
      source.responseCode <= 599
    ) {
      this.responseCode = source.responseCode;
    }
    if (typeof source.command === "string") {
      this.command = safeCommand(source.command);
    }
  }
}

/**
 * Creates a retryable sign-in error without retaining private transport data.
 *
 * @param reason the bounded operation that failed.
 * @param source the untrusted original or previously sanitized error.
 * @returns a fresh error with only allowlisted operational diagnostics.
 */
export function createEmailSigninError(
  reason: EmailSigninErrorReason,
  source?: unknown
): EmailSigninError {
  return new EmailSigninError(reason, source);
}

/**
 * Identifies sign-in task envelopes before any untrusted job data is logged.
 *
 * @param data the serialized queue envelope, including malformed legacy jobs.
 * @returns whether the envelope identifies the sign-in email template.
 */
export function isSigninEmailTask(data: unknown): boolean {
  if (!isRecord(data)) {
    return false;
  }

  return (
    data.templateName === "SigninEmail" ||
    (isRecord(data.props) && data.props.templateName === "SigninEmail")
  );
}

/**
 * Removes authentication query values from a copy used only for HTTP logging.
 *
 * @param url the original URL or formatted HTTP log message.
 * @returns a copy with repeated and encoded credential parameters redacted.
 */
export function redactEmailSigninUrl(url: string): string {
  return url.replace(
    /([?&])([^=&#\s]+)=([^&#\s]*)/g,
    (parameter: string, separator: string, encodedName: string) => {
      let name = encodedName;

      try {
        name = decodeURIComponent(encodedName.replace(/\+/g, " "));
      } catch {
        // Leave malformed unrelated names untouched.
      }

      return ["token", "code"].includes(name.toLowerCase())
        ? `${separator}${encodedName}=[REDACTED]`
        : parameter;
    }
  );
}

const messages = {
  transport: "Sign-in email delivery failed",
  render: "Sign-in email rendering failed",
  task: "Sign-in email task failed",
  callback: "Email sign-in verification failed",
  queue: "Sign-in email scheduling failed",
};

const errorNames = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "AbortError",
  "TimeoutError",
  "SMTPError",
  "ConnectionError",
]);

const errorCodes = new Set([
  "EAUTH",
  "ECONNECTION",
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ESOCKET",
  "ESTREAM",
  "EMESSAGE",
  "EENVELOPE",
  "EPROTOCOL",
  "ETLS",
  "EDNS",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ECANCELLED",
]);

function safeCommand(command: string): string | undefined {
  const normalized = command.trim().toUpperCase();
  const match = normalized.match(
    /^(CONN|EHLO|HELO|STARTTLS|DATA|RSET|NOOP|QUIT|AUTH|MAIL FROM|RCPT TO)(?=$|[\s:])/
  );
  if (!match) {
    return undefined;
  }

  const verb = match[1];
  if (verb !== "AUTH") {
    return verb;
  }

  const mechanism = normalized.match(
    /^AUTH\s+(PLAIN|LOGIN|CRAM-MD5|XOAUTH2|OAUTHBEARER)(?=$|\s)/
  )?.[1];
  return mechanism ? `AUTH ${mechanism}` : "AUTH";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
