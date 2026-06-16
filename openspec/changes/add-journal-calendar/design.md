## 上下文

Outline 的核心内容模型是 Document 和 Collection，前端通过 MobX Store、React Router 和 Sidebar 入口组织主要工作流；后端通过 Koa RPC 路由、Sequelize 模型、权限策略和插件 Hook 扩展功能。Journal 需要新增一个个人私有的日期入口，但正文编辑、协作编辑和文档生命周期仍应复用现有 Document 能力。

设计稿 v6.4 将 Journal 定位为 MVP：侧栏进入月历，点击某一天时创建或打开该日期对应的 Document，并将日期、mood、tags、用户、团队、文档关系记录在 `journal_entries` 表中。插件系统支持 `Hook.API` 和 `Hook.Processor`，因此 Journal API 和文档永久删除联动可以放在 `plugins/journal/server/`；但 Sequelize 模型、权限策略、前端路由、前端 Store 和侧栏入口仍需要核心接入。

## 目标 / 非目标

**目标：**

- 为每位用户提供私有 Journal 月历入口，支持按日期打开或创建日记文档。
- 保证同一团队、同一用户、同一日期最多只有一个 JournalEntry 和一个关联日记文档。
- 使用系统私有集合承载日记文档，并通过 `sourceMetadata.externalId = "outline:journal"` 识别和隐藏该集合。
- 在用户时区语义下处理“今天”、未来日期限制和连续记录统计。
- 在软删除文档时保留 JournalEntry 元数据，在永久删除文档时清理 JournalEntry。
- 为 API、模型、集合保护和前端关键交互补充测试。

**非目标：**

- 不实现内嵌分栏编辑器、Timeline、月度导出、团队统计仪表盘或实时推送。
- 不新增公开分享能力；Journal collection 的公开分享保持禁用。
- 不改变现有 Document 编辑器、协作协议或普通文档路由。
- 不把插件系统扩展到动态注册 Sequelize 模型、权限策略或前端 Store。

## 决策

### 决策 1：JournalEntry 作为核心 Sequelize 模型接入

`JournalEntry` 需要参与数据库迁移、模型索引、权限策略和 `@server/models` 导出。当前插件边界不支持注册 Sequelize 模型，所以模型放在 `server/models/JournalEntry.ts`，并在 `server/models/index.ts` 导出。

替代方案是把元数据写入 Document 字段或 Collection metadata。该方案会把日期唯一性、权限隔离和软删除恢复逻辑混入通用 Document，难以建立 `(teamId, userId, date)` 唯一约束，因此不采用。

### 决策 2：API 和永久删除 Processor 放在 Journal 插件目录

Journal 的 RPC 路由通过 `Hook.API` 注册，文档永久删除联动通过 `Hook.Processor` 注册。这样可以让主要业务逻辑保留在 `plugins/journal/server/`，核心改动只保留在模型、策略和必要入口。

替代方案是在核心 API 和核心 processor 中直接添加 Journal 逻辑。该方案扩大核心耦合面，不符合已有插件 Hook 的扩展点，因此不采用。

### 决策 3：使用 `sourceMetadata.externalId` 识别系统集合

Journal collection 使用固定名称 `__journal__`，但识别依据必须是 `sourceMetadata.externalId = "outline:journal"`。侧栏过滤也基于同一标记，而不是名称、权限或 sharing 组合。

替代方案是仅按名称隐藏 `__journal__`。该方案会误隐藏用户上线前已有的同名普通集合，也可能复用错误集合，因此不采用。同时，普通集合 create/update 需要拒绝 `__` 前缀保留名，避免用户后续创建系统名称。

### 决策 4：upsert 创建路径使用事务内 advisory lock

`journal.upsert` 先走无锁快速路径读取已有 entry；未命中时使用 `pg_advisory_xact_lock(hashtextextended(:lockKey, 0))` 对 `(teamId, userId, journal)` 串行化，再锁后重查并创建 collection、document、entry。唯一索引仍保留为最后防线。

替代方案是只依赖唯一约束并捕获冲突。该方案可能在 Document 已创建但 JournalEntry 唯一冲突时留下孤儿文档，或在 catch 后正常提交事务，因此不采用。

### 决策 5：软删除保留元数据，永久删除才清理

普通删除将 Document 放入 Trash，此时 JournalEntry 保留，但 `journal.entries` 和 `journal.calendar` 过滤软删除文档；用户恢复文档后日记自动回到日历。只有 `documents.permanent_delete` 事件触发时，Journal Processor 才删除关联 JournalEntry。

替代方案是在软删除时立即删除 JournalEntry。该方案会导致恢复文档后 mood、tags、日期关联丢失，因此不采用。

### 决策 6：前端保持跳转到现有 Document Scene

MVP 的 Journal Scene 只负责月历、最近记录和错误反馈；点击日期后调用 `journal.upsert`，拿到 document URL 后使用现有路由打开 Document Scene。正文编辑继续复用现有文档编辑器。

替代方案是在 Journal Scene 内嵌编辑器。该方案需要额外处理布局、协作状态、移动端响应和编辑器生命周期，超出 MVP 范围，因此不采用。

## 风险 / 权衡

- 并发创建风险 -> 在创建路径使用事务内 advisory lock、锁后重查和数据库唯一索引三层保护。
- 系统集合误隐藏或误复用风险 -> 所有识别逻辑统一使用 `sourceMetadata.externalId = "outline:journal"`，并添加同名历史集合测试。
- 用户时区与服务器 UTC 错位风险 -> 前端 Store 和后端 helper 都用 IANA timezone 计算 YYYY-MM-DD；mutation 优先使用用户 profile timezone，读取接口允许请求 timezone 覆盖。
- Trash 状态体验风险 -> 软删除文档不显示在日历和列表；打开已在 Trash 中的 entry 返回 409，提示用户先恢复文档。
- Journal 元数据泄露风险 -> JournalEntry policy 限制同一用户和团队访问，viewer/guest 只能按权限读取已有 entry，不能更新 mood/tags。
- Streak 长区间查询成本风险 -> 连续记录统计只查询最近 367 天，并用 `streakCapped` 表示超过 366 天的情况。
- 前端集合字段类型缺失风险 -> 在 `app/models/Collection.ts` 声明 `sourceMetadata`，避免侧栏过滤产生 TypeScript 错误。

## 迁移计划

1. 添加 `journal_entries` 表、mood enum、唯一索引和查询索引。
2. 部署 `JournalEntry` 模型导出和权限策略注册。
3. 部署 Journal 插件 API、Presenter 和 Processor 注册。
4. 部署集合保留名校验，防止普通集合创建或重命名为系统名称。
5. 部署前端 Journal Store、模型、路由、侧栏入口、日历组件和集合过滤。
6. 运行后端 API、模型、集合保护和前端组件测试。

回滚时先移除前端入口和插件注册，再回滚迁移删除 `journal_entries` 表和 mood enum。Journal 文档本身是普通 Document，回滚不会自动删除已创建文档。

## 待确认问题

无。当前按设计稿 v6.4 作为最终执行稿实施。
