# Component Guidelines

> Documents form patterns and shared theme styling.

---

## Forms

Two patterns are in use. Pick by form size; do not mix them in one form.

### A. Local state + `<form onSubmit>`: small dialogs (1–3 fields)

Used by `plugins/passkeys/client/components/RenamePasskeyDialog.tsx`, `app/scenes/Invite.tsx` and 13 other files.

```tsx
const [name, setName] = React.useState(currentName || "");
const [isSaving, setIsSaving] = React.useState(false);

const handleSubmit = async (ev: React.FormEvent) => {
  ev.preventDefault();
  setIsSaving(true);
  try {
    await client.post("/passkeys.update", { id: passkeyId, name: name.trim() });
    toast.success(t("Passkey updated"));
    onSuccess();
  } catch (err) {
    toast.error(errToString(err));
  } finally {
    setIsSaving(false);
  }
};

return (
  <form onSubmit={handleSubmit}>
    <Input value={name} onChange={(ev) => setName(ev.target.value)} disabled={isSaving} required />
    <Button type="submit" disabled={isSaving || !name.trim()}>{t("Save")}</Button>
  </form>
);
```

### B. `react-hook-form`: settings and multi-field forms with stored defaults

Used by 11 files, e.g. `plugins/umami/client/Settings.tsx`, `app/components/Collection/CollectionForm.tsx`, `plugins/webhooks/client/components/WebhookSubscriptionForm.tsx`.

```tsx
const { register, reset, handleSubmit: formHandleSubmit, formState } =
  useForm<FormData>({ mode: "all", defaultValues: { umamiDomain: instanceUrl } });

// Re-sync when the stored values load or change.
React.useEffect(() => {
  reset({ umamiDomain: instanceUrl });
}, [reset, instanceUrl]);

<form onSubmit={formHandleSubmit(handleSubmit)}>
  <Input {...register("umamiDomain", { required: true })} />
  <Button type="submit" disabled={formState.isSubmitting}>
    {formState.isSubmitting ? `${t("Saving")}…` : t("Save")}
  </Button>
</form>
```

### Rules for both

- Inputs and buttons come from `~/components/Input` and `~/components/Button`; all visible strings go through `t()`.
- Disable submit while saving (`isSaving` or `formState.isSubmitting`).
- Report failures with `toast.error(errToString(err))` (64 uses); report success with `toast.success(t(...))`.
- Save through a MobX store method when one exists (`integrations.save`, `users.invite`); call `client.post("/<resource>.<verb>")` directly only when no store models the data (18 files).
- The server schema is the validation source of truth; client-side checks (`required`, trimming) only prevent obvious mistakes.
- Use `usePolicy(model)` to hide or disable actions the user cannot perform (69 files); the server still enforces with `authorize`.

## Shared theme styling

- Adapt external themes through semantic tokens in `shared/styles/theme.ts` and scoped styled-components. Preserve `buildLightTheme`/`buildDarkTheme` custom palette overrides and use real dark colors rather than inverting the page.
- Keep the user's `fontFamilies` stacks and the `--font-body`, `--font-ui`, `--font-mono` variables. Document typography belongs in the document wrapper; shared editor element styles in `shared/editor/components/Styles.ts` also reach read-only rendering and HTML export.
- Measure contrast after translucent backgrounds are composited. Test dark sidebar active text, inline code and focused buttons, including hover/focus states. Use `selected` for focus outlines so the dark theme can supply a visible accent variant.
- `Highlight.toDOM` emits inline translucent backgrounds. The default highlight omits `data-color`; its theme CSS can supply an opaque default background and `textHighlightForeground`. Preserve explicitly selected `data-color` backgrounds. Test links inside default highlights as well as ordinary highlighted text so external-link pill styles cannot introduce a dark background beneath dark text.
- Keep KaTeX selectors, editable source styling, mobile overflow and print visibility rules when adapting editor styles. Formula rendering uses the installed KaTeX package; preserve MathML output, source-editor selection boundaries, and font readiness before printing. Verify the actual default/custom highlight DOM and both light/dark themes, mobile width, RTL sidebar selection, menus and printing.
- Formula source editors forward undo/redo shortcuts to the enclosing editor's configured key handlers. Do not bind them directly to `prosemirror-history`: collaborative editors use Yjs history. Keep select-all confined to the formula source.
- A sidebar's decorative accent rail must remain in every hover/focus/collapsed shadow branch. Use logical inline properties for active indicators and dividers.
