import crypto from "node:crypto";
import { addMinutes, addMonths, addSeconds, subMinutes } from "date-fns";
import JWT, { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";
import Router from "koa-router";
import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";
import { z } from "zod";
import { Client, NotificationEventType } from "@shared/types";
import { parseDomain } from "@shared/utils/domains";
import coreEnv from "@server/env";
import {
  AuthenticationError,
  NotFoundError,
  RateLimitExceededError,
  ServiceUnavailableError,
  ValidationError,
} from "@server/errors";
import Logger from "@server/logging/Logger";
import { parseAuthentication } from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import { Event, Team, User } from "@server/models";
import { sequelize } from "@server/storage/database";
import Redis from "@server/storage/redis";
import type { APIContext } from "@server/types";
import { AuthenticationType } from "@server/types";
import { signIn } from "@server/utils/authentication";
import { getJWTPayload } from "@server/utils/jwt";
import { getTeamFromContext } from "@server/utils/passport";
import * as T from "./schema";
import env from "../env";
import { PasswordResetEmail } from "../email/PasswordResetEmail";
import InviteAcceptedEmail from "@server/emails/templates/InviteAcceptedEmail";

const limiterCache = new Map<string, RateLimiterRedis>();

const PASSWORD_LOCK_THRESHOLD = 5;
const PASSWORD_LOCK_MINUTES = 15;
const PASSWORD_RESET_EXPIRY_MINUTES = 15;
const PASSWORD_LOGIN_PRETEAM_LIMIT = { requests: 75, duration: 3600 };
const PASSWORD_LOGIN_LIMITS = {
  ip: 25,
  teamEmail: 10,
  ipTeamEmail: 10,
  duration: 3600,
};
const PASSWORD_RESET_PRETEAM_LIMIT = { requests: 60, duration: 3600 };
const PASSWORD_RESET_LIMITS = {
  ip: 20,
  teamEmail: 5,
  ipTeamEmail: 5,
  duration: 3600,
};

class ResetTokenConsumedError extends Error {}

const PasswordResetPayloadSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  type: z.literal("password-reset"),
  createdAt: z.string(),
  jti: z.string(),
});

const PasswordActivationPayloadSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  type: z.literal("password-activation"),
  createdAt: z.string(),
  jti: z.string(),
});

interface ResetContext {
  kind: "reset";
  jtiKey: string;
  payload: z.infer<typeof PasswordResetPayloadSchema>;
  resetToken: string;
  user: User;
}

interface ActivationContext {
  kind: "activation";
  jtiKey: string;
  payload: z.infer<typeof PasswordActivationPayloadSchema>;
  activationToken: string;
  user: User;
}

interface LoginContext {
  kind: "login";
  currentPassword: string;
  expires: Date;
  user: User;
}

type PasswordUpdateContext = ResetContext | ActivationContext | LoginContext;

function assertPasswordAuthEnabled() {
  if (!env.PASSWORD_AUTH_ENABLED || coreEnv.isCloudHosted) {
    throw NotFoundError();
  }
}

function getLimiter(name: string, requests: number, duration: number) {
  const key = `${name}:${requests}:${duration}`;
  const existing = limiterCache.get(key);

  if (existing) {
    return existing;
  }

  const points = Math.max(
    1,
    Math.round(requests * coreEnv.RATE_LIMITER_MULTIPLIER)
  );
  const limiter = new RateLimiterRedis({
    storeClient: Redis.defaultClient,
    points,
    duration,
    keyPrefix: `password:${name}`,
    insuranceLimiter: new RateLimiterMemory({
      points,
      duration,
    }),
  });

  limiterCache.set(key, limiter);

  return limiter;
}

function setRateLimitHeaders(
  ctx: APIContext,
  limiter: RateLimiterRedis,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any
) {
  ctx.set("Retry-After", `${response.msBeforeNext / 1000}`);
  ctx.set("RateLimit-Limit", `${limiter.points}`);
  ctx.set("RateLimit-Remaining", `${response.remainingPoints}`);
  ctx.set(
    "RateLimit-Reset",
    new Date(Date.now() + response.msBeforeNext).toString()
  );
}

async function consumeLimiter(
  ctx: APIContext,
  limiter: RateLimiterRedis,
  key: string,
  options?: {
    failOpen?: boolean;
  }
) {
  try {
    await limiter.consume(key);
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = err as any;

    if (response?.msBeforeNext) {
      setRateLimitHeaders(ctx, limiter, response);
      throw RateLimitExceededError();
    }

    Logger.error("password rate limiter error", err);

    if (options?.failOpen) {
      return;
    }
  }
}

function hmacEmail(email: string) {
  return crypto
    .createHmac("sha256", coreEnv.SECRET_KEY)
    .update(email)
    .digest("hex");
}

async function getTeamForRequest(ctx: APIContext) {
  const requestDomain = parseDomain(ctx.request.hostname);
  let team = null;

  if (requestDomain.custom) {
    team = await Team.findByDomain(requestDomain.host);
  } else if (requestDomain.teamSubdomain) {
    team = await Team.findBySubdomain(requestDomain.teamSubdomain);
  }

  if (!team) {
    team = await getTeamFromContext(ctx, {
      includeOAuthState: false,
    });
  }

  if (!team) {
    return null;
  }

  return Team.scope("withAuthenticationProviders").findByPk(team.id);
}

function redirectToNotice(ctx: APIContext, team: Team, notice: string) {
  ctx.redirect(`${team.url}/?notice=${notice}`);
}

function isEmailServiceAvailable() {
  return coreEnv.EMAIL_ENABLED && !!coreEnv.SMTP_FROM_EMAIL;
}

async function consumePasswordPreTeamLimiter(
  ctx: APIContext,
  type: "login" | "reset"
) {
  const config =
    type === "login"
      ? PASSWORD_LOGIN_PRETEAM_LIMIT
      : PASSWORD_RESET_PRETEAM_LIMIT;
  const limiter = getLimiter(
    `${type}-preteam`,
    config.requests,
    config.duration
  );

  await consumeLimiter(ctx, limiter, `${type}:${ctx.request.ip}`, {
    failOpen: true,
  });
}

async function consumePasswordScopedLimiters(
  ctx: APIContext,
  type: "login" | "reset",
  teamId: string,
  email: string
) {
  const config =
    type === "login" ? PASSWORD_LOGIN_LIMITS : PASSWORD_RESET_LIMITS;
  const emailKey = `${teamId}:${hmacEmail(email)}`;
  const limiters = [
    {
      limiter: getLimiter(`${type}-ip`, config.ip, config.duration),
      key: ctx.request.ip,
    },
    {
      limiter: getLimiter(
        `${type}-team-email`,
        config.teamEmail,
        config.duration
      ),
      key: emailKey,
    },
    {
      limiter: getLimiter(
        `${type}-ip-team-email`,
        config.ipTeamEmail,
        config.duration
      ),
      key: `${ctx.request.ip}:${emailKey}`,
    },
  ];

  for (const entry of limiters) {
    await consumeLimiter(ctx, entry.limiter, entry.key);
  }
}

export function createPasswordRouter() {
  const router = new Router();

  router.post(
    "password",
    validate(T.PasswordSchema),
    async (ctx: APIContext<T.PasswordReq>) => {
      assertPasswordAuthEnabled();

      const {
        email: rawEmail,
        password = "",
        client,
      } = ctx.input.body;
      const email = rawEmail?.trim().toLowerCase();

      if (!email) {
        throw ValidationError("Email is required");
      }

      await consumePasswordPreTeamLimiter(ctx, "login");

      const team = await getTeamForRequest(ctx);
      if (!team) {
        throw NotFoundError();
      }

      if (team.isSuspended) {
        redirectToNotice(ctx, team, "team-suspended");
        return;
      }

      await consumePasswordScopedLimiters(ctx, "login", team.id, email);

      const user = await User.findOne({
        where: {
          teamId: team.id,
          email,
        },
      });

      if (!user) {
        const missingUser = User.build();
        missingUser.passwordHash = null;
        await missingUser.verifyPassword(password);

        redirectToNotice(ctx, team, "password-auth-failed");
        return;
      }

      if (user.isSuspended) {
        redirectToNotice(ctx, team, "user-suspended");
        return;
      }

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        redirectToNotice(ctx, team, "password-locked");
        return;
      }

      const verified = await user.verifyPassword(password);
      if (!verified) {
        await User.increment("failedSignInAttempts", {
          where: {
            id: user.id,
          },
        });
        await user.reload({
          attributes: ["failedSignInAttempts"],
        });

        if (user.failedSignInAttempts >= PASSWORD_LOCK_THRESHOLD) {
          await User.update(
            {
              lockedUntil: addMinutes(new Date(), PASSWORD_LOCK_MINUTES),
            },
            {
              where: {
                id: user.id,
              },
            }
          );

          redirectToNotice(ctx, team, "password-locked");
          return;
        }

        redirectToNotice(ctx, team, "password-auth-failed");
        return;
      }

      await User.update(
        {
          failedSignInAttempts: 0,
          lockedUntil: null,
        },
        {
          where: {
            id: user.id,
          },
        }
      );

      const resolvedClient =
        client === Client.Desktop ? Client.Desktop : Client.Web;

      await signIn(ctx, "password", {
        user,
        team,
        client: resolvedClient,
        isNewTeam: false,
        isNewUser: false,
      });
    }
  );

  router.post(
    "password/reset",
    validate(T.PasswordResetSchema),
    async (ctx: APIContext<T.PasswordResetReq>) => {
      assertPasswordAuthEnabled();

      const email = ctx.input.body.email?.trim().toLowerCase();

      if (!email) {
        throw ValidationError("Email is required");
      }

      await consumePasswordPreTeamLimiter(ctx, "reset");

      const team = await getTeamForRequest(ctx);
      if (!team) {
        throw NotFoundError();
      }

      if (!isEmailServiceAvailable()) {
        throw ServiceUnavailableError("Email service unavailable");
      }

      await consumePasswordScopedLimiters(ctx, "reset", team.id, email);

      const user = await User.findOne({
        where: {
          teamId: team.id,
          email,
        },
      });

      if (user) {
        const { token, jti } = user.getPasswordResetToken();
        const resetUrl = `${team.url}/reset-password?token=${encodeURIComponent(
          token
        )}`;

        await Redis.defaultClient.set(
          `password-reset:jti:${jti}`,
          JSON.stringify({
            userId: user.id,
            teamId: user.teamId,
          }),
          "EX",
          PASSWORD_RESET_EXPIRY_MINUTES * 60
        );

        await new PasswordResetEmail({
          to: user.email,
          language: user.language,
          resetUrl,
          teamUrl: team.url,
        }).schedule();
      }

      ctx.body = {
        success: true,
      };
    }
  );

  router.post(
    "password/update",
    validate(T.PasswordUpdateSchema),
    async (ctx: APIContext<T.PasswordUpdateReq>) => {
      assertPasswordAuthEnabled();

      const team = await getTeamForRequest(ctx);
      if (!team) {
        throw NotFoundError();
      }

      const {
        currentPassword,
        password = "",
        resetToken,
        activationToken,
      } = ctx.input.body;

      const updatePathCount =
        Number(resetToken !== undefined) +
        Number(activationToken !== undefined) +
        Number(currentPassword !== undefined);

      if (updatePathCount !== 1) {
        throw ValidationError(
          "Provide exactly one of resetToken, activationToken or currentPassword"
        );
      }

      let updateContext: PasswordUpdateContext;

      if (resetToken !== undefined) {
        const token = resetToken;

        try {
          let payloadInput: unknown;

          try {
            payloadInput = getJWTPayload(token);
          } catch {
            throw new ResetTokenConsumedError();
          }

          const parsedPayload = PasswordResetPayloadSchema.safeParse(payloadInput);
          if (!parsedPayload.success) {
            throw new ResetTokenConsumedError();
          }

          const payload = parsedPayload.data;
          const createdAt = new Date(payload.createdAt);

          if (
            !Number.isFinite(createdAt.getTime()) ||
            createdAt > addSeconds(new Date(), 60) ||
            createdAt < subMinutes(new Date(), PASSWORD_RESET_EXPIRY_MINUTES)
          ) {
            throw new ResetTokenConsumedError();
          }

          if (payload.teamId !== team.id) {
            throw new ResetTokenConsumedError();
          }

          const user = await User.findOne({
            where: {
              id: payload.id,
              teamId: team.id,
            },
          });

          if (!user) {
            throw new ResetTokenConsumedError();
          }

          try {
            JWT.verify(token, user.jwtSecret);
          } catch {
            throw new ResetTokenConsumedError();
          }

          updateContext = {
            kind: "reset",
            jtiKey: `password-reset:jti:${payload.jti}`,
            payload,
            resetToken: token,
            user,
          };
        } catch (err) {
          if (err instanceof ResetTokenConsumedError) {
            redirectToNotice(ctx, team, "expired-token");
            return;
          }

          throw err;
        }
      } else if (activationToken !== undefined) {
        const token = activationToken;

        try {
          let payloadInput: unknown;

          try {
            payloadInput = getJWTPayload(token);
          } catch {
            throw new ResetTokenConsumedError();
          }

          const parsedPayload =
            PasswordActivationPayloadSchema.safeParse(payloadInput);
          if (!parsedPayload.success) {
            throw new ResetTokenConsumedError();
          }

          const payload = parsedPayload.data;
          const createdAt = new Date(payload.createdAt);

          if (
            !Number.isFinite(createdAt.getTime()) ||
            createdAt > addSeconds(new Date(), 60) ||
            createdAt < subMinutes(new Date(), PASSWORD_RESET_EXPIRY_MINUTES)
          ) {
            throw new ResetTokenConsumedError();
          }

          if (payload.teamId !== team.id) {
            throw new ResetTokenConsumedError();
          }

          const user = await User.findOne({
            where: {
              id: payload.id,
              teamId: team.id,
            },
          });

          if (!user || !user.isInvited || user.passwordHash) {
            throw new ResetTokenConsumedError();
          }

          try {
            JWT.verify(token, user.jwtSecret);
          } catch {
            throw new ResetTokenConsumedError();
          }

          updateContext = {
            kind: "activation",
            jtiKey: `password-activation:jti:${payload.jti}`,
            payload,
            activationToken: token,
            user,
          };
        } catch (err) {
          if (err instanceof ResetTokenConsumedError) {
            redirectToNotice(ctx, team, "expired-token");
            return;
          }

          throw err;
        }
      } else if (currentPassword !== undefined) {
        const { transport } = parseAuthentication(ctx);
        const authenticatedUser = ctx.state.auth?.user;

        if (
          !authenticatedUser ||
          ctx.state.auth?.type !== AuthenticationType.APP
        ) {
          throw AuthenticationError("Authentication required");
        }

        if (transport !== "cookie") {
          throw AuthenticationError("Cookie authentication required");
        }

        const verified = await authenticatedUser.verifyPassword(currentPassword);
        if (!verified) {
          throw ValidationError("Current password is incorrect");
        }

        updateContext = {
          kind: "login",
          currentPassword,
          expires: addMonths(new Date(), 3),
          user: authenticatedUser,
        };
      } else {
        throw ValidationError(
          "Provide exactly one of resetToken, activationToken or currentPassword"
        );
      }

      if (
        updateContext.kind === "reset" ||
        updateContext.kind === "activation"
      ) {
        try {
          const exists = await Redis.defaultClient.exists(updateContext.jtiKey);
          if (!exists) {
            redirectToNotice(ctx, team, "expired-token");
            return;
          }
        } catch {
          // Cost-avoidance only, continue to authoritative GETDEL.
        }
      }

      const newHash = await User.hashPassword(password);

      try {
        const result = await sequelize.transaction(
          async (transaction) => {
            const lockedUser = await User.findByPk(updateContext.user.id, {
              transaction,
              lock: transaction.LOCK.UPDATE,
            });

            if (!lockedUser) {
              if (
                updateContext.kind === "reset" ||
                updateContext.kind === "activation"
              ) {
                throw new ResetTokenConsumedError();
              }

              throw AuthenticationError("User not found");
            }

            if (
              updateContext.kind === "reset" ||
              updateContext.kind === "activation"
            ) {
              try {
                JWT.verify(
                  updateContext.kind === "reset"
                    ? updateContext.resetToken
                    : updateContext.activationToken,
                  lockedUser.jwtSecret
                );
              } catch {
                throw new ResetTokenConsumedError();
              }

              const consumed = await Redis.defaultClient.getdel(
                updateContext.jtiKey
              );
              if (!consumed) {
                throw new ResetTokenConsumedError();
              }

              let jtiState: unknown;

              try {
                jtiState = JSON.parse(consumed);
              } catch {
                throw new ResetTokenConsumedError();
              }

              const parsedState = z
                .object({
                  teamId: z.string(),
                  userId: z.string(),
                })
                .safeParse(jtiState);

              if (
                !parsedState.success ||
                parsedState.data.userId !== updateContext.payload.id ||
                parsedState.data.teamId !== updateContext.payload.teamId
              ) {
                throw new ResetTokenConsumedError();
              }

              if (
                updateContext.kind === "activation" &&
                (!lockedUser.isInvited || !!lockedUser.passwordHash)
              ) {
                throw new ResetTokenConsumedError();
              }
            } else {
              const verified = await lockedUser.verifyPassword(
                updateContext.currentPassword
              );

              if (!verified) {
                throw ValidationError("Current password is incorrect");
              }
            }

            lockedUser.passwordHash = newHash;
            lockedUser.failedSignInAttempts = 0;
            lockedUser.lockedUntil = null;
            await lockedUser.save({
              transaction,
              hooks: false,
            });
            await lockedUser.rotateJwtSecret({
              transaction,
            });

            if (updateContext.kind === "reset") {
              await Event.create(
                {
                  name: "users.update",
                  userId: lockedUser.id,
                  actorId: lockedUser.id,
                  teamId: lockedUser.teamId,
                  ip: ctx.request.ip,
                  authType: null,
                  data: {
                    passwordChanged: true,
                  },
                },
                {
                  transaction,
                }
              );

              return null;
            }

            if (updateContext.kind === "activation") {
              await Event.create(
                {
                  name: "users.invite_accepted",
                  userId: lockedUser.id,
                  actorId: lockedUser.id,
                  teamId: lockedUser.teamId,
                  ip: ctx.request.ip,
                  authType: null,
                },
                {
                  transaction,
                }
              );

              return lockedUser;
            }

            await Event.createFromContext(
              ctx,
              {
                name: "users.update",
                userId: lockedUser.id,
                data: {
                  passwordChanged: true,
                },
              },
              {
                actorId: lockedUser.id,
                teamId: lockedUser.teamId,
              },
              {
                transaction,
              }
            );

            return lockedUser.getSessionToken(updateContext.expires, "password");
          }
        );

        if (updateContext.kind === "reset") {
          redirectToNotice(ctx, team, "password-updated");
          return;
        }

        if (updateContext.kind === "activation") {
          if (!(result instanceof User)) {
            throw ValidationError("Failed to activate user");
          }

          const inviter = await result.$get("invitedBy");
          if (inviter?.subscribedToEventType(NotificationEventType.InviteAccepted)) {
            await new InviteAcceptedEmail({
              to: inviter.email,
              language: inviter.language,
              inviterId: inviter.id,
              invitedName: result.name,
              teamUrl: team.url,
            }).schedule();
          }

          await signIn(ctx, "password", {
            user: result,
            team,
            client: Client.Web,
            isNewTeam: false,
            isNewUser: false,
          });
          return;
        }

        if (!result || typeof result !== "string") {
          throw ValidationError("Failed to generate session token");
        }

        ctx.cookies.set("accessToken", result, {
          sameSite: "lax",
          expires:
            updateContext.kind === "login"
              ? updateContext.expires
              : addMonths(new Date(), 3),
        });

        ctx.body = {
          success: true,
        };
      } catch (err) {
        if (
          (updateContext.kind === "reset" ||
            updateContext.kind === "activation") &&
          (err instanceof ResetTokenConsumedError ||
            err instanceof JsonWebTokenError ||
            err instanceof TokenExpiredError)
        ) {
          redirectToNotice(ctx, team, "expired-token");
          return;
        }

        throw err;
      }
    }
  );

  return router;
}

const router = createPasswordRouter();

export default router;
