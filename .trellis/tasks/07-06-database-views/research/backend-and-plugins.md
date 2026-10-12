# Research: 数据库表格功能的后端与插件基础调研

- **Query**: 为"数据库表格"(字段定义/行记录/视图配置) 功能调研 Outline 的模型/迁移/插件/实时更新/Store 模式
- **Scope**: internal
- **Date**: 2026-07-06

## 1. server/models 模型模式（完整链路示例）

### 代表模型

| 文件 | 说明 |
|---|---|
| `server/models/Comment.ts` | 附着于文档的结构化数据典型：JSONB 字段 (`data: ProsemirrorData`, `reactions`)、`@BelongsTo`/`@ForeignKey` 关联 Document/User/父 Comment、`@DefaultScope` 预加载、生命周期 hooks (`@BeforeCreate` 继承 resolved 状态、`@AfterUpdate` 级联、`@AfterDestroy` 删子评论)、业务方法 (`resolve()`/`unresolve()`)。继承 `ParanoidModel`（软删除） |
| `server/models/Star.ts` | 最小模型示例：仅 `index` 排序字段 + userId/documentId/collectionId 三个外键，继承 `IdModel`。`@Table({ tableName, modelName })` + `@Fix` 装饰器是标配 |
| `server/models/Memo.ts` | 最近新增（2026-06）的完整新资源示例，JSONB content + tags + enum visibility，可作为新资源的模板 |

模型基类：`server/models/base/Model.ts`、`base/IdModel.ts`、`base/ParanoidModel.ts`。
关键机制（`base/Model.ts`）：

- `createWithCtx(ctx, ...)` / `updateWithCtx(ctx)` / `destroyWithCtx(ctx)`（L66-201）：携带 APIContext 保存，触发 `@AfterCreate/@AfterUpdate/@AfterDestroy` → `insertEvent()`（L256-337）自动向 `events` 表写入 `<namespace>.<create|update|delete>` 事件（namespace 默认取 `tableName`，可用静态 `eventNamespace` 覆盖，如 `ApiKey.ts:45`）。**这是实时广播的源头，新模型只要用 `xxxWithCtx` 就自动进事件流**。
- 事件属性自动提取 model 上的 `collectionId/documentId/userId/teamId` 字段。

模型需在 `server/models/index.ts` 中导出注册。

### Policy 授权

- `server/policies/star.ts`：最简形式 `allow(User, ["read","update","delete"], Star, isOwner)`（cancan 风格）。
- `server/policies/comment.ts`：条件组合 `and()/or()/isTeamModel()`，自定义动作名如 `resolve`/`addReaction`。
- 工具函数在 `server/policies/utils.ts`，`allow`/`authorize` 在 `server/policies/cancan.ts` 与 `server/policies/index.ts`。路由中用 `authorize(user, "update", star)`。

### Presenter

- `server/presenters/star.ts`：纯函数把 model 转为 API 响应形状；在 `server/presenters/index.ts` 导出。
- `presentPolicies(user, [models])` 会把授权结果一并下发给前端 PoliciesStore。

### API 路由（server/routes/api）

每个资源一个目录，四件套：`stars/{index.ts, stars.ts, schema.ts, stars.test.ts}`。

- `server/routes/api/stars/stars.ts`：RPC 风格端点 `stars.create|list|update|delete`。中间件链：`rateLimiter()` → `auth()` → `validate(T.XxxSchema)` → `transaction()`，handler 内 `authorize` → 模型/command 操作（`star.updateWithCtx(ctx, {...})`）→ `ctx.body = { data: presentStar(star), policies: presentPolicies(...) }`。
- `server/routes/api/stars/schema.ts`：zod schema（`BaseSchema.extend({ body: z.object({...}) })`）+ 推导的请求类型。
- 复杂创建逻辑放 command：`server/commands/starCreator.ts`。
- 路由挂载：`server/routes/api/index.ts`（L90+ `router.use("/", stars.routes())`）。

## 2. 迁移 (migrations) 惯例

- 目录：`server/migrations/`，文件名 `YYYYMMDDHHMMSS-<描述>.js`（CommonJS，非 TS）。
- 生成：`yarn sequelize migration:create --name=xxx`；运行：`yarn db:migrate`。
- 近期完整建表例子：`server/migrations/20260629000000-create-memos.js` —— `queryInterface.createTable` + UUID 主键 + JSONB 列 + ENUM 列 + 外键 `references + onDelete: "cascade"` + `addIndex`（含 GIN 索引 on JSONB）+ 完整 `down()`（含 `DROP TYPE` 清理 enum）。

## 3. 插件系统 plugins/ 的能力边界

- 每个插件目录：`plugin.json`（id/name/priority/description）+ `server/index.ts`（服务端入口，被 `server/utils/PluginManager.ts` L138-150 glob 自动加载）+ `client/index.tsx`（前端入口，被 `app/utils/PluginManager.ts` L144-175 `import.meta.glob` 自动加载）+ 可选 `shared/`。

**服务端可注册的 Hook**（`server/utils/PluginManager.ts` L26-37）：
`API`(Koa Router，挂载在核心路由之前，见 `server/routes/api/index.ts:85)、`AuthProvider`、`EmailTemplate`、`IssueProvider`、`Processor`(事件处理器)、`SearchProvider`、`Task`、`UnfurlProvider`、`Uninstall`、`GroupSyncProvider`。
例子：`plugins/webhooks/server/index.ts`（注册 API 路由 + Processor + 2 个 Task）、`plugins/slack/server/index.ts`（AuthProvider + API + Processor，且按 env 条件注册）。

**前端可注册的 Hook**（`app/utils/PluginManager.ts` L14-18）：仅 `Settings`（设置页）、`Imports`、`Icon` 三种。例子：`plugins/webhooks/client/index.tsx` 注册一个懒加载 Settings 页。

**边界结论**：插件**不能**注册 Sequelize 模型、迁移、policy、presenter、MobX store、路由页面或编辑器节点 —— webhooks 插件的模型 `WebhookSubscription.ts`/`WebhookDelivery.ts` 及迁移、前端 `WebhookSubscriptionStore` 全部放在核心 `server/models`、`server/migrations`、`app/stores` 中（plugins/ 下无 models/migrations 目录）。因此 **"数据库表格"应做成核心功能**：模型/迁移/policy/presenter/API/store/编辑器节点都必须进核心代码；插件形态最多只能承载 API 路由与设置页，无法覆盖本需求。

## 4. 实时更新机制（非文档内容，以评论为例）

服务端链路：

1. 路由 handler 用 `model.createWithCtx(ctx)` 等 → `server/models/base/Model.ts` hooks → `insertEvent()` 写 `events` 表（或 `Event.schedule()` 只进队列不落库，`server/models/Event.ts:142`）。
2. `Event` 创建后进入 `globalEventQueue`（`server/models/Event.ts:94`）。
3. `server/services/worker.ts` L21-78 消费 globalEventQueue，分发到 `websocketQueue`（L55）和 `processorEventQueue`（L60，供 Notifications/Webhook 等 Processor）。
4. `server/services/websockets.ts` L146-166 用 `WebsocketsProcessor` 消费 websocketQueue。
5. `server/queues/processors/WebsocketsProcessor.ts` 的 `perform(event, socketio)` 按事件名 switch：如 `comments.create/update`（L570-590）重新查库 → `getDocumentEventChannels()` 算出房间（`user-<id>`/`document-<id>`/`collection-<id>`/`team-<id>`）→ `socketio.to(channels).emit(event.name, presentComment(comment))`；delete 只发 `{ modelId }`。
6. 事件名的 TS 类型在 `server/types.ts`（`CommentEvent` L394、`StarEvent` L411，并加入 `Event` 联合类型 L491）。

前端链路：`app/components/WebsocketProvider.tsx` —— `useCommentHandlers()`（L527-560）`socket.on("comments.create", e => comments.add(e))`、update 时若 resolvedAt 变化先 `policies.remove(id)` 再 `comments.add(e)`、delete → `comments.remove(modelId)`。stars 同理（L707+）。`Store.add()` 是幂等 upsert，MobX observable Map 自动驱动 UI。

## 5. app/stores Store 基类模式

- 基类：`app/stores/base/Store.ts`（496 行）。泛型 `Store<T extends Model>`，持有 `@observable data: Map<string, T>`；约定 `apiEndpoint = pluralize(lowerFirst(modelName))`，内置 `create/update/delete/fetch/fetchPage/fetchAll`（POST `/<endpoint>.create` 等 RPC）、`add()`(upsert)、`remove()`(处理 @Relation 级联与 policy 清理)、`orderedData` computed、`actions = [Info,List,Create,Update,Delete]` 控制允许的 RPC。
- 简单子类：`app/stores/StarsStore.ts`（46 行）—— 构造器 `super(rootStore, Star)`，覆写 `fetchPage`（响应带副资源时手动分发 `rootStore.documents.add`），加自定义 `orderedData` 排序。
- 前端模型：`app/models/Star.ts` —— `static modelName = "Star"`、`@Field @observable` 可写字段、`@Relation(() => Document, { onDelete: "cascade" })` 声明关联；基类 `app/models/base/Model.ts`。
- 注册：`app/stores/RootStore.ts` 中 import 并实例化（L4-40）。

## 6. 若新增 database / records / views 三类资源需要建的文件清单

以 `DataTable`（表定义，含 fields JSONB）、`DataRecord`（行）、`DataView`（视图配置）为例，每类资源各需：

**后端（每资源）**

1. `server/migrations/2026xxxxxxxxxx-create-<tables>.js` — 建表（参考 create-memos，字段定义/单元格值/视图配置可用 JSONB + GIN 索引；外键 documentId/teamId/userId + cascade）
2. `server/models/DataTable.ts` 等 — 继承 `ParanoidModel` 或 `IdModel`，加 `@Table`/`@Fix`，并在 `server/models/index.ts` 导出
3. `server/policies/dataTable.ts` 等 — `allow(User, [...], Model, ...)`，可复用 document/collection 的成员判断
4. `server/presenters/dataTable.ts` 等 + 在 `server/presenters/index.ts` 导出
5. `server/routes/api/dataTables/{index.ts, dataTables.ts, schema.ts, dataTables.test.ts}` + 在 `server/routes/api/index.ts` 挂载
6. 复杂逻辑（如批量改行、字段类型变更）放 `server/commands/`
7. `server/types.ts` — 新增 `DataTableEvent` 等并加入 `Event` 联合
8. `server/queues/processors/WebsocketsProcessor.ts` — 新增 `dataTables.create/update/delete`、`dataRecords.*`、`dataViews.*` 的 case（按 documentId 走 `getDocumentEventChannels`，或按 teamId 房间）

**前端（每资源）**

9. `app/models/DataTable.ts` 等 — `@Field/@observable/@Relation`
10. `app/stores/DataTablesStore.ts` 等 — 继承 `Store<T>`，在 `app/stores/RootStore.ts` 注册
11. `app/components/WebsocketProvider.tsx` — 新增 socket.on 处理器把事件写入 store

**共享**：`shared/types.ts` 中的字段类型/视图类型枚举定义（供前后端复用）。

若要嵌入文档，还需在 `shared/editor/nodes/` 增加编辑器 Node（此部分属核心编辑器，插件无法注册，另行调研前端编辑器部分）。

## Caveats / Not Found

- 未调研编辑器节点 (shared/editor) 与文档嵌入方式，属前端专题。
- `Hook.Processor` 允许插件监听所有事件（webhooks 即如此），故"表格变更推送第三方"这种衍生能力可以做成插件；但资源本体必须在核心。
- Memo 资源 (`server/routes/api/memos/`, `app/stores/MemosStore.ts`) 是 2026-06 新增的、最贴近本需求的端到端参考实现，但未确认其是否已接入 WebsocketsProcessor（grep 未见 `memos.` case，说明新资源不强制接实时广播）。
