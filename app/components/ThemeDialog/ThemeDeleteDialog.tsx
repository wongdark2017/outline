import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import type ThemeModel from "~/models/Theme";

interface Props {
  /** The theme being deleted. */
  theme: ThemeModel;
  /** Callback invoked after a successful deletion. */
  onSubmit: () => void;
}

/**
 * Dialog confirming deletion of a custom theme.
 */
export function ThemeDeleteDialog({ theme, onSubmit }: Props) {
  const { t } = useTranslation();

  const handleSubmit = async () => {
    await theme.delete();
    onSubmit();
    toast.success(t("Theme deleted"));
  };

  return (
    <ConfirmationDialog
      onSubmit={handleSubmit}
      submitText={t("I’m sure – Delete")}
      savingText={`${t("Deleting")}…`}
      danger
    >
      <Trans
        defaults="Are you sure you want to delete the <em>{{themeName}}</em> theme? Anyone using it will switch back to the workspace default."
        values={{ themeName: theme.name }}
        components={{ em: <strong /> }}
      />
    </ConfirmationDialog>
  );
}
