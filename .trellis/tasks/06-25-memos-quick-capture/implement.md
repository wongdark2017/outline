# 实施 — Memos 快速记录（MVP / 第一阶段）

有序清单。每个里程碑后做验证。Inline 模式：在主会话中直接实现；不派发 implement/check
子代理。

## 里程碑 1 — 数据模型与迁移
- [ ] `server/models/Memo.ts`：继承 `ArchivableModel`；`@Table`，列 `content`（JSONB）、
      `tags`（JSONB string[]）、`visibility`（ENUM）、`userId`、`teamId`；`BelongsTo Team`、
      `BelongsTo User`、`HasMany Attachment`（memoId）。在 `server/models/index.ts` 注册。
- [ ] 迁移 `yarn sequelize migration:create --name=create-memos` —— 表、枚举、索引
      `(teamId,userId,createdAt desc)`、`tags` 上的 GIN、`(teamId,visibility,createdAt desc)`。
- [ ] 迁移 `--name=add-memoId-to-attachments` —— 可空 `memoId` 外键。
- [ ] 在 `Attachment` 上加 `BelongsTo Memo`（`memoId`）。
- [ ] `server/models/Memo.test.ts` —— 创建、标签抽取钩子、归档/软删。

## 里程碑 2 — 服务端 API、策略、presenter
- [ ] `server/presenters/memo.ts`（`presentMemo`）+ 测试。
- [ ] `server/policies/memo.ts` —— create/read/update/archive/delete 能力；测试。
- [ ] `server/commands/memoCreator.ts` / `memoUpdater.ts` —— 从 ProseMirror JSON 抽取 `#tag`
      到 `tags`；在事务内按 `memoId` 关联附件。
- [ ] `server/routes/api/memos/schema.ts`（zod，`BaseSchema`）—— create/list/info/update/
      archive/delete/attachments.create/tags。
- [ ] `server/routes/api/memos/memos.ts` + `index.ts`；在 `server/routes/api/index.ts` 注册
      （`router.use("/", memos.routes())`）。
- [ ] `server/routes/api/memos/memos.test.ts` —— 认证、校验、仅作者可改、list 分页/标签过滤、
      归档过滤。

## 里程碑 3 — `#tag` 编辑器节点
- [ ] `shared/editor/nodes/MemoTag.tsx` —— 内联 atom 节点（仿 `Mention.tsx`）。
- [ ] `shared/editor/nodes/MemoTagMenu.tsx` —— `#` 触发 + 建议（仿 `MentionMenu`）；接到
      `MemosStore.fetchTags`。
- [ ] 从 `shared/editor/nodes/index.ts` 导出；加入 memo 扩展子集。

## 里程碑 4 — 前端 store、模型、场景、路由、导航
- [ ] `app/models/Memo.ts`（仿 `Pin.ts`）。
- [ ] `app/stores/MemosStore.ts`（仿 `JournalEntriesStore`/`PinsStore`）；在
      `app/stores/RootStore.ts` + `app/stores/index.ts` 注册。
- [ ] `app/scenes/Memos/index.tsx`（录入框 + 时间线）+ `components/MemoEditor.tsx`、
      `MemoCard.tsx`、`MemoTimeline.tsx`。
- [ ] 路由：在 `app/routes/authenticated.tsx` 懒加载 `Memos`；加
      `<Route exact path="/memos" component={Memos} />`。
- [ ] 侧栏导航项"Memos" -> `/memos`（在 `app/components/Sidebar/`）。
- [ ] `app/scenes/Memos/index.test.tsx` + `MemosStore` 测试 —— 渲染、创建流程、时间线排序、
      归档过滤。

## 里程碑 5 — 验收关卡（`task.py start` 评审前运行）
- [ ] `yarn tsc`
- [ ] `yarn lint`
- [ ] `yarn test server/models/Memo.test.ts`
- [ ] `yarn test server/routes/api/memos/memos.test.ts`
- [ ] `yarn test server/presenters/memo` 与 `server/policies/memo`
- [ ] `yarn test app/scenes/Memos/index.test.tsx`
- [ ] 手动：打开 `/memos`，创建一条含 `#tag/subtag` + 图片的 memo，确认它居时间线顶部；
      就地编辑；归档；删除（软删）。

## 高风险文件 / 回滚点
- `server/routes/api/index.ts` —— 路由注册（一行附加）。
- `server/models/Attachment.ts` + `add-memoId-to-attachments` 迁移 —— 附加可空外键；可安全
  反转。
- `server/models/index.ts` —— 模型注册。
- `app/stores/RootStore.ts` / `app/stores/index.ts` —— store 注册。
- `app/routes/authenticated.tsx` —— 一行路由。
- 回滚：反转两个迁移；功能自包含。

## 后续（未来子任务，非本任务）
- 团队 memo 墙 + 公开分享链接 UX（消费 `visibility`）。
- 全文搜索；统计/热力图/连续天数。
- 表情反应 + 评论（新模型；`Comment`/`Reaction` 非多态）。
- 实时协作编辑；API/第三方录入。
- 独立 `Tag` 模型 + 管理 UI。
