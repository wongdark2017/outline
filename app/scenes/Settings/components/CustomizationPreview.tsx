import { observer } from "mobx-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import type { CustomizationBackgroundFit } from "@shared/types/customizations";
import { TeamPreference } from "@shared/types";
import { Theme } from "~/stores/UiStore";
import Text from "~/components/Text";
import useBuildTheme from "~/hooks/useBuildTheme";
import useStores from "~/hooks/useStores";
import { buildCustomizationPreviewDocument } from "./customizationPreview";

interface CustomizationPreviewProps {
  appearance: "light" | "dark";
  backgroundUrl?: string | null;
  fit: CustomizationBackgroundFit;
}

/**
 * Previews appearance drafts in a credential-free frame that cannot run scripts.
 *
 * @param props the unsaved appearance values to preview.
 * @returns the isolated miniature application preview.
 */
export const CustomizationPreview = observer(function CustomizationPreview({
  appearance,
  backgroundUrl,
  fit,
}: CustomizationPreviewProps) {
  const { t, i18n } = useTranslation();
  const { auth } = useStores();
  const [imageUrl, setImageUrl] = useState<string>();
  const [imageError, setImageError] = useState(false);
  const isDark = appearance === "dark";
  const theme = useBuildTheme(
    auth.team?.getPreference(TeamPreference.CustomTheme) ||
      auth.config?.customTheme ||
      undefined,
    isDark ? Theme.Dark : Theme.Light
  );

  useEffect(() => {
    setImageUrl(undefined);
    setImageError(false);
    if (!backgroundUrl) {
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | undefined;
    let active = true;

    const loadImage = async () => {
      const url = new URL(backgroundUrl, window.location.href);
      if (url.origin !== window.location.origin) {
        throw new Error("Background image must use the application origin");
      }
      const response = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error("Could not load background image");
      }
      const image = await response.blob();
      if (!["image/jpeg", "image/png", "image/webp"].includes(image.type)) {
        throw new Error("Background response is not an image");
      }
      if (!active) {
        return;
      }

      objectUrl = URL.createObjectURL(image);
      setImageUrl(objectUrl);
    };

    void loadImage().catch(() => {
      if (active && !controller.signal.aborted) {
        setImageError(true);
      }
    });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [backgroundUrl]);

  const srcDoc = useMemo(
    () =>
      buildCustomizationPreviewDocument({
        theme,
        appearance,
        direction: i18n.dir() === "rtl" ? "rtl" : "ltr",
        backgroundUrl: imageUrl,
        fit,
        labels: {
          workspace: t("Team knowledge base"),
          collection: t("Getting started"),
          home: t("Home"),
          favorites: t("Favorites"),
          title: t("Knowledge within reach"),
          paragraph: t(
            "Capture your team’s ideas and make every collaboration count."
          ),
          link: t("Write your first document"),
          listItem: t("Share what your team knows"),
        },
      }),
    [theme, appearance, i18n, imageUrl, fit, t]
  );

  return (
    <>
      <PreviewFrame
        title={t("Appearance preview")}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
      />
      {imageError && (
        <Text as="p" type="danger" size="small" role="status">
          {t("Could not load the background preview")}
        </Text>
      )}
    </>
  );
});

const PreviewFrame = styled.iframe`
  display: block;
  width: 100%;
  height: 340px;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 8px;
  background: ${(props) => props.theme.background};
`;
