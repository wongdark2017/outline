import { Transaction } from "sequelize";

export interface ScriptLogger {
  error: (message?: unknown, ...optionalParams: unknown[]) => void;
  log: (message?: unknown, ...optionalParams: unknown[]) => void;
}

function getArgValue(args: string[], name: string) {
  const argument = args
    .filter((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`))
    .map((arg) => arg.split("=")[1] ?? "true")
    .map((arg) => arg.trim())
    .join(",");

  return argument || undefined;
}

function requireArg(args: string[], name: string) {
  const value = getArgValue(args, name);

  if (!value) {
    throw new Error(`Missing required argument --${name}`);
  }

  return value;
}

/**
 * Set or reset a user's password in a specific team.
 *
 * @param args command line arguments without the node/script prefix.
 * @param logger logger used for status output.
 * @returns promise that resolves when the password has been updated.
 */
export async function main(
  args: string[] = process.argv.slice(2),
  logger: ScriptLogger = console
) {
  if (process.env.NODE_ENV !== "test") {
    await import("./bootstrap");
  }

  const [{ Event, User }, { sequelize }] = await Promise.all([
    import("@server/models"),
    import("@server/storage/database"),
  ]);
  const teamId = requireArg(args, "team-id");
  const email = requireArg(args, "email").trim().toLowerCase();
  const password = requireArg(args, "password");
  const actorId = getArgValue(args, "actor-id");

  const user = await User.findOne({
    where: {
      teamId,
      email,
    },
  });

  if (!user) {
    throw new Error("User not found for the provided team and email");
  }

  const newHash = await User.hashPassword(password);

  await sequelize.transaction(async (transaction) => {
    const lockedUser = await User.findByPk(user.id, {
      transaction,
      lock: Transaction.LOCK.UPDATE,
    });

    if (!lockedUser) {
      throw new Error("User not found or was deleted");
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
    await Event.create(
      {
        name: "users.update",
        userId: lockedUser.id,
        actorId: actorId ?? null,
        teamId: lockedUser.teamId,
        data: {
          passwordChanged: true,
          viaCliScript: true,
        },
      },
      {
        transaction,
      }
    );
  });

  logger.log(`Password updated for ${email} in team ${teamId}`);
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
