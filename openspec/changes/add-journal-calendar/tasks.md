## 1. 后端数据模型与权限

- [x] 1.1 生成并实现 `journal_entries` 迁移，包含 `userId`、`teamId`、`documentId`、`date`、`mood`、`tags`、时间戳、唯一索引和查询索引。
- [x] 1.2 实现 `server/models/JournalEntry.ts`，声明 DATEONLY date、mood enum、JSONB tags，以及 User、Team、Document 关联。
- [x] 1.3 在 `server/models/index.ts` 导出 `JournalEntry`，确保插件和策略可通过 `@server/models` 引用。
- [x] 1.4 实现 `server/policies/journalEntry.ts`，限制 read/update/delete 只能由同团队作者执行，并禁止 viewer/guest 更新或删除。
- [x] 1.5 在 `server/policies/index.ts` 注册 JournalEntry policy。
- [x] 1.6 实现 `plugins/journal/server/presenters/journalEntry.ts`，序列化 entry、document、mood、tags 和时间戳。

## 2. Journal 插件 API

- [x] 2.1 创建 `plugins/journal/server/api/journal.ts`，按 Outline 路由模式接入 `auth()`、`validate()`、`transaction()` 和必要的 rate limiter。
- [x] 2.2 实现 `zodDateOnly`、`todayInTimezone`、`addDays` 和 `calculateStreak` helpers，覆盖真实日期校验、用户时区和 367 天 lookback capped 逻辑。
- [x] 2.3 实现 `journal.upsert` 已有 entry 快速路径，支持只读打开、mood/tags 更新、Trash 409 和权限校验。
- [x] 2.4 实现 `journal.upsert` 创建路径，使用事务内 advisory lock、锁后重查、Journal collection 创建/复用、`createCollection` 与 `createDocument` 授权、`documentCreator` 和 JournalEntry 创建。
- [x] 2.5 实现 `journal.entries`，校验日期范围顺序和 366 天上限，并排除关联 Document 已软删除的 entry。
- [x] 2.6 实现 `journal.calendar`，返回当月日期点、streak 和 `streakCapped`，并校验 IANA timezone。
- [x] 2.7 实现 `journal.info`，按日期返回当前用户 entry，并对不存在或 Trash 中的文档返回 404。
- [x] 2.8 实现 `plugins/journal/server/processors/JournalProcessor.ts`，仅监听 `documents.permanent_delete` 并删除关联 JournalEntry。
- [x] 2.9 实现 `plugins/journal/server/index.ts`，注册 `Hook.API` 和 `Hook.Processor`。

## 3. 集合保护与核心接入

- [x] 3.1 在 `server/routes/api/collections/collections.ts` 的 create 路由中拒绝 `name.trim().startsWith("__")` 的普通集合名称。
- [x] 3.2 在 `server/routes/api/collections/collections.ts` 的 update 路由中使用可选链拒绝重命名为 `__` 前缀，并保持非 name 更新不报错。
- [x] 3.3 确认 Journal collection 创建时写入 `sourceMetadata.externalId = "outline:journal"`、`sourceMetadata.externalName = "Journal"`、`permission = null` 和 `sharing = false`。

## 4. 后端测试

- [x] 4.1 新增 `plugins/journal/server/api/journal.test.ts`，覆盖首次 upsert、重复 upsert、并发 upsert、跨用户隔离、mood/tags 更新、私有集合创建和 rate limit。
- [x] 4.2 扩展 Journal API 测试，覆盖历史同名 `__journal__` 集合不复用、已标记集合复用、viewer/guest 权限、无创建权限读取已有 entry、未来日期和无效日期。
- [x] 4.3 扩展 Journal API 测试，覆盖 Trash 409、entries 范围校验、calendar timezone、streak capped、info 404 和软删除过滤。
- [x] 4.4 新增 `server/models/JournalEntry.test.ts`，覆盖 `(teamId, userId, date)` 唯一约束和 Document 物理删除级联或清理行为。
- [x] 4.5 扩展 `server/routes/api/collections/collections.test.ts`，覆盖 create/update 拒绝 `__` 前缀和 update 未传 name 的情况。
- [x] 4.6 运行后端相关测试：`yarn test plugins/journal/server/api/journal.test.ts`、`yarn test server/models/JournalEntry.test.ts`、`yarn test server/routes/api/collections/collections.test.ts`。

## 5. 前端数据层

- [x] 5.1 实现 `app/models/JournalEntry.ts`，继承 `app/models/base/Model`，声明 `static modelName`、store、date、mood、tags、documentId 和 document 字段。
- [x] 5.2 实现 `app/stores/JournalEntriesStore.ts`，继承 `Store<JournalEntry>` 并设置 `apiEndpoint = "journal"`。
- [x] 5.3 在 JournalEntriesStore 中实现 `userTimezone`、`today`、`fetchCalendar`、`fetchOrCreateByDate`、`fetchRange`、错误状态、selectedDate/currentMonth 状态和 `recentEntries` computed。
- [x] 5.4 在 `app/stores/RootStore.ts` 声明并通过 `registerStore(JournalEntriesStore)` 注册 JournalEntriesStore。
- [x] 5.5 在 `app/models/Collection.ts` 声明 `sourceMetadata?: { externalId?: string; externalName?: string } | null`，供侧栏过滤类型检查使用。

## 6. 前端 UI 与路由

- [x] 6.1 在 `app/routes/authenticated.tsx` 懒加载 Journal Scene，并注册 `/journal` 和 `/journal/:date` 路由。
- [x] 6.2 在 `app/components/Sidebar/App.tsx` 增加 Journal 侧栏入口和日历图标。
- [x] 6.3 在 `app/components/Sidebar/components/Collections.tsx` 过滤 `sourceMetadata.externalId === "outline:journal"` 的系统集合，并保持拖拽排序使用过滤后的集合。
- [x] 6.4 实现 `app/scenes/Journal/index.tsx`，加载月历和最近 14 天 entry，处理 URL date 参数、点击日期 upsert 跳转、actionError toast 和 streak 展示。
- [x] 6.5 实现 `app/scenes/Journal/components/CalendarGrid.tsx`，提供月切换、周标题、日期按钮、entry dot、today 高亮、selected 状态和未来日期 disabled。
- [x] 6.6 实现 `app/scenes/Journal/components/RecentEntries.tsx`，展示最近有可见文档的 JournalEntry 并链接到关联文档。
- [x] 6.7 检查 Journal Scene 在桌面和移动宽度下无文字重叠，日期格、按钮和 loading 状态尺寸稳定。

## 7. 前端测试

- [x] 7.1 新增 `app/scenes/Journal/index.test.tsx`，覆盖打开页面加载 calendar/range、点击日期跳转、actionError toast、streak 文案和 0 streak 不展示。
- [x] 7.2 新增 CalendarGrid 测试，覆盖 today 的 `aria-current="date"`、selected 的 `aria-pressed="true"`、未来日期 disabled、日期 aria-label 和 entry dot。
- [x] 7.3 新增 `app/components/Sidebar/components/Collections.journal.test.tsx`，覆盖已标记 Journal 系统集合隐藏、历史同名未标记集合不隐藏、普通集合不误过滤。
- [x] 7.4 运行前端相关测试：`yarn test app/scenes/Journal/index.test.tsx` 和 `yarn test app/components/Sidebar/components/Collections.journal.test.tsx`。

## 8. 验证与收尾

- [x] 8.1 运行 `yarn tsc`，修复 Journal 模型、Store、路由和 API 引入的类型错误。
- [x] 8.2 运行 `yarn lint`，修复 Oxlint 和项目风格问题。
- [x] 8.3 运行 `yarn format`，确保新增和修改文件符合 Prettier。
- [x] 8.4 手动验证 `/journal`：侧栏入口可见，系统集合不在普通集合列表，点击今天创建/打开文档，未来日期不可点击。
- [x] 8.5 手动验证 Trash 流程：软删除日记文档后日历隐藏，恢复后重新显示，永久删除后 JournalEntry 被清理。
