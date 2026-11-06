# Fix table column resize rendering

## Goal

Make a table column's displayed width follow its saved and dragged width, including tables whose other cells contain long file paths.

## Background

- In the local document `outline-e0O8cwS04I`, the first column stores `colwidth: [278]` in every row, yet the browser displays it at about 43px.
- Dragging its right edge 100px changes the `<col>` style from 278px to 378px while the displayed cell remains about 43px.
- The table currently computes to `table-layout: auto`; the upstream `prosemirror-tables` stylesheet specifies `table-layout: fixed`.
- A temporary browser-only switch to fixed layout displayed both 278px and 378px widths correctly. The test was restored and did not persist a document change.

## Requirements

- Use the stored or actively dragged column width when laying out editable and read-only tables.
- Keep table content readable when a narrow column contains long file paths. Unspecified columns should retain a usable minimum width, with existing horizontal scrolling available where needed.
- Preserve the table's current width modes and column resize persistence.

## Acceptance Criteria

- [x] The reproduced first column displays approximately 278px before dragging, and changes visibly during a 100px drag.
- [x] Releasing the drag saves the new width, and refreshing the document retains it.
- [x] Long file paths remain readable without overlapping adjacent cells or disappearing.
- [x] Tables without stored widths and full-width tables remain usable. At a 700px viewport, an unspecified column stays about 100px wide, and the table can scroll horizontally.

## Out of Scope

- Changing the block drag handle or the column resize event logic.
- Changing document storage or database schema.
