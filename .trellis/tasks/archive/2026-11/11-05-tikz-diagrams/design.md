# Editable TikZ diagrams — technical design

## Boundaries

Keep heavy UI and compilation code under app/editor. shared/editor owns only
the reusable image source enum/detection and node query. Keep browser globals out
of shared/server initialization. No server TeX execution or storage API changes.

## Data flow

/tikz or image/lightbox edit -> observable extension session -> lazy modal ->
CodeMirror source -> 600 ms debounce -> prepareSource -> same-origin Worker ->
SVG post-processing + original-source metadata -> img preview -> existing
uploadFile callback -> fresh editor transaction -> ordinary source=tikz image.

## Compilation contract

renderTikz(source, optional AbortSignal) returns a discriminated success/error
result. Allocate one new raw worker per request and retain a reference before
spawn resolves so startup failures/timeouts are also terminable. Check already
aborted signals, remove abort listeners/timers, and terminate exactly once on
success, failure, abort, or timeout. Include startup/loading in the 10-second
budget. A queued or active request makes its current source unsavable until that
exact source succeeds. Ignore outdated completions; keep the last good image.
Do not import or preload static engine files into the application entry bundle.

## Source and SVG contracts

prepareSource returns the compiled text and source status; SVG embedSource
always receives the original source. Skip CJK/font setup without swallowing
unrelated code; cover multiline/mixed declarations and escaped percent signs.
Extract missing-package line numbers from the original source, not TeX's
rewritten log. XML-parse SVG, reject malformed/non-SVG input, strip executable
content and unsafe URL attributes, preserve font/style definitions needed for
rendering, and insert metadata/script[type=text/x-tikz] using XML serialization.
Read SiYuan metadata without executing it, including XML special characters.
FileHelper recognition lives in shared and must not import app helpers.

## Editor/session contract

Use a named-export Tikz extension and a lazy named-export modal; register in
withUIExtensions. Keep commands blocked in read-only mode and avoid automatic
editor refocusing while opening the modal. Handle source-fetch errors explicitly
instead of silently replacing an existing figure with the default template.
Every async operation captures the session identity and checks it before
updating observable state or dispatching. Closing invalidates that session.
Saving finds the existing node by src in the latest doc; preserve other image
attrs. A removed edit target must not update a different figure. New creation
inserts at the current preserved editor selection with no placeholder on cancel.
Extract the node lookup for reuse by Diagrams without changing its existing UX.

## UI integration

Use ui-design.md for the visual specification and reviewed prototype states.
The shared Modal currently constrains inner width to 640 px and content height
to 65vh; adapt the TikZ instance so panels, errors, and the footer remain visible.
The prototype is a static design artifact and does not compile or upload diagrams.

Use the existing Modal, Button, Flex, theme tokens, and focus management.
CodeMirror owns local edit history; Tab must leave the editor and remain inside
the modal focus trap. Use a callback-ref state for the editor host. Show inline
errors and source status without alerts that interrupt editing. Keep the previous
preview visible while rendering/errors occur. Lightbox currently closes via a
reducer and animation; trigger TikZ editing only after actual close/unmount,
using an explicit callback rather than an uncoordinated timeout. Hide image
replacement for TikZ; preserve existing unrelated toolbar actions.
Attach data-source to linked/unlinked shared image renders and, if needed,
the static toDOM path. Scope the inversion to dark screen content; exclude
preview, print, and light exports. Keep sanitizer requirements for user URLs.

## Exception copy and presentation

Use PRD section 3.2.5 as the authoritative E01–E08 message catalog, including
the E02-F variant when the original package line cannot be located. Show fixed
localized copy before relevant raw TeX diagnostics. All errors use one region
below both panels and above Cancel/Save, with a maximum height of 120 px and
scrolling overflow. Source-fetch and missing-metadata errors also appear inside
the dialog; never substitute the default template or enable saving before the
existing source loads successfully. Keep the original image unchanged.

Classify timeouts, engine loading, missing packages, malformed render output,
source loading, missing metadata, and attachment failures before applying a
generic compilation message. Preserve original source and any successful preview.
Abort caused by typing or closing is silent, and stale-session errors are ignored.
CJK setup skipped during preparation remains a status-bar notice. Read messages
through t() and the existing extraction workflow; do not hand-edit catalogs.

## Static assets, CSP, and attribution

Vendor the untouched engine snapshot from siyuan-embed-tikz commit
e374921f417ef84bd42aaf78886d8326eef8f6f4 into a versioned static folder. The
reference has 449 files, 293 package files, 152 fonts, and 9,696,446 total bytes.
Resolve worker/engine fetches against the page origin, ignoring CDN_URL. Keep
precompressed gz assets as raw bytes. Add only wasm-unsafe-eval to current CSP,
preserving the existing per-request module/static allowances.
The guide's blanket LPPL attribution is inaccurate: drgrice1/tikzjax package.json
declares GPL-3.0+; kisonecat's original declares GPL-3.0 OR LPPL-1.3c. The plugin
root MIT license is not a replacement for bundled component licenses. Record
actual copyright notices, component licenses, pinned revision, checksums, and
source/build links in non-Markdown LICENSE/NOTICE/SOURCES files. Verify which
upstream sources correspond to the vendored worker, WASM, format, and fonts.
Preserve applicable original licenses, and do not relabel the whole bundle MIT.

## Compatibility and dependencies

Use yarn for threads and CodeMirror dependencies; update yarn.lock through an
install. Follow current strict TS, named exports, interfaces, JSDoc, early returns,
and oxfmt conventions. Do not adopt outdated sample imports or hardcoded source
positions. Use existing source extraction for strings; avoid colon-bearing keys
that the repository parser treats as namespaces. Do not hand-edit locales.

## Rollout and rollback

The image storage format extends an existing source enum and requires no
migration. Stored output remains an SVG image for clients without the new UI.
Rollback removes entry points, UI modules, the CSP allowance, and engine assets;
previously saved figures remain readable as images and retained in history.
Do not delete old attachments when replacing diagrams. Never include the user's
.env.development changes in feature commits.

## Known limits and validation

System CJK fonts vary; color inversion approximates explicit colors. Verify the
worker in a real production browser, including cached/offline engine loading,
actual cancellation, and CSP response headers. Unit tests alone do not prove
those browser behaviors. See implement.md for the quality and review gates.

## Development proxy correction

`createViteMiddleware()` finishes static requests before the web page CSP runs.
The pinned worker needs a strict response policy permitting same-origin scripts,
same-origin connections and WebAssembly. Vite's gzip header must be removed only
for the engine's opaque compressed inputs. Suppress their upstream conditional
validators so a cached incorrect Content-Encoding is replaced by a 200 entity;
304 cannot remove the old metadata. Ordinary assets and production stay outside
this correction. Assert browser bytes and recovery in the same warmed browser.
