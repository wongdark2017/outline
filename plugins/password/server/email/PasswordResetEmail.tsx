import env from "@server/env";
import type { EmailProps } from "@server/emails/templates/BaseEmail";
import BaseEmail, {
  EmailMessageCategory,
} from "@server/emails/templates/BaseEmail";
import Body from "@server/emails/templates/components/Body";
import Button from "@server/emails/templates/components/Button";
import EmailTemplate from "@server/emails/templates/components/EmailLayout";
import EmptySpace from "@server/emails/templates/components/EmptySpace";
import Footer from "@server/emails/templates/components/Footer";
import Header from "@server/emails/templates/components/Header";
import Heading from "@server/emails/templates/components/Heading";

type Props = EmailProps & {
  resetUrl: string;
  teamUrl: string;
};

export class PasswordResetEmail extends BaseEmail<Props> {
  protected get category() {
    return EmailMessageCategory.Authentication;
  }

  protected subject() {
    return this.t("Reset your {{ appName }} password", {
      appName: env.APP_NAME,
    });
  }

  protected preview() {
    return this.t("Use this link to reset your password.");
  }

  protected renderAsText({ resetUrl, teamUrl }: Props) {
    return `
${this.t("You requested to reset your {{ appName }} password.", {
  appName: env.APP_NAME,
})}

${this.t("Use the link below to choose a new password")}:

${resetUrl}

${this.t("If the link expired you can request another from your workspace sign-in page at")}: ${teamUrl}
`;
  }

  protected render({ resetUrl }: Props) {
    return (
      <EmailTemplate previewText={this.preview()}>
        <Header />

        <Body>
          <Heading>
            {this.t("Reset your {{ appName }} password", {
              appName: env.APP_NAME,
            })}
          </Heading>
          <p>
            {this.t("You requested to reset your {{ appName }} password.", {
              appName: env.APP_NAME,
            })}
          </p>
          <EmptySpace height={10} />
          <p>
            <Button href={resetUrl}>{this.t("Reset password")}</Button>
          </p>
        </Body>

        <Footer />
      </EmailTemplate>
    );
  }
}
