# Implement — Outline usememos-style memos module

这个 parent task 当前用于规划和拆阶段，不直接开始实现。实现要从子任务逐步推进。

## Planning checklist

- [x] 确认 parent task 与现有 `06-25-memos-quick-capture` 的父子关系正确。
- [x] 完成本任务的 `prd.md`、`design.md`、`implement.md` 初稿。
- [x] 明确后续阶段拆分策略，避免继续把所有功能塞进 `06-25-memos-quick-capture`。
- [x] 与用户确认近期优先阶段。

## Proposed child-task map

### Child 1 — Quick capture foundation

- Existing: `06-25-memos-quick-capture`
- Scope: 基础数据模型、个人时间线、`#tag`、基础附件、基础 CRUD

### Child 2 — Capture and timeline UX

- Existing: `06-29-memos-capture-timeline-ux`
- Scope:
  - `/memos` 首屏体验向 usememos 高相似度对齐
  - composer 交互重做
  - 时间线密度和信息层次重做
  - 标签展示与快捷筛选体验提升
  - 移动端录入/浏览体验

### Child 3 — Search and filters

- New child
- Scope:
  - 全文搜索
  - 组合过滤
  - 标签面板/过滤状态管理

### Child 4 — Visibility and workspace feed

- New child
- Scope:
  - workspace/public visibility 行为落地
  - 团队 feed
  - 分享/公开访问路径

### Child 5 — Review and stats

- New child
- Scope:
  - daily review
  - heatmap / streak / counts
  - 标签与时间聚合视图

### Child 6 — API and integrations

- New child
- Scope:
  - import/export
  - external capture/API surfaces
  - integration contracts

## Recommended execution order

1. Finish and stabilize `06-25-memos-quick-capture`
2. Create and plan “Capture and timeline UX”
3. Create and plan “Search and filters”
4. Create and plan “Visibility and workspace feed”
5. Create and plan “Review and stats”
6. Create and plan “API and integrations”

## Validation gates for each child

- Requirements and acceptance criteria are written before `task.py start`
- Child task stays independently testable
- Data-model changes are backward-compatible with previous child phases
- UI changes are verified against both desktop and mobile paths
- New query/index work is validated with targeted tests

## Immediate next step recommendation

下一步不应该立刻开工“全量 usememos 模块”。

应该先做这件事：

- 完成对 `06-25-memos-quick-capture` 当前状态的收尾和归档条件判断
- 然后新建第二阶段子任务“Capture and timeline UX”
- 把 usememos 风格的主要差异优先放到交互层，而不是先扑向搜索/统计/公开流

## Review gate before implementation

开始任何新实现前，需要用户先确认：

- 近期优先 Phase B（capture and timeline UX）是否正确
- 团队流/公开流是否接受延后
- 搜索是否排在 Phase C
