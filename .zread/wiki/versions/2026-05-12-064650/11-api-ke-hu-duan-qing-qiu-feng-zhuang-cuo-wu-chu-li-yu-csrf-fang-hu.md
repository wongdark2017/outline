Outline 前端并没有在各个组件里直接 `fetch("/api/...")`，而是把请求行为统一收敛到了 `app/utils/ApiClient.ts`。这不是单纯为了“少写几行重复代码”，而是因为一次请求在这个项目里通常同时涉及：版本头、分享上下文、Cookie 凭证、CSRF、防抖去重、错误类型映射，以及在 401/403 场景下的会话清理。把这些逻辑散在页面里，后面几乎一定会失控。

Sources: [app/utils/ApiClient.ts](app/utils/ApiClient.ts), [app/utils/errors.ts](app/utils/errors.ts), [server/middlewares/csrf.ts](server/middlewares/csrf.ts), [server/routes/api/middlewares/apiErrorHandler.ts](server/routes/api/middlewares/apiErrorHandler.ts), [server/routes/api/middlewares/apiResponse.ts](server/routes/api/middlewares/apiResponse.ts)

## 先看它想解决什么问题

一个统一 API 客户端在 Outline 里要同时解决至少六件事：

| 问题 | 如果不统一会怎样 |
|---|---|
| 请求地址和 query/body 组装 | 每个组件都在手写 URL 拼接，格式不一致 |
| 版本与客户端头信息 | 服务端难以知道请求来自哪个编辑器/客户端版本 |
| 会话与分享上下文 | 登录态请求和分享请求的处理会分叉 |
| CSRF | 有些写请求带 token，有些忘带 |
| 错误翻译 | 页面里到处写状态码判断，异常类型不统一 |
| 请求去重与重试 | 同一资源可能被重复请求，网络瞬断时体验脆弱 |

`ApiClient` 的价值就在于：把这些横切问题一次性吸收掉，让 Store、Model 和 scene 更专注业务本身。

## `ApiClient` 的基本形态

当前前端默认导出的是一个单例：

```ts
export const client = new ApiClient();
```

默认 `baseUrl` 是 `/api`，这让绝大多数请求天然落到后端 RPC API 上。但它也允许通过 `baseUrl` 覆盖，把请求发去别的前缀，例如：

- `/auth`
- 绝对 URL

所以它不是“只能请求主 API”的死板封装，而是一个以 `/api` 为默认语境、但保留越界能力的客户端。

Sources: [app/utils/ApiClient.ts](app/utils/ApiClient.ts)

## 请求是怎么被组装出来的

`fetch()` 方法会按 HTTP 方法区分参数放置方式：

- `GET`：把 `data` 序列化到 query string
- `POST/PUT`：
  - 如果是 `FormData` 或原始字符串，直接作为 body
  - 如果是普通对象，JSON.stringify 后作为 JSON body

它还会自动判断：

- 传进来的 `path` 是不是以 `http` 开头
- 如果不是，就拼到 `baseUrl` 后面

这套规则看起来简单，但 WHY 很对：99% 的业务请求都应该零脑力走默认路径，只有少数认证或上传场景才需要偏离。

## 版本头和客户端头是这个系统的“自报家门”

每次请求默认都会带上：

- `Accept: application/json`
- `x-editor-version`
- `x-api-version`
- `x-client-version`
- 禁缓存相关头

其中：

- `x-editor-version` 来自共享编辑器版本
- `x-client-version` 会组合 `package.json` 版本和环境版本

这不是可有可无的装饰。对于 Outline 这种包含富文本编辑器和协作协议的系统来说，服务端知道“你是哪一版客户端来的”非常重要。否则一旦出现编辑器 schema 不兼容、客户端过旧、灰度环境问题，排查会非常痛苦。

Sources: [app/utils/ApiClient.ts](app/utils/ApiClient.ts), [shared/editor/version.ts](shared/editor/version.ts)

## 分享上下文是通过 `shareId` 自动注入的

`ApiClient` 内部有个 `shareId` 字段。只要它被设置，后续请求就会在 data 里自动追加 `shareId`。

这条能力主要由分享场景驱动：`app/scenes/Shared/index.tsx` 在进入分享页面时会调用 `client.setShareId(shareId)`，离开时再清掉。这样一来，分享页面下的所有请求都不需要手动重复带 shareId。

WHY 这很值？因为分享页和登录后页面大量复用了同一套 Store/Model/组件。如果分享上下文靠每个调用方手传，很快就会漏。集中到客户端层，复用才真正可控。

Sources: [app/utils/ApiClient.ts](app/utils/ApiClient.ts), [app/scenes/Shared/index.tsx](app/scenes/Shared/index.tsx)

## CSRF：前后端是一套对称设计

### 前端怎么决定这次请求要不要带 CSRF

`ApiClient` 的策略不是“所有 POST 都带 CSRF”，而是：

1. 先判断这是不是一个修改型请求（POST/PUT/PATCH/DELETE）
2. 再用 `AuthenticationHelper.canAccess(path, [Scope.Read])` 判断这个 endpoint 是否可被只读 scope 访问
3. 如果是修改型请求且不是 read-scope 路由，再从 cookie 里取 token，加到 `x-csrf-token` 头

这个判断很细，WHY 很好：

- 避免给本质只读的 POST 接口无意义地附加 CSRF 负担
- 保持与服务端鉴权/作用域模型一致

### 服务端怎么验证

服务端的 `verifyCSRFToken()` 走的是完全对称的思路：

1. 只保护潜在修改型方法
2. 如果当前不是 cookie 型认证，就跳过
3. 如果是 `/api/` 路由且它本身属于 read-scope，也跳过
4. 否则要求：
   - cookie 里有 token
   - header 或 form field 里也有 token
   - 两个 token 都能通过签名校验
   - 两者值完全一致

这其实就是一个标准的 double-submit cookie 方案。更关键的是，前端和后端都共用 `AuthenticationHelper.canAccess()` 这套 scope 判定逻辑，所以不会出现“一边觉得要校验，一边觉得不用”的漂移。

Sources: [app/utils/ApiClient.ts](app/utils/ApiClient.ts), [shared/helpers/AuthenticationHelper.ts](shared/helpers/AuthenticationHelper.ts), [server/middlewares/csrf.ts](server/middlewares/csrf.ts), [shared/constants.ts](shared/constants.ts)

## 非 JS 表单也没有被忘掉

虽然大多数请求都走 `ApiClient`，但仓库里仍然保留了原生表单场景，例如：

- Email 登录
- Passkey 验证

为此，前端还有一条配套路径：

- `useCsrfToken()` 定期从 cookie 读取 token
- `Form` 组件自动插入隐藏字段 `_csrf`
- 某些原生提交流程会手工把 token 塞回表单数据

WHY 要保留这套？因为像 Passkey 这种流程，有时需要让浏览器原生表单提交去接手 redirect 和 cookie 行为。纯 fetch 并不总是最合适。

Sources: [app/hooks/useCsrfToken.ts](app/hooks/useCsrfToken.ts), [app/components/primitives/Form.tsx](app/components/primitives/Form.tsx), [app/scenes/Login/components/AuthenticationProvider.tsx](app/scenes/Login/components/AuthenticationProvider.tsx)

## 错误处理：先把 HTTP 状态变成前端可理解的异常类型

`ApiClient` 对错误状态码做了非常明确的映射：

| 状态码 | 前端异常 |
|---|---|
| `400` | `BadRequestError` |
| `401` | `AuthorizationError`，并在非分享态下触发登出 |
| `402` | `PaymentRequiredError` |
| `403` | `AuthorizationError`，若是 `csrf_error` 会带专门提示 |
| `404` | `NotFoundError` |
| `422` | `UnprocessableEntityError` |
| `429` | `RateLimitExceededError` |
| `502` | `BadGatewayError`，并带详细日志 |
| `503` | `ServiceUnavailableError` |

还有两个额外分支特别值得记：

### 网络错误 vs 离线错误会被分开

如果 fetch 本身抛异常，客户端会根据 `window.navigator.onLine` 区分：

- 在线但请求失败 -> `NetworkError`
- 浏览器离线 -> `OfflineError`

这就是为什么 Outline 能在某些页面展示真正的“离线页”，而不是统一弹一句“请求失败”。

### 编辑器版本不兼容会触发强制刷新

当服务端返回 `400` 且错误码是 `editor_update_required` 时，客户端会先 `window.location.reload()`，再抛 `UpdateRequiredError`。WHY？因为这种错误的本质通常不是用户输入错了，而是当前页面持有的编辑器 bundle 已经过期，最合理的恢复方式就是刷新拿新 bundle。

Sources: [app/utils/ApiClient.ts](app/utils/ApiClient.ts), [app/utils/errors.ts](app/utils/errors.ts)

## 401/403 不只是报错，还会驱动会话状态变化

`ApiClient` 对认证相关错误不是“抛了就算了”。

### 401：默认会触发登出流程

如果收到 401，且当前不是分享上下文，客户端会先调用 `stores.auth.logout()` 再抛 `AuthorizationError`。这样做的 WHY 很直接：401 往往意味着当前会话已经失效，本地继续装作已登录只会让后续状态越来越乱。

### 403：如果是 `user_suspended`，会清缓存并退出

这说明错误处理不只是技术层状态码翻译，还承担了一部分“安全与账户状态收敛”职责。

Sources: [app/utils/ApiClient.ts](app/utils/ApiClient.ts), [app/stores/AuthStore.ts](app/stores/AuthStore.ts)

## 请求去重：为什么 `post()` 也要去重

很多人默认只给 GET 做 dedupe，但 Outline 连 `post()` 也做了“同 path + 同 data + 同 options 的 in-flight 去重”。WHY 这很合理？

- 这个项目大量 RPC 风格接口都用 POST，即便语义上是在读数据
- 像 `*.info`、`*.list`、`search_titles` 这类查询也常常是 POST

所以如果只按“HTTP method 是否 GET”判断去重，你会错过大量真实可复用请求。当前实现唯一的例外是 `FormData`，它不会参与去重，因为上传这类请求天然更偏副作用，直接复用 Promise 反而可能制造歧义。

Sources: [app/utils/ApiClient.ts](app/utils/ApiClient.ts)

## 文件上传是两段式协议，不是简单 POST 二进制

`app/utils/files.ts` 展示了一个很有代表性的配套流程：

1. 先调用 `/attachments.create`，向 Outline 后端要上传凭证和表单字段
2. 再用 `XMLHttpRequest` 把文件真正传到 `uploadUrl`

它用 XHR 而不是 fetch，WHY 只有一个：需要进度事件。

另外还有个很细的点：如果上传 URL 是跨域的，它会关闭 `withCredentials`，避免因为 CORS + cookie 导致 preflight 失败。这类逻辑如果每个上传组件各写一遍，很快就会互相不一致。

Sources: [app/utils/files.ts](app/utils/files.ts)

## 服务端如何把 API 响应收口成统一格式

前端之所以能稳定假设“成功响应里通常有 `data` / `policies` / `pagination`”，背后是服务端中间件在收口。

### `apiResponse()`

如果 `ctx.body` 是普通对象，它会自动补上：

- `status`
- `ok`

这样前端拿到的 JSON 响应天然有统一成功态标识。

### `apiErrorHandler()`

它会把一些底层异常转成更一致的业务错误：

- 文本里像授权错误的异常 -> `AuthorizationError`
- Sequelize 校验错误 -> `ValidationError`
- `ENOENT` / 空结果 / “Not found” 文本 -> `NotFoundError`

WHY 这层重要？因为前端错误映射想成立，前提是后端不要把底层库五花八门的异常原样冒出来。

Sources: [server/routes/api/middlewares/apiResponse.ts](server/routes/api/middlewares/apiResponse.ts), [server/routes/api/middlewares/apiErrorHandler.ts](server/routes/api/middlewares/apiErrorHandler.ts)

## 这套客户端封装和 Store 架构是怎么咬合的

前端大约有接近百处 `client.post(...)` 调用，但最主要的消费者还是 Store 和 Model：

- `Store<T>` 的 `create/update/delete/fetch/fetchPage`
- `AuthStore.fetchAuth()`
- `DocumentsStore` 这类具体领域 store
- 个别模型实例方法，例如 `Document`、`Collection` 的特殊操作

这形成了一条很清晰的分层链：

```text
Scene / Component
  -> Store / Model 方法
    -> ApiClient
      -> Koa API 中间件
        -> 路由 / 命令 / 模型
```

这也是为什么这三个主题最好连着读：第 9 页讲状态对象，第 10 页讲场景与路由，第 11 页讲这些状态怎样真正穿过网络边界。

## 为什么这套设计对 Outline 特别重要

Outline 的前端不是简单 CRUD 面板，它有这些现实压力：

1. **大量 RPC 接口走 POST，即便逻辑上是读取**
2. **既有登录态访问，也有分享态访问**
3. **同时支持 JSON 请求、表单请求和文件上传**
4. **要和富文本编辑器版本、协作能力、认证状态保持同步**

在这种前提下，`ApiClient` 如果只是“fetch 的薄封装”就不够了。它必须成为请求层的控制塔，把会话、上下文、安全和错误语义一起管住。

## 建议继续阅读

- 想看这些请求最终怎么喂给前端状态：读 [状态管理：MobX Model、Store 与 RootStore 架构](9-zhuang-tai-guan-li-mobx-model-store-yu-rootstore-jia-gou)
- 想看路由和 scene 怎样消费这些请求结果：读 [路由系统与页面场景（Scenes）组织方式](10-lu-you-xi-tong-yu-ye-mian-chang-jing-scenes-zu-zhi-fang-shi)
- 想看后端请求入口怎么接住这些调用：读 [API 路由设计：Schema 验证、中间件与错误处理](17-api-lu-you-she-ji-schema-yan-zheng-zhong-jian-jian-yu-cuo-wu-chu-li)
