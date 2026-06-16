import JWT from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { User } from "@server/models";

describe("User password helpers", () => {
  it("hashes and verifies a password", async () => {
    const user = User.build({
      id: randomUUID(),
      teamId: randomUUID(),
      jwtSecret: "test-jwt-secret",
      email: "user@example.com",
      name: "Test User",
    });
    const password = "correct horse battery staple";

    await user.setPassword(password);

    expect(user.passwordHash).toBeTruthy();
    await expect(user.verifyPassword(password)).resolves.toBe(true);
    await expect(user.verifyPassword("wrong password")).resolves.toBe(false);
  });

  it("returns a password reset token with matching JWT payload and jti", async () => {
    const user = User.build({
      id: randomUUID(),
      teamId: randomUUID(),
      jwtSecret: "test-jwt-secret",
      email: "user@example.com",
      name: "Test User",
    });
    const { token, jti } = user.getPasswordResetToken();

    const payload = JWT.decode(token);
    expect(payload).toMatchObject({
      id: user.id,
      teamId: user.teamId,
      type: "password-reset",
      jti,
    });
    expect(typeof (payload as { createdAt?: unknown }).createdAt).toBe(
      "string"
    );
  });

  it("returns a password activation token with matching JWT payload and jti", async () => {
    const user = User.build({
      id: randomUUID(),
      teamId: randomUUID(),
      jwtSecret: "test-jwt-secret",
      email: "user@example.com",
      name: "Test User",
    });
    const { token, jti } = user.getPasswordActivationToken();

    const payload = JWT.decode(token);
    expect(payload).toMatchObject({
      id: user.id,
      teamId: user.teamId,
      type: "password-activation",
      jti,
    });
    expect(typeof (payload as { createdAt?: unknown }).createdAt).toBe(
      "string"
    );
  });

  it("returns false for verifyPassword when the user has no password", async () => {
    const user = User.build({
      id: randomUUID(),
      teamId: randomUUID(),
      jwtSecret: "test-jwt-secret",
      email: "user@example.com",
      name: "Test User",
    });

    user.passwordHash = null;

    await expect(user.verifyPassword("anything at all")).resolves.toBe(false);
  });
});
