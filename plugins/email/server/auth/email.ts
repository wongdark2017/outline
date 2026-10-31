import { randomUUID } from "node:crypto";
import Router from "@koa/router";
import {
  Client,
  EmailSigninMethod,
  NotificationEventType,
} from "@shared/types";
import InviteAcceptedEmail from "@server/emails/templates/InviteAcceptedEmail";
import SigninEmail from "@server/emails/templates/SigninEmail";
import WelcomeEmail from "@server/emails/templates/WelcomeEmail";
import { AuthorizationError } from "@server/errors";
import Logger from "@server/logging/Logger";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import validate from "@server/middlewares/validate";
import { User, Team } from "@server/models";
import type { APIContext } from "@server/types";
import { EmailSigninRequest } from "@server/utils/EmailSigninRequest";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { VerificationCode } from "@server/utils/VerificationCode";
import { signIn } from "@server/utils/authentication";
import { getTokenFromCookie } from "@server/utils/csrf";
import { createEmailSigninError } from "@server/utils/emailSigninRedaction";
import { getUserForEmailSigninToken } from "@server/utils/jwt";
import { getTeamFromContext } from "@server/utils/passport";
import * as T from "./schema";
import { CSRF } from "@shared/constants";

const router = new Router();

router.post(
  "email",
  rateLimiter(RateLimiterStrategy.TenPerHour),
  validate(T.EmailSchema),
  async (ctx: APIContext<T.EmailReq>) => {
    const { email, client, preferOTP } = ctx.input.body;

    const requestedAt = Date.now();
    const method = preferOTP ? EmailSigninMethod.Code : EmailSigninMethod.Link;
    const normalizedEmail = email.trim().toLowerCase();
    const contextTeam = await getTeamFromContext(ctx, {
      includeOAuthState: false,
    });
    const team = contextTeam
      ? await Team.scope("withAuthenticationProviders").findByPk(contextTeam.id)
      : null;

    if (!team?.emailSigninEnabled) {
      throw AuthorizationError();
    }

    const user = await User.scope("withAuthentications").findOne({
      where: {
        teamId: team.id,
        email: normalizedEmail,
      },
    });

    const response = { success: true, method, requestedAt };
    if (!user || user.isSuspended || team.isSuspended) {
      ctx.body = response;
      return;
    }

    // If the user matches an email address associated with an SSO
    // provider then just forward them directly to that sign-in page
    if (user.authentications.length) {
      const authenticationProvider =
        user.authentications[0].authenticationProvider;
      ctx.body = {
        redirect: `${team.url}/auth/${authenticationProvider?.name}`,
      };
      return;
    }

    const request = {
      teamId: team.id,
      email: normalizedEmail,
      requestId: randomUUID(),
      requestedAt,
    };

    try {
      if (await EmailSigninRequest.admit(request)) {
        await new SigninEmail({
          userId: user.id,
          teamId: team.id,
          to: normalizedEmail,
          language: user.language,
          client,
          method,
          requestId: request.requestId,
          requestedAt,
          requestIp: ctx.request.ip,
          userAgent: ctx.get("user-agent").slice(0, 512),
        }).schedule();
      }
    } catch (error) {
      // Cleanup must never erase a request admitted by another interface call.
      try {
        await EmailSigninRequest.clear(request);
      } catch {
        Logger.warn("Sign-in request cleanup unavailable");
      }
      const safeError = createEmailSigninError("queue", error);
      Logger.warn("Sign-in email could not be queued", {
        reason: safeError.message,
        name: safeError.name,
        code: safeError.code,
        responseCode: safeError.responseCode,
        command: safeError.command,
      });
    }

    ctx.body = response;
  }
);

const emailCallback = async (ctx: APIContext<T.EmailCallbackReq>) => {
  const { query, body } = ctx.input;
  const token = query.token || body.token;
  const client = query.client || body.client || Client.Web;
  const follow = query.follow || body.follow;
  const code = body.code?.replace(/\s/g, "");
  const email = body.email?.trim().toLowerCase();
  const hasQueryCode = query.code !== undefined || query.email !== undefined;
  const hasToken = query.token !== undefined || body.token !== undefined;
  const hasBodyCode = body.code !== undefined || body.email !== undefined;
  const ambiguousToken = query.token !== undefined && body.token !== undefined;

  if (
    hasQueryCode ||
    ambiguousToken ||
    (hasBodyCode && (ctx.method !== "POST" || hasToken)) ||
    (hasBodyCode && (!code || !/^\d{6}$/.test(code) || !email)) ||
    (!hasBodyCode && !token)
  ) {
    return ctx.redirect("/?notice=invalid-code");
  }

  // The link in the email does not include the follow query param, this
  // is to help prevent anti-virus, and email clients from pre-fetching the link
  // and spending the token before the user clicks on it. Instead we redirect
  // to the same URL with the follow query param added from the client side.
  if (token && !follow) {
    const csrfToken = getTokenFromCookie(ctx);

    // Parse the current URL to extract existing query parameters
    const url = new URL(ctx.request.href);
    const searchParams = url.searchParams;

    // Add new parameters
    searchParams.set("follow", "true");
    if (csrfToken) {
      searchParams.set(CSRF.fieldName, csrfToken);
    }

    // Reconstruct the URL with merged parameters
    url.search = searchParams.toString();

    return ctx.redirectOnClient(url.toString(), "POST");
  }

  let user: User | null = null;

  try {
    if (token) {
      user = await getUserForEmailSigninToken(ctx, token);
    } else if (code && email) {
      const team = await getTeamFromContext(ctx, { includeOAuthState: false });

      if (!team) {
        ctx.redirect("/?notice=invalid-code");
        return;
      }

      if (!(await VerificationCode.verify(team.id, email, code))) {
        return ctx.redirect("/?notice=invalid-code");
      }

      user = await User.scope(["withTeam", "withAuthentications"]).findOne({
        where: {
          teamId: team.id,
          email: email.trim().toLowerCase(),
        },
      });

      if (!user || user.authentications.length > 0) {
        return ctx.redirect("/?notice=invalid-code");
      }
    } else {
      ctx.redirect("/?notice=auth-error&description=Missing%20token");
      return;
    }
  } catch (error) {
    const safeError = createEmailSigninError("callback", error);
    Logger.debug("authentication", safeError.message, {
      name: safeError.name,
      code: safeError.code,
      responseCode: safeError.responseCode,
      command: safeError.command,
    });
    if (token && error instanceof Error) {
      if (error.message === "Disabled signin method") {
        return ctx.redirect(
          "/?notice=auth-error&description=Disabled%20signin%20method"
        );
      }
      if (error.message === "User suspended") {
        return ctx.redirect("/?notice=user-suspended");
      }
      if (error.message === "Team suspended") {
        return ctx.redirect("/?notice=team-suspended");
      }
    }
    return ctx.redirect("/?notice=invalid-code");
  }

  if (!user) {
    return ctx.redirect(`/?notice=invalid-code`);
  }

  if (!user.team.emailSigninEnabled) {
    return ctx.redirect(
      "/?notice=auth-error&description=Disabled%20signin%20method"
    );
  }

  if (user.team.isSuspended) {
    return ctx.redirect("/?notice=team-suspended");
  }
  if (user.isSuspended) {
    return ctx.redirect("/?notice=user-suspended");
  }

  if (user.isInvited) {
    await new WelcomeEmail({
      to: user.email,
      language: user.language,
      role: user.role,
      teamUrl: user.team.url,
    }).schedule();

    const inviter = await user.$get("invitedBy");
    if (inviter?.subscribedToEventType(NotificationEventType.InviteAccepted)) {
      await new InviteAcceptedEmail({
        to: inviter.email,
        language: inviter.language,
        inviterId: inviter.id,
        invitedName: user.name,
        teamUrl: user.team.url,
      }).schedule();
    }
  }

  // set cookies on response and redirect to team subdomain
  await signIn(ctx, "email", {
    user,
    team: user.team,
    isNewTeam: false,
    isNewUser: false,
    client,
  });
};
router.register(
  "email.callback",
  ["get", "post"],
  [
    rateLimiter(RateLimiterStrategy.FivePerMinute),
    validate(T.EmailCallbackSchema),
    emailCallback,
  ]
);

export default router;
