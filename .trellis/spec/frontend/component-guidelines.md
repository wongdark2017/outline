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

The legacy `/settings/theme` and `/settings/themes` manager and all `themes.*`
RPC endpoints are currently paused. Do not mount `useCustomThemeTokens` or request
themes from Preferences or `CustomizationPreview`. Application and preview use
the built-in light/dark/system palette with the existing branding accent input;
saved legacy IDs/cache do not select a palette. Keep stored themes and preferences
intact. Backgrounds use the remaining `customizations.*` endpoints; author CSS
and scripts are currently paused with stored data retained. Legacy
addresses redirect with replace, preserve search/hash (including recovery), and
choose workspace appearance only when `can.update` permits it.

- Adapt external themes through semantic tokens in `shared/styles/theme.ts` and scoped styled-components. Preserve `buildLightTheme`/`buildDarkTheme` custom palette overrides and use real dark colors rather than inverting the page.
- Keep the user's `fontFamilies` stacks and the `--font-body`, `--font-ui`, `--font-mono` variables. Document typography belongs in the document wrapper; shared editor element styles in `shared/editor/components/Styles.ts` also reach read-only rendering and HTML export.
- Measure contrast after translucent backgrounds are composited. Test dark sidebar active text, inline code and focused buttons, including hover/focus states. Use `selected` for focus outlines so the dark theme can supply a visible accent variant.
- `Highlight.toDOM` emits inline translucent backgrounds. The default highlight omits `data-color`; its theme CSS can supply an opaque default background and `textHighlightForeground`. Preserve explicitly selected `data-color` backgrounds. Test links inside default highlights as well as ordinary highlighted text so external-link pill styles cannot introduce a dark background beneath dark text.
- Keep KaTeX selectors, editable source styling, mobile overflow and print visibility rules when adapting editor styles. Formula rendering uses the installed KaTeX package; preserve MathML output, source-editor selection boundaries, and font readiness before printing. Verify the actual default/custom highlight DOM and both light/dark themes, mobile width, RTL sidebar selection, menus and printing.
- Formula source editors forward undo/redo shortcuts to the enclosing editor's configured key handlers. Do not bind them directly to `prosemirror-history`: collaborative editors use Yjs history. Keep select-all confined to the formula source.
- A sidebar's decorative accent rail must remain in every hover/focus/collapsed shadow branch. Use logical inline properties for active indicators and dividers.

### Table column width rendering

`prosemirror-tables` writes saved and actively dragged `colwidth` values to the
table's `<colgroup>`. Keep `table-layout: fixed` in
`shared/editor/components/Styles.ts`; with automatic table layout, long code
paths can shrink a 278px column to about 43px even while its `<col>` changes to
378px during a drag. Unspecified columns use the upstream 100px
`defaultCellMinWidth` through `columnResizing({ View: TableView })`; this lets
the existing scroll wrapper carry overflow on narrow viewports. Inside tables,
allow `.code-word` spans to wrap with `white-space: break-spaces` and
`overflow-wrap: anywhere`, since their desktop default is `nowrap`.

```css
table {
  table-layout: fixed;
}

table .code-word {
  white-space: break-spaces;
  overflow-wrap: anywhere;
}
```

When changing these styles, verify a stored width before and during a real
drag, persistence after reload, a long inline-code path, and horizontal scroll
at a narrow viewport. Also check tables with no stored widths and full-width
mode.

## Historical contract: Appearance settings and script lifecycle

The current product is background-only. CSS and script entry points, effective
sources and execution are paused; the current contract below takes precedence.

### 1. Scope / Trigger

`CustomizationProvider` belongs inside authenticated routes, outside per-page
scenes. Public shares do not mount it, even with a signed-in viewer. Independent
settings live in `CustomizationsStore`; the API contract is documented in
`../backend/quality-guidelines.md`.

### 2. Signatures

- `CustomizationRuntime.setScript({ identity, id, digest, url } | null)` owns
  one exact consented revision. `stop()` disposes registered resources.
- ESM exports `activate(ctx)`, which can return a synchronous or asynchronous
  cleanup function. Context provides `appRoot`, `toolbar`, `appearance`,
  `signal`, `onCleanup`, `onNavigation` and `onAppearanceChange`.
- Recovery is `?disableCustomizations=1`; check it before using stored settings.

### 3. Contracts

Workspace CSS loads before personal CSS. CSS specificity and importance still
apply. Screen-only style elements and background CSS variables must clear for
printing, recovery and identity changes. Use `backgroundColor` rather than a
`background` shorthand in `PageTheme`; a shorthand resets the uploaded image.
Keep the normal opaque document surface when no custom background is active.
When a background is active, the main `content` region uses a 92% theme surface
and the editor uses that same surface without a second background or decorative
rounded card. A nested 94% editor surface over 92% main opacity becomes 99.52%
opaque and makes the image nearly disappear inside the article. Remove that
extra base rule instead of forcing every editor background to transparent; keep
the `editor` DOM hook and author CSS overrides intact. Transparent settings
controls remain readable over light images in dark mode and dark images in light
mode. Verify the composited
text contrast in a real browser; jsdom does not calculate `color-mix()` pixels.

Load native modules from the authenticated versioned endpoint. Never evaluate
source text with `eval` or `new Function`. Match revision ID AND digest after
revalidation; websocket invalidation, reconnect, visibility and fallback polling
update that state. Do not restart a script for CSS/background or theme changes.
Generation checks prevent delayed imports from activating obsolete scripts;
abort immediately and run each registered cleanup once. A disposed async
activation must still execute a late returned disposer.

This is trusted main-window execution. Imported module top-level code is not
cancelable, and arbitrary DOM changes or network requests cannot be undone.
Place side effects in `activate` and register cleanup. Runtime-fetched code is
outside the managed dependency digest; UI must state this limit explicitly.

Each tab has separate draft/version/error state. Do not replace unsaved drafts
on revalidation or save another tab's draft implicitly. Preview background/CSS
in an iframe with no script permission; fetch authorized images as local blob
URLs and revoke them. Never run preview JavaScript. Provide a copyable recovery
URL alongside the recovery action.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| New publication | Stop old managed effects; show `Enable again`; require exact consent. |
| Slow import or activation after disable/logout | Do not call `activate` after a stale import; dispose managed effects and run any late returned cleanup. |
| Failed save or stale version | Keep saved state and unsaved draft; show an error/reload action. |
| Invalid source/modules or image | Show validation error; do not replace saved settings. |
| Recovery or print | Remove custom appearance and pause managed script effects; keep recovery editors usable. |

### 5. Good / Base / Bad Cases

Good: SPA navigation keeps one running instance and notifies registered listeners.
Base: no consent means no import. Bad: assume dynamic import is a sandbox, claim
all script side effects can be undone, or infer consent from a theme selection.

### 6. Tests Required

Run `CustomizationsStore.test.ts`, `CustomizationRuntime.test.ts`,
`customizations.test.ts` and `customizationPreview.test.ts`. Assert stale identity
responses are discarded, exact consent is required, field versions remain
independent, cleanup survives StrictMode/async races, CSS order is stable and
preview HTML cannot execute scripts. Use real-browser native ESM for publication,
reenabling, navigation, print/recovery and signed-in public shares. Check actual
control bounds at 320/390/736/1024 px; body overflow alone can hide clipped fields.

### 7. Wrong vs Correct

Wrong: `document.body.style.background = theme.background` resets the image.
Correct: `document.body.style.backgroundColor = theme.background` changes only
the theme color and preserves independent background configuration.

## Scenario: Releasing the startup root background for saved images

### 1. Scope / Trigger

`server/static/index.html` gives `#root` an inline background before React loads.
It fills the viewport between `body` and the authenticated layout. Making the
layout transparent does not release this opaque layer; an image can upload,
preview, save and decode successfully while remaining completely hidden.

### 2. Signatures

`CustomizationStyleManager.apply(state)` acquires the existing root background
when an image activates. `clear()`, `dispose()` and an apply without an image
release it. The snapshot stores the element, background value and CSS priority.
The server/API/storage contracts remain unchanged.

### 3. Contracts

Capture the pre-existing inline `background` shorthand once, then remove it so
the authenticated body image can paint. Revalidation and image replacement must
not replace the saved original value with an empty value. Leave unrelated inline
styles untouched. No image means no acquisition; an independently authored
longhand without a shorthand must not be taken over.

Restore the original value and priority on cleanup only while the controller
still owns the cleared state. If an author script writes a new `background` or
`background-*` declaration after acquisition, retain that author change rather
than overwrite it. Clear the snapshot even on repeated cleanup. Do not add
`!important` to fight user CSS or remove the startup loading background globally.

Keep the screen-only 92% main surface without a second editor surface. Restoration during
print/recovery/logout must not leave the private image behind. Native printing
restores the root, clears custom appearance, then reacquires after printing when
the saved image remains active.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Saved image plus startup root shorthand | Root becomes transparent; actual image pixels reach the main surface. |
| Replace image or repeat apply | Retain the first snapshot and paint the new image. |
| Remove image, clear or dispose | Restore original background/priority and preserve unrelated inline properties. |
| Author writes shorthand or longhand after acquisition | Preserve the author's new value during cleanup. |
| No image or pre-existing longhand without a shorthand | Do not remove unrelated authored styles. |
| Recovery or native printing | No custom image; root restoration remains safe and idempotent. |

### 5. Good / Base / Bad Cases

Good: black and white image cells produce different real screenshot pixels after
save, while text contrast remains at least 4.5:1. Base: the startup root remains
unchanged when no background is configured. Bad: accept a saved asset ID, decoded
image, CSS variable or iframe preview as proof that the main page displays it.

### 6. Tests Required

`app/utils/customizations.test.ts` creates a realistic opaque startup `#root` and
covers acquisition, replacement, no-image restoration, clear/dispose, repeated
cleanup, priority, unrelated styles and author overrides. Inspect actual CSS
declarations and computed styles in jsdom; a shorthand getter can retain an old
cached value after `removeProperty()` even when its declaration is gone.

Use a high-contrast checkerboard in a real browser with the actual HTML bootstrap.
Sample the same blank main-surface coordinates before and after the fix. At the
current 92% light surface, black/white cells differ by about 20 channel levels;
the defective opaque root produces zero difference. Also verify contain, swapping,
light/dark contrast, original-root restoration, native document print and recovery.
Do not use an almost-white avatar or CSS-variable presence as the paint test.

### 7. Wrong vs Correct

Wrong: only make Layout/Document transparent and assume body images are visible.
That ignores the opaque startup root between them.

Correct: manage the intervening root shorthand's lifecycle and verify visible
pixels through the real page, preserving cleanup and author ownership.

### Collection surfaces and sticky tabs

The Home `Documents`, collection `Content` and shared `Tabs` sticky wrapper must use
`background: var(--outline-customization-layout-background, ${s("background")})`.
An opaque theme background in either component creates a second solid slab over
the main content's readable surface. Reuse the existing variable; do not override
all descendant backgrounds or reduce the main surface opacity to fix a local slab.

When a custom image is active on screen, sticky tabs use `backdrop-filter: blur(12px)`
to soften rows scrolling underneath. Their overflow cue uses a `mask-image`
gradient when more tabs remain to the right, and `none` at the end. Disable the
old opaque theme-colored `::after` fade in this state. Scope blur/mask changes to
`@media screen` and `body[data-outline-customization-background]`; ordinary pages,
recovery and printing retain the theme background and original overflow cue.

Verify the actual collection route with enough documents to scroll: list and
tabs paint the saved image, sticky links remain clickable, and 320/390px widths
allow horizontal scrolling and keyboard access to the final A–Z tab. A screenshot
of the settings page alone cannot verify collection-specific backgrounds.

Home has a separate `Documents` wrapper shared by Recently viewed, Popular,
Recently updated and Created by me. Verify all four routes with seeded viewed and
owned documents. In dark mode an opaque slab is dark rather than white, so test
both themes with actual background pixels. Parent/layout and collection fixes
do not automatically release Home's local background. Audit other list wrappers
without clearing intentional input, drag-over, highlight or sticky-mask surfaces.

Use a short article with a rendered formula and a child document to verify the
article surface. Compare actual pixels just inside and outside the editor edge
over the same image cell: there must be no extra near-white card boundary.
Verify read and edit modes, light/dark text contrast, narrow screens, author CSS,
recovery and native printing. Do not treat an opaque inner editor as necessary
for readability when the containing main surface already provides it.

### Inline editable title backgrounds

`ContentEditable` renders its text and empty placeholder in an inner styled
`span`. Releasing the document/editor wrapper does not release that span's own
background. Use the same existing layout background variable with the original
theme fallback in this shared component. Preserve `color`, `-webkit-text-fill-color`,
`data-empty`, placeholder pseudo-element rules and editing/selection handlers.
Do not broadly clear all spans, inputs, highlights or code surfaces.

Test a real image with a dark cell beneath the title: a white image cell can
hide the defect even in a real screenshot. Verify populated text, the read-only
Untitled fallback, the truly empty editable placeholder and a focused caret.
Compare unchanged blank glyph pixels before/after, then check light/dark,
390px width, author CSS, no-image fallback, recovery and native printing.

## Current contract: Background-only appearance and Chinese UI

`Customizations` mounts only the background form and isolated image preview.
Do not mount CSS/JavaScript editors or retain their tab navigation. Personal and
admin settings follow the user's existing language preference; Simplified Chinese
must cover menus, descriptions, upload/save/recovery, error states and preview
sample text. Use ordinary English source extraction and preserve unrelated locale
values. Background fit labels use dedicated ordinary source keys (`Fill
background`, `Fit background`, `Tile background`) to avoid changing the global
meaning of `Cover` or exposing generated `_background` keys in English.

The main sidebar and personal collection display name already use `t("Personal")`.
Provide the missing Simplified Chinese value `个人` in that catalog; do not
rename stored personal collections or change the English source key.

The Provider must not import/instantiate `CustomizationRuntime` or request author
modules. Pass empty workspace/personal CSS to the style manager. Store effective
CSS getters return empty strings and the effective script is null even if an old
response claims a valid consent. The preview builder no longer accepts or injects
user CSS. Keep dormant source and stored data rather than deleting it.

Retain background identity checks, invalidation/reconnect/visibility refresh,
print/recovery cleanup, source inheritance and private image access. Keep all
previous root/collection/article/title background fixes. Old positive script/CSS
tests and custom author-CSS examples describe historical dormant behavior, not
the active product surface.

Run store, preview and style tests. In a real production browser, seed nonempty
CSS and exact consent, confirm no effects/module requests, inject a stale enabled
response to prove client suppression, then exercise Chinese personal/admin forms,
preview-before-save, inheritance, personal override, errors, mobile, print and
recovery. Reload paused database fields to prove they were retained. Source
inspection and hiding tabs alone do not prove the full pause.

## Scenario: Editable TikZ image lifecycle

### 1. Scope / Trigger

TikZ crosses the UI extension, CodeMirror, browser worker, attachment upload,
shared image serialization, static assets and CSP. Preserve its ordinary-image
storage format when changing any of those boundaries.

### 2. Signatures

- Commands: `insertTikz()` and `editTikz()`; editing requires a TikZ image
  `NodeSelection`, a live editable view and an upload callback.
- `renderTikz(source: string, signal?: AbortSignal): Promise<RenderResult>`;
  success is `{ ok: true, svg }`, failure is `{ ok: false, error, reason }`.
  Reasons are `compile`, `timeout`, `engine`, `invalid-svg`, and `aborted`.
- `prepareSource(source)` returns `{ tex, info }`; `embedSource(svg, source)`
  and `extractSource(svg)` exchange the exact original source.
- `TikzSession.save(svg, save)` supplies an attempt-specific abort signal.
  `findImageNodeBySrc(doc, src)` returns the first image and its current position.

### 3. Contracts

`ExtensionManager.widgets` probes widgets before a session exists. Return a
lightweight wrapper while closed; mount the lazy editor only during a writable
session. Keep CodeMirror and threads out of eager imports and browser globals
out of module initialization.

Debounce source revisions for 600 ms. Disable saving immediately on an edit,
including undo to identical text; only that revision's successful preview is
current. Retain the last successful preview during compilation and errors.
Each render allocates a fresh worker, retains it before `spawn()` resolves and
terminates it exactly once. The 10-second timeout includes startup/loading.
Remove timer/listener resources on every path and keep user cancellation silent.

Resolve `/static/tikzjax-e374921f` against the page origin, independent of
`CDN_URL`. Create threads workers with `{ CORSWorkaround: false }`; absolute URLs
otherwise become blob wrappers that violate `worker-src 'self'`. CSP adds only
`'wasm-unsafe-eval'`. Workbox ignores `**/tikzjax-*/**`, including `fonts.css`, so
reader precaching never loads the engine. Keep pinned vendor bytes unchanged;
root/server Oxlint and oxfmt ignore this vendor subtree. Verify its 449 hashes
and preserve its component-specific licenses and recorded build-source gap.

Development assets pass through `createViteMiddleware()` before the page's CSP.
The pinned worker response must carry its own strict policy allowing same-origin
scripts/connections and `wasm-unsafe-eval`. Engine `.gz` files are opaque gzip
inputs for the worker's decompressor, not HTTP-encoded representations: remove
Vite's `Content-Encoding` only for the pinned engine assets. A 304 cannot remove
an encoding header stored by an older response. Do not forward conditional
validators for these gzip inputs; return a fresh entity to repair existing
browser caches. Preserve ordinary asset caching and production behavior. Check
the bytes returned by browser `fetch()`, not just raw curl responses, and verify
failure-to-success recovery in the same browser with a previously cached asset.

Compilation adaptations may remove declarations, font setup and comment content.
Keep comment `%` markers so TeX still consumes the following newline. The pinned
worker drops every raw line containing `\documentclass`, including comments.
Never pass that trigger through a comment or overwrite the source to be saved.
Store source only in SVG `metadata/script[type="text/x-tikz"]`, using XML escaping
and carriage-return character references. Reject malformed SVG/DOCTYPE, strip
active content and external URLs, and preserve embedded font styles.

Map the exact edit target through individual transaction steps; never retarget
another image with the same URL after deletion. `setNodeMarkup` uses a
`ReplaceAroundStep` whose boundary map reports deletion. Preserve only a
same-src/source image step retaining its exact original content gap; allow
concurrent resizing/alignment while rejecting structural replacements.
After upload, recheck the attempt signal,
session identity, current permission and latest target before dispatching. Copy
existing image attrs to retain layout, caption, dimensions and links. Closing or
editing source invalidates a pending save. Lightbox passes a mapped selection
only after actual Radix focus-scope unmount through `onCloseAutoFocus`.

Use the scoped `Modal.expanded` layout for this editor. Keep two panels, a
120 px bounded error region and footer actions within the viewport. Preview is
always white. Only document/lightbox `source=tikz` images invert on dark screens;
static HTML and print retain light output. Write `data-source` on linked and
unlinked images and sanitize URLs in `toDOM`.

Non-inline images occupy an entire paragraph row. The row spans the content
column while the figure retains its saved width and alignment. Left/right
alignment uses `float: none`, `clear: both`, fit-content width and automatic
margins. Following text and block-insert controls start below the complete
figure, including its caption, and may move vertically as the image resizes.
Ordinary inline icons retain their inline layout. Check both NodeViews and parsed
static HTML: containing a float only in `.component-image` misses static output.

TikZ figures keep that block layout at every width, including below the 48 px
inline-icon threshold. Pass `source` to the shared `isInlineImageIcon()` check in
the live image, HTML serializer and image toolbar; TikZ must never gain
`.image-icon`, lose its caption/resize handles, or hide alignment controls.
Exercise real pointer resizing across the threshold before, during and after
pointer release, including captions and resize handles.

Image paragraphs reuse the existing text block drag handle. `DragTarget` must
not exclude a paragraph because its image has left/right/full-width alignment.
Drag the containing paragraph as a closed block slice; retain all image attrs
and its caption. Mixed image/text paragraphs continue to move as one paragraph,
and list items and tables retain their existing drag target boundaries. Keep
the shared inline image schema and existing drop behavior. Read-only updates
must hide the handle, and click/drag entry points must recheck `view.editable`.

A standalone block image owns its entire paragraph row. The blank area beside
it is not a text input: it must not expose a text caret or block-menu controls.
Text belongs in a separate paragraph below the image. Keep a genuine following
empty paragraph editable with its normal plus and slash-menu hint. Ordinary
inline icons and existing mixed image/text paragraphs retain their text editing
behavior. This behavior does not introduce columns.
`imageBlockPlugin()` enforces that input boundary with view-only paragraph
decorations and selection/input handling, keeping the stored image schema.
Image and containing-paragraph node selections must preserve the image when
typing or pasting. Process/229 input-method startup moves to an editable
paragraph before native composition begins. Keep caption editing independent.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Compile, missing package, timeout, engine or invalid output | Fixed localized message; relevant TeX log and original package declaration line; old preview retained; saving disabled. |
| Source request/parse fails or metadata is absent | Distinct source/metadata message inside the dialog; no default source and no document change. |
| Attachment upload fails | Save error; retain code, preview and original image. |
| Source edit, dialog close or superseding session | Abort/invalidate old work; late success/error cannot mutate documents or the newer session. |
| Edited image deleted/replaced | No fallback to a duplicate or insertion; reject the save. |
| Same image resized/aligned during editing/upload | Keep its mapped target and preserve the latest attrs when saving. |

Use the approved task's PRD E01–E08/E02-F catalog through `getTikzErrorMessage`.
English extraction keys must not contain namespace-separating colons.

The pinned worker can return SVG from a partial DVI despite TeX errors. Call
`texify` with `showConsole: true` and listen to raw worker string messages only
during compilation; protocol objects and loading messages are not diagnostics.
Keep the first `!` error and following context within 16,384 characters. A missing
package can also become an empty virtual input with no TeX error: recognize its
explicit `(TeXinputs:"...sty")` file trace. Retain only 1,024 characters of rolling
file trace and join TeX log wrapping for recognition. Long filenames may lose
their suffix, closing quote or even the virtual prefix; only an observed
unclosed filename trace matching a unique original package declaration may
supply the original name. An ambiguous trace fails compilation without inventing
a package name or source line. Do not replace this evidence with a package
allowlist. Preserve the actual log context and remove the message listener on
every completion path. A diagnostic must not override cancellation or timeout;
an empty document without errors maps to `invalid-svg`.

### 5. Good / Base / Bad Cases

Good: edit the second of two identical URLs, insert preceding text during upload,
then replace only that mapped image. Base: insert a snippet as an ordinary SVG
and reopen its exact source. Bad: accept a stale preview during debounce, update
the first URL match after target deletion, or let a late upload close a new session.

### 6. Tests Required

Run the colocated runtime, extension/session/error, Lightbox selection, image
detection/serialization, shared query, Diagrams and CSP tests. Assert startup
abort/timeout cleanup, XML/CRLF/Unicode round trips, safe SVG font preservation,
comment newline semantics, original package lines, target mapping, upload
invalidation, concurrent image attribute updates and widget registration.
Browser verification must cover real
workers/CSP, lazy requests and PWA, focus/Tab/history, errors, mobile sizing,
save/reopen, imported source, dark mode and light export/print.
For figure alignment, verify left/right placement, the following empty
paragraph and insertion button, linked images, intrinsic/oversized widths,
captions, narrow containers, ordinary-image controls and inline-icon controls
in screen and print layouts.
For image block handles, exercise real hover and native handle dragging for
ordinary/TikZ images with left/right/center/full-width alignment. Check the
entire row remains occupied during dragging, one image paragraph moves without
changing its attrs, and read-only mode and printing suppress the handle.
Use real Image/BlockMenu plugins and the real Caption component to test blank-row
clicks, keyboard input, multiline paste, native Chinese composition, caption
editing/Enter and the editable following paragraph. Verify the image survives
both image and containing-paragraph node selections.

### 7. Wrong vs Correct

Wrong: `await spawn(new Worker(url))` with no raw worker retained, then terminate
only the spawned thread. Correct: retain a same-origin worker before startup,
race the complete operation against timeout/abort, and release the thread or raw
worker in `finally`. Wrong: embed `prepareSource(source).tex`; correct:
`embedSource(renderedSvg, source)` preserves the user's original text.
