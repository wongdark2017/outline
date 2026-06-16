import * as React from "react";
import env from "@server/env";
import type { EmailProps } from "./BaseEmail";
import BaseEmail, { EmailMessageCategory } from "./BaseEmail";
import Body from "./components/Body";
import Button from "./components/Button";
import EmailTemplate from "./components/EmailLayout";
import EmptySpace from "./components/EmptySpace";
import Footer from "./components/Footer";
import Header from "./components/Header";
import Heading from "./components/Heading";

type Props = EmailProps & {
  name: string;
  actorName: string;
  actorEmail: string | null;
  teamName: string;
  teamUrl: string;
  activationUrl: string;
};

/**
 * Email sent to an invited user when they must set a password to activate.
 */
export default class InvitePasswordActivationEmail extends BaseEmail<
  Props,
  void
> {
  protected get category() {
    return EmailMessageCategory.Invitation;
  }

  protected subject({ actorName, teamName }: Props) {
    return this.t(
      "{{ actorName }} invited you to join {{ teamName }}’s workspace",
      {
        actorName,
        teamName,
      }
    );
  }

  protected preview() {
    return this.t("Use this link to set your password and activate your account.");
  }

  protected renderAsText({
    actorName,
    actorEmail,
    teamName,
    activationUrl,
  }: Props): string {
    return `
${this.t("Join {{ teamName }} on {{ appName }}", {
  teamName,
  appName: env.APP_NAME,
})}

${actorName} ${actorEmail ? `(${actorEmail})` : ""} ${this.t(
  "invited you to join this workspace."
)}

${this.t("Set your password")}: ${activationUrl}
`;
  }

  protected render({
    teamName,
    actorName,
    actorEmail,
    activationUrl,
  }: Props) {
    return (
      <EmailTemplate previewText={this.preview()}>
        <Header />

        <Body>
          <Heading>
            {this.t("Join {{ teamName }} on {{ appName }}", {
              teamName,
              appName: env.APP_NAME,
            })}
          </Heading>
          <p>
            {actorName} {actorEmail ? `(${actorEmail})` : ""}{" "}
            {this.t("invited you to join this workspace.")}
          </p>
          <p>
            {this.t("Set your password to activate your account and continue.")}
          </p>
          <EmptySpace height={10} />
          <p>
            <Button href={activationUrl}>{this.t("Set your password")}</Button>
          </p>
        </Body>

        <Footer />
      </EmailTemplate>
    );
  }
}
