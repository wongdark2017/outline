# Implementation plan: code block language search

## 本次改动边界

现有代码块语言下拉不能搜索；行为归属在共享语言定义和编辑器工具栏。改动限于 `code.ts` 的关键词与纯搜索函数、同级测试、新的 `CodeLanguagePicker`、语言菜单和顶层自定义内容接入、必要的选区保护，以及依赖和中英文翻译。复用现有 `Popover`、`Drawer` 和编辑器命令，不增加通用选择器抽象，不重构其他菜单。浏览器验收发现 `DrawerContent` 未将 `onCloseAutoFocus` 传给底层抽屉，补转发这一个回调以保证移动端关闭后恢复编辑器焦点。

## Order of work

1. Confirm task context and frontend specs. Record the initial Git status, package versions, and lockfile state in the worktree. Keep the source checkout's unrelated edits untouched.
2. Add `cmdk@^1.1.1` with Yarn. Run `yarn dedupe '@radix-ui/*'`, then `yarn install`. Review `package.json` and `yarn.lock` for the exact Radix upgrades and unintended non-Radix churn. Run `yarn dedupe --check '@radix-ui/*'` after installation.
3. Extend the 38 registry entries in `shared/editor/lib/code.ts` with the supplied keywords. Add `CodeLanguageMatch` and the pure six-tier `searchCodeLanguages` with stable tier/frequency/registry ordering. Document exported API with JSDoc.
4. Add focused `shared/editor/lib/code.test.ts` cases for the supplied query matrix, normalization, alias exclusion, one-character limit, matched ranges, and frequent tie ordering. Run the targeted shared test before UI wiring.
5. Build named-export `app/editor/components/CodeLanguagePicker.tsx` using `cmdk`, existing `Popover`/`Drawer`, toolbar trigger styles and theme tokens. Implement the grouped empty-query view, ranked results, visual hit cues, empty state, clear control, keyboard behavior, safe selection and focus restoration.
6. Replace editable language-menu children with `content` in `app/editor/menus/code.tsx`. Add a top-level content render path in `app/editor/components/ToolbarMenu.tsx` before the icon guard. Preserve the read-only label and other menu paths. If pointer interaction can reset selection, add a narrowly scoped guard in `app/editor/components/SelectionToolbar.tsx`.
7. Run `yarn build:i18n`, add the seven approved Chinese translations, and review both catalogs for unrelated changes and placeholder parity.
8. Run focused tests, type checking, lint and format checks on changed code. Inspect the final diff against all acceptance criteria. Check existing popup/menu behavior because Radix resolutions changed. If a local app can run, manually exercise desktop, dark theme and emulated mobile flows. Record any unverified true-device behavior explicitly.
9. Use the Trellis check phase, fix verified findings, update applicable specs if a reusable contract was learned, then commit only task-related files on `feat/code-block-search`. Finish the task record and journal per Trellis workflow.

## Validation commands

- `yarn vitest run --project shared-node --project shared-jsdom shared/editor/lib/code.test.ts`
- `yarn tsc --noEmit`
- `yarn oxlint --type-aware <changed TS/TSX files>`
- `yarn oxfmt --check <changed TS/TSX files>`
- `yarn dedupe --check '@radix-ui/*'`
- Compare changed locale keys and interpolation tokens; verify the English extraction does not remove unrelated keys.

## Review gates and rollback points

- Stop after dependency installation if the Radix dedupe causes unrelated major lockfile movement; identify the exact descriptors before continuing.
- Stop after search tests until all six tiers and one-character behavior match the supplied matrix.
- Review editor selection and focus handling after UI integration; do not hide a failed selection behind a visual-only fix.
- Keep dependency and UI changes in one reviewable branch. If a regression requires rollback, revert the task commit; no persisted data changes are involved.
