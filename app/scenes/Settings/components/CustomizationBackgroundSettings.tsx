import { observer } from "mobx-react";
import { ImageIcon } from "outline-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import type {
  CustomizationAssetInfo,
  CustomizationBackground,
  CustomizationBackgroundFit,
  CustomizationScope,
} from "@shared/types/customizations";
import { CustomizationValidation } from "@shared/types/customizations";
import Button from "~/components/Button";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import useStores from "~/hooks/useStores";
import {
  CustomizationActions,
  CustomizationError,
  CustomizationField,
  CustomizationHelp,
  CustomizationSectionHeading,
  CustomizationStatus,
} from "./CustomizationStyles";

/** An image draft that remains independent of CSS and script saves. */
export interface CustomizationBackgroundDraft {
  asset: CustomizationAssetInfo | null;
  source: "inherit" | "personal";
  fit: CustomizationBackgroundFit;
}

interface CustomizationBackgroundSettingsProps {
  scope: CustomizationScope;
  saved: CustomizationBackground;
  source: "inherit" | "personal";
  onPreviewChange: (draft: CustomizationBackgroundDraft) => void;
}

/**
 * Edits uploaded backgrounds and personal inheritance without saving other tabs.
 *
 * @param props the saved image, ownership, and preview callback.
 * @returns the independent image configuration form.
 */
export const CustomizationBackgroundSettings = observer(
  function CustomizationBackgroundSettings({
    scope,
    saved,
    source,
    onPreviewChange,
  }: CustomizationBackgroundSettingsProps) {
    const { t } = useTranslation();
    const { customizations } = useStores();
    const [draft, setDraft] = useState<CustomizationBackgroundDraft>(() => ({
      asset: saved.asset,
      source,
      fit: saved.fit,
    }));
    const [baseline, setBaseline] = useState(() => draft);
    const [version, setVersion] = useState(() => saved.version);
    const [isUploading, setIsUploading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string>();
    const isWorkspace = scope === "workspace";
    const isDirty =
      draft.asset?.id !== baseline.asset?.id ||
      draft.source !== baseline.source ||
      draft.fit !== baseline.fit;
    const isStale = saved.version !== version;
    const isBusy = isUploading || isSaving;

    const sourceOptions: Option[] = useMemo(
      () => [
        { type: "item", value: "inherit", label: t("Workspace default") },
        { type: "item", value: "personal", label: t("Use a personal image") },
      ],
      [t]
    );
    const fitOptions: Option[] = useMemo(
      () => [
        {
          type: "item",
          value: "cover",
          label: t("Fill background"),
        },
        {
          type: "item",
          value: "contain",
          label: t("Fit background"),
        },
        {
          type: "item",
          value: "repeat",
          label: t("Tile background"),
        },
      ],
      [t]
    );

    useEffect(() => {
      if (!isDirty) {
        const current = { asset: saved.asset, source, fit: saved.fit };
        setDraft(current);
        setBaseline(current);
        setVersion(saved.version);
      }
    }, [saved.asset, saved.fit, saved.version, source, isDirty]);

    useEffect(() => {
      onPreviewChange(draft);
    }, [draft, onPreviewChange]);

    const applySaved = useCallback(
      (
        background: CustomizationBackground,
        nextSource: "inherit" | "personal"
      ) => {
        const current = {
          asset: background.asset,
          source: nextSource,
          fit: background.fit,
        };
        setDraft(current);
        setBaseline(current);
        setVersion(background.version);
      },
      []
    );

    const handleUpload = useCallback(
      async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) {
          return;
        }
        if (!imageTypes.includes(file.type)) {
          setError(t("Choose a JPG, PNG, or WebP image"));
          return;
        }
        if (file.size > CustomizationValidation.maxBackgroundSize) {
          setError(t("The image must be smaller than 10 MB"));
          return;
        }

        setIsUploading(true);
        setError(undefined);
        try {
          const asset = await customizations.uploadBackground(file, scope);
          if (asset) {
            setDraft((previous) => ({
              ...previous,
              source: "personal",
              asset,
            }));
          }
        } catch {
          setError(
            t("Could not upload the background image. Please try again.")
          );
        } finally {
          setIsUploading(false);
        }
      },
      [customizations, scope, t]
    );

    const handleSave = useCallback(async () => {
      if (!isWorkspace && draft.source === "personal" && !draft.asset) {
        setError(t("Choose a personal background image first"));
        return;
      }

      setIsSaving(true);
      setError(undefined);
      try {
        const result = await customizations.updateBackground(scope, {
          assetId:
            !isWorkspace && draft.source === "inherit"
              ? null
              : (draft.asset?.id ?? null),
          source: isWorkspace ? undefined : draft.source,
          fit: draft.fit,
          expectedVersion: version,
        });
        if (result) {
          const background = isWorkspace
            ? result.workspace.background
            : result.personal.background;
          const nextSource = isWorkspace
            ? "personal"
            : result.personal.background.source;
          applySaved(background, nextSource);
          toast.success(t("Background saved"));
        }
      } catch {
        setError(t("Could not save the background. Please try again."));
        void customizations.revalidate().catch(() => undefined);
      } finally {
        setIsSaving(false);
      }
    }, [applySaved, customizations, draft, isWorkspace, scope, t, version]);

    const handleRestore = useCallback(async () => {
      setIsSaving(true);
      setError(undefined);
      try {
        const result = await customizations.updateBackground(scope, {
          assetId: null,
          source: isWorkspace ? undefined : "inherit",
          fit: saved.fit,
          expectedVersion: version,
        });
        if (result) {
          applySaved(
            isWorkspace
              ? result.workspace.background
              : result.personal.background,
            isWorkspace ? "personal" : "inherit"
          );
          toast.success(t("Background saved"));
        }
      } catch {
        setError(t("Could not save the background. Please try again."));
        void customizations.revalidate().catch(() => undefined);
      } finally {
        setIsSaving(false);
      }
    }, [applySaved, customizations, isWorkspace, saved.fit, scope, t, version]);

    const handleReload = () => {
      applySaved(saved, source);
      setError(undefined);
    };

    return (
      <>
        <CustomizationSectionHeading>
          <h2>{t("Background image")}</h2>
          <CustomizationStatus>
            {isWorkspace || draft.source === "inherit"
              ? t("Workspace default")
              : t("Personal override")}
          </CustomizationStatus>
        </CustomizationSectionHeading>
        <CustomizationHelp>
          {isWorkspace
            ? t("Used by members who have not chosen a personal image.")
            : t(
                "Your image only changes your own appearance and stays independent of color themes."
              )}
        </CustomizationHelp>
        {!isWorkspace && (
          <CustomizationField>
            <InputSelect
              label={t("Image source")}
              value={draft.source}
              options={sourceOptions}
              disabled={isBusy}
              onChange={(value) =>
                setDraft((previous) => ({
                  ...previous,
                  source: value === "personal" ? "personal" : "inherit",
                }))
              }
            />
          </CustomizationField>
        )}
        <UploadBox>
          <ImageIcon size={28} />
          <strong>
            {isWorkspace
              ? t("Upload workspace background")
              : t("Upload personal background")}
          </strong>
          <CustomizationHelp>
            {t("JPG, PNG, or WebP, up to 10 MB")}
          </CustomizationHelp>
          <UploadLabel>
            <UploadInput
              type="file"
              accept={imageTypes.join(",")}
              disabled={isBusy}
              onChange={handleUpload}
              aria-label={t("Choose background image")}
            />
            <span>
              {isUploading ? `${t("Uploading")}…` : t("Choose image")}
            </span>
          </UploadLabel>
          {draft.asset && (
            <FileDetails>
              <span>{draft.asset.name}</span>
              <CustomizationHelp>
                {t("{{ size }} KB", {
                  size: Math.ceil(draft.asset.size / 1024),
                })}
              </CustomizationHelp>
            </FileDetails>
          )}
        </UploadBox>
        <CustomizationField>
          <InputSelect
            label={t("Display mode")}
            value={draft.fit}
            options={fitOptions}
            disabled={isBusy}
            onChange={(value) => {
              if (
                value === "cover" ||
                value === "contain" ||
                value === "repeat"
              ) {
                setDraft((previous) => ({ ...previous, fit: value }));
              }
            }}
          />
        </CustomizationField>
        {isStale && (
          <CustomizationHelp role="status">
            {t("The saved setting changed while you were editing.")}{" "}
            <Button
              type="button"
              neutral
              onClick={handleReload}
              disabled={isBusy}
            >
              {t("Reload saved setting")}
            </Button>
          </CustomizationHelp>
        )}
        {error && <CustomizationError role="alert">{error}</CustomizationError>}
        <CustomizationActions>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isBusy || !isDirty}
          >
            {isSaving
              ? `${t("Saving")}…`
              : isWorkspace
                ? t("Publish background")
                : t("Save background")}
          </Button>
          <Button
            type="button"
            neutral
            onClick={handleRestore}
            disabled={isBusy}
          >
            {isWorkspace
              ? t("Remove default background")
              : t("Restore workspace default")}
          </Button>
        </CustomizationActions>
        {isDirty && (
          <CustomizationHelp role="status">
            {t("Unsaved changes")}
          </CustomizationHelp>
        )}
      </>
    );
  }
);

const imageTypes = ["image/jpeg", "image/png", "image/webp"];

const UploadBox = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 22px 16px;
  border: 1px dashed ${(props) => props.theme.divider};
  border-radius: 8px;
  background: ${(props) => props.theme.backgroundSecondary};
  color: ${(props) => props.theme.textSecondary};
  text-align: center;

  p {
    margin: 0;
  }
  strong {
    font-weight: 500;
  }
`;

const UploadInput = styled.input`
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  cursor: var(--pointer);
`;

const UploadLabel = styled.label`
  position: relative;
  padding: 7px 12px;
  border-radius: 5px;
  border: 1px solid ${(props) => props.theme.inputBorder};
  background: ${(props) => props.theme.inputBackground};
  color: ${(props) => props.theme.text};
  cursor: var(--pointer);

  &:focus-within {
    outline: 2px solid ${(props) => props.theme.selected};
    outline-offset: 2px;
  }
`;

const FileDetails = styled.div`
  max-width: 100%;
  overflow-wrap: anywhere;
`;
