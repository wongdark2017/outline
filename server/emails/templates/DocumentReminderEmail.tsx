import * as React from "react";
import BaseEmail, { EmailMessageCategory, EmailProps } from "./BaseEmail";
import Body from "./components/Body";
import Button from "./components/Button";
import EmailTemplate from "./components/EmailLayout";
import EmptySpace from "./components/EmptySpace";
import Footer from "./components/Footer";
import Header from "./components/Header";
import Heading from "./components/Heading";

type Props = EmailProps & {
  documentTitle: string;
  documentUrl: string;
  note: string | null;
};

export default class DocumentReminderEmail extends BaseEmail<Props> {
  protected get category(): EmailMessageCategory {
    return EmailMessageCategory.Notification;
  }
  protected subject({ documentTitle }: Props) {
    return this.t("Reminder: {{ documentTitle }}", { documentTitle });
  }

  protected preview({ note }: Props) {
    return note ?? this.t("You asked to be reminded about this document.");
  }
  protected renderAsText({ documentTitle, documentUrl, note }: Props) {
    return `${this.t("You asked to be reminded about {{ documentTitle }}", { documentTitle })}.${note ?? ""}
${this.t("View Document")}: ${documentUrl}`;
  }
  protected render(props: Props) {
    const { documentTitle, documentUrl, note } = props;
    return (
      <EmailTemplate previewText={this.preview(props)}>
        <Header />
        <Body>
          <Heading>{documentTitle}</Heading>
          <p>{this.t("You asked to be reminded about this document.")}</p>
          {note && <p>{note}</p>}
          <EmptySpace height={10} />
          <p>
            <Button href={documentUrl}>{this.t("View Document")}</Button>
          </p>
        </Body>
        <Footer />
      </EmailTemplate>
    );
  }
}
