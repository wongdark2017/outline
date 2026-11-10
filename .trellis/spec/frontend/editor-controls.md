# Editor toolbar controls

## 1. Scope / Trigger

Applies to searchable code-language controls and portaled overlays opened from the editor selection toolbar.

## 2. Signatures

- `searchCodeLanguages(query: string, frequent?: string[]): CodeLanguageMatch[]` in `shared/editor/lib/code.ts` returns language IDs, labels, optional label ranges and matched keywords.
- `CodeLanguagePicker({ language: string })` renders the editable control through `MenuItem.content`.
- `DrawerContent.onCloseAutoFocus` must reach `DrawerPrimitive.Content`, where Radix emits the focus event.

## 3. Contracts

Search owns filtering and six-tier ranking; cmdk uses `shouldFilter={false}` for keyboard and item semantics. Exact match, label prefix, keyword prefix, label word prefix, label substring and keyword substring are ordered tiers. Single-character queries use only the first three. Same-tier ties use frequent-list order, then registry order. Skip compatible aliases such as `mermaidjs` in the list; retain their resolution for saved documents.

Selecting the active language only closes the picker. Calling `commands.code_block` with the active language toggles the block into a paragraph. For a different language, use the existing command and history boundaries.

The language trigger is a direct toolbar flex child. Override the base button's `flex: 0` locally with `flex: 0 0 auto` and `white-space: nowrap` so multiword labels stay on one line and leave room for the disclosure icon. Do not change every toolbar button to fix this control.

Portaled picker events carry `data-code-language-picker`; `SelectionToolbar` excludes these targets from outside-click selection resets. Desktop list mousedown preserves input focus. Mobile opening avoids input autofocus. On close, prevent the overlay's default focus restoration and call `view.focus()` through `onCloseAutoFocus`.

Forward focus lifecycle props to the primitive that emits them, not an inner styled DOM element. Do not use a drawer animation callback to restore focus: the primitive can subsequently move focus back to its trigger.

Give the desktop popover an `aria-label`. `DrawerTitle` must pass its actual title element to Radix `asChild`, not a Fragment; otherwise the generated title ID is lost and the drawer's `aria-labelledby` cannot resolve.

## 4. Validation matrix

| Action | Expected result |
| --- | --- |
| Search `ts` | TypeScript keyword exact match precedes TSX label prefix. |
| Re-select current language | No command invocation; code block remains intact. |
| Pointer or touch selection | Language changes; ProseMirror selection remains in the same block. |
| Close either surface | Editor regains focus. |
| Inspect overlay naming | Desktop label exists; mobile `aria-labelledby` resolves to its title element. |
| Escape with query / without query | Clear query / close surface. |
| IME composition Enter | No language selection. |

## 5. Good / Base / Bad cases

Good: a mobile touch selection updates the language and returns focus to the editor. Base: a read-only toolbar displays only the language label. Bad: using the toggle command for the current language or allowing an outside-click handler to move selection to document start.

## 6. Tests required

Run the focused `shared/editor/lib/code.test.ts` tests with explicit frequency arrays. Verify current-language preservation, keyboard navigation, pointer/touch selection, close focus, accessible overlay names, read-only mode, and light/dark layouts in a browser. Synthetic composition events do not replace a real IME or phone keyboard check.

## 7. Wrong vs correct

Wrong: `<StyledInnerContent onCloseAutoFocus={handler}>` or `onAnimationEnd={() => view.focus()}`.

Correct: forward `onCloseAutoFocus` to `DrawerPrimitive.Content`; the picker handler calls `event.preventDefault()` and `view.focus()`.
