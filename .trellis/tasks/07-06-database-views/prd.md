# Database table blocks like AppFlowy/AFFiNE

## Goal

给 Outline 增加类似 AppFlowy / AFFiNE 的"数据库表格"能力：一种结构化数据表，
包含可自定义的字段（列类型）、行记录，以及可配置的视图（至少表格视图），
区别于现有的纯富文本 table 节点。

用户价值：让团队在知识库内直接管理结构化信息（任务清单、需求列表、CRM 式记录等），
无需跳转到外部工具。

## Confirmed Facts（代码库调研得出，详见 research/）

- 编辑器扩展体系：`ReactNode` 基类 + `ComponentView`（React Portal NodeView）可让自定义块用
  React 渲染，交互事件默认不透传编辑器；`atom: true` 节点以 attrs 持久化状态
  （先例：Video/Attachment/Embed）。详见 `research/editor-architecture.md`。
- 现有 `Table.ts` 基于 prosemirror-tables，仅是富文本网格，无字段类型/行模型，不能复用作数据库。
- 文档存储：`state`（Y.js CRDT，事实源）+ `content`（PM JSON 快照）；新节点必须加入
  shared 的 `richExtensions`，server 与 client schema 才一致。Y.js 自动同步节点 attrs，
  但 atom 节点的 attrs 并发编辑是整体覆盖（无细粒度合并）。
- 插件系统只能注册 API 路由/AuthProvider/Processor/Task 与少量前端设置页，
  不能注册模型、迁移、policy、编辑器节点 ⇒ 本功能必须做在核心，不能做成插件。
- 新增服务端资源的成熟样板：迁移 → `server/models/` → `server/policies/` →
  `server/presenters/` → `server/routes/api/`（RPC 风格 + zod 校验 + 事务）；
  `server/models/Memo.ts`（2026-06 新增）是最贴近的端到端参考。
- 实时广播链路：`createWithCtx` → events 表 → worker → `WebsocketsProcessor` →
  前端 `WebsocketProvider` 写入 MobX store（Comment 是完整先例）。
- 前端 store：继承 `app/stores/base/Store.ts` + `app/models/` 模型类 + `RootStore.ts` 注册。
- 斜杠菜单加块：`app/editor/menus/block.tsx` 增加 MenuItem 即可。

## Requirements

- TBD（待用户访谈确认）

## Open Questions（待用户决策）

1. 形态：嵌入文档的块（AFFiNE 式 embedded database）还是独立页面类型（AppFlowy 式 grid 页面），或两者？
2. MVP 字段类型范围（文本/数字/单选/多选/日期/复选/人员/URL…）？
3. MVP 视图范围：只做 Grid 表格视图，还是含 Kanban/Calendar？
4. 筛选、排序、分组在 MVP 中的范围？
5. 数据存储策略：独立 PostgreSQL 表（databases/fields/records）vs 存在文档 ProseMirror JSON 里？
6. 实时协作要求：多人同时编辑数据表需要什么级别的一致性？
7. 权限模型：跟随所在文档权限，还是独立权限？
8. 是否需要与现有 markdown 导出/导入、搜索、API 生态整合？

## Acceptance Criteria

- [ ] TBD（待需求收敛后补充）

## Out of Scope（初步假设，待确认）

- 公式字段 / Rollup / 双向关联（Relation）等高级字段
- 自动化（Automation）、表单视图（Form view）
- 移动端专属交互优化（保证可用即可）

## Notes

- 复杂任务：需要 `design.md` 与 `implement.md` 后才能 `task.py start`。
- 调研产物在 `research/` 目录。
