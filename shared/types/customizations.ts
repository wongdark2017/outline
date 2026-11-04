/** The scope of an independently saved customization. */
export type CustomizationScope = "workspace" | "personal";

/** The way an uploaded background fills the application. */
export type CustomizationBackgroundFit = "cover" | "contain" | "repeat";

/** Metadata and an authorized application URL for an uploaded image. */
export interface CustomizationAssetInfo {
  id: string;
  name: string;
  contentType: string;
  size: number;
  url: string;
}

/** A separately versioned background configuration. */
export interface CustomizationBackground {
  asset: CustomizationAssetInfo | null;
  fit: CustomizationBackgroundFit;
  version: number;
}

/** A user's explicit background inheritance choice. */
export interface PersonalCustomizationBackground extends CustomizationBackground {
  source: "inherit" | "personal";
}

/** A separately versioned CSS source document. */
export interface CustomizationCss {
  source: string;
  version: number;
}

/** An immutable, administrator-published native JavaScript module revision. */
export interface CustomizationScript {
  id: string;
  revision: number;
  digest: string;
  source: string;
  modules: Record<string, string>;
  url: string;
  createdAt: string;
}

/** An unpublished JavaScript draft, visible only to administrators. */
export interface CustomizationScriptDraft {
  source: string;
  modules: Record<string, string>;
  version: number;
}

/** Shared appearance defaults and the current published script. */
export interface WorkspaceCustomizations {
  background: CustomizationBackground;
  css: CustomizationCss;
  script: CustomizationScript | null;
}

/** Current-user appearance overrides and exact-revision script consent. */
export interface PersonalCustomizations {
  background: PersonalCustomizationBackground;
  css: CustomizationCss;
  enabledScriptId: string | null;
  enabledScriptDigest: string | null;
}

/** The authorized settings returned by customization reads and writes. */
export interface CustomizationsInfo {
  workspace: WorkspaceCustomizations;
  personal: PersonalCustomizations;
  scriptEnabled: boolean;
  scriptsAllowed: boolean;
  canManage: boolean;
}

/** The administrator's authorized settings including the unpublished draft. */
export interface WorkspaceCustomizationsInfo extends CustomizationsInfo {
  draft: CustomizationScriptDraft;
}

/** An invalidation notification without source code or personal settings. */
export interface CustomizationInvalidation {
  scope: CustomizationScope;
  revisionId?: string | null;
}

/** Shared limits applied before accepting customization source or images. */
export const CustomizationValidation = {
  maxCssLength: 100_000,
  maxScriptLength: 200_000,
  maxModuleCount: 20,
  maxModulePathLength: 160,
  maxScriptTotalLength: 1_000_000,
  maxBackgroundSize: 10 * 1024 * 1024,
} as const;
