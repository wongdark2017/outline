# Browser reproduction and source evidence

- Local test document: `outline-e0O8cwS04I`, second table, header `层 / 新建文件 / 修改的文件`.
- Database snapshot before and after the test: first-column `colwidth: [278]`, document `updatedAt` unchanged at `2026-11-06T08:26:27.253Z`.
- Browser layout before drag: first `<col>` inline style `width: 278px`, computed first cell about 43px; table `table-layout: auto`.
- During a 100px drag: first `<col>` inline style `width: 378px`, computed first cell still about 43px. The resize cursor and handle appeared, so pointer handling worked.
- Temporary browser-only fixed layout: first cell computed 278px; with the inline `<col>` width temporarily set to 378px, it computed 378px. Styles and drag position were restored afterward.
- `shared/editor/components/Styles.ts` defines the table's `width: 100%` but omits `table-layout`.
- `node_modules/prosemirror-tables/style/tables.css` includes `table-layout: fixed` for `.ProseMirror table`.
- `shared/editor/nodes/Table.ts` registers `columnResizing` before `tableEditing`; the resize plugin writes widths through the table's `<colgroup>`.
- After applying fixed layout and scoped code-word wrapping, a 700px viewport still reduced the third, unspecified column to about 24px. `Table.ts` overrides `defaultCellMinWidth` to 25px, while upstream `columnResizing` defaults it to 100px. Restoring the upstream default should retain a readable auto column and allow horizontal scrolling.

## Hotfix browser verification

- With the hotfix loaded, the target table displayed the saved widths as 278px and 334px. Its unspecified third column was about 123px at a 1500px viewport. No cells overflowed.
- Dragging the first column 100px showed a 378px cell during the drag. Releasing and refreshing retained 378px. The column was then dragged back to 278px, and a second refresh confirmed the restoration.
- With the restored 100px default minimum, a 700px viewport showed widths of about 278px, 334px and 99px (the last value excludes a border). The table scrolled horizontally, and no cells overflowed.
- Four other tables in the same document had no saved widths; they displayed equal-width columns with no cell overflow at desktop width.
- A temporary browser-only full-width class check produced widths of about 278px, 334px and 563px with no overflow; the class was removed afterward. This checks layout CSS, not the full menu command.
