# Memos capture and timeline UX

## Goal

重做 Outline 的 `/memos` 主体验，使用户点击侧栏进入 Memos 后，首屏和核心使用路径尽量接近
usememos 网站/应用的主界面：快速录入优先、时间线优先、标签和筛选自然融入，而不是现在这种
Outline 表单页 + 卡片列表的感觉。

## Parent task

Parent: `06-29-memos-module`

本任务是 Phase B：Capture and timeline UX。它依赖 Phase A
`06-25-memos-quick-capture` 提供的基础模型、路由、store 和初始页面。

## Product intent

用户明确要求：“点进去这个 memos 里，然后效果和打开 memos 网站效果几乎是一样的。”
用户已确认：允许 `/memos` 页面使用更独立的布局，弱化 Outline 标准 `Scene + Heading` 外壳。

本任务把“几乎一样”定义为：

- 首屏信息架构接近：进入 `/memos` 后首先看到的是 memo 工作台，而不是普通 Outline 场景页。
- 主要交互接近：顶部/主区域快速输入，保存后立即进入时间线。
- 时间线观感接近：短内容流、紧凑卡片、时间信息、标签、快捷操作清晰。
- 标签/筛选接近：能自然通过 tag 和状态浏览内容。
- 响应式接近：桌面和移动端都以“捕获 + 时间线”为中心。

本任务不要求逐像素复制 usememos，也不要求复制其品牌、logo、配色或完整所有页面。

## Requirements

### R1. Replace the current generic Outline scene feel

`/memos` 不应继续像普通 Outline 设置/列表页。需要建立专属 Memos 布局：

- 去掉过强的 `Heading + Scene` 表单感
- 主体优先展示 composer 和 timeline
- 操作控件更贴近 memo 流，而不是文档管理页

### R2. Capture-first composer

录入区应成为首屏第一主角：

- 明确的快速输入区域
- 支持现有 ProseMirror 内容
- `#tag` 建议继续可用
- 保存动作低摩擦
- 空内容不可保存
- 保存成功后清空输入并刷新/插入时间线顶部

### R3. Timeline-first feed

时间线要从“卡片列表”进化成 memo feed：

- 最新 memo 在上
- 每条 memo 内容、时间、tags、归档/编辑/删除操作清楚但不喧宾夺主
- archived 与 active 状态切换保留
- load more 保留
- 空状态要符合 memo 产品，而不是普通表格/列表空状态

### R4. Tags and filters as first-class navigation

标签不只是 card 底部按钮：

- 当前 tag filter 清楚可见
- 选择 tag 后时间线语义清楚
- 清除过滤容易
- tags 呈现要适合后续扩展成侧栏/面板

### R5. Responsive behavior

移动端必须可用：

- composer 不被挤压
- memo card 文本不重叠
- 操作按钮不造成布局跳动
- tag wrap 合理

### R6. Keep current backend scope

本任务优先做 UX。除非 UI 必须，不扩大后端范围。

允许使用现有 endpoints：

- `memos.list`
- `memos.create`
- `memos.update`
- `memos.archive`
- `memos.delete`
- `memos.tags`

搜索、workspace feed、公开分享、统计不在本任务实现。

## Acceptance criteria

- [ ] 用户进入 `/memos` 后，首屏明显是 memo 工作台，视觉和交互优先级接近 usememos 主界面。
- [ ] 用户可以在首屏 composer 输入含 `#tag` 的 memo 并保存，保存后新 memo 立即出现在 feed 顶部。
- [ ] 只输入 `#` 不崩溃，并继续显示 tag 建议。
- [ ] Feed 中每条 memo 以紧凑、可扫描的方式展示内容、更新时间、tags 和基础操作。
- [ ] 用户可以切换 active / archived，并可以清除 tag filter。
- [ ] 桌面和移动视口下，composer、feed、buttons、tags 不重叠、不溢出。
- [ ] 不新增搜索、workspace feed、public feed、统计等超出 Phase B 的功能。
- [ ] 现有 memos API 测试和前端 Memos 场景测试通过；新增 UX 行为有测试覆盖。

## Out of scope

- 全文搜索和高级过滤。
- workspace/public feed。
- usememos 的完整页面体系复制。
- Markdown-native 编辑器替换。
- 资源中心、统计、回顾、API/integration。

## Open questions

- None.
