import { Minute, Hour, Second } from "@shared/utils/time";
import Redis from "@server/storage/redis";

/** Server-owned identity and request time of a queued email sign-in. */
export interface EmailSigninRequestData {
  teamId: string;
  email: string;
  requestId: string;
  requestedAt: number;
}

/** Coordinates email sign-in admission and worker publication. */
export class EmailSigninRequest {
  /** Lifetime of credentials measured from admission, in milliseconds. */
  public static readonly lifetime = 10 * Minute.ms;

  /** Maximum future request-time drift accepted across web and worker hosts. */
  public static readonly clockSkewTolerance = 30 * Second.ms;

  /**
   * Returns the absolute server deadline for a request.
   *
   * @param requestedAt the server request time in milliseconds.
   * @returns the request deadline in milliseconds.
   */
  public static getDeadline(requestedAt: number): number {
    return requestedAt + this.lifetime;
  }

  /**
   * Gets normalized, method-independent keys for one team and email.
   *
   * @param teamId the workspace identifier.
   * @param email the recipient email address.
   * @returns the keys used by admission and credential scripts.
   */
  public static getKeys(teamId: string, email: string) {
    const scope = `${teamId}:${email.trim().toLowerCase()}`;
    return {
      latest: `email_signin_latest:${scope}`,
      verifier: `email_signin_verifier:${scope}`,
      attempts: `email_signin_attempts:${scope}`,
      failures: `email_signin_failures:${scope}`,
      cooldown: `email_signin_cooldown:${scope}`,
      hourly: `email_signin_hourly:${scope}`,
      legacyVerifier: `email_verification_code:${scope}`,
    };
  }

  /**
   * Reserves common Code/Link limits and supersedes the old OTP atomically.
   *
   * @param request the server-owned request identity and timestamp.
   * @returns whether the request was admitted for enqueue.
   * @throws if Redis is unavailable.
   */
  public static async admit(request: EmailSigninRequestData): Promise<boolean> {
    if (!this.isValid(request)) {
      return false;
    }
    const keys = this.getKeys(request.teamId, request.email);
    const result = await Redis.defaultClient.eval(
      `local time = redis.call('TIME')
       local now = tonumber(time[1]) * 1000.0 + math.floor(tonumber(time[2]) / 1000)
       local remaining = tonumber(ARGV[2]) - now
       if remaining <= 0 or redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
       if tonumber(redis.call('GET', KEYS[2]) or '0') >= 5 then return 0 end
       local count = redis.call('INCR', KEYS[2])
       if count == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[4]) end
       redis.call('SET', KEYS[1], '1', 'PX', ARGV[3])
       redis.call('SET', KEYS[3], ARGV[1], 'PX', remaining)
       redis.call('DEL', KEYS[4], KEYS[5], KEYS[6])
       return 1`,
      6,
      keys.cooldown,
      keys.hourly,
      keys.latest,
      keys.verifier,
      keys.attempts,
      keys.legacyVerifier,
      request.requestId,
      this.getDeadline(request.requestedAt),
      Minute.ms,
      Hour.ms
    );
    return result === 1;
  }

  /**
   * Checks the worker-only latest-request and absolute deadline guard.
   *
   * @param request the queued request identity.
   * @returns whether this worker may still generate or publish credentials.
   * @throws if Redis is unavailable.
   */
  public static async isCurrent(
    request: EmailSigninRequestData
  ): Promise<boolean> {
    if (!this.isValid(request)) {
      return false;
    }
    const result = await Redis.defaultClient.eval(
      `local time = redis.call('TIME')
       local now = tonumber(time[1]) * 1000.0 + math.floor(tonumber(time[2]) / 1000)
       if now >= tonumber(ARGV[2]) then return 0 end
       if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
       return 1`,
      1,
      this.getKeys(request.teamId, request.email).latest,
      request.requestId,
      this.getDeadline(request.requestedAt)
    );
    return result === 1;
  }

  /**
   * Retires only the matching request, preserving any newer worker pointer.
   *
   * @param request the request being completed or abandoned.
   * @returns whether its pointer was removed.
   * @throws if Redis is unavailable.
   */
  public static async clear(request: EmailSigninRequestData): Promise<boolean> {
    if (!this.isValid(request)) {
      return false;
    }
    const result = await Redis.defaultClient.eval(
      `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
       return redis.call('DEL', KEYS[1])`,
      1,
      this.getKeys(request.teamId, request.email).latest,
      request.requestId
    );
    return result === 1;
  }

  /**
   * Validates metadata before a worker or script uses it.
   *
   * @param request the queued metadata to validate.
   * @returns whether the metadata contains a bounded, live request identity.
   */
  public static isValid(request: EmailSigninRequestData): boolean {
    const now = Date.now();
    return (
      typeof request.teamId === "string" &&
      request.teamId.length > 0 &&
      typeof request.email === "string" &&
      request.email.trim().length > 0 &&
      typeof request.requestId === "string" &&
      request.requestId.length > 0 &&
      request.requestId.length <= 128 &&
      Number.isSafeInteger(request.requestedAt) &&
      request.requestedAt > 0 &&
      request.requestedAt <= now + this.clockSkewTolerance &&
      this.getDeadline(request.requestedAt) > now
    );
  }
}
