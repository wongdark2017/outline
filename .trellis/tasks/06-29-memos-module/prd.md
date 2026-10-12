# Outline usememos-style memos module

## Goal

把现有的 Memos MVP 扩展成一个在 Outline 内部可长期演进的、明显接近
`usememos/memos` 产品体验的独立模块，而不是只停留在“快速记录 + 时间线”的 demo 级能力。

## User value

- 用户能像使用 usememos 一样，以极低摩擦持续记录和回看短内容。
- 标签、时间线、搜索、可见性、媒体和回顾能力围绕 memo 工作流组织，而不是借用文档心智。
- 团队可以把 memo 作为独立于长文档之外的知识流与动态流。

## Confirmed facts

- 已存在任务 `06-25-memos-quick-capture`，且已挂为本任务子任务；它覆盖的是第一阶段 MVP。
- 当前已落地的 Memos 能力主要是：个人时间线、创建/编辑/归档/删除、`#tag` 自动补全、简单标签过滤。
- 当前实现仍然是 Outline 风格页面，不是 usememos 风格的完整工作流。
- 当前数据模型已经引入 `Memo`、基础 API、`MemosStore`、`/memos` 页面和 `#tag` 建议菜单。
- 现有 MVP 没有完成 usememos 风格的核心后续能力：搜索、团队流、公开可见性 UX、资源中心、
  统计/回顾、集成/API 优先工作流、移动端体验打磨。

## Product intent

这个任务的目标不是“克隆 usememos 前端外观”，而是：

1. 在 Outline 中提供一个 usememos 风格的 memo 产品面。
2. 保留 Outline 的账号、权限、编辑器、附件和团队基础设施。
3. 允许模块分阶段推进，但阶段设计要从一开始就服务于完整模块，而不是一串临时拼补。

补充确认：

- 用户明确希望“点进 `/memos` 后的效果，与直接打开 memos 网站时的效果几乎一样”。
- 这意味着优先目标不只是能力覆盖，还包括页面结构、信息层次、交互节奏、录入区位置、时间线密度、
  标签与筛选呈现方式等整体体验接近。
- “几乎一样”当前先理解为产品体验高相似度，而不是要求逐像素或逐 DOM 完全复制。

## Requirements

### R1. Define the module as a parent roadmap, not a single MVP patch

Memos 模块需要以 parent task 规划，至少覆盖这些阶段：

- Phase A: Quick capture foundation（已有子任务承接）
- Phase B: usememos-style capture and timeline UX
- Phase C: search, filters, and discoverability
- Phase D: visibility, workspace feed, and sharing
- Phase E: review, stats, and habit surfaces
- Phase F: API / integration / import-export surfaces

### R2. Keep existing MVP as the foundation layer

不推翻现有 `06-25-memos-quick-capture` 的数据模型和基础路由，后续阶段在其上演进。
允许必要重构，但不能为了“像 usememos”而重建一套平行 memos 系统。

### R3. Target the usememos workflow, not just isolated features

规划时要以使用路径为中心：

- 快速输入和自动保存/低摩擦保存体验
- 按时间流持续浏览
- `#tag` 和层级标签组织
- 搜索与交叉过滤
- 媒体/资源附着和查看
- 个人/团队/公开可见性
- 回顾、统计、使用连续性
- API / 导入导出 / 集成能力

并且 `/memos` 首屏应优先对齐 usememos 的核心使用感，而不是保持当前 Outline 场景页样式。

### R4. Be explicit about where Outline intentionally diverges

必须写清楚哪些 usememos 体验要复刻，哪些因为 Outline 架构和产品边界要保留差异，例如：

- 编辑器仍基于 ProseMirror，而不是纯 Markdown textarea
- 权限与分享沿用 Outline 体系
- 团队信息架构需要与现有侧栏/路由兼容

### R5. Define implementation phases with independent acceptance

每个阶段都要独立验收，避免“大而全一次性交付”。阶段之间要有清楚的前置依赖和回滚边界。

### R6. Preserve compatibility with existing Memo data

后续规划不能要求清空或手工迁移当前开发数据才能上线。任何模型增强都应以兼容迁移方式设计。

## Acceptance criteria

- [ ] 产出一个可评审的 parent-task PRD，明确模块目标、阶段拆分、边界和非目标。
- [ ] 产出 `design.md`，说明如何在现有 Memo MVP 基础上演进到 usememos 风格模块。
- [ ] 产出 `implement.md`，把阶段拆成可执行的实现顺序、验证方式和风险点。
- [ ] 明确 `06-25-memos-quick-capture` 在整体路线中的角色：作为基础阶段子任务，而不是最终形态。
- [ ] 明确哪些 usememos 能力计划复刻，哪些会基于 Outline 架构保留差异。
- [ ] 每个阶段都有可测试、可验收的交付定义，而不是只列想法清单。

## Out of scope

- 本任务当前回合不直接开始大规模实现。
- 本任务当前回合不要求把现有 Memos 立即补成完整 usememos。
- 不引入独立的第二套认证、路由系统或存储系统来“外挂” usememos。

## Open questions

- “几乎一样”的范围边界是只指 `/memos` 主页面和个人使用路径，还是要求把 usememos 的团队流、
  搜索、公开页、资源页等多个页面也尽快一并对齐？
- 团队流和公开流，是否要求在第二阶段就进入规划内的“近期实现”，还是放到第三阶段之后？
