# Memos 快速记录功能

## 目标

为 Outline 增加一个 memos / flomo 式的"快速记录"功能：一种低摩擦、快速的方式，用
`#标签` 在倒序时间线上组织短笔记（"memo"），并提供每日回顾、搜索、写作统计与团队/
公开可见性，作为对 Outline 现有长篇协作文档的补充。

## 用户价值

- 几秒内记录一个想法，无需创建/查找文档或集合。
- 通过标签、时间线和每日回顾重新发现过往 memo。
- 在文档库之外建立个人**与**团队的知识流。

## 决策

- **[Q1] 与 Journal 的关系：** 方案 C —— 构建一个**全新、完全独立的"Memos"功能**
  （新的 `Memo` 实体 + 新的场景/UX），与现有 Journal 功能并存。Journal 维持原样；
  补全/修复 Journal 缺失的后端对本任务**不在范围内**。两个功能在概念上不得重叠。
- **[Q2] 可见性：** 方案 B —— memos **团队可见 / 可分享**。每条 memo 带 `visibility`
  （如 `private` / `workspace` / `public`）；一个**团队 memo 流（"墙"）**展示工作区
  可见的 memos。公开分享复用 Outline 的分享概念。MVP 不做每条 memo 的细粒度 ACL。
- **[Q3] 内容格式与编辑器：** 方案 A —— 复用 Outline 的 ProseMirror 编辑器，配一份
  **精简的"memo"扩展集**；内容以 **ProseMirror JSON** 存储。Markdown 仅用于导入/导出与
  API 写入。Memos **单作者**（团队可见 = 可看/可反应/可评论，非共编）；实时协作编辑属
  **未来范围**，不在 MVP。
- **[Q4] MVP 范围：** 方案 C + 附件。**MVP = 录入 + `#标签`（含层级）+ 个人倒序时间线
  + 附件。** 推迟到后续阶段：团队 memo 墙、全文搜索、统计/热力图/连续天数、公开分享链接
  UX、表情反应、评论、实时协作、API/第三方写入（微信等）。
  - **与 Q2 的协调：** `visibility` 字段**仍在 MVP 中建模**（默认 `private`），以便团队墙
    与公开分享日后无需迁移即可上线，但 MVP 只上线**个人时间线** UI。若 visibility 在 MVP
    中无 UI 效果，作为前向兼容是可以接受的。
  - 这是**多交付物范围**：MVP 现在做，"团队/社交"与"回顾/搜索"阶段日后做。将在 `design.md`
    中以父任务 + 可独立验收的子任务建模。
- **[Q5] 标签模型：** 方案 1 —— 内联 `#tag` ProseMirror 节点（仿 `Mention.tsx` +
  `MentionMenu`），保存时抽取到 `Memo.tags`（JSONB `string[]`，同 `JournalEntry`）。层级
  用 `tag/subtag` 扁平串；**MVP 不建独立 `Tag` 模型**（UI 临时聚合出树）。无现成 hashtag
  节点或 `Tag` 模型可复用；`Mention` 是模板。
- **[Q6] 编辑/历史/删除语义：** 方案 A —— 可就地编辑、无完整历史、软删 + 归档。`Memo`
  继承 `ArchivableModel`（免费获得软删 `deletedAt` 与归档 `archivedAt`，与全站一致）；支持
  就地更新 `content` 与 `updatedAt`，**MVP 不接 `Revision` 历史链**；删除走软删（可恢复），
  归档从时间线默认视图隐藏。

## 参考产品

- **memos**（usememos/memos）：自托管 memo 中心。短 markdown memos、`#tag`（含
  `#tag/subtag`）、倒序信息流、列表/紧凑视图、公开 vs 私有可见性、资源/附件、搜索、反应、
  分享、API。
- **flomo**（flomoapp.com）：卡片笔记。快速录入框、`#tag` 含标签树 + 标签思维导图、每日回顾
  （回顾）、日历热力图、计数/连续天数、API + 微信录入、默认个人/私有。

共同精髓：快速录入 · `#标签` 组织 · 扁平时间线 · 每日回顾 · 搜索 · 统计（计数/连续天数/
热力图）· 分享与附件。

## 已确认事实（来自代码库勘察）

- Outline 的核心内容实体是 `Document`（ProseMirror、可协作、位于 `Collection` 中，含
  Revisions、Shares、Comments、Reactions、Pins、Stars、Views）。前端用 MobX stores；
  后端 = `/api/` 下的 Koa 路由、Sequelize 模型、presenters、policies、commands。
- Outline 编辑器（`app/editor/index.tsx`）**可组合**：接受 `extensions` prop（默认
  `basicExtensions`），Comments 已用其轻量变体。Markdown 解析/序列化已存在
  （`shared/utils/markdown.ts`、`@shared/editor/lib/markdown/serializer`），编辑器接受
  markdown 作为输入。=> 一个精简的"memo 编辑器"可复用 ProseMirror + 精选扩展子集，无需
  另起 markdown 渲染管线。
- `JournalEntry` 把自己的 `tags` 存为 JSONB `string[]` 列；`Document` **没有** `tags` 列。
  Memos 将同样自行管理标签存储。
- `ArchivableModel`（base）继承 `ParanoidModel`（软删 `deletedAt`）并增加 `archivedAt`；
  `Document` 继承它。=> Memos 可继承 `ArchivableModel` 免费获得软删 + 归档，与代码库一致。
- `Revision` 是重量的逐次历史模型（`Document` 有多条，含 `restoreFromRevision`）。对短 memo
  而言完整历史在 MVP 过重。
- `Comment` 硬绑 `Document`（`documentId` + 线程化 `parentCommentId`）；`Reaction` 硬绑
  `Comment`。两者都非多态，因此给 memo 复用需要非平凡的改造（或新建并行模型）。`Attachment`
  较接近通用（`documentId` 可空，含 `userId`/`teamId`）但仍偏文档导向。=> Memo 的反应/评论/
  附件在 MVP **不是廉价复用**。
- 一个**半成品 Journal 功能已存在（已提交 WIP）**且保持不动：`server/models/JournalEntry.ts`
  （date/mood/tags→Document）、迁移 `20260604000000-create-journal-entries.js`、
  `server/presenters/journalEntry.ts`、`app/stores/JournalEntriesStore.ts`、
  `app/scenes/Journal/`。其后端 API 缺失（无路由目录，未在 `routes/api/index.ts` 注册）。模型
  把一个日期映射到一个 Document（日记式），而非多条短 memo。

## 需求（MVP / 第一阶段）

- **R1 Memo 实体** —— 新服务端模型 `Memo`（`server/models/Memo.ts`），继承
  `ArchivableModel`。列：`teamId`、`userId`（作者）、`content`（ProseMirror JSON，JSONB）、
  `tags`（JSONB `string[]`）、`visibility`（枚举 `private|workspace|public`，默认 `private`）。
  复用 base 的 `archivedAt`/`deletedAt`。索引：个人时间线 `(teamId, userId, createdAt desc)`
  与 `tags` 上的 GIN 索引用于标签过滤。
- **R2 快速录入** —— 一个精简 ProseMirror"memo 编辑器"（从 `basicExtensions` 精选 `extensions`
  子集：段落、加粗/斜体、列表、链接、新的 `#tag` 节点、图片/附件节点）。从录入框一步创建+保存
  一条 memo。
- **R3 `#tag` 节点 + 抽取** —— 内联 `#tag` 节点，仿 `Mention.tsx` + `MentionMenu`（触发 `#`，
  从用户已有标签自动补全）。保存时从内容抽取标签到 `Memo.tags`。层级用 `tag/subtag` 扁平串。
- **R4 个人时间线** —— 用户自己的 memos 倒序列表，游标分页；归档 memo 默认隐藏，可通过过滤
  切换显示。
- **R5 附件** —— 给 memo 附图片/文件。给 `Attachment` 加可空 `memoId` 外键（附加迁移）与
  `memos.attachments.create` 路由；memo 编辑器复用 `insertFiles`，用 memo 作用域的上传回调。
  图片内联渲染。
- **R6 API** —— `server/routes/api/memos/`，仿 `pins`：`memos.create`、`memos.list`、
  `memos.info`、`memos.update`、`memos.archive`、`memos.delete`、`memos.attachments.create`。
  Zod schemas、`auth()`、`validate()`、`pagination()`、`rateLimiter()`、需要的处 `transaction()`；
  策略在 `server/policies/memo.ts`。
- **R7 前端** —— `Memos` 场景位于 `/memos`（录入框 + 时间线）、`MemosStore`
  （`apiEndpoint = "memos"`）、`app/models/Memo.ts`、侧栏导航项、`app/routes/authenticated.tsx`
  中的路由。
- **R8 生命周期** —— 可就地编辑（更新 `content` + `updatedAt`，无 `Revision` 历史）；软删
  （可恢复）+ 归档，经 `ArchivableModel`。

## 验收标准

- [ ] 已登录用户打开 `/memos`，输入一条含 `#tag/subtag` 和一张附带图片的短笔记，一步保存；
      该 memo 出现在时间线顶部，标签渲染为 chip。
- [ ] 内联 `#tag` 从用户已有标签提供自动补全；保存后 memo 的 `tags` 精确反映所有内联标签
      （含 `tag/subtag`）。
- [ ] 时间线按时间倒序列出用户自己的 memos，游标分页；归档 memo 默认隐藏，经过滤切换可显示。
- [ ] 编辑 memo 就地更新内容 + `updatedAt`；不创建任何 `Revision` 行。
- [ ] 删除为软删（可恢复）；归档使 memo 从默认时间线隐藏。
- [ ] `visibility` 默认 `private` 并持久化（MVP 中无其他 UI 效果；团队墙 / 公开分享已推迟）。
- [ ] 所有 `memos.*` 端点受认证保护、Zod 校验、限流，并执行策略：仅作者可更新/归档/删除其
      memo；任意团队成员可读 workspace 可见的 memos（即使墙 UI 推迟，读取路径也由测试覆盖）。
- [ ] `yarn tsc` 与 `yarn lint` 通过；模型、路由处理器、store、场景的同目录 `.test.ts`/
      `.test.tsx` 测试通过。

## 范围外（第一阶段 —— 未来子任务）

- 团队 memo 墙、全文搜索、统计/热力图/连续天数、公开分享链接 UX。
- 表情反应、评论（需新建模型 —— `Comment`/`Reaction` 非多态）。
- memos 的实时协作编辑。
- API / 第三方录入（微信等）。
- 补全/修复现有 Journal 后端；每条 memo 的细粒度 ACL；memos 的 `Revision` 历史；独立 `Tag`
  模型 / 标签管理 UI。

## 待定问题（无阻塞 —— 评审时确认的假设）

- 入口：侧栏顶层"Memos" -> `/memos`（仿 Journal）。已假设。
- 附件：给 `Attachment` 加可空 `memoId` + `memos.attachments.create`（vs 多态 `Attachment`
  重构）。已假设附加方式；重构推迟。
