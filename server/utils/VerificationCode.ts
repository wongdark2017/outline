import { createHmac, randomInt } from "node:crypto";
import { Day } from "@shared/utils/time";
import env from "@server/env";
import Redis from "@server/storage/redis";
import { EmailSigninRequest } from "./EmailSigninRequest";
import type { EmailSigninRequestData } from "./EmailSigninRequest";

/** Safe, bounded outcomes from atomic verifier publication. */
export type VerificationCodePublishResult =
  | { published: true }
  | {
      published: false;
      reason:
        | "invalid_request"
        | "superseded_or_expired"
        | "attempts_exhausted"
        | "daily_locked";
    };

/** Manages HMAC-only email codes and atomic, single-use verification. */
export class VerificationCode {
  /**
   * Generates a uniformly distributed, zero-padded six-digit code.
   *
   * @returns the transient code to render in an email.
   */
  public static generate(): string {
    return randomInt(0, 1000000).toString().padStart(6, "0");
  }

  /**
   * Publishes a verifier only while its request remains current and usable.
   *
   * @param request the admitted server-owned request.
   * @param code the transient code, hashed before any Redis operation.
   * @returns the publication outcome, including a safe reason when skipped.
   * @throws if Redis is unavailable.
   */
  public static async publish(
    request: EmailSigninRequestData,
    code: string
  ): Promise<VerificationCodePublishResult> {
    if (!EmailSigninRequest.isValid(request) || !/^\d{6}$/.test(code)) {
      return { published: false, reason: "invalid_request" };
    }
    const keys = EmailSigninRequest.getKeys(request.teamId, request.email);
    const deadline = EmailSigninRequest.getDeadline(request.requestedAt);
    const result = await Redis.defaultClient.eval(
      `local time = redis.call('TIME')
       local now = tonumber(time[1]) * 1000.0 + math.floor(tonumber(time[2]) / 1000)
       local remaining = tonumber(ARGV[2]) - now
       if remaining <= 0 or redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
       if tonumber(redis.call('GET', KEYS[4]) or '0') >= 30 then return -1 end
       if tonumber(redis.call('GET', KEYS[3]) or '0') >= 5 then return -2 end
       redis.call('DEL', KEYS[2])
       redis.call('HSET', KEYS[2], 'version', '1', 'hmac', ARGV[3], 'requestId', ARGV[1], 'deadline', ARGV[2])
       redis.call('PEXPIRE', KEYS[2], remaining)
       local attemptsTTL = redis.call('PTTL', KEYS[3])
       if attemptsTTL >= 0 and attemptsTTL < remaining then
         redis.call('PEXPIRE', KEYS[3], remaining)
       end
       return 1`,
      4,
      keys.latest,
      keys.verifier,
      keys.attempts,
      keys.failures,
      request.requestId,
      deadline,
      this.digest(request.teamId, request.email, code)
    );
    switch (result) {
      case 1:
        return { published: true };
      case 0:
        return { published: false, reason: "superseded_or_expired" };
      case -1:
        return { published: false, reason: "daily_locked" };
      case -2:
        return { published: false, reason: "attempts_exhausted" };
      default:
        throw new Error("Invalid email sign-in publication result");
    }
  }

  /**
   * Checks and consumes the current verifier in one Redis operation.
   *
   * @param teamId the workspace identifier.
   * @param email the recipient email address.
   * @param code the candidate code, HMACed locally before Redis receives it.
   * @returns whether this attempt consumed a valid code.
   * @throws if Redis is unavailable.
   */
  public static async verify(
    teamId: string,
    email: string,
    code: string
  ): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) {
      return false;
    }
    const keys = EmailSigninRequest.getKeys(teamId, email);
    const result = await Redis.defaultClient.eval(
      `if tonumber(redis.call('GET', KEYS[4]) or '0') >= 30 then return 0 end
       local time = redis.call('TIME')
       local now = tonumber(time[1]) * 1000.0 + math.floor(tonumber(time[2]) / 1000)
       local storedType = redis.call('TYPE', KEYS[1])
       if type(storedType) == 'table' then storedType = storedType.ok end
       local verifier = {}
       if storedType == 'hash' then
         verifier = redis.call('HMGET', KEYS[1], 'version', 'hmac', 'requestId', 'deadline')
       end
       local deadline = tonumber(verifier[4]) or 0
       local valid = verifier[1] == '1' and type(verifier[2]) == 'string'
         and string.len(verifier[2]) == 64 and type(verifier[3]) == 'string'
         and deadline > now
       local attempts = tonumber(redis.call('GET', KEYS[3]) or '0')
       if valid and attempts < 5 and verifier[2] == ARGV[1] then
         redis.call('DEL', KEYS[1])
         if redis.call('GET', KEYS[2]) == verifier[3] then
           redis.call('DEL', KEYS[2])
         end
         return 1
       end
       local failures = redis.call('INCR', KEYS[4])
       if failures == 1 then redis.call('PEXPIRE', KEYS[4], ARGV[2]) end
       if valid then
         attempts = redis.call('INCR', KEYS[3])
         local remaining = deadline - now
         local attemptsTTL = redis.call('PTTL', KEYS[3])
         if attemptsTTL < remaining then redis.call('PEXPIRE', KEYS[3], remaining) end
       end
       if not valid or attempts >= 5 or failures >= 30 then
         redis.call('DEL', KEYS[1])
       end
       return 0`,
      4,
      keys.verifier,
      keys.latest,
      keys.attempts,
      keys.failures,
      this.digest(teamId, email, code),
      Day.ms
    );
    return result === 1;
  }

  /**
   * Invalidates a verifier without replenishing active guess or failure budgets.
   *
   * @param teamId the workspace identifier.
   * @param email the recipient email address.
   * @returns whether a verifier was deleted.
   * @throws if Redis is unavailable.
   */
  public static async delete(teamId: string, email: string): Promise<boolean> {
    return (
      (await Redis.defaultClient.del(
        EmailSigninRequest.getKeys(teamId, email).verifier
      )) === 1
    );
  }

  /**
   * Checks fixed-window protection without extending the lock.
   *
   * @param teamId the workspace identifier.
   * @param email the recipient email address.
   * @returns whether the email's thirty-failure window is locked.
   * @throws if Redis is unavailable.
   */
  public static async isLocked(
    teamId: string,
    email: string
  ): Promise<boolean> {
    const count = await Redis.defaultClient.get(
      EmailSigninRequest.getKeys(teamId, email).failures
    );
    return Number(count ?? 0) >= 30;
  }

  /**
   * Domain-separates an HMAC by workspace and normalized recipient.
   *
   * @param teamId the workspace identifier.
   * @param email the recipient email address.
   * @param code the transient issued or candidate code.
   * @returns the hexadecimal verification digest.
   */
  private static digest(teamId: string, email: string, code: string): string {
    return createHmac("sha256", env.SECRET_KEY)
      .update(
        JSON.stringify([
          "email-signin-v1",
          teamId,
          email.trim().toLowerCase(),
          code,
        ])
      )
      .digest("hex");
  }
}
