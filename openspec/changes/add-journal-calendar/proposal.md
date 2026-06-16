## 为什么

Outline 目前没有面向个人日记的日期入口，用户需要手动创建、命名和整理每日记录，难以形成连续的写作习惯和按日期回溯。新增 Journal（日记 + 日历）能力可以在不改变现有 Document 编辑体验的前提下，为每位用户提供私有、按日期组织的入口。

## 变更内容

- 新增 Journal 功能：用户可以从侧栏进入日历视图，点击日期后打开或创建当天对应的文档。
- 新增 `JournalEntry` 元数据模型：将用户、团队、日期和文档关联起来，并保存可选 mood、tags。
- 新增 `journal.upsert`、`journal.entries`、`journal.calendar`、`journal.info` API，用于创建/读取日记、日历日期点和连续记录统计。
- 新增私有 Journal 系统集合，使用 `sourceMetadata.externalId = "outline:journal"` 标记，并从普通集合侧栏列表隐藏。
- 新增文档永久删除联动：仅在文档物理删除时清理 JournalEntry，软删除期间保留元数据以支持恢复。
- 新增前端 Journal Store、模型、路由、侧栏入口和日历 UI。
- 补充集合保留名保护，禁止普通集合创建或重命名为 `__` 开头的系统名称。
- 无破坏性变更。

## 功能 (Capabilities)

### 新增功能

- `journal-calendar`: 提供个人私有日记、月历入口、按日期创建/打开文档、日记元数据、连续记录统计和 Journal 系统集合隔离。

### 修改功能

无。

## 影响

- 后端：新增 Sequelize 模型、迁移、权限策略、插件 API、插件 Processor、Presenter 和相关测试。
- 前端：新增 Journal 模型、Store、Scene、CalendarGrid、RecentEntries、路由和侧栏入口，并扩展 Collection 模型字段。
- 现有集合 API：创建和更新集合时增加 `__` 前缀保留名校验。
- 现有集合侧栏：过滤带 `outline:journal` sourceMetadata 标记的系统集合，避免显示用户日记内部集合。
- 数据安全：JournalEntry 元数据仅作者本人可读写；Journal collection 为私有且禁用公开分享。
