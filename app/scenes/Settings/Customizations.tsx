import { observer } from "mobx-react";
import { PaletteIcon } from "outline-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import type { CustomizationScope } from "@shared/types/customizations";
import Button from "~/components/Button";
import CopyToClipboard from "~/components/CopyToClipboard";
import Heading from "~/components/Heading";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import useStores from "~/hooks/useStores";
import { useLocationSelector } from "~/hooks/useLocationSelector";
import { getCustomizationRecoveryUrl } from "~/utils/customizations";
import type { CustomizationBackgroundDraft } from "./components/CustomizationBackgroundSettings";
import { CustomizationBackgroundSettings } from "./components/CustomizationBackgroundSettings";
import { CustomizationPreview } from "./components/CustomizationPreview";
import {
  CustomizationActions,
  CustomizationError,
  CustomizationHelp,
} from "./components/CustomizationStyles";

/**
 * Displays the current user's independent background settings.
 *
 * @returns the personal settings scene.
 */
export function PersonalCustomizationsSettings() {
  return <CustomizationsSettings scope="personal" />;
}

/**
 * Displays administrator-managed workspace background settings.
 *
 * @returns the workspace settings scene.
 */
export function WorkspaceCustomizationsSettings() {
  return <CustomizationsSettings scope="workspace" />;
}

interface CustomizationsSettingsProps {
  scope: CustomizationScope;
}

const CustomizationsSettings = observer(function CustomizationsSettings({
  scope,
}: CustomizationsSettingsProps) {
  const { t } = useTranslation();
  const { customizations, ui } = useStores();
  const recoveryUrl = useLocationSelector(
    (location) =>
      new URL(getCustomizationRecoveryUrl(location), window.location.origin)
        .href
  );
  const [appearance, setAppearance] = useState<"light" | "dark">(() =>
    ui.resolvedTheme === "dark" ? "dark" : "light"
  );
  const [backgroundDraft, setBackgroundDraft] =
    useState<CustomizationBackgroundDraft>();
  const [loadError, setLoadError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const isWorkspace = scope === "workspace";
  const info = isWorkspace ? customizations.workspaceInfo : customizations.info;
  const title = isWorkspace ? t("Workspace appearance") : t("Appearance");
  const appearanceOptions: Option[] = useMemo(
    () => [
      { type: "item", value: "light", label: t("Light") },
      { type: "item", value: "dark", label: t("Dark") },
    ],
    [t]
  );

  useEffect(() => {
    let active = true;
    setLoadError(undefined);
    const load = isWorkspace
      ? customizations.fetchWorkspaceInfo({ force: true })
      : customizations.fetchInfo({ force: true });

    void load.catch(() => {
      if (active) {
        setLoadError(
          t("Could not load appearance settings. Please try again.")
        );
      }
    });

    return () => {
      active = false;
    };
  }, [customizations, isWorkspace, retry, t]);

  const handleRetry = useCallback(() => setRetry((value) => value + 1), []);
  const handleRecovery = () => {
    window.location.assign(recoveryUrl);
  };
  const handleCopyRecovery = useCallback(() => {
    toast.success(t("Copied to clipboard"));
  }, [t]);

  let contents: ReactNode;
  if (!info) {
    contents = loadError ? (
      <>
        <CustomizationError role="alert">{loadError}</CustomizationError>
        <Button type="button" onClick={handleRetry}>
          {t("Try again")}
        </Button>
      </>
    ) : (
      <Text as="p" role="status">
        {t("Loading")}…
      </Text>
    );
  } else if (isWorkspace && !info.canManage) {
    contents = (
      <CustomizationError role="alert">
        {t("Only administrators can manage workspace appearance.")}
      </CustomizationError>
    );
  } else {
    const savedBackground = isWorkspace
      ? info.workspace.background
      : info.personal.background;
    const savedSource = isWorkspace
      ? "personal"
      : info.personal.background.source;
    const previewBackground = backgroundDraft ?? {
      ...savedBackground,
      source: savedSource,
    };
    const effectiveBackground =
      !isWorkspace && previewBackground.source === "inherit"
        ? info.workspace.background
        : previewBackground;

    contents = (
      <>
        {loadError && (
          <CustomizationError role="alert">
            {loadError}{" "}
            <Button type="button" neutral onClick={handleRetry}>
              {t("Try again")}
            </Button>
          </CustomizationError>
        )}
        <Layout>
          <Forms>
            <section
              id={`customizations-${scope}-background-panel`}
              aria-label={t("Background image")}
            >
              <CustomizationBackgroundSettings
                scope={scope}
                saved={savedBackground}
                source={savedSource}
                onPreviewChange={setBackgroundDraft}
              />
            </section>
          </Forms>
          <PreviewArea aria-label={t("Appearance preview")}>
            <PreviewHeading>
              <strong>{t("Preview")}</strong>
              <InputSelect
                label={t("Preview appearance")}
                labelHidden
                options={appearanceOptions}
                value={appearance}
                onChange={(value) =>
                  setAppearance(value === "dark" ? "dark" : "light")
                }
                short
              />
            </PreviewHeading>
            <CustomizationPreview
              appearance={appearance}
              backgroundUrl={effectiveBackground.asset?.url}
              fit={effectiveBackground.fit}
            />
            <CustomizationHelp>
              {t(
                "Drafts are previewed here without changing your saved settings."
              )}
            </CustomizationHelp>
            <CustomizationActions>
              <Button type="button" neutral onClick={handleRecovery}>
                {t("Open recovery mode")}
              </Button>
              <CopyToClipboard text={recoveryUrl} onCopy={handleCopyRecovery}>
                <Button type="button" neutral>
                  {t("Copy recovery URL")}
                </Button>
              </CopyToClipboard>
            </CustomizationActions>
          </PreviewArea>
        </Layout>
      </>
    );
  }

  return (
    <Scene title={title} icon={<PaletteIcon />} wide>
      <SettingsContent>
        <Heading>{title}</Heading>
        <Description>
          {isWorkspace
            ? t("Set the default background image for your workspace.")
            : t(
                "Choose a personal background image or use the workspace default."
              )}
        </Description>
        {contents}
      </SettingsContent>
    </Scene>
  );
});

const SettingsContent = styled.div`
  max-width: 1120px;
  margin: 0 auto;
  min-width: 0;
`;

const Description = styled.p`
  color: ${(props) => props.theme.textSecondary};
  margin: 0 0 22px;
`;

const Layout = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(260px, 1fr);
  gap: 32px;
  align-items: start;
  margin-top: 24px;

  @media (max-width: 1000px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const Forms = styled.div`
  min-width: 0;
`;

const PreviewArea = styled.aside`
  position: sticky;
  top: 112px;
  min-width: 0;

  @media (max-width: 1000px) {
    position: static;
  }
`;

const PreviewHeading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;

  strong {
    font-weight: 500;
  }
`;
