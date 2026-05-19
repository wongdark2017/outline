Outline 的 API 层看起来路由很多，但设计思路其实非常统一：**入口薄、schema 先行、中间件分层、命令和模型承载业务、presenter 统一输出。** 这也是为什么你读 `server/routes/api/` 时，不应该只盯着某个 endpoint 本身，更应该先理解这整条请求流水线是如何被搭起来的。

Sources: [server/routes/api/index.ts](server/routes/api/index.ts), [server/routes/api/schema.ts](server/routes/api/schema.ts), [server/middlewares/validate.ts](server/middlewares/validate.ts), [server/middlewares/authentication.ts](server/middlewares/authentication.ts), [server/routes/api/middlewares/apiErrorHandler.ts](server/routes/api/middlewares/apiErrorHandler.ts), [server/routes/api/middlewares/apiResponse.ts](server/routes/api/middlewares/apiResponse.ts)

## 先建立整体心智模型

一条典型 API 请求在 Outline 里大致会经过这条链：

```text
/api 路由入口
  -> 全局中间件栈
  -> auth / validate / pagination / transaction 等路由级中间件
  -> 路由处理函数读取 ctx.input 与 ctx.state
  -> command / model / policy 执行业务
  -> presenter 组装 data / policies / pagination
  -> apiResponse 统一补 status / ok
  -> apiErrorHandler 统一收口底层异常
```

这条链背后的关键判断是：**路由函数不是业务中心，它更像一次请求编排器。**

## `/api` 入口不是只挂 router，而是先挂一整串全局中间件

`server/routes/api/index.ts` 先创建了一个包裹 `koa-router` 的 Koa app，然后依次挂上这些全局中间件：

| 顺序 | 中间件 | 作用 |
|---|---|---|
| 1 | `requestContextMiddleware()` | 初始化请求上下文 |
| 2 | `koa-body` | 解析 JSON、form、multipart |
| 3 | `coalesceBody()` | 统一 body 表现 |
| 4 | `userAgent()` | 挂用户代理信息 |
| 5 | `requestTracer()` | 请求链路追踪 |
| 6 | `apiResponse()` | 成功响应统一补 `status/ok` |
| 7 | `apiErrorHandler()` | 收口底层错误 |
| 8 | `editor()` | 拒绝过旧编辑器版本 |
| 9 | `apiContext()` | 注入 `ctx.context` 给持久化 helper 使用 |
| 10 | `verifyCSRFToken()` | 对需要保护的写请求做 CSRF 校验 |

这很值得注意，因为它说明很多 API 约束并不是每个 route 手工加的，而是**先在 `/api` 整体入口就定下来了。**

### plugin 路由会先于核心路由注册

在核心 routes 之前，API 入口会先执行：

- `PluginManager.getHooks(Hook.API)`

然后把插件路由挂进来。注释里也写得很直接：这样可以允许插件对某些路径做 override。

WHY 这个顺序很重要？因为如果核心路由先注册，插件就很难稳定覆盖或扩展相同命名空间的接口。

Sources: [server/routes/api/index.ts](server/routes/api/index.ts)

## Outline 的 API 更像 RPC 路由，而不是资源式 URL 表

### 大多数 endpoint 都是 `POST + 动词名`

你会在路由里不断看到这种命名：

- `documents.list`
- `documents.info`
- `documents.update`
- `collections.create`
- `comments.resolve`

也就是说，虽然整体挂在 `/api` 下，但它在风格上更接近 RPC，而不是：

- `GET /documents/:id`
- `PATCH /collections/:id`

这种典型 REST 路径。

WHY 这种风格适合 Outline？因为这个系统里很多操作天然不是纯 CRUD：

- `documents.templatize`
- `documents.unpublish`
- `collections.add_group`
- `comments.resolve`

如果强行塞进 REST 资源模型，路径会更绕，反而不如显式动词直白。

### 未命中的路由也会统一转成业务 404

`api/index.ts` 在最后专门加了：

- `router.post("*", ...)`
- `router.get("*", ...)`

都转成 `NotFoundError("Endpoint not found")`。这能保证即便没命中任何路由，也仍然走统一错误格式，而不是直接冒出 Koa 或 router 的默认报错。

Sources: [server/routes/api/index.ts](server/routes/api/index.ts)

## `ctx.input`：请求边界上的“已验证输入”

这套 API 设计里最关键的一个约定是：

- 路由函数优先读 `ctx.input`
- 而不是直接读 `ctx.request.body`

### `validate(schema)` 会把解析结果写回 `ctx.input`

`server/middlewares/validate.ts` 的逻辑很简单：

1. 调 `schema.parse(ctx.request)`
2. 把解析结果 merge 到 `ctx.input`
3. 若捕获到 `ZodError`，只取第一条 issue
4. 统一抛 `ValidationError`

这意味着一旦 route 进入业务代码，拿到的输入已经是：

- 类型化的
- 过 schema 校验的
- 可能已做过 transform/refine 的

### `APIContext<ReqT>` 让路由函数拿到强类型输入

`server/types.ts` 里定义了：

- `APIContext<ReqT, ResT>`

里面显式声明：

- `input: ReqT`
- `context`

因此像：

```ts
async (ctx: APIContext<T.DocumentsUpdateReq>) => {
  const { id } = ctx.input.body;
}
```

这类用法在编译期就有了请求形状的约束。

WHY 这比“路由里自己断言类型”更好？因为整个 API 层的边界被集中固定下来了，后面 route 作者只管业务。

Sources: [server/middlewares/validate.ts](server/middlewares/validate.ts), [server/types.ts](server/types.ts)

## Zod schema 文件不是装饰，而是路由契约本体

每个资源目录下基本都配了一份 `schema.ts`，它们不是简单的注释集合，而是请求契约本体。

### `BaseSchema` 统一请求外壳

`server/routes/api/schema.ts` 先定义了：

- `body`
- `query`
- `file`

都以 `unknown` 开始。然后具体 endpoint 再基于它扩展，这样所有 route 都共享同一套“请求外壳”。

### `ProsemirrorSchema()` 说明 schema 层已经知道业务结构

这不是一个普通 string/number 校验器，而是会：

1. 用给定 ProseMirror schema 把 JSON 转成 `Node`
2. 调 `node.check()`
3. 再判断是否允许空文档

这说明 Outline 的请求校验并不只停留在“字段类型对不对”，而是会下探到富文本文档结构是否合法。

### schema 经常会携带 transform / refine / backward compatibility 逻辑

比如：

- `DocumentsListSchema` 会把旧字段别名 `collection` / `user` 归一成 `collectionId` / `userId`
- `DocumentsInfoSchema` 会 refine “`id` 或 `shareId` 至少要有一个”
- `CollectionsCreateSchema` 会把部分 null/undefined 语义提前规范化

也就是说，schema 不只是“拦错误输入”，还会顺手做**边界归一化**。

Sources: [server/routes/api/schema.ts](server/routes/api/schema.ts), [server/routes/api/documents/schema.ts](server/routes/api/documents/schema.ts), [server/routes/api/collections/schema.ts](server/routes/api/collections/schema.ts)

## 请求边界用 Zod，领域层还保留了一套更底层的校验工具

Outline 的校验体系不是单一的一套 Zod。

### `server/validation.ts` 负责命令式断言

这里有一批很传统但很实用的 helper：

- `assertPresent`
- `assertNotEmpty`
- `assertEmail`
- `assertUrl`
- `assertUuid`
- `assertHexColor`
- `assertIndexCharacters`

这类 helper 更适合放在：

- 命令实现
- 业务条件分支
- 不是纯“请求入口”的地方

### `server/utils/validators.ts` 则偏向 class-validator 装饰器生态

这里还有像：

- `CannotUseWithout`
- `CannotUseWith`
- `IsInCaseInsensitive`
- `IsDatabaseUrl`

这样的装饰器式校验器。

这说明 Outline 的现实选择并不是“全站只留一种校验风格”，而是：

- **请求边界** 优先用 Zod
- **业务层与模型层** 继续保留更命令式/装饰器式工具

这样的混合方式更符合一个长期演进的代码库。

Sources: [server/validation.ts](server/validation.ts), [server/utils/validators.ts](server/utils/validators.ts), [server/utils/zod.ts](server/utils/zod.ts)

## 认证中间件负责把“你是谁、凭什么来”提前算清楚

### `auth()` 支持多种认证来源

`server/middlewares/authentication.ts` 会按顺序尝试从：

- `Authorization: Bearer ...`
- `body.token`
- `query.token`
- `cookie accessToken`

里提取 token。

这很重要，因为 Outline 的 API 既会被：

- 浏览器登录态调用
- API key 调用
- OAuth client 调用
- 某些 query/body token 场景调用

一套中间件统一兜住，可以避免每个 route 再自己判断 transport。

### 它不只校验 token，还会区分认证类型

认证通过后，`ctx.state.auth` 里会得到：

- `user`
- `token`
- `type`
- `service`
- `scope`

其中 `type` 可能是：

- `app`
- `api`
- `oauth`
- `mcp`

这让后续：

- 路由层
- CSRF 中间件
- 事件记录

都能知道当前请求到底来自哪类身份。

### `auth({ role, optional, type })` 允许路由声明访问要求

你在 route 里会经常看到：

- `auth()`
- `auth({ role: UserRole.Member })`
- `auth({ optional: true })`

这意味着访问控制的第一层不是散在业务代码里的 if/else，而是通过中间件参数在路由定义处就先声明出来。

Sources: [server/middlewares/authentication.ts](server/middlewares/authentication.ts), [server/types.ts](server/types.ts)

## `ctx.context` 和事务中间件让路由与持久化 helper 能稳定协作

### `transaction()` 给修改型 route 一致的事务边界

`server/middlewares/transaction.ts` 会把整个 route 包进：

- `sequelize.transaction(...)`

然后把 transaction 存到：

- `ctx.state.transaction`

这让后续 model 查询、command、save helper 都能共享同一个数据库事务。

### `apiContext()` 又把常用变更上下文挂成 getter

它会给 `ctx` 动态定义：

- `ctx.context`

里面包含：

- `auth`
- `transaction`
- `ip`

于是像：

- `saveWithCtx`
- `destroyWithCtx`
- `createWithCtx`

这类 helper 在底层就能拿到当前请求上下文，而不需要 route 作者一层层手工传参。

WHY 这很值？因为 Outline 的很多模型保存动作都会顺带：

- 记审计事件
- 记 actor
- 走 hooks

统一上下文能明显减少样板代码。

Sources: [server/middlewares/transaction.ts](server/middlewares/transaction.ts), [server/middlewares/apiContext.ts](server/middlewares/apiContext.ts)

## 分页中间件和 `paginateQuery()` 说明 API 层非常在意性能细节

### `pagination()` 先把 limit/offset 规范化

它会统一从：

- query
- body

读取分页参数，检查：

- 是否是数字
- limit 是否超上限
- offset 是否非负

然后把结果写到：

- `ctx.state.pagination`

### `paginateQuery()` 对客户端请求做了特别优化

如果请求头里有：

- `x-client-version`

它就不再单独跑 `COUNT(*)`，而是让查询函数多取一条数据：

- `limit + 1`

再根据是否多出那一条来推断“还有没有下一页”。

WHY 这个优化很实在？因为 Web 客户端大量列表请求只需要知道：

- 这页结果
- 是否还有下一页

不一定非得每次知道一个精确 total。这样就省掉了一次额外 count 查询。

Sources: [server/routes/api/middlewares/pagination.ts](server/routes/api/middlewares/pagination.ts)

## `editor()` 和 CSRF 中间件体现了 API 层的两条横切保护

### `editor()`：在 API 层就挡掉过旧编辑器版本

它会读取：

- `x-editor-version`

只要客户端 major 版本落后于当前服务端 `EDITOR_VERSION`，就直接抛 `EditorUpdateError`。

这和协作服务里的 `EditorVersionExtension` 是同一套思路：**富文本协议版本不兼容时，宁可尽早拒绝，也不要让老客户端继续写入。**

### `verifyCSRFToken()`：只保护真正需要保护的写请求

CSRF 中间件的逻辑很值得注意：

1. `GET/HEAD/OPTIONS` 直接跳过
2. 如果不是 cookie 型认证，跳过
3. 如果 `/api/` 路径本身可被 `Scope.Read` 访问，也跳过
4. 其他情况才要求 cookie token 与 header/form token 做 double-submit 对比

这说明 Outline 的 CSRF 不是“一刀切所有 POST”，而是和认证/作用域模型对齐的。

Sources: [server/routes/api/middlewares/editor.ts](server/routes/api/middlewares/editor.ts), [server/middlewares/csrf.ts](server/middlewares/csrf.ts), [shared/editor/version.ts](shared/editor/version.ts)

## 典型 route 的样子：路由层负责编排，业务层负责真正更新

### `documents.update` 很能代表路由的标准形态

它的 route 定义顺序是：

1. `auth()`
2. `validate(T.DocumentsUpdateSchema)`
3. `transaction()`
4. route handler

handler 内部主要做：

- 从 `ctx.input.body` 解构参数
- 从 header 取 `x-editor-version`
- 查询 document / collection
- `authorize(...)` 做权限检查
- 调 `documentUpdater(ctx, ...)`
- 最后用 `presentDocument()` 和 `presentPolicies()` 回响应

这条链很重要，因为它展示了典型分工：

- **中间件**：认证、输入、事务
- **路由**：少量查询、权限判断、参数拼装
- **command**：真正更新文档
- **presenter**：最终序列化输出

### `collections.create` 则展示了另一种“直接模型 + presenter”的轻量路径

它同样先走：

- `auth()`
- `validate(...)`
- `transaction()`

但业务层没有单独命令，而是：

- `Collection.build(...)`
- 少量补充逻辑
- `saveWithCtx(ctx)`
- reload
- presenter 输出

这说明 Outline 并不是“任何事都必须上 command”，而是：

- 跨模型、复杂业务 -> command
- 单模型、逻辑较薄 -> 路由中直接完成

这个取舍非常务实。

Sources: [server/routes/api/documents/documents.ts](server/routes/api/documents/documents.ts), [server/commands/documentUpdater.ts](server/commands/documentUpdater.ts), [server/routes/api/collections/collections.ts](server/routes/api/collections/collections.ts)

## presenter 层把输出格式统一收口

Route 最后返回的通常不是原始 Sequelize model，而是一组 presenter 处理后的对象，比如：

- `presentDocument`
- `presentCollection`
- `presentComment`
- `presentPolicies`

### 这带来两个明显收益

1. **前后端契约更稳定**  
   route 不直接暴露数据库字段细节。

2. **同类资源输出格式更一致**  
   不同 route 对同一个模型的序列化方式不会越写越散。

同时你也会发现很多响应形状都很像：

- `data`
- `policies`
- `pagination`

这种一致性正是 presenter 层和 `apiResponse()` 一起收口出来的。

Sources: [server/presenters/index.ts](server/presenters/index.ts), [server/routes/api/middlewares/apiResponse.ts](server/routes/api/middlewares/apiResponse.ts)

## 错误处理中间件负责把底层异常翻译成 API 语义

`apiErrorHandler()` 做了几类很实用的转换：

- 文本像授权失败，但异常类型不是 `AuthorizationError` -> 转成 `AuthorizationError`
- `SequelizeValidationError` -> 转成统一 `ValidationError`
- `ENOENT` / `SequelizeEmptyResultError` / 文本像 “Not found” -> 转成 `NotFoundError`

WHY 这层很重要？因为没有它，底层库抛出来的异常：

- 形状不一致
- 文案不一致
- 状态码不一致

前端就很难建立稳定的错误处理逻辑。

### `apiResponse()` 则让成功响应也统一一点

如果 `ctx.body` 是普通对象，它会自动补：

- `status`
- `ok`

这样前端即便面对不同资源的返回数据，也能始终拿到统一的成功态字段。

Sources: [server/routes/api/middlewares/apiErrorHandler.ts](server/routes/api/middlewares/apiErrorHandler.ts), [server/routes/api/middlewares/apiResponse.ts](server/routes/api/middlewares/apiResponse.ts)

## rate limiter 说明 API 约束不仅是鉴权，还有吞吐保护

### 默认限流是全站级的

`defaultRateLimiter()` 会根据：

- 能否解析出 user
- token 类型
- 或回退到 IP

来确定限流 key。

### 路由还能注册自己的限流策略

部分 route 再叠加：

- `rateLimiter(...)`

例如导入、导出、某些昂贵操作会在路由定义处额外声明更窄的限制。

这说明 API 设计里的“中间件”不只负责正确性，也负责资源保护。

Sources: [server/middlewares/rateLimiter.ts](server/middlewares/rateLimiter.ts)

## 为什么这套 API 设计很适合 Outline

Outline 的后端请求有几个现实特征：

1. **接口很多，而且不少操作是明显的业务动词**
2. **请求既可能来自浏览器登录态，也可能来自 API key / OAuth / 其他客户端**
3. **大量接口都要带 policies、pagination、presented data**
4. **文档与富文本字段的输入校验比普通 CRUD 更复杂**

在这种前提下，这套设计的优点很明显：

- 路由命名清楚，业务意图直接体现在 endpoint 名上
- schema 文件把输入契约前置、显式化
- 中间件把认证、事务、CSRF、分页、版本保护集中处理
- 路由保持相对精简，复杂逻辑下沉到 command / model / presenter
- 错误和成功响应都被统一收口

它不像纯 REST 教科书那样“优雅”，但对 Outline 这种业务复杂、客户端类型多样的系统来说，非常实用。

## 建议继续阅读

- 想看前端这一侧是怎样消费这些 `data/policies/pagination` 响应的：读 [API 客户端：请求封装、错误处理与 CSRF 防护](11-api-ke-hu-duan-qing-qiu-feng-zhuang-cuo-wu-chu-li-yu-csrf-fang-hu)
- 想继续往下看后端数据结构本身：读 [数据模型层：Sequelize 模型定义、关联与生命周期钩子](18-shu-ju-mo-xing-ceng-sequelize-mo-xing-ding-yi-guan-lian-yu-sheng-ming-zhou-qi-gou-zi)
- 想看为什么有些 route 会把复杂逻辑下沉成 command：读 [Command 模式：跨模型的复杂业务操作封装](19-command-mo-shi-kua-mo-xing-de-fu-za-ye-wu-cao-zuo-feng-zhuang)
- 想看 presenter 输出里的 `policies` 来自哪里：读 [权限系统：基于 CanCan 的策略（Policies）与授权机制](20-quan-xian-xi-tong-ji-yu-cancan-de-ce-lue-policies-yu-shou-quan-ji-zhi)
- 想看 presenter 本身如何形成前后端数据契约：读 [数据 Presenter 层：模型序列化与前后端数据契约](21-shu-ju-presenter-ceng-mo-xing-xu-lie-hua-yu-qian-hou-duan-shu-ju-qi-yue)
