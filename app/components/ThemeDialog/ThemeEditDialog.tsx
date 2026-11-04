import { omit } from "es-toolkit";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import type {
  ThemeTokenGroup,
  ThemeTokenKey,
  ThemeTokens,
} from "@shared/styles/themeTokens";
import {
  ThemeTokenGroupOrder,
  ThemeTokenGroups,
} from "@shared/styles/themeTokens";
import type { ThemeColors } from "@shared/types";
import { validateColorHex } from "@shared/utils/color";
import { ThemeValidation } from "@shared/validations";
import Button from "~/components/Button";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Input from "~/components/Input";
import InputColor from "~/components/InputColor";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import Text from "~/components/Text";
import useStores from "~/hooks/useStores";
import type ThemeModel from "~/models/Theme";
import { parseThemeFile } from "~/utils/themes";
import { ThemePreview } from "./ThemePreview";

type Mode = "light" | "dark";

interface Props {
  /** The theme to edit, or undefined to create a new theme. */
  theme?: ThemeModel;
  /** Callback invoked after a successful save. */
  onSubmit: () => void;
}

/**
 * Dialog to create or edit a custom color theme, with a live preview.
 */
export function ThemeEditDialog({ theme, onSubmit }: Props) {
  const { t } = useTranslation();
  const { themes } = useStores();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [name, setName] = React.useState(() => theme?.name ?? "");
  const [mode, setMode] = React.useState<Mode>("light");
  const [colors, setColors] = React.useState<ThemeColors>(() => ({
    light: { ...theme?.light },
    dark: { ...theme?.dark },
  }));

  const groupLabels: Record<ThemeTokenGroup, string> = {
    brand: t("Brand"),
    surfaces: t("Surfaces"),
    text: t("Text"),
    sidebar: t("Sidebar"),
    menus: t("Menus and dialogs"),
    inputs: t("Inputs and buttons"),
    editor: t("Editor"),
  };

  const modeOptions: Option[] = React.useMemo(
    () => [
      { type: "item", label: t("Light"), value: "light" },
      { type: "item", label: t("Dark"), value: "dark" },
    ],
    [t]
  );

  const handleColorChange = (key: ThemeTokenKey, value: string) => {
    setColors((prev) => ({
      ...prev,
      [mode]: { ...prev[mode], [key]: value },
    }));
  };

  const handleReset = (key: ThemeTokenKey) => {
    setColors((prev) => ({ ...prev, [mode]: omit(prev[mode], [key]) }));
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const parsed = parseThemeFile(await file.text());
      setName(parsed.name);
      setColors({ light: parsed.light, dark: parsed.dark });
    } catch (_err) {
      toast.error(t("This file is not a valid theme"));
    }
  };

  const handleSubmit = async () => {
    const invalid = [
      ...new Set([...invalidKeys(colors.light), ...invalidKeys(colors.dark)]),
    ];
    if (invalid.length) {
      toast.error(
        t("These colors are not valid hex values ({{ keys }})", {
          keys: invalid.join(", "),
        })
      );
      return false;
    }

    const params = {
      name: name.trim(),
      light: colors.light,
      dark: colors.dark,
    };
    if (theme) {
      await theme.save(params);
    } else {
      await themes.create(params);
    }

    toast.success(theme ? t("Theme saved") : t("Theme created"));
    onSubmit();
    return true;
  };

  return (
    <ConfirmationDialog
      onSubmit={handleSubmit}
      submitText={theme ? t("Save") : t("Create")}
      savingText={`${t("Saving")}…`}
      disabled={!name.trim()}
    >
      <Header>
        <Input
          label={t("Name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={ThemeValidation.maxNameLength}
          autoFocus
          flex
        />
        <InputSelect
          label={t("Appearance")}
          options={modeOptions}
          value={mode}
          onChange={(value) => setMode(value === "dark" ? "dark" : "light")}
          short
        />
        {!theme && (
          <>
            <Button
              type="button"
              neutral
              onClick={() => fileInputRef.current?.click()}
            >
              {t("Import JSON")}…
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImport}
              hidden
            />
          </>
        )}
      </Header>
      <Columns>
        <Fields>
          <Text as="p" type="secondary" size="small">
            {t(
              "Leave a color empty to keep Outline’s color. Use hex values, for example #0366d6."
            )}
          </Text>
          {ThemeTokenGroupOrder.map((group) => (
            <Group key={group}>
              <Text as="h3" weight="bold">
                {groupLabels[group]}
              </Text>
              {ThemeTokenGroups[group].map((key) => (
                <Row key={key}>
                  <Label htmlFor={`theme-${key}`}>{key}</Label>
                  <ColorField>
                    <InputColor
                      id={`theme-${key}`}
                      value={colors[mode][key]}
                      onChange={(value) => handleColorChange(key, value)}
                      maxLength={9}
                    />
                  </ColorField>
                  {colors[mode][key] !== undefined && (
                    <Button
                      type="button"
                      neutral
                      onClick={() => handleReset(key)}
                    >
                      {t("Reset")}
                    </Button>
                  )}
                </Row>
              ))}
            </Group>
          ))}
        </Fields>
        <PreviewColumn>
          <ThemePreview mode={mode} tokens={colors[mode]} />
        </PreviewColumn>
      </Columns>
    </ConfirmationDialog>
  );
}

/**
 * Lists the keys whose values are not valid hex colors.
 *
 * @param tokens the colors to check.
 * @returns the invalid keys.
 */
function invalidKeys(tokens: ThemeTokens): string[] {
  return Object.entries(tokens)
    .filter(([, value]) => !value || !validateColorHex(value))
    .map(([key]) => key);
}

const Header = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 12px;
`;

const Columns = styled.div`
  display: flex;
  gap: 24px;
  margin-top: 12px;
`;

const Fields = styled.div`
  flex: 1;
  max-height: 55vh;
  overflow-y: auto;
  padding-right: 8px;
`;

const Group = styled.div`
  margin-bottom: 16px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Label = styled.label`
  width: 200px;
  flex-shrink: 0;
  font-family: ${(props) => props.theme.fontFamilyMono};
  font-size: 12px;
  color: ${(props) => props.theme.textSecondary};
`;

const ColorField = styled.div`
  flex: 1;
  min-width: 0;
`;

const PreviewColumn = styled.div`
  width: 360px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
`;
