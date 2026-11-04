import { observer } from "mobx-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  CustomizationCss,
  CustomizationScope,
} from "@shared/types/customizations";
import { CustomizationValidation } from "@shared/types/customizations";
import { errToString } from "@shared/utils/error";
import Button from "~/components/Button";
import useStores from "~/hooks/useStores";
import {
  CustomizationActions,
  CustomizationCodeInput,
  CustomizationError,
  CustomizationField,
  CustomizationHelp,
  CustomizationSectionHeading,
  CustomizationStatus,
} from "./CustomizationStyles";

interface CustomizationCssSettingsProps {
  scope: CustomizationScope;
  saved: CustomizationCss;
  workspaceCss: string;
  onPreviewChange: (css: string) => void;
}

/**
 * Edits one stylesheet while preserving the other scope and unsaved tabs.
 *
 * @param props the saved stylesheet and isolated-preview callback.
 * @returns the independent CSS form.
 */
export const CustomizationCssSettings = observer(
  function CustomizationCssSettings({
    scope,
    saved,
    workspaceCss,
    onPreviewChange,
  }: CustomizationCssSettingsProps) {
    const { t } = useTranslation();
    const { customizations } = useStores();
    const [css, setCss] = useState(() => saved.source);
    const [baseline, setBaseline] = useState(() => saved.source);
    const [version, setVersion] = useState(() => saved.version);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string>();
    const isWorkspace = scope === "workspace";
    const isDirty = css !== baseline;
    const isStale = saved.version !== version;

    useEffect(() => {
      if (!isDirty) {
        setCss(saved.source);
        setBaseline(saved.source);
        setVersion(saved.version);
      }
    }, [saved.source, saved.version, isDirty]);

    useEffect(() => {
      onPreviewChange(css);
    }, [css, onPreviewChange]);

    const handleSave = useCallback(async () => {
      setIsSaving(true);
      setError(undefined);
      try {
        const result = await customizations.updateCss(scope, css, version);
        if (result) {
          const current = isWorkspace
            ? result.workspace.css
            : result.personal.css;
          setCss(current.source);
          setBaseline(current.source);
          setVersion(current.version);
          toast.success(t("CSS saved"));
        }
      } catch (err) {
        setError(errToString(err));
        void customizations.revalidate().catch(() => undefined);
      } finally {
        setIsSaving(false);
      }
    }, [css, customizations, isWorkspace, scope, t, version]);

    const handleClear = () => {
      setCss("");
      setError(undefined);
    };

    const handleReload = () => {
      setCss(saved.source);
      setBaseline(saved.source);
      setVersion(saved.version);
      setError(undefined);
    };

    return (
      <>
        <CustomizationSectionHeading>
          <h2>{isWorkspace ? t("Workspace CSS") : t("Personal CSS")}</h2>
          <CustomizationStatus>{t("Styles are combined")}</CustomizationStatus>
        </CustomizationSectionHeading>
        <CustomizationHelp>
          {isWorkspace
            ? t(
                "Base styles for the workspace. Personal CSS loads after these styles."
              )
            : t(
                "Workspace CSS loads first, followed by your CSS. Normal CSS specificity still applies."
              )}
        </CustomizationHelp>
        {!isWorkspace && (
          <CustomizationField>
            <CustomizationCodeInput
              type="textarea"
              label={t("Workspace CSS (read only)")}
              value={workspaceCss}
              readOnly
              spellCheck={false}
              rows={4}
              margin={0}
            />
          </CustomizationField>
        )}
        <CustomizationField>
          <CustomizationCodeInput
            type="textarea"
            label={isWorkspace ? t("Default styles") : t("My styles")}
            value={css}
            onChange={(event) => setCss(event.target.value)}
            disabled={isSaving}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            maxLength={CustomizationValidation.maxCssLength}
            rows={12}
            margin={0}
            placeholder={
              '[data-outline-part="editor"] p {\n  line-height: 1.9;\n}'
            }
          />
        </CustomizationField>
        {isStale && (
          <CustomizationHelp role="status">
            {t("The saved setting changed while you were editing.")}{" "}
            <Button
              type="button"
              neutral
              onClick={handleReload}
              disabled={isSaving}
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
            disabled={isSaving || !isDirty}
          >
            {isSaving
              ? `${t("Saving")}…`
              : isWorkspace
                ? t("Publish CSS")
                : t("Save CSS")}
          </Button>
          <Button
            type="button"
            neutral
            onClick={handleClear}
            disabled={isSaving || !css}
          >
            {isWorkspace ? t("Clear workspace CSS") : t("Clear personal CSS")}
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
