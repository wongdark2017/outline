import { subHours } from "date-fns";
import { Op } from "sequelize";
import { customizationAssetDelete } from "@server/commands/customizationAssetDelete";
import Logger from "@server/logging/Logger";
import {
  CustomizationAsset,
  UserCustomization,
  WorkspaceCustomization,
} from "@server/models";
import { sequelize } from "@server/storage/database";
import { CronTask, TaskInterval, type Props } from "./base/CronTask";

interface TableQuoter {
  quoteTable(
    table: ReturnType<typeof WorkspaceCustomization.getTableName>
  ): string;
}

/** Collects failed, abandoned, and ownerless private image uploads durably. */
export class CleanupCustomizationAssetsTask extends CronTask {
  /** Rechecks old images; references protect live workspace and personal assets. */
  public async perform({ limit, partition }: Props): Promise<void> {
    const generator = sequelize.getQueryInterface().queryGenerator;
    if (!isTableQuoter(generator)) {
      throw new Error("The database query generator cannot quote table names");
    }
    const workspaceTable = generator.quoteTable(
      WorkspaceCustomization.getTableName()
    );
    const personalTable = generator.quoteTable(
      UserCustomization.getTableName()
    );
    const assets = await CustomizationAsset.findAll({
      where: {
        createdAt: { [Op.lt]: subHours(new Date(), 24) },
        [Op.and]: [
          {
            id: {
              [Op.notIn]: sequelize.literal(
                `(SELECT "backgroundAssetId" FROM ${workspaceTable} WHERE "backgroundAssetId" IS NOT NULL UNION SELECT "backgroundAssetId" FROM ${personalTable} WHERE "backgroundAssetId" IS NOT NULL)`
              ),
            },
          },
          this.getPartitionWhereClause("id", partition),
        ],
      },
      order: [["createdAt", "ASC"]],
      limit,
    });
    for (const asset of assets) {
      try {
        await customizationAssetDelete(asset.id);
      } catch (error) {
        Logger.warn("Could not clean up a customization image", {
          assetId: asset.id,
          error,
        });
      }
    }
  }

  public get cron() {
    return { interval: TaskInterval.Hour };
  }
}

export default CleanupCustomizationAssetsTask;

function isTableQuoter(value: unknown): value is TableQuoter {
  return (
    !!value &&
    typeof value === "object" &&
    "quoteTable" in value &&
    typeof value.quoteTable === "function"
  );
}
