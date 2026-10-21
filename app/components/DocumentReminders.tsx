import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ReminderValidation } from "@shared/validations";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Input from "~/components/Input";
import type Document from "~/models/Document";
import useStores from "~/hooks/useStores";
import Text from "~/components/Text";
import Time from "~/components/Time";

interface Props {
  /** The document to set a reminder on. */
  document: Document;
}

/**
 * Dialog for setting a reminder email on a document.
 */
export const DocumentReminder = observer(function DocumentReminder({
  document,
}: Props) {
  const { t } = useTranslation();
  const { reminders } = useStores();
  const [remindAt, setRemindAt] = React.useState("");
  const [note, setNote] = React.useState("");

  // …inside DocumentReminder, below the useState lines
  // (const { reminders } = useStores(); is already at the top)
  React.useEffect(() => {
    void reminders.fetchPage({ documentId: document.id });
  }, [reminders, document.id]);

  const upcoming = reminders.forDocument(document.id); // re-renders on websocket updates

  // …in the returned JSX, inside <ConfirmationDialog>, before the first <Input>
  {
    upcoming.map((reminder) => (
      <Text key={reminder.id} as="p" type="secondary">
        <Time dateTime={reminder.remindAt} addSuffix />
        {reminder.note ? ` · ${reminder.note}` : null}
      </Text>
    ));
  }

  const handleSubmit = async () => {
    await reminders.create({
      documentId: document.id,
      // datetime-local is in the browser's time zone; send UTC
      remindAt: new Date(remindAt).toISOString(),
      note: note.trim() || undefined,
    });
    toast.success(t("We'll email you a reminder around then"));
  };

  const handleRemindAtChange = (ev: React.ChangeEvent<HTMLInputElement>) =>
    setRemindAt(ev.target.value);

  const handleNoteChange = (ev: React.ChangeEvent<HTMLInputElement>) =>
    setNote(ev.target.value);

  return (
    <ConfirmationDialog
      onSubmit={handleSubmit}
      submitText={t("Set reminder")}
      disabled={!remindAt}
    >
      <Input
        type="datetime-local"
        label={t("Remind me on")}
        value={remindAt}
        onChange={handleRemindAtChange}
        autoFocus
        required
      />
      <Input
        label={t("Note")}
        placeholder={t("Optional")}
        value={note}
        onChange={handleNoteChange}
        maxLength={ReminderValidation.maxNoteLength}
      />
    </ConfirmationDialog>
  );
});
