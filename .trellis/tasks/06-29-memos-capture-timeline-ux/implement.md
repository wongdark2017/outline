# Implement — Memos capture and timeline UX

## Preconditions

- Parent task: `06-29-memos-module`
- Foundation task: `06-25-memos-quick-capture`
- Do not start implementation until this planning is reviewed and `task.py start` is run.

## Implementation checklist

### 1. Read current frontend guidelines

- [ ] `trellis-before-dev`
- [ ] `.trellis/spec/frontend/index.md`
- [ ] relevant frontend guideline files listed by the index

### 2. Refactor `/memos` page structure

- [ ] Replace generic `Scene + Heading` visual dominance with a dedicated Memos shell.
- [ ] Keep route title/accessibility intact.
- [ ] Add responsive page width and spacing constraints.
- [ ] Keep Outline outer navigation, but allow the inner `/memos` surface to diverge visually from standard scenes.

### 3. Composer UX

- [ ] Restyle composer as primary capture area.
- [ ] Keep existing `Editor` integration and `MemoTagMenuExtension`.
- [ ] Keep empty content guard.
- [ ] Keep save flow and clear draft after successful create.
- [ ] Ensure `#` suggestion still works.

### 4. Feed toolbar

- [ ] Restyle active/archived switch.
- [ ] Show current tag filter in a clearer compact element.
- [ ] Keep clear-filter behavior.

### 5. Memo feed item

- [ ] Restyle `MemoCard` into feed item.
- [ ] Make time, actions, content, tags scan well.
- [ ] Keep edit/update/cancel flow.
- [ ] Keep archive/delete behavior.

### 6. Empty and loading states

- [ ] Add empty feed state.
- [ ] Avoid layout jump when feed has no memos.
- [ ] Keep load more behavior.

### 7. Tests

- [ ] Update `app/scenes/Memos/index.test.tsx`.
- [ ] Preserve existing memos tests.
- [ ] Run targeted app tests.

## Validation commands

```bash
yarn test app/scenes/Memos/index.test.tsx app/editor/extensions/Suggestion.test.ts app/editor/components/MemoTagMenu.test.tsx shared/editor/plugins/SuggestionsMenuPlugin.test.ts
yarn oxlint --type-aware app/scenes/Memos/index.tsx app/scenes/Memos/index.test.tsx app/editor/components/MemoTagMenu.tsx app/editor/extensions/Suggestion.ts shared/editor/plugins/SuggestionsMenuPlugin.ts
```

Manual validation after starting dev server:

- Open `/memos`
- Type `#` in composer
- Create a memo with `#tag`
- Filter by tag and clear filter
- Edit memo
- Archive memo
- Check mobile width

## Rollback

This phase should be mostly frontend-only. Rollback is reverting `app/scenes/Memos/index.tsx` and test changes.
