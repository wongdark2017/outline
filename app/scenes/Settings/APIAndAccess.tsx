import { observer } from "mobx-react";
import { PadlockIcon } from "outline-icons";
import * as React from "react";
import { useTranslation, Trans } from "react-i18next";
import { toast } from "sonner";
import type ApiKey from "~/models/ApiKey";
import type OAuthAuthentication from "~/models/oauth/OAuthAuthentication";
import { Action } from "~/components/Actions";
import Button from "~/components/Button";
import Heading from "~/components/Heading";
import Input from "~/components/Input";
import PaginatedList from "~/components/PaginatedList";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import { createApiKey } from "~/actions/definitions/apiKeys";
import env from "~/env";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import useCurrentUser from "~/hooks/useCurrentUser";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import ApiKeyListItem from "./components/ApiKeyListItem";
import OAuthAuthenticationListItem from "./components/OAuthAuthenticationListItem";
import SettingRow from "./components/SettingRow";

function APIAndAccess() {
  const team = useCurrentTeam();
  const user = useCurrentUser();
  const { t } = useTranslation();
  const { apiKeys, oauthAuthentications } = useStores();
  const can = usePolicy(team);
  const appName = env.APP_NAME;
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [isSubmittingPassword, setSubmittingPassword] = React.useState(false);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);

  const handleSubmitPassword = React.useCallback(async () => {
    if (newPassword.length < 12) {
      setPasswordError(t("Password must be at least 12 characters."));
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(t("Passwords do not match."));
      return;
    }

    setSubmittingPassword(true);
    setPasswordError(null);

    try {
      await client.post(
        "/password/update",
        {
          currentPassword,
          password: newPassword,
        },
        {
          baseUrl: "/auth",
        }
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success(t("Password updated"));
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : t("Unable to update password."));
    } finally {
      setSubmittingPassword(false);
    }
  }, [confirmPassword, currentPassword, newPassword, t]);

  return (
    <Scene
      title={t("API & Access")}
      icon={<PadlockIcon />}
      actions={
        <>
          {can.createApiKey && (
            <Action>
              <Button
                type="submit"
                value={`${t("New API key")}…`}
                action={createApiKey}
              />
            </Action>
          )}
        </>
      }
    >
      <Heading>{t("API & Access")}</Heading>
      <h2>{t("Personal keys")}</h2>
      {can.createApiKey ? (
        <Text as="p" type="secondary">
          <Trans
            defaults="Create personal API keys to authenticate with the API and programatically control
      your workspace's data. For more details see the <em>developer documentation</em>."
            components={{
              em: (
                <a
                  href="https://www.getoutline.com/developers"
                  target="_blank"
                  rel="noreferrer"
                />
              ),
            }}
          />
        </Text>
      ) : (
        <Trans>API keys have been disabled by an admin for your account</Trans>
      )}
      <PaginatedList<ApiKey>
        fetch={apiKeys.fetchPage}
        items={apiKeys.personalApiKeys}
        options={{ userId: user.id }}
        renderItem={(apiKey) => (
          <ApiKeyListItem key={apiKey.id} apiKey={apiKey} />
        )}
      />
      {user.hasPassword ? (
        <>
          <Heading as="h2">{t("Password")}</Heading>
          <Text as="p" type="secondary">
            {t("Update the password you use to sign in to your account.")}
          </Text>
          <SettingRow
            label={t("Current password")}
            name="currentPassword"
            border={false}
          >
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder={t("Current password")}
            />
          </SettingRow>
          <SettingRow
            label={t("New password")}
            name="newPassword"
            border={false}
          >
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder={t("New password")}
            />
          </SettingRow>
          <SettingRow
            label={t("Confirm new password")}
            name="confirmPassword"
          >
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder={t("Confirm new password")}
            />
          </SettingRow>
          {passwordError ? (
            <Text as="p" type="danger">
              {passwordError}
            </Text>
          ) : null}
          <Button
            onClick={handleSubmitPassword}
            disabled={isSubmittingPassword}
            value={isSubmittingPassword ? `${t("Saving")}…` : t("Update password")}
          />
        </>
      ) : null}
      <PaginatedList
        fetch={oauthAuthentications.fetchPage}
        items={oauthAuthentications.orderedData}
        heading={
          <>
            <h2>{t("Application access")}</h2>
            <Text as="p" type="secondary">
              {t(
                "Manage which third-party and internal applications have been granted access to your {{ appName }} account.",
                { appName }
              )}
            </Text>
          </>
        }
        renderItem={(oauthAuthentication: OAuthAuthentication) => (
          <OAuthAuthenticationListItem
            key={oauthAuthentication.id}
            oauthAuthentication={oauthAuthentication}
          />
        )}
      />
    </Scene>
  );
}

export default observer(APIAndAccess);
