# 设计 — Memos 快速记录（MVP / 第一阶段）

## 架构与边界

一个全新、独立的 `Memo` 聚合根，**不是** `Document`，也不包裹它。复用 Outline 的
ProseMirror 编辑器栈（内容为 ProseMirror JSON）与 `Attachment` 存储管线，但有独立的模型、
路由、store、场景、presenter 与策略。它与半成品 `Journal` 并存，互不触碰。

```
app（React/MobX）                      server（Koa/Sequelize）
─────────────────                     ──────────────────────
scenes/Memos/            ──HTTP──▶    routes/api/memos/memos.ts
  index.tsx（录入+时间线）                  routes/api/memos/schema.ts（zod）
stores/MemosStore.ts                     routes/api/memos/index.ts
models/Memo.ts                       commands/memoCreator.ts（可选）
editor：memo 扩展子集 +               models/Memo.ts（继承 ArchivableModel）
  MemoTag 节点（仿 Mention）            presenters/memo.ts
Sidebar 导航 -> /memos                policies/memo.ts
routes/authenticated.tsx             migrations/<ts>-create-memos.js
                                      migrations/<ts>-add-memoId-to-attachments.js
```

## 数据模型

### `Memo`（`server/models/Memo.ts`，继承 `ArchivableModel`）

| 列         | 类型                               | 说明                               |
| ---------- | ---------------------------------- | ---------------------------------- |
| id         | uuid（主键，来自`IdModel`）      |                                    |
| teamId     | uuid 外键 -> teams                 | 必填                               |
| userId     | uuid 外键 -> users                 | 作者                               |
| content    | jsonb（ProsemirrorData）           | memo 正文                          |
| tags       | jsonb`string[]`                  | 抽取的内联`#tag`，`tag/subtag` |
| visibility | 枚举(private,workspace,public)     | 默认`private`                    |
| createdAt  | timestamptz（base）                | 时间线排序键（desc）               |
| updatedAt  | timestamptz（base）                |                                    |
| archivedAt | timestamptz 可空（base）           | 归档                               |
| deletedAt  | timestamptz 可空（base，paranoid） | 软删                               |

索引：

- `(teamId, userId, createdAt DESC)` —— 个人时间线。
- `tags` 上的 GIN —— 标签过滤。
- `(teamId, visibility, createdAt DESC)` —— 为未来团队墙预留。

关联：`BelongsTo Team`、`BelongsTo User`（作者）、`HasMany Attachment`（经 `Attachment.memoId`）。

### `Attachment`（附加改动）

加一个可空 `memoId` uuid 外键 -> memos（及 `BelongsTo Memo`）。现有 `documentId` 行为不变。
迁移纯附加。memo 编辑器的上传回调设置 `memoId` 而非 `documentId`。

## `#tag` 节点

新的 ProseMirror 内联节点 `MemoTag`，位于 `shared/editor/nodes/`，仿 `Mention.tsx`
（parseDOM、toDOM、atom）。一个 `MemoTagMenu` 扩展（仿 `MentionMenu`）在 `#` 时触发，用
用户已有标签建议（经 `memos.tags` 获取，见 API）。服务端 `memoCreator`/`memoUpdater` 从
ProseMirror JSON 抽取所有 `MemoTag` 节点文本值（经 `ProsemirrorHelper` / `textBetween`）并
写入 `tags`。层级仅为 `tag/subtag` 串；UI 按 `/` 分段分组以日后渲染树（MVP 无 `Tag` 表）。

## API 面（`server/routes/api/memos/`）

仿 `pins`（`pins.ts` + `schema.ts` + `index.ts`；在 `routes/api/index.ts` 中
`router.use("/", memos.routes())` 注册）。

| 端点                         | 认证 | 输入                                           | 返回            |
| ---------------------------- | ---- | ---------------------------------------------- | --------------- |
| `memos.create`             | 是   | `content`、`visibility?`、`attachments?` | memo + policies |
| `memos.list`               | 是   | `cursor?`、`archived?`、`tag?`           | memos[] + 分页  |
| `memos.info`               | 是   | `id`                                         | memo + policies |
| `memos.update`             | 是   | `id`、`content?`、`visibility?`          | memo + policies |
| `memos.archive`            | 是   | `id`                                         | memo            |
| `memos.delete`             | 是   | `id`                                         | success         |
| `memos.attachments.create` | 是   | `memoId?`（或临时）、`name`、file/url      | attachment      |
| `memos.tags`               | 是   | `query?`                                     | distinct tags[] |

- schemas：Zod，扩展 `BaseSchema`（见 `pins/schema.ts`）。
- 中间件：`auth()`、`validate(Schema)`、`list` 用 `pagination()`、create/update 用
  `rateLimiter(RateLimiterStrategy.TwentyFivePerMinute)`、多写处用 `transaction()`。
- `list` 默认返回调用者自己的 memos（作者 = 用户），倒序，排除 `deletedAt`/`archivedAt`，
  除非 `archived=true`。`tag` 过滤用 GIN 索引（`tags @> ARRAY[...]`）。

## 策略（`server/policies/memo.ts`）

- `create`：任意已认证用户（限定到自己的 `teamId`）。
- `read`：作者始终可读；若 `visibility=workspace`，任意同队用户可读；`public` 预留（暂无分享 UI）。
- `update` / `archive` / `delete`：仅作者。
  仿一个现有简单策略（如 `pin.ts`）。

## Presenter（`server/presenters/memo.ts`）

`presentMemo(memo)` -> `{ id, content, tags, visibility, userId, teamId, createdAt, updatedAt, archivedAt }`。仿 `journalEntry.ts`。

## 前端

- `app/models/Memo.ts`：继承 `Model`；`static modelName = "Memo"`；`@Field`
  observables（`content`、`tags`、`visibility`）；`@Relation` 到 User。仿 `Pin.ts`。
- `app/stores/MemosStore.ts`：继承 `Store<Memo>`，`apiEndpoint = "memos"`；
  动作 `createMemo`、`fetchTimeline`（分页）、`fetchMemo`、`updateMemo`、`archiveMemo`、
  `deleteMemo`、`fetchTags`；observable `timeline`、`isLoading`、`cursor`。仿
  `JournalEntriesStore.ts` / `PinsStore.ts`。
- `app/scenes/Memos/`：`index.tsx`（顶部录入框 + 下方时间线）、
  `components/MemoEditor.tsx`（精简 ProseMirror 编辑器，用精选扩展子集 + `MemoTag` 节点）、
  `components/MemoCard.tsx`（只读渲染）、`components/MemoTimeline.tsx`。仿
  `scenes/Journal/` 结构。
- 路由：在 `app/routes/authenticated.tsx` 懒加载 `Memos`，并在 Journal 路由旁加
  `<Route exact path="/memos" component={Memos} />`。
- 侧栏：在 `app/components/Sidebar/` 加"Memos"导航项（图标 + 标签），链到 `/memos`。

## 数据流（录入）

1. 用户在 `MemoEditor`（精简扩展 + `MemoTag`）中输入；`#` 用 `MemosStore.fetchTags()`
   的建议打开 `MemoTagMenu`。
2. 提交时 `MemosStore.createMemo({ content, visibility })` POST `memos.create`。
3. 服务端校验（zod）-> `memoCreator` 从 JSON 抽取标签，写 `Memo`，在事务内按 `memoId`
   关联任何 `attachments`。
4. Presenter 返回 memo；store 把它前置到 `timeline`。

## 兼容性与迁移

- 仅两个附加迁移：`create-memos`（表 + 索引 + 枚举）与 `add-memoId-to-attachments`
  （可空外键）。不改任何现有表/列。
- `Attachment.documentId` 保持可空；memo 附件用 `memoId`。对文档无影响。
- `visibility` 枚举默认 `private`；现有数据不受影响（新表）。
- MVP 无实时/协作连线（memos 不接 Yjs/Hocuspocus）。

## 权衡

- **ProseMirror JSON 而非 markdown**：比 flomo 纯文本重，但复用编辑器/附件/mention 栈，
  只保留一条渲染管线（AGENTS.md）。
- **`tags[]` JSONB + GIN 而非 `Tag` 表**：MVP 更简单；标签计数/重命名日后更难（推迟到未来
  `Tag` 模型任务）。
- **`Attachment.memoId` 而非多态重构**：附加且低风险；未来多态 `Attachment` 重构可合并
  `documentId`/`memoId`。
- **无 `Revision` 历史**：契合短 memo 场景；MVP 无法撤销编辑。

## 运维 / 回滚

- 回滚 = 反转两个迁移（删 `attachments.memoId`、删 `memos`）。不触碰现有表中数据，
  因此回滚安全。
- 功能自包含；禁用 = 移除导航项 + 路由注册。
