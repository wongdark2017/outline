# Design — Memos capture and timeline UX

## Summary

本阶段只重做 `/memos` 主页面体验，让它从 Outline 普通页面变成 usememos 风格的 memo 工作台。
它不扩大后端能力，不引入搜索/团队流/公开流。

## Existing baseline

当前页面 `app/scenes/Memos/index.tsx`：

- 使用 `Scene` + `Heading`
- 顶部是 Editor + Save button
- 下方是 Timeline / Archived 两个按钮
- memo 用 bordered card 展示
- tag 是卡片底部按钮
- 编辑/归档/删除在卡片右上

这能工作，但视觉和信息架构更像 Outline 的普通 CRUD 页，不像 usememos 的主体验。

## Target shape

页面拆成四个明确区域：

1. Memos shell
   - 专属页面容器
   - 控制最大宽度和移动端 padding
   - 不依赖大标题建立页面感

2. Capture composer
   - 顶部/主列优先
   - 输入区域有足够视觉权重
   - action row 简洁
   - 保存后清空并回到 feed

3. Feed toolbar
   - active / archived 状态切换
   - 当前 tag filter
   - 后续可承载 search/filter，但本阶段不做搜索

4. Memo feed
   - 使用紧凑 feed item，不是重 card UI
   - 时间和操作低调
   - tags 贴近内容底部

## Component direction

建议在 `app/scenes/Memos/index.tsx` 内先抽出本地 styled blocks，不急着创建过多文件：

- `MemosShell`
- `ComposerPanel`
- `FeedToolbar`
- `Feed`
- `MemoItem`
- `MemoActions`
- `TagList`
- `EmptyState`

如果页面继续增长，再拆 `components/`。

## Visual direction

- 页面应安静、密集、适合重复使用。
- 避免营销式 hero、装饰背景、过大的卡片。
- feed item border 可以更轻，hover/操作更克制。
- 按钮应优先图标化或紧凑化，避免每条 memo 都显得像管理表单。

## Data flow

沿用现有 store：

- mount -> `memos.fetchMemos()`
- create -> `memos.createMemo(draft)`
- update -> `memos.updateMemo(id, draft)`
- archive -> `memos.archiveMemo(id)`
- delete -> `memos.deleteMemo(id)`
- filter tag -> `memos.fetchMemos({ tag })`
- archived -> `memos.fetchMemos({ archived: true })`

本阶段不改变 API contract。

## Testing strategy

更新 `app/scenes/Memos/index.test.tsx`：

- composer renders as primary region
- save creates memo and clears draft
- active/archived filter remains functional
- tag filter display and clear remains functional
- empty state renders

保留刚修复的 `#` suggestion 回归测试。

## Risks

- 只改样式不改交互，会达不到“像 usememos”的目标。
- 过度拆组件会让当前 MVP 代码复杂化。
- 如果保留 `Scene + Heading` 原外壳，体验会继续像 Outline 普通页面。

## Recommendation

采用专属 Memos shell，弱化标准 `Scene` / `Heading` 的视觉主导；仍保留必要的 document title /
route integration，不破坏 Outline 外层导航。

用户已确认这个方向。
