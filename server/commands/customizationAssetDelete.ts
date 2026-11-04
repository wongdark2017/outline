import {
  CustomizationAsset,
  Team,
  UserCustomization,
  WorkspaceCustomization,
} from "@server/models";
import { sequelize } from "@server/storage/database";
import FileStorage from "@server/storage/files";

/**
 * Deletes an unreferenced image while retaining metadata if storage fails.
 *
 * @param assetId the image to reconsider for deletion.
 * @returns whether the image was deleted.
 */
export async function customizationAssetDelete(
  assetId: string
): Promise<boolean> {
  return sequelize.transaction(async (transaction) => {
    const snapshot = await CustomizationAsset.findByPk(assetId, {
      transaction,
    });
    if (!snapshot) {
      return false;
    }
    if (snapshot.teamId) {
      await Team.findByPk(snapshot.teamId, {
        transaction,
        paranoid: false,
        lock: transaction.LOCK.UPDATE,
      });
    }
    const asset = await CustomizationAsset.findByPk(assetId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!asset) {
      return false;
    }
    const [workspaceReferences, personalReferences] = await Promise.all([
      WorkspaceCustomization.count({
        where: { backgroundAssetId: asset.id },
        transaction,
      }),
      UserCustomization.count({
        where: { backgroundAssetId: asset.id },
        transaction,
      }),
    ]);
    if (workspaceReferences || personalReferences) {
      return false;
    }
    await FileStorage.deleteFile(asset.key);
    await asset.destroy({ transaction });
    return true;
  });
}
