# Contain document background while scrolling

## Goal

When a document reaches its bottom edge, continued downward scrolling must not pull the document surface upward and expose the background image.

## Background

- The user supplied a 736-pixel-wide screenshot of the document view. The `useMobile` breakpoint is below 737 pixels (`app/hooks/useMobile.ts:10`, `shared/styles/breakpoints.ts:5`).
- At that width, `PageScroll` is a 100vh `overflow: auto` wrapper (`app/components/PageScroll.tsx:11-22`). Its rules do not currently contain vertical overscroll.
- The previous desktop fix applies `overscroll-behavior-y` to `html` only while a document surface is mounted (`shared/styles/globals.ts:30`); it does not control the mobile wrapper.

## Requirements

- Contain downward overscroll in the mobile document scroll container so that the background image cannot be pulled into view beyond the bottom edge.
- Keep normal upward and downward scrolling within document content, including the final image and footer.
- Scope the behavior to document views; avoid changing unrelated mobile pages or printing.

## Acceptance Criteria

- [ ] At a 736-pixel-wide document viewport, repeated downward wheel or touch scrolling at the bottom leaves the view at the bottom boundary.
- [ ] The final image and footer remain reachable, and upward scrolling works normally.
- [ ] Desktop document behavior and non-document mobile pages retain their current scrolling.
- [ ] Format, lint, and TypeScript checks pass; real-browser visual confirmation is recorded separately if the authenticated page cannot be reproduced locally.

## Out of Scope

- Changing saved background-image settings or document image rendering.
