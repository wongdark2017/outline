import type {
  CustomizationAssetInfo,
  CustomizationScript,
} from "@shared/types";
import type {
  CustomizationAsset,
  CustomizationScriptRevision,
} from "@server/models";

/**
 * Presents image metadata without exposing its storage key or a signed URL.
 *
 * @param asset the authorized image.
 * @returns the authorized application image descriptor.
 */
export function presentCustomizationAsset(
  asset: CustomizationAsset
): CustomizationAssetInfo {
  return {
    id: asset.id,
    name: asset.name,
    contentType: asset.contentType,
    size: asset.size,
    url: `/api/customizations.background?id=${asset.id}`,
  };
}

/**
 * Presents immutable published source and its separately authorized module URL.
 *
 * @param revision the authorized published revision.
 * @returns the script descriptor.
 */
export function presentCustomizationScript(
  revision: CustomizationScriptRevision
): CustomizationScript {
  return {
    id: revision.id,
    revision: revision.revision,
    digest: revision.digest,
    source: revision.source,
    modules: revision.modules,
    url: `/api/customizations.module/${revision.id}/entry.js`,
    createdAt: revision.createdAt.toISOString(),
  };
}
