import { customizationAssetDelete } from "@server/commands/customizationAssetDelete";
import { BaseTask, TaskPriority } from "./base/BaseTask";

interface Props {
  assetId: string;
}

/** Retries cleanup of a replaced private background without losing its key. */
export class DeleteCustomizationAssetTask extends BaseTask<Props> {
  /** Deletes the asset only when no saved setting references it. */
  public async perform({ assetId }: Props): Promise<void> {
    await customizationAssetDelete(assetId);
  }

  public get options() {
    return { priority: TaskPriority.Background };
  }
}

export default DeleteCustomizationAssetTask;
