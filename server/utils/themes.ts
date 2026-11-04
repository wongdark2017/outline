import type { Transaction } from "sequelize";
import { isUUID } from "validator";
import { ValidationError } from "@server/errors";
import { Theme } from "@server/models";

/**
 * Throws if any of the given values is a theme ID that does not belong to the
 * workspace. Values that are not UUIDs, such as ThemeChoice values, are
 * ignored.
 *
 * @param values theme preference values from a request.
 * @param teamId the workspace the themes must belong to.
 * @param transaction optional transaction to run the query in.
 * @throws {ValidationError} if a theme does not exist in the workspace.
 */
export async function assertThemesInTeam(
  values: Array<string | undefined>,
  teamId: string,
  transaction?: Transaction
): Promise<void> {
  const ids = [
    ...new Set(
      values.filter((value): value is string => !!value && isUUID(value))
    ),
  ];
  if (ids.length === 0) {
    return;
  }

  const count = await Theme.count({
    where: { id: ids, teamId },
    transaction,
  });
  if (count !== ids.length) {
    // Avoid the words "not found": the API error handler turns any error that
    // contains them into a generic 404.
    throw ValidationError(
      "The selected theme does not exist in this workspace"
    );
  }
}
