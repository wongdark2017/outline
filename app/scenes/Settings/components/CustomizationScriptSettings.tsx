import { observer } from "mobx-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  CustomizationScope,
  CustomizationScript,
  CustomizationScriptDraft,
} from "@shared/types/customizations";
import { CustomizationValidation } from "@shared/types/customizations";
import { errToString } from "@shared/utils/error";
import Button from "~/components/Button";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Notice from "~/components/Notice";
import useStores from "~/hooks/useStores";
import { parseCustomizationModules } from "./customizationPreview";
import {
  CustomizationActions,
  CustomizationCodeInput,
  CustomizationError,
  CustomizationField,
  CustomizationHelp,
  CustomizationSectionHeading,
  CustomizationStatus,
} from "./CustomizationStyles";

interface CustomizationScriptSettingsProps {
  scope: CustomizationScope;
  published: CustomizationScript | null;
  draft?: CustomizationScriptDraft;
  scriptsAllowed: boolean;
}

/**
 * Separates administrator draft publication from a member's revision consent.
 *
 * @param props the reviewed publication and authorized administrator draft.
 * @returns the script editor or read-only consent controls.
 */
export const CustomizationScriptSettings = observer(
  function CustomizationScriptSettings({
    scope,
    published,
    draft,
    scriptsAllowed,
  }: CustomizationScriptSettingsProps) {
    const { t } = useTranslation();
    const { customizations, dialogs } = useStores();
    const isWorkspace = scope === "workspace";
    const [source, setSource] = useState(() => draft?.source ?? "");
    const [modules, setModules] = useState(() =>
      JSON.stringify(draft?.modules ?? {}, null, 2)
    );
    const [baseline, setBaseline] = useState(() => ({ source, modules }));
    const [version, setVersion] = useState(() => draft?.version ?? 0);
    const [isSaving, setIsSaving] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [isDisabling, setIsDisabling] = useState(false);
    const [error, setError] = useState<string>();
    const isDirty = source !== baseline.source || modules !== baseline.modules;
    const isStale = draft?.version !== undefined && draft.version !== version;
    const isBusy = isSaving || isPublishing || isDisabling;
    const hasEnabledScript = !!customizations.enabledScript;
    const needsConsent = customizations.scriptRequiresConsent;

    useEffect(() => {
      if (draft && !isDirty) {
        const nextModules = JSON.stringify(draft.modules, null, 2);
        setSource(draft.source);
        setModules(nextModules);
        setBaseline({ source: draft.source, modules: nextModules });
        setVersion(draft.version);
      }
    }, [draft, isDirty]);

    const handleSaveDraft = useCallback(async () => {
      const parsed = parseCustomizationModules(modules);
      if (!parsed.ok) {
        setError(
          parsed.reason === "json"
            ? t("Managed dependencies must contain valid JSON")
            : t("Managed dependencies must map file paths to JavaScript source")
        );
        return;
      }

      setIsSaving(true);
      setError(undefined);
      try {
        const result = await customizations.saveScriptDraft(
          source,
          parsed.modules,
          version
        );
        if (result) {
          const nextModules = JSON.stringify(result.draft.modules, null, 2);
          setSource(result.draft.source);
          setModules(nextModules);
          setBaseline({ source: result.draft.source, modules: nextModules });
          setVersion(result.draft.version);
          toast.success(t("Script draft saved"));
        }
      } catch (err) {
        setError(errToString(err));
        void customizations
          .fetchWorkspaceInfo({ force: true })
          .catch(() => undefined);
      } finally {
        setIsSaving(false);
      }
    }, [customizations, modules, source, t, version]);

    const handlePublish = useCallback(async () => {
      setIsPublishing(true);
      setError(undefined);
      try {
        const result = await customizations.publishScript(version);
        if (result) {
          toast.success(t("Script published"));
        }
      } catch (err) {
        setError(errToString(err));
        void customizations
          .fetchWorkspaceInfo({ force: true })
          .catch(() => undefined);
      } finally {
        setIsPublishing(false);
      }
    }, [customizations, t, version]);

    const handleEnable = useCallback(() => {
      if (!published) {
        return;
      }

      const reviewed = published;
      dialogs.openModal({
        title: t("Enable workspace script"),
        content: (
          <ConfirmationDialog
            submitText={t("Enable this revision")}
            savingText={`${t("Enabling")}…`}
            onSubmit={async () => {
              await customizations.enableScript(reviewed.id, reviewed.digest);
              toast.success(t("Script enabled"));
            }}
          >
            {t(
              "This script can read page content, modify the interface, and act with your account’s permissions."
            )}
            <br />
            <br />
            {t(
              "This confirmation only enables revision {{ revision }}. Source or dependency changes require confirmation again.",
              {
                revision: reviewed.revision,
              }
            )}
          </ConfirmationDialog>
        ),
      });
    }, [customizations, dialogs, published, t]);

    const handleDisable = useCallback(async () => {
      setIsDisabling(true);
      setError(undefined);
      try {
        await customizations.disableScript();
        toast.success(t("Script disabled"));
      } catch (err) {
        setError(errToString(err));
      } finally {
        setIsDisabling(false);
      }
    }, [customizations, t]);

    const handleReload = () => {
      if (draft) {
        const nextModules = JSON.stringify(draft.modules, null, 2);
        setSource(draft.source);
        setModules(nextModules);
        setBaseline({ source: draft.source, modules: nextModules });
        setVersion(draft.version);
      }
      setError(undefined);
    };

    const handleExample = () => {
      setSource(`export function activate(ctx) {
  const button = document.createElement("button");
  button.textContent = ${JSON.stringify(t("Quick tools"))};
  ctx.toolbar.appendChild(button);

  return () => button.remove();
}`);
    };

    let status = t("Not enabled");
    if (isWorkspace) {
      status = published
        ? t("Published revision {{ revision }}", {
            revision: published.revision,
          })
        : t("Not published");
    } else if (!scriptsAllowed) {
      status = t("Disabled");
    } else if (customizations.scriptError) {
      status = t("Script error");
    } else if (hasEnabledScript) {
      status = t("Enabled");
    } else if (needsConsent) {
      status = t("Enable again");
    }

    return (
      <>
        <CustomizationSectionHeading>
          <h2>{t("Workspace script")}</h2>
          <CustomizationStatus
            $warning={needsConsent || !!customizations.scriptError}
          >
            {status}
          </CustomizationStatus>
        </CustomizationSectionHeading>
        <CustomizationHelp>
          {published
            ? t("Administrator published revision {{ revision }}", {
                revision: published.revision,
              })
            : t("No script has been published for this workspace.")}
        </CustomizationHelp>
        {!scriptsAllowed && (
          <Notice>
            {t("Custom script execution is disabled for this installation.")}
          </Notice>
        )}
        <Notice>
          {isWorkspace
            ? t(
                "Publishing changed code pauses members’ scripts until they enable the new revision. Saving a draft does not change the published version."
              )
            : needsConsent
              ? t(
                  "The administrator updated the script. Execution is paused until you enable the new revision."
                )
              : t(
                  "Scripts can read page content and act with your account’s permissions. They run only after you explicitly enable them."
                )}
        </Notice>
        {isWorkspace ? (
          <>
            <CustomizationField>
              <CustomizationCodeInput
                type="textarea"
                label={t("Script draft")}
                value={source}
                onChange={(event) => setSource(event.target.value)}
                disabled={isBusy}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                maxLength={CustomizationValidation.maxScriptLength}
                rows={13}
                margin={0}
                placeholder={
                  "export function activate(ctx) {\n  return () => {};\n}"
                }
              />
            </CustomizationField>
            <Button
              type="button"
              neutral
              onClick={handleExample}
              disabled={isBusy}
            >
              {t("Use example script")}
            </Button>
            <CustomizationField>
              <CustomizationCodeInput
                type="textarea"
                label={t("Managed dependencies (JSON)")}
                value={modules}
                onChange={(event) => setModules(event.target.value)}
                disabled={isBusy}
                spellCheck={false}
                maxLength={CustomizationValidation.maxScriptTotalLength}
                rows={5}
                margin={0}
              />
              <CustomizationHelp>
                {t(
                  "Map relative JavaScript file paths to their source. Dependencies are saved with each published revision."
                )}
              </CustomizationHelp>
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
            <CustomizationActions>
              <Button
                type="button"
                neutral
                onClick={handleSaveDraft}
                disabled={isBusy || !isDirty}
              >
                {isSaving ? `${t("Saving")}…` : t("Save draft")}
              </Button>
              <Button
                type="button"
                onClick={handlePublish}
                disabled={isBusy || isDirty || !source.trim()}
              >
                {isPublishing
                  ? `${t("Publishing")}…`
                  : t("Publish new revision")}
              </Button>
            </CustomizationActions>
            {isDirty && (
              <CustomizationHelp role="status">
                {t("Save your draft before publishing.")}
              </CustomizationHelp>
            )}
          </>
        ) : (
          <>
            <CustomizationField>
              <CustomizationCodeInput
                type="textarea"
                label={t("Published code (read only)")}
                value={published?.source ?? ""}
                readOnly
                spellCheck={false}
                rows={12}
                margin={0}
              />
            </CustomizationField>
            {published && Object.keys(published.modules).length > 0 && (
              <details>
                <summary>{t("Managed dependencies")}</summary>
                <CustomizationCodeInput
                  type="textarea"
                  label={t("Dependency source (read only)")}
                  value={JSON.stringify(published.modules, null, 2)}
                  readOnly
                  spellCheck={false}
                  rows={8}
                />
              </details>
            )}
            <CustomizationActions>
              <Button
                type="button"
                onClick={handleEnable}
                disabled={
                  !published || hasEnabledScript || !scriptsAllowed || isBusy
                }
              >
                {needsConsent ? t("Enable again") : t("Enable this revision")}
              </Button>
              <Button
                type="button"
                neutral
                onClick={handleDisable}
                disabled={
                  !customizations.info?.personal.enabledScriptId || isBusy
                }
              >
                {isDisabling ? `${t("Disabling")}…` : t("Disable script")}
              </Button>
            </CustomizationActions>
          </>
        )}
        {error && <CustomizationError role="alert">{error}</CustomizationError>}
        {customizations.scriptError && (
          <CustomizationError role="alert">
            {customizations.scriptError}
          </CustomizationError>
        )}
        <CustomizationHelp>
          {t(
            "Changing only a background or CSS does not require enabling the script again."
          )}
        </CustomizationHelp>
        <CustomizationHelp>
          {t(
            "Revision checks cover the published source and managed dependencies. Code fetched by the script at runtime is outside these checks."
          )}
        </CustomizationHelp>
        <CustomizationHelp>
          {t(
            "Disabling runs the script’s registered cleanup. It does not undo unregistered effects or saved document edits."
          )}
        </CustomizationHelp>
      </>
    );
  }
);
