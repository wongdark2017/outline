import { ClockIcon } from "outline-icons";
import { createAction } from "~/actions";
import { ActiveDocumentSection } from "~/actions/sections";
import { DialogTitle } from "~/components/DialogTitle";
import { DocumentReminder } from "~/components/DocumentReminders";

export const remindAboutDocument = createAction({
  name: ({ t }) => `${t("Remind me")}…`,
  analyticsName: "Remind about document",
  section: ActiveDocumentSection,
  icon: <ClockIcon />,
  keywords: "reminder alarm later follow up",
  visible: ({ activeDocumentId, stores }) =>
    !!activeDocumentId &&
    !!stores.policies.abilities(activeDocumentId).remind,
  perform: ({ activeDocumentId, stores, t }) => {
    const document = activeDocumentId
      ? stores.documents.get(activeDocumentId)
      : undefined;
    if (!document) {
      return;
    }

    stores.dialogs.openModal({
      title: <DialogTitle title={t("Remind me")} model={document} />,
      content: <DocumentReminder document={document} />,
    });
  },
});