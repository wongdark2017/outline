import { DownloadIcon, EditIcon, PlusIcon, TrashIcon } from "outline-icons";
import { createAction } from "~/actions";
import { dialogActionFactory } from "~/actions/definitions/common";
import { ThemeDeleteDialog } from "~/components/ThemeDialog/ThemeDeleteDialog";
import { ThemeEditDialog } from "~/components/ThemeDialog/ThemeEditDialog";
import type ThemeModel from "~/models/Theme";
import stores from "~/stores";
import { downloadThemeFile } from "~/utils/themes";
import { TeamSection, ThemeSection } from "../sections";

export const createTheme = dialogActionFactory({
  analyticsName: "Create theme",
  section: TeamSection,
  name: (t) => `${t("New theme")}…`,
  title: (t) => t("New theme"),
  content: (onSubmit) => <ThemeEditDialog onSubmit={onSubmit} />,
  icon: <PlusIcon />,
  keywords: "theme color palette appearance",
  width: 880,
  visible: () =>
    stores.policies.abilities(stores.auth.team?.id || "").createTheme,
});

export const editThemeActionFactory = (theme: ThemeModel) =>
  dialogActionFactory({
    analyticsName: "Edit theme",
    section: ThemeSection,
    name: (t) => `${t("Edit")}…`,
    title: (t) => t("Edit theme"),
    content: (onSubmit) => (
      <ThemeEditDialog theme={theme} onSubmit={onSubmit} />
    ),
    icon: <EditIcon />,
    width: 880,
    visible: () => stores.policies.abilities(theme.id).update,
  });

export const exportThemeActionFactory = (theme: ThemeModel) =>
  createAction({
    analyticsName: "Export theme",
    section: ThemeSection,
    name: ({ t }) => t("Export"),
    icon: <DownloadIcon />,
    perform: () => downloadThemeFile(theme),
  });

export const deleteThemeActionFactory = (theme: ThemeModel) =>
  dialogActionFactory({
    analyticsName: "Delete theme",
    section: ThemeSection,
    name: (t) => `${t("Delete")}…`,
    title: (t) => t("Delete theme"),
    content: (onSubmit) => (
      <ThemeDeleteDialog theme={theme} onSubmit={onSubmit} />
    ),
    icon: <TrashIcon />,
    dangerous: true,
    visible: () => stores.policies.abilities(theme.id).delete,
  });
