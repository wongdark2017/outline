import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { languageOptions as availableLanguages } from "@shared/i18n";
import { s } from "@shared/styles";
import type { JSONObject } from "@shared/types";
import ButtonLarge from "~/components/ButtonLarge";
import ChangeLanguage from "~/components/ChangeLanguage";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import Input from "~/components/Input";
import type { Item, Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import Switch from "~/components/Switch";
import Text from "~/components/Text";
import { Form } from "~/components/primitives/Form";
import { client } from "~/utils/ApiClient";
import { detectLanguage } from "~/utils/language";
import { BackButton } from "./BackButton";
import { Background } from "./Background";

type Step = "admin" | "system" | "storage" | "review";

interface SetupWizardProps {
  onBack?: () => void;
  isPasswordAuthEnabled?: boolean;
}

interface SetupState {
  teamName: string;
  userName: string;
  userEmail: string;
  password: string;
  passwordConfirmation: string;
  url: string;
  defaultLanguage: string;
  forceHttps: boolean;
  fileStorage: "local" | "s3";
  s3BucketName: string;
  s3Region: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Endpoint: string;
  s3ForcePathStyle: boolean;
  s3Acl: string;
}

interface StorageTestResponse {
  data: {
    success: boolean;
    error?: string;
  };
}

type FieldErrors = Partial<Record<keyof SetupState, string>>;

const allSteps: Step[] = ["admin", "system", "storage", "review"];

const hasFieldErrors = (errors: FieldErrors) =>
  Object.values(errors).some(Boolean);

const isOptionItem = (option: Option): option is Item => option.type === "item";

const getOptionLabel = (options: Option[], value: string) => {
  for (const option of options) {
    if (isOptionItem(option) && option.value === value) {
      return option.label;
    }
  }

  return value;
};

const initialState: SetupState = {
  teamName: "",
  userName: "",
  userEmail: "",
  password: "",
  passwordConfirmation: "",
  url: window.location.origin,
  defaultLanguage: detectLanguage(),
  forceHttps: window.location.protocol === "https:",
  fileStorage: "local",
  s3BucketName: "",
  s3Region: "",
  s3AccessKeyId: "",
  s3SecretAccessKey: "",
  s3Endpoint: "",
  s3ForcePathStyle: true,
  s3Acl: "private",
};

const SetupWizard = ({ onBack, isPasswordAuthEnabled }: SetupWizardProps) => {
  const { t } = useTranslation();
  const [step, setStep] = React.useState<Step>("admin");
  const [state, setState] = React.useState<SetupState>(initialState);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [globalError, setGlobalError] = React.useState<string | undefined>();
  const [storageTesting, setStorageTesting] = React.useState(false);
  const [storageTestPassed, setStorageTestPassed] = React.useState(false);

  const currentIndex = allSteps.indexOf(step);
  const languageOptions: Option[] = React.useMemo(
    () =>
      availableLanguages.map(
        (lang) =>
          ({
            type: "item",
            label: lang.label,
            value: lang.value,
          }) satisfies Option
      ),
    []
  );
  const storageOptions: Option[] = React.useMemo(
    () => [
      { type: "item", label: t("Local"), value: "local" },
      { type: "item", label: t("S3-compatible"), value: "s3" },
    ],
    [t]
  );
  const stepLabels: Record<Step, string> = React.useMemo(
    () => ({
      admin: t("Account"),
      system: t("System"),
      storage: t("Storage"),
      review: t("Review"),
    }),
    [t]
  );
  const stepContent: Record<Step, { title: string; description: string }> =
    React.useMemo(
      () => ({
        admin: {
          title: t("Create your admin account"),
          description: t(
            "Set up the first administrator who will manage this workspace."
          ),
        },
        system: {
          title: t("System settings"),
          description: t(
            "Configure your site URL, language, and file storage. These can be changed later in environment variables."
          ),
        },
        storage: {
          title: t("S3 storage configuration"),
          description: t(
            "Connect an S3-compatible storage service for file uploads. Test the connection before continuing."
          ),
        },
        review: {
          title: t("Review and create"),
          description: t(
            "Confirm your settings. You can go back to change any value."
          ),
        },
      }),
      [t]
    );
  const selectedLanguageLabel = getOptionLabel(
    languageOptions,
    state.defaultLanguage
  );
  const selectedStorageLabel = getOptionLabel(
    storageOptions,
    state.fileStorage
  );

  const setField = React.useCallback(
    (key: keyof SetupState, value: string | boolean) => {
      setState((prev) => ({ ...prev, [key]: value }));
      setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
      setGlobalError(undefined);

      if (key === "fileStorage" || key.startsWith("s3")) {
        setStorageTestPassed(false);
      }
    },
    []
  );

  const validateStep = React.useCallback(
    (stepToValidate: Step = step) => {
      const errors: FieldErrors = {};

      if (stepToValidate === "admin") {
        if (!state.teamName) {
          errors.teamName = t("Workspace name is required.");
        }

        if (!state.userName) {
          errors.userName = t("Admin name is required.");
        }

        if (!state.userEmail) {
          errors.userEmail = t("Email is required.");
        }

        if (isPasswordAuthEnabled && state.password.length < 12) {
          errors.password = t("At least 12 characters.");
        }

        if (
          isPasswordAuthEnabled &&
          state.password !== state.passwordConfirmation
        ) {
          errors.passwordConfirmation = t("Passwords do not match.");
        }
      }

      if (stepToValidate === "system") {
        try {
          const url = new URL(state.url);
          if (!["http:", "https:"].includes(url.protocol)) {
            errors.url = t("Enter a valid http or https URL.");
          }
        } catch (_err) {
          errors.url = t("Enter a valid http or https URL.");
        }
      }

      if (stepToValidate === "storage" && state.fileStorage === "s3") {
        if (!state.s3BucketName) {
          errors.s3BucketName = t("Bucket name is required.");
        }

        if (!state.s3AccessKeyId) {
          errors.s3AccessKeyId = t("Access key is required.");
        }

        if (!state.s3SecretAccessKey) {
          errors.s3SecretAccessKey = t("Secret key is required.");
        }
      }

      return errors;
    },
    [isPasswordAuthEnabled, state, step, t]
  );

  const getNextStep = React.useCallback(
    (fromStep: Step) => {
      const nextIndex = allSteps.indexOf(fromStep) + 1;
      const nextStep = allSteps[Math.min(nextIndex, allSteps.length - 1)];

      if (nextStep === "storage" && state.fileStorage !== "s3") {
        return "review";
      }

      return nextStep;
    },
    [state.fileStorage]
  );

  const getPreviousStep = React.useCallback(
    (fromStep: Step) => {
      const previousIndex = allSteps.indexOf(fromStep) - 1;
      const previousStep = allSteps[Math.max(previousIndex, 0)];

      if (previousStep === "storage" && state.fileStorage !== "s3") {
        return "system";
      }

      return previousStep;
    },
    [state.fileStorage]
  );

  const handleNext = React.useCallback(() => {
    const validationErrors = validateStep();
    if (hasFieldErrors(validationErrors)) {
      setFieldErrors(validationErrors);
      return;
    }

    if (
      step === "storage" &&
      state.fileStorage === "s3" &&
      !storageTestPassed
    ) {
      setGlobalError(t("Test the storage connection before continuing."));
      return;
    }

    setStep(getNextStep(step));
  }, [
    getNextStep,
    state.fileStorage,
    step,
    storageTestPassed,
    t,
    validateStep,
  ]);

  const handlePrevious = React.useCallback(() => {
    setGlobalError(undefined);
    setFieldErrors({});
    setStep(getPreviousStep(step));
  }, [getPreviousStep, step]);

  const handleEditStep = React.useCallback((nextStep: Step) => {
    setGlobalError(undefined);
    setFieldErrors({});
    setStep(nextStep);
  }, []);

  const handleTestStorage = React.useCallback(async () => {
    const validationErrors = validateStep(step);
    if (hasFieldErrors(validationErrors)) {
      setFieldErrors(validationErrors);
      return;
    }

    setGlobalError(undefined);
    setStorageTesting(true);
    setStorageTestPassed(false);
    try {
      const response = await client.post<StorageTestResponse>(
        "/installation.testStorage",
        {
          s3BucketName: state.s3BucketName,
          s3Region: state.s3Region || undefined,
          s3AccessKeyId: state.s3AccessKeyId,
          s3SecretAccessKey: state.s3SecretAccessKey,
          s3Endpoint: state.s3Endpoint || undefined,
          s3ForcePathStyle: state.s3ForcePathStyle,
        } as JSONObject
      );

      if (response.data.success) {
        setStorageTestPassed(true);
        toast.success(t("Connection successful"));
      } else {
        setGlobalError(response.data.error ?? t("Connection failed."));
      }
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : t("Connection failed.")
      );
    } finally {
      setStorageTesting(false);
    }
  }, [state, step, t, validateStep]);

  const handleSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      if (step !== "review") {
        event.preventDefault();
        handleNext();
        return;
      }

      for (const stepToValidate of allSteps) {
        if (stepToValidate === "review") {
          continue;
        }

        const validationErrors = validateStep(stepToValidate);
        if (hasFieldErrors(validationErrors)) {
          event.preventDefault();
          setStep(stepToValidate);
          setFieldErrors(validationErrors);
          return;
        }

        if (
          stepToValidate === "storage" &&
          state.fileStorage === "s3" &&
          !storageTestPassed
        ) {
          event.preventDefault();
          setStep(stepToValidate);
          setGlobalError(t("Test the storage connection before continuing."));
          return;
        }
      }
    },
    [handleNext, state.fileStorage, step, storageTestPassed, t, validateStep]
  );

  return (
    <Background>
      <BackButton onBack={onBack} />
      <ChangeLanguage locale={detectLanguage()} />
      <Wizard
        action="/api/installation.setup"
        method="POST"
        onSubmit={handleSubmit}
      >
        <ShellHeader>
          <BrandMark aria-hidden />
          <BrandText>
            <Text as="strong">Outline</Text>
            <Text type="secondary">{t("Setup")}</Text>
          </BrandText>
        </ShellHeader>

        <StepIndicator aria-label={t("Setup progress")}>
          {allSteps.map((item, index) => {
            const isNotRequired =
              item === "storage" && state.fileStorage !== "s3";

            return (
              <StepIndicatorItem
                key={item}
                data-testid="setup-step"
                aria-current={item === step ? "step" : undefined}
                $active={item === step}
                $complete={index < currentIndex}
                $notRequired={isNotRequired}
              >
                <StepNumber>{index + 1}</StepNumber>
                <StepLabel>
                  <span>{stepLabels[item]}</span>
                  {isNotRequired ? (
                    <StepMeta>{t("Not required")}</StepMeta>
                  ) : null}
                </StepLabel>
              </StepIndicatorItem>
            );
          })}
        </StepIndicator>

        <StepHeader>
          <StyledHeading>{stepContent[step].title}</StyledHeading>
          <StepDescription type="secondary">
            {stepContent[step].description}
          </StepDescription>
        </StepHeader>

        {step === "admin" && (
          <Inputs column gap={12}>
            <Input
              name="teamName"
              label={t("Workspace name")}
              margin={0}
              value={state.teamName}
              onChange={(event) => setField("teamName", event.target.value)}
              error={fieldErrors.teamName}
              required
              autoFocus
            />
            <Input
              name="userName"
              label={t("Admin name")}
              margin={0}
              value={state.userName}
              onChange={(event) => setField("userName", event.target.value)}
              error={fieldErrors.userName}
              required
            />
            <Input
              name="userEmail"
              type="email"
              label={t("Admin email")}
              margin={0}
              value={state.userEmail}
              onChange={(event) => setField("userEmail", event.target.value)}
              error={fieldErrors.userEmail}
              required
            />
            {isPasswordAuthEnabled ? (
              <>
                <Input
                  name="password"
                  type="password"
                  label={t("Password")}
                  margin={0}
                  value={state.password}
                  onChange={(event) => setField("password", event.target.value)}
                  error={fieldErrors.password}
                  required
                />
                <Input
                  name="passwordConfirmation"
                  type="password"
                  label={t("Confirm password")}
                  margin={0}
                  value={state.passwordConfirmation}
                  onChange={(event) =>
                    setField("passwordConfirmation", event.target.value)
                  }
                  error={fieldErrors.passwordConfirmation}
                  required
                />
              </>
            ) : null}
          </Inputs>
        )}

        {step === "system" && (
          <Inputs column gap={12}>
            <Input
              name="url"
              type="text"
              label={t("Site URL")}
              margin={0}
              value={state.url}
              onChange={(event) => setField("url", event.target.value)}
              error={fieldErrors.url}
              required
            />
            <InputSelect
              label={t("Default language")}
              options={languageOptions}
              value={state.defaultLanguage}
              onChange={(value) => setField("defaultLanguage", value)}
            />
            <input
              type="hidden"
              name="defaultLanguage"
              value={state.defaultLanguage}
            />
            <Switch
              label={t("Force HTTPS")}
              name="forceHttps"
              inForm={false}
              checked={state.forceHttps}
              onChange={(checked) => setField("forceHttps", checked)}
            />
            <input
              type="hidden"
              name="forceHttps"
              value={String(state.forceHttps)}
            />
            <InputSelect
              label={t("File storage")}
              options={storageOptions}
              value={state.fileStorage}
              onChange={(value) => setField("fileStorage", value)}
            />
            <input type="hidden" name="fileStorage" value={state.fileStorage} />
          </Inputs>
        )}

        {step === "storage" && (
          <Inputs column gap={12}>
            <FieldGroup>
              <GroupTitle>{t("Required")}</GroupTitle>
              <Input
                name="s3BucketName"
                label={t("Bucket name")}
                margin={0}
                value={state.s3BucketName}
                onChange={(event) =>
                  setField("s3BucketName", event.target.value)
                }
                error={fieldErrors.s3BucketName}
                required
              />
              <Input
                name="s3AccessKeyId"
                label={t("Access key ID")}
                margin={0}
                value={state.s3AccessKeyId}
                onChange={(event) =>
                  setField("s3AccessKeyId", event.target.value)
                }
                error={fieldErrors.s3AccessKeyId}
                required
              />
              <Input
                name="s3SecretAccessKey"
                type="password"
                label={t("Secret access key")}
                margin={0}
                value={state.s3SecretAccessKey}
                onChange={(event) =>
                  setField("s3SecretAccessKey", event.target.value)
                }
                error={fieldErrors.s3SecretAccessKey}
                required
              />
            </FieldGroup>
            <AdvancedOptions>
              <AdvancedSummary>{t("Advanced options")}</AdvancedSummary>
              <AdvancedFields>
                <Input
                  name="s3Region"
                  label={t("Region")}
                  margin={0}
                  value={state.s3Region}
                  onChange={(event) => setField("s3Region", event.target.value)}
                />
                <Input
                  name="s3Endpoint"
                  label={t("Endpoint URL")}
                  margin={0}
                  value={state.s3Endpoint}
                  onChange={(event) =>
                    setField("s3Endpoint", event.target.value)
                  }
                />
                <Switch
                  label={t("Force path style")}
                  name="s3ForcePathStyle"
                  inForm={false}
                  checked={state.s3ForcePathStyle}
                  onChange={(checked) => setField("s3ForcePathStyle", checked)}
                />
                <input
                  type="hidden"
                  name="s3ForcePathStyle"
                  value={String(state.s3ForcePathStyle)}
                />
                <Input
                  name="s3Acl"
                  label={t("ACL")}
                  margin={0}
                  value={state.s3Acl}
                  onChange={(event) => setField("s3Acl", event.target.value)}
                />
              </AdvancedFields>
            </AdvancedOptions>
            <ButtonLarge
              type="button"
              fullwidth
              neutral
              disabled={storageTesting}
              onClick={handleTestStorage}
            >
              {storageTesting ? t("Testing") : t("Test connection")}
            </ButtonLarge>
            {storageTestPassed ? (
              <StatusText type="secondary">
                {t("Connection successful")}
              </StatusText>
            ) : null}
          </Inputs>
        )}

        {step === "review" && (
          <>
            <Review>
              <ReviewSection>
                <ReviewSectionHeader>
                  <ReviewTitle>{t("Account")}</ReviewTitle>
                  <EditButton
                    type="button"
                    onClick={() => handleEditStep("admin")}
                  >
                    {t("Edit account")}
                  </EditButton>
                </ReviewSectionHeader>
                <ReviewRow label={t("Workspace")} value={state.teamName} />
                <ReviewRow label={t("Admin")} value={state.userEmail} />
              </ReviewSection>
              <ReviewSection>
                <ReviewSectionHeader>
                  <ReviewTitle>{t("System")}</ReviewTitle>
                  <EditButton
                    type="button"
                    onClick={() => handleEditStep("system")}
                  >
                    {t("Edit system")}
                  </EditButton>
                </ReviewSectionHeader>
                <ReviewRow label={t("Site URL")} value={state.url} />
                <ReviewRow
                  label={t("Language")}
                  value={selectedLanguageLabel}
                />
                <ReviewRow
                  label={t("HTTPS")}
                  value={state.forceHttps ? t("Enabled") : t("Disabled")}
                />
                <ReviewRow label={t("Storage")} value={selectedStorageLabel} />
              </ReviewSection>
              {state.fileStorage === "s3" ? (
                <ReviewSection>
                  <ReviewSectionHeader>
                    <ReviewTitle>{t("Storage")}</ReviewTitle>
                    <EditButton
                      type="button"
                      onClick={() => handleEditStep("storage")}
                    >
                      {t("Edit storage")}
                    </EditButton>
                  </ReviewSectionHeader>
                  <ReviewRow label={t("Bucket")} value={state.s3BucketName} />
                  <ReviewRow
                    label={t("Access key")}
                    value={state.s3AccessKeyId}
                  />
                  <ReviewRow label={t("Secret key")} value="********" />
                </ReviewSection>
              ) : null}
            </Review>
            <SetupPayloadFields
              state={state}
              isPasswordAuthEnabled={!!isPasswordAuthEnabled}
            />
          </>
        )}

        {globalError ? (
          <StatusText type="danger">{globalError}</StatusText>
        ) : null}

        <Actions gap={8}>
          {currentIndex > 0 ? (
            <ButtonLarge type="button" neutral onClick={handlePrevious}>
              {t("Back")}
            </ButtonLarge>
          ) : null}
          {step === "review" ? (
            <ButtonLarge type="submit" fullwidth>
              {t("Create workspace")}
            </ButtonLarge>
          ) : (
            <ButtonLarge type="button" fullwidth onClick={handleNext}>
              {t("Continue")}
            </ButtonLarge>
          )}
        </Actions>
      </Wizard>
    </Background>
  );
};

function SetupPayloadFields({
  state,
  isPasswordAuthEnabled,
}: {
  state: SetupState;
  isPasswordAuthEnabled: boolean;
}) {
  return (
    <>
      <input type="hidden" name="teamName" value={state.teamName} />
      <input type="hidden" name="userName" value={state.userName} />
      <input type="hidden" name="userEmail" value={state.userEmail} />
      {isPasswordAuthEnabled ? (
        <>
          <input type="hidden" name="password" value={state.password} />
          <input
            type="hidden"
            name="passwordConfirmation"
            value={state.passwordConfirmation}
          />
        </>
      ) : null}
      <input type="hidden" name="url" value={state.url} />
      <input
        type="hidden"
        name="defaultLanguage"
        value={state.defaultLanguage}
      />
      <input type="hidden" name="forceHttps" value={String(state.forceHttps)} />
      <input type="hidden" name="fileStorage" value={state.fileStorage} />
      {state.fileStorage === "s3" ? (
        <>
          <input type="hidden" name="s3BucketName" value={state.s3BucketName} />
          {state.s3Region ? (
            <input type="hidden" name="s3Region" value={state.s3Region} />
          ) : null}
          <input
            type="hidden"
            name="s3AccessKeyId"
            value={state.s3AccessKeyId}
          />
          <input
            type="hidden"
            name="s3SecretAccessKey"
            value={state.s3SecretAccessKey}
          />
          {state.s3Endpoint ? (
            <input type="hidden" name="s3Endpoint" value={state.s3Endpoint} />
          ) : null}
          <input
            type="hidden"
            name="s3ForcePathStyle"
            value={String(state.s3ForcePathStyle)}
          />
          {state.s3Acl ? (
            <input type="hidden" name="s3Acl" value={state.s3Acl} />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function ReviewRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Row>
      <Text type="secondary">{label}</Text>
      <Value>{value}</Value>
    </Row>
  );
}

const Wizard = styled(Form)`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  box-sizing: border-box;
  width: min(92vw, 560px);
  max-width: 560px;
  max-height: calc(100vh - 48px);
  margin: 24px auto;
  padding: 28px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  gap: 18px;
  color: ${s("text")};
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 10%);

  @media (max-width: 600px) {
    width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    margin: 16px auto;
    padding: 20px;
  }
`;

const ShellHeader = styled.header`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const BrandMark = styled.span`
  width: 16px;
  height: 16px;
  border: 2px solid ${s("accent")};
  border-radius: 4px;
  transform: rotate(45deg);
`;

const BrandText = styled.div`
  display: flex;
  align-items: baseline;
  gap: 6px;
`;

const Inputs = styled(Flex)`
  width: 100%;
  text-align: left;
  row-gap: 14px;

  > * {
    display: block;
    flex: none;
    width: 100%;
    min-width: 0;
  }

  label {
    display: block;
    width: 100%;
  }
`;

const StyledHeading = styled(Heading)`
  margin: 0;
  text-align: left;
`;

const StepHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const StepDescription = styled(Text)`
  line-height: 1.45;
`;

const StepIndicator = styled.nav`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  width: 100%;

  @media (max-width: 520px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const StepIndicatorItem = styled.div<{
  $active: boolean;
  $complete: boolean;
  $notRequired: boolean;
}>`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px;
  border: 1px ${(props) => (props.$notRequired ? "dashed" : "solid")}
    ${(props) =>
      props.$active || props.$complete ? s("accent") : s("divider")};
  border-radius: 6px;
  color: ${(props) =>
    props.$active || props.$complete ? s("text") : s("textSecondary")};
  opacity: ${(props) => (props.$notRequired ? 0.72 : 1)};
`;

const StepNumber = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: ${s("divider")};
  font-size: 12px;
  font-weight: 600;
`;

const StepLabel = styled.span`
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: 13px;
  line-height: 1.2;
`;

const StepMeta = styled.span`
  color: ${s("textSecondary")};
  font-size: 11px;
`;

const Review = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
`;

const ReviewSection = styled.section`
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  overflow: hidden;
`;

const ReviewSectionHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid ${s("divider")};
`;

const ReviewTitle = styled(Text)`
  font-weight: 600;
`;

const EditButton = styled.button`
  padding: 0;
  border: 0;
  background: transparent;
  color: ${s("accent")};
  cursor: pointer;
  font: inherit;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: minmax(112px, 0.7fr) minmax(0, 1.3fr);
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid ${s("divider")};

  &:last-child {
    border-bottom: 0;
  }

  @media (max-width: 480px) {
    grid-template-columns: 1fr;
    gap: 4px;
  }
`;

const Value = styled(Text)`
  min-width: 0;
  overflow-wrap: anywhere;
  text-align: right;

  @media (max-width: 480px) {
    text-align: left;
  }
`;

const StatusText = styled(Text)`
  text-align: center;
  overflow-wrap: anywhere;
`;

const FieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const GroupTitle = styled(Text)`
  font-weight: 600;
`;

const AdvancedOptions = styled.details`
  width: 100%;
`;

const AdvancedSummary = styled.summary`
  cursor: pointer;
  color: ${s("textSecondary")};
`;

const AdvancedFields = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 12px;
`;

const Actions = styled(Flex)`
  width: 100%;
  align-items: stretch;
  margin-top: 4px;

  > *:first-child {
    flex: none;
  }

  > *:last-child {
    flex: 1 1 0;
    min-width: 0;
  }

  @media (max-width: 420px) {
    flex-direction: column;
  }
`;

export default SetupWizard;
