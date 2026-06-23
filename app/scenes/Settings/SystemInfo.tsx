import { observer } from "mobx-react";
import { SettingsIcon } from "outline-icons";
import * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import Empty from "~/components/Empty";
import Heading from "~/components/Heading";
import LoadingIndicator from "~/components/LoadingIndicator";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import { client } from "~/utils/ApiClient";

type SystemSettingSource = "env" | "database" | "default";

interface EffectiveSystemSetting {
  key: string;
  value: string;
  source: SystemSettingSource;
  isSensitive: boolean;
}

interface SystemInfoResponse {
  data: {
    settings: EffectiveSystemSetting[];
  };
}

function SystemInfo() {
  const { t } = useTranslation();
  const [settings, setSettings] = React.useState<EffectiveSystemSetting[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | undefined>();
  const formatSource = React.useCallback(
    (source: SystemSettingSource) => {
      switch (source) {
        case "env":
          return t("Environment");
        case "database":
          return t("Database");
        case "default":
          return t("Default");
      }
    },
    [t]
  );

  React.useEffect(() => {
    let isMounted = true;

    const fetchSystemInfo = async () => {
      setIsLoading(true);
      setError(undefined);

      try {
        const response = await client.post<SystemInfoResponse>(
          "/installation.systemInfo"
        );

        if (!isMounted) {
          return;
        }

        setSettings(response.data.settings);
      } catch (err) {
        if (!isMounted) {
          return;
        }

        const message =
          err instanceof Error ? err.message : t("Could not load system info");
        setError(message);
        toast.error(message);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void fetchSystemInfo();

    return () => {
      isMounted = false;
    };
  }, [t]);

  return (
    <Scene title={t("System Info")} icon={<SettingsIcon />}>
      <Heading>{t("System Info")}</Heading>
      <Text as="p" type="secondary">
        <Trans>
          Review the effective self-hosted system settings and where each value
          is sourced from.
        </Trans>
      </Text>

      {isLoading ? <LoadingIndicator /> : null}
      {error ? <Text type="danger">{error}</Text> : null}

      {!isLoading && !error ? (
        settings.length > 0 ? (
          <SettingsTable>
            <thead>
              <tr>
                <HeaderCell>{t("Setting")}</HeaderCell>
                <HeaderCell>{t("Value")}</HeaderCell>
                <HeaderCell>{t("Source")}</HeaderCell>
              </tr>
            </thead>
            <tbody>
              {settings.map((setting) => (
                <tr key={setting.key}>
                  <Cell>
                    <Code>{setting.key}</Code>
                  </Cell>
                  <ValueCell>
                    {setting.value ? setting.value : <Empty>{t("Empty")}</Empty>}
                  </ValueCell>
                  <Cell>{formatSource(setting.source)}</Cell>
                </tr>
              ))}
            </tbody>
          </SettingsTable>
        ) : (
          <Empty>{t("No system settings found")}</Empty>
        )
      ) : null}
    </Scene>
  );
}

const SettingsTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  margin-top: 24px;
`;

const HeaderCell = styled.th`
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid ${s("divider")};
  color: ${s("textSecondary")};
  font-weight: 500;
`;

const Cell = styled.td`
  padding: 12px;
  border-bottom: 1px solid ${s("divider")};
  vertical-align: top;
`;

const ValueCell = styled(Cell)`
  overflow-wrap: anywhere;
`;

const Code = styled.code`
  font-size: 13px;
`;

export default observer(SystemInfo);
