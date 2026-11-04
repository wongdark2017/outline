import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { TeamPreference, ThemeChoice } from "@shared/types";
import { errToString } from "@shared/utils/error";
import Heading from "~/components/Heading";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import useStores from "~/hooks/useStores";
import SettingRow from "./SettingRow";

type DefaultKey =
  | TeamPreference.DefaultLightTheme
  | TeamPreference.DefaultDarkTheme;

/**
 * Lets admins choose the themes used by people who haven't picked their own.
 */
export const WorkspaceThemeDefaults = observer(
  function WorkspaceThemeDefaults() {
    const { t } = useTranslation();
    const { themes } = useStores();
    const team = useCurrentTeam();

    const options: Option[] = React.useMemo(
      () => [
        { type: "item", label: t("Outline"), value: ThemeChoice.Builtin },
        ...themes.orderedData.map(
          (theme) =>
            ({
              type: "item",
              label: theme.name,
              value: theme.id,
            }) satisfies Option
        ),
      ],
      [t, themes.orderedData]
    );

    const handleChange = React.useCallback(
      async (key: DefaultKey, value: string) => {
        try {
          await team.save({
            preferences: { ...team.preferences, [key]: value },
          });
          toast.success(t("Settings saved"));
        } catch (err) {
          toast.error(errToString(err));
        }
      },
      [team, t]
    );

    const valueFor = (key: DefaultKey) => {
      const value = team.getPreference(key);
      if (typeof value !== "string") {
        return ThemeChoice.Builtin;
      }

      // A theme that no longer exists is not listed, so show what it falls
      // back to instead of an empty selection.
      const isListed = options.some(
        (option) => option.type === "item" && option.value === value
      );
      return isListed || !themes.isLoaded ? value : ThemeChoice.Builtin;
    };

    return (
      <>
        <Heading as="h2">{t("Workspace default")}</Heading>
        <SettingRow
          name={TeamPreference.DefaultLightTheme}
          label={t("Light theme")}
          description={t(
            "Used in light mode by everyone who hasn’t chosen their own theme."
          )}
        >
          <InputSelect
            options={options}
            value={valueFor(TeamPreference.DefaultLightTheme)}
            onChange={(value) =>
              handleChange(TeamPreference.DefaultLightTheme, value)
            }
            label={t("Light theme")}
            labelHidden
          />
        </SettingRow>
        <SettingRow
          name={TeamPreference.DefaultDarkTheme}
          label={t("Dark theme")}
          description={t(
            "Used in dark mode by everyone who hasn’t chosen their own theme."
          )}
        >
          <InputSelect
            options={options}
            value={valueFor(TeamPreference.DefaultDarkTheme)}
            onChange={(value) =>
              handleChange(TeamPreference.DefaultDarkTheme, value)
            }
            label={t("Dark theme")}
            labelHidden
          />
        </SettingRow>
      </>
    );
  }
);
