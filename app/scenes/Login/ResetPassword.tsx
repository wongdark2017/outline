import * as React from "react";
import { useTranslation } from "react-i18next";
import ButtonLarge from "~/components/ButtonLarge";
import ChangeLanguage from "~/components/ChangeLanguage";
import Heading from "~/components/Heading";
import InputLarge from "~/components/InputLarge";
import PageTitle from "~/components/PageTitle";
import Text from "~/components/Text";
import { detectLanguage } from "~/utils/language";
import useQuery from "~/hooks/useQuery";
import { Background } from "./components/Background";
import { Centered } from "./components/Centered";
import { Form } from "~/components/primitives/Form";

function ResetPassword() {
  const { t } = useTranslation();
  const query = useQuery();
  const resetToken = query.get("token");
  const activationToken = query.get("activationToken");
  const token = activationToken ?? resetToken;
  const isActivation = !!activationToken;
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (!token) {
      event.preventDefault();
      return;
    }

    if (password.length < 12) {
      event.preventDefault();
      setError(t("Password must be at least 12 characters."));
      return;
    }

    if (password !== confirmPassword) {
      event.preventDefault();
      setError(t("Passwords do not match."));
      return;
    }

    setError(null);
  };

  return (
    <Background>
      <ChangeLanguage locale={detectLanguage()} />
      <Centered gap={12}>
        <PageTitle title={isActivation ? t("Set password") : t("Reset password")} />
        <Heading centered>
          {isActivation ? t("Set password") : t("Reset password")}
        </Heading>
        {!token ? (
          <>
            <Text type="secondary" as="p" style={{ textAlign: "center" }}>
              {t("This reset link is invalid or missing.")}
            </Text>
            <ButtonLarge onClick={() => (window.location.href = "/")} fullwidth>
              {t("Back to login")}
            </ButtonLarge>
          </>
        ) : (
          <Form method="POST" action="/auth/password/update" onSubmit={handleSubmit}>
            <input
              type="hidden"
              name={isActivation ? "activationToken" : "resetToken"}
              value={token}
            />
            <InputLarge
              type="password"
              name="password"
              placeholder={t("New password")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              required
            />
            <InputLarge
              type="password"
              placeholder={t("Confirm new password")}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
            {error ? (
              <Text
                as="p"
                style={{ color: "var(--color-danger)", textAlign: "center" }}
              >
                {error}
              </Text>
            ) : null}
            <ButtonLarge type="submit" fullwidth>
              {isActivation ? t("Set password") : t("Update password")}
            </ButtonLarge>
          </Form>
        )}
      </Centered>
    </Background>
  );
}

export default ResetPassword;
