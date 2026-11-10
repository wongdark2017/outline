# Code block language search: integration evidence

## Repository facts

- `shared/editor/lib/code.ts` owns the ordered language registry and frequency tracker. `mermaid` and `mermaidjs` are excluded from persistence. `mermaidjs` has `alias: true` and must be omitted from the selector.
- `shared/editor/nodes/CodeFence.ts:324` implements `code_block` through `toggleBlockType`. `shared/editor/commands/toggleBlockType.ts:20` switches to paragraph when the requested language is already active. The picker must skip the command when the selected ID equals the current language.
- `app/editor/menus/code.tsx:91` creates the editable language item. `shared/editor/types/index.ts:78` already includes `MenuItem.content`, and `app/editor/components/ToolbarMenu.tsx:148` needs a top-level content render path before its icon guard.
- `app/components/primitives/Popover.tsx` and `Drawer.tsx` supply existing themed overlays. `PopoverTrigger` internally uses `asChild`; `DrawerTrigger` callers pass it explicitly. `FilterOptions.tsx` has the nearest mobile pattern: no opening autofocus and 16px search text.
- Browser verification found that `DrawerContent` originally forwarded `onCloseAutoFocus` to its inner Flex, so Radix never received the callback. Root animation-based focus restoration left focus on the trigger after touch selection. Forwarding only `onCloseAutoFocus` to `DrawerPrimitive.Content` fixed this; selection position and editor focus now pass after mobile touch selection.
- `app/editor/components/SelectionToolbar.tsx:169` resets the ProseMirror selection on outside mouseup unless the toolbar or editor contains the target, or an input is focused. A portaled picker may need an explicit target guard if pointer tests show the selection moves.
- `package.json` uses Yarn 4.18.0, React 19.3, and Radix dialog `^1.1.23`; cmdk is absent. The initial `yarn.lock` resolves dialog to 1.1.23. `node_modules` is absent in this worktree.
- The i18next parser extracts English source keys from TS/TSX to `shared/i18n/locales/en_US/translation.json`. The Chinese values in the supplied plan are approved product text and should be applied after extraction; compare catalogs for unrelated churn.

## External primary sources

- [cmdk source](https://github.com/dip/cmdk/blob/main/cmdk/src/index.tsx) exposes `shouldFilter={false}`, controlled item `value`, `onValueChange`, and `loop`. The picker owns ranking; cmdk owns focus navigation and item selection.
- [Yarn dedupe documentation](https://yarnpkg.com/cli/dedupe) confirms that quoted glob patterns can target `@radix-ui/*`, `highest` only upgrades compatible resolutions, and `--check` detects remaining compatible duplicates. Review the lockfile after dedupe because semver-compatible upgrades can still change behavior.

## Design reference interpretation

The attached HTML contains four bundled pages: desktop, mobile, search states, and interaction rules. The supplied implementation plan explicitly removes the design's shortcut hint footer. Other language dropdowns and the read-only label remain unchanged.
