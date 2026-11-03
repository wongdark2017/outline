import { observer } from "mobx-react";
import { PaletteIcon, PlusIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Action } from "~/components/Actions";
import Button from "~/components/Button";
import Heading from "~/components/Heading";
import ListItem from "~/components/List/Item";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import {
  createTheme,
  deleteThemeActionFactory,
  editThemeActionFactory,
  exportThemeActionFactory,
} from "~/actions/definitions/themes";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import type ThemeModel from "~/models/Theme";
import { WorkspaceThemeDefaults } from "./components/WorkspaceThemeDefaults";

function Themes() {
  const { t } = useTranslation();
  const { themes } = useStores();
  const team = useCurrentTeam();
  const can = usePolicy(team);

  React.useEffect(() => {
    themes.fetchPage({ limit: 100 }).catch(() => {
      toast.error(t("Could not load themes"));
    });
  }, [themes, t]);

  return (
    <Scene
      title={t("Themes")}
      icon={<PaletteIcon />}
      actions={
        can.createTheme && (
          <Action>
            <Button type="button" action={createTheme} icon={<PlusIcon />}>
              {t("New theme")}…
            </Button>
          </Action>
        )
      }
    >
      <Heading>{t("Themes")}</Heading>
      <Text as="p" type="secondary">
        {t(
          "Themes change the colors of Outline. Anyone in the workspace can choose a theme for light and dark mode in their preferences."
        )}
      </Text>

      {can.update && <WorkspaceThemeDefaults />}

      <Heading as="h2">{t("All themes")}</Heading>
      {themes.orderedData.length === 0 ? (
        <Text as="p" type="secondary">
          {t("No themes yet.")}
        </Text>
      ) : (
        themes.orderedData.map((theme) => (
          <ThemeRow key={theme.id} theme={theme} />
        ))
      )}
    </Scene>
  );
}

const ThemeRow = observer(function ThemeRow({ theme }: { theme: ThemeModel }) {
  const { t } = useTranslation();
  const can = usePolicy(theme);
  const editAction = React.useMemo(
    () => editThemeActionFactory(theme),
    [theme]
  );
  const exportAction = React.useMemo(
    () => exportThemeActionFactory(theme),
    [theme]
  );
  const deleteAction = React.useMemo(
    () => deleteThemeActionFactory(theme),
    [theme]
  );

  return (
    <ListItem
      title={theme.name}
      subtitle={
        theme.createdBy
          ? t("Created by {{ name }}", { name: theme.createdBy.name })
          : undefined
      }
      actions={
        <>
          {can.update && (
            <Button type="button" neutral action={editAction}>
              {t("Edit")}
            </Button>
          )}
          <Button type="button" neutral action={exportAction}>
            {t("Export")}
          </Button>
          {can.delete && (
            <Button type="button" neutral action={deleteAction}>
              {t("Delete")}
            </Button>
          )}
        </>
      }
      border
    />
  );
});

export default observer(Themes);
