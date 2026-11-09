# Prevent document scrolling past the bottom

## Goal

When a document reaches its bottom edge, further downward mouse-wheel input must leave the visible page in place. The user should not see the background image appear below the document.

## Background

- The report concerns the document page at `/doc/5rwl6kv-wVYKweSuK5`, viewed on desktop with a mouse wheel.
- The document surface is rendered by `app/scenes/Document/components/Document.tsx:399`; the regular document footer is appended at `app/scenes/Document/index.tsx:77`.
- The authenticated layout uses a viewport-height content area (`app/components/Layout.tsx:99`), and a customized background image can be painted behind it (`app/utils/customizations.ts:245`).
- Desktop scrolling uses the page; the extra `PageScroll` scroll container is enabled only on mobile (`app/components/PageScroll.tsx:32`).

## Requirements

- Keep the document view at its natural bottom boundary when the user continues scrolling downward.
- Preserve normal upward scrolling, access to the final document content and footer, and document editing behavior.
- Apply the fix to document views, including read and edit modes, without changing unrelated pages or customized background settings.

## Acceptance Criteria

- [ ] In a desktop document view, repeated downward wheel input at the bottom does not move the document farther up or reveal the background image below it.
- [ ] The final document content and footer remain reachable; scrolling upward works normally.
- [ ] The behavior works in both read and edit modes, with and without a customized background image.
- [ ] Focused frontend validation passes, and the change is checked for mobile and print layout regressions.

## Out of Scope

- Changing the background image or workspace appearance settings.
- Changing general scrolling behavior on non-document pages.
