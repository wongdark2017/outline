import JWT from "jsonwebtoken";
import { addMinutes } from "date-fns";
import { Event } from "@server/models";
import { buildTeam, buildUser } from "@server/test/factories";
import { main } from "./set-password";

describe("set-password script", () => {
  it("updates the password, clears lock state, rotates jwtSecret, and writes an audit event", async () => {
    const team = await buildTeam();
    const actor = await buildUser({
      teamId: team.id,
    });
    const user = await buildUser({
      teamId: team.id,
      email: "member@example.com",
    });
    await user.setPassword("old password value");
    user.failedSignInAttempts = 4;
    user.lockedUntil = addMinutes(new Date(), 10);
    await user.save({
      hooks: false,
    });
    const previousSecret = user.jwtSecret;
    const previousToken = user.getSessionToken();
    const logger = {
      error: vi.fn(),
      log: vi.fn(),
    };

    await main(
      [
        `--team-id=${team.id}`,
        `--email=${user.email}`,
        "--password=new password value",
        `--actor-id=${actor.id}`,
      ],
      logger
    );

    const reloaded = await user.reload();
    expect(await reloaded.verifyPassword("new password value")).toBe(true);
    expect(reloaded.failedSignInAttempts).toBe(0);
    expect(reloaded.lockedUntil).toBeNull();
    expect(reloaded.jwtSecret).not.toEqual(previousSecret);
    expect(() => JWT.verify(previousToken, reloaded.jwtSecret)).toThrow();

    const event = await Event.findLatest({
      name: "users.update",
      userId: user.id,
    });
    expect(event?.actorId).toBe(actor.id);
    expect(event?.teamId).toBe(team.id);
    expect(event?.data).toMatchObject({
      passwordChanged: true,
      viaCliScript: true,
    });
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("member@example.com")
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("updates only the matching team-scoped user when the same email exists in multiple teams", async () => {
    const email = "same@example.com";
    const teamA = await buildTeam();
    const teamB = await buildTeam();
    const userA = await buildUser({
      teamId: teamA.id,
      email,
    });
    const userB = await buildUser({
      teamId: teamB.id,
      email,
    });
    await userA.setPassword("old password value");
    await userA.save();
    await userB.setPassword("other password value");
    await userB.save();

    await main([
      `--team-id=${teamA.id}`,
      `--email=${email}`,
      "--password=new password value",
    ]);

    const reloadedA = await userA.reload();
    const reloadedB = await userB.reload();

    expect(await reloadedA.verifyPassword("new password value")).toBe(true);
    expect(await reloadedB.verifyPassword("other password value")).toBe(true);
  });

  it("fails with a controlled error when the user does not exist", async () => {
    const team = await buildTeam();

    await expect(
      main([
        `--team-id=${team.id}`,
        "--email=missing@example.com",
        "--password=new password value",
      ])
    ).rejects.toThrow("User not found for the provided team and email");
  });
});
