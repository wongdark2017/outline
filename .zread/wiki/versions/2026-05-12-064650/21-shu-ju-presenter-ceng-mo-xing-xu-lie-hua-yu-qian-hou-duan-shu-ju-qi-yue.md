如果第 18 页讲的是模型层如何维护数据库语义，第 21 页要看的就是另一端：**这些模型最终是怎样被整理成前后端都能稳定依赖的数据契约。**

Outline 并没有把 API 返回直接交给 Sequelize 默认序列化，而是在 `server/presenters/` 里显式维护了一层 Presenter。它做的事情至少有四类：

- 过滤和裁剪字段，避免把内部状态直接暴露给客户端
- 补充前端真正需要的派生字段和嵌套结构
- 根据场景切换公开 / 私有 / 管理员视图
- 维持历史兼容和版本差异，而不把这些分支塞回模型层

所以这里的 Presenter 不是“可有可无的格式化小函数”，而是 API 契约层本体。

Sources: [server/presenters/index.ts](server/presenters/index.ts), [server/presenters/document.ts](server/presenters/document.ts), [server/presenters/collection.ts](server/presenters/collection.ts), [server/presenters/user.ts](server/presenters/user.ts), [server/presenters/share.ts](server/presenters/share.ts), [server/presenters/event.ts](server/presenters/event.ts), [server/presenters/revision.ts](server/presenters/revision.ts), [server/presenters/policy.ts](server/presenters/policy.ts), [server/presenters/env.ts](server/presenters/env.ts), [server/presenters/providerConfig.ts](server/presenters/providerConfig.ts), [server/routes/api/documents/documents.ts](server/routes/api/documents/documents.ts), [server/routes/api/collections/collections.ts](server/routes/api/collections/collections.ts), [server/routes/api/users/users.ts](server/routes/api/users/users.ts), [app/stores/PoliciesStore.ts](app/stores/PoliciesStore.ts), [app/actions/definitions/documents.tsx](app/actions/definitions/documents.tsx), [app/actions/definitions/collections.tsx](app/actions/definitions/collections.tsx)

## 先把 Presenter 放回整条请求链看

在 Outline 的后端里，请求通常不是这样结束的：

```text
Route -> Model -> ctx.body = model
```

更接近的是：

```text
Route
  -> 认证 / 校验 / 授权
  -> model / command 获取领域对象
  -> presenter 把对象整理成 API 契约
  -> 再附加 policies / pagination / status / ok
```

这条链里，Presenter 处在一个非常尴尬但也非常关键的位置：

- 太靠前，就会混进业务规则
- 太靠后，就只能做浅层 JSON 美化

Outline 的做法是让 Presenter 专注于：**“客户端应该看到什么形状的数据”**。

## `server/presenters/index.ts` 是一张非常清楚的契约地图

看 `server/presenters/index.ts`，你会发现它其实已经把 API 输出对象的主要类别列全了：

- `presentDocument`
- `presentCollection`
- `presentUser`
- `presentShare`
- `presentRevision`
- `presentPolicies`
- `presentFileOperation`
- `presentTeam`
- `presentNotification`

这说明作者并不是把 Presenter 当作某几个“特殊资源”的例外，而是把它当成 API 输出的默认通道。

### 为什么这里要显式导出一批 presenter，而不是让每个 route 就地组对象

因为 Outline 的同一种资源会出现在多个场景里：

- 正常登录用户 API
- 公开分享页 API
- WebSocket 实体推送
- 后台任务事件回推

如果每条路径自己拼响应对象，很快就会出现：

- 同一字段名字不一致
- 同一资源在不同 endpoint 里结构漂移
- 敏感字段有的地方忘记裁掉

集中 exporter 的好处，就是把“资源长什么样”先固定住。

Sources: [server/presenters/index.ts](server/presenters/index.ts)

## Presenter 不是单纯 `toJSON`，它经常会重新计算一层视图模型

这一层最容易被低估的地方在于：很多 presenter 并不是“读模型字段，然后原样返回”。

它们通常会做下面几种事情：

- 改字段名，例如 `path -> url`
- 聚合嵌套对象，例如 `createdBy`, `updatedBy`
- 只暴露部分 source metadata
- 用 helper 把 ProseMirror / Markdown / state 重新投影成客户端能消费的格式
- 根据上下文删除某些字段

也就是说，它已经在构建 view model，而不是机械序列化。

## `presentDocument` 是最能说明这一层价值的例子

如果只读 `Document` 模型，你拿不到“客户端到底应该怎样收到一篇文档”的全貌。真正的契约在：

- `server/presenters/document.ts`

### 它会先决定返回的是 `data` 还是 `text`

这里有一个很关键的分支：

- `const asData = !ctx || Number(ctx?.headers["x-api-version"] ?? 0) >= 3`

这意味着 Presenter 已经知道客户端版本差异：

- 较新客户端优先收 ProseMirror JSON `data`
- 较旧客户端则仍可能依赖 `text`

WHY 这个判断放在 Presenter 层最合适？因为它本质上是“同一份领域对象，对不同 API 消费方呈现不同投影”，不是模型层该关心的事情。

### 文档内容不是直接取字段，而是重新走 `DocumentHelper`

Presenter 会调用：

- `DocumentHelper.toJSON(...)`
- `DocumentHelper.toMarkdown(...)`

这说明 API 暴露的 `data` / `text` 并不是随手拿 `document.content` 或 `document.text` 就结束，而是走了一层更稳定的转换管道。

这样做的好处是：

- 模型内部双轨存储可以继续演进
- API 契约仍保持相对稳定

### 公开分享和私有文档走的是不同投影

当 `options.isPublic` 为真时，`presentDocument` 会在 `toJSON` 里带上：

- `signedUrls`
- `teamId`
- `removeMarks: ["comment"]`
- `internalUrlBase: /s/<shareId>`

这几个参数非常说明问题：

- 公开分享看到的附件 URL 和登录态不一样
- comment mark 在公开分享里要被去掉
- 文档内部链接在 share 场景下要改成本分享路径

也就是说，“公开版文档”并不是普通文档少几个字段，而是**内容投影本身都变了**。

### 私有文档又会补很多非公开元数据

对于正常登录态，Presenter 还会补：

- `tasks`
- `isCollectionDeleted`
- `collectionId`
- `parentDocumentId`
- `createdBy`
- `updatedBy`
- `collaboratorIds`
- `templateId`
- `insightsEnabled`
- `popularityScore`
- `sourceMetadata`

这说明 Presenter 层还承担了一个重要职责：**区分“资源真实存在的状态”与“公开可暴露的状态”。**

### `sourceMetadata` 也会被重新规整，而不是整包透传

即使模型上已经有 `sourceMetadata`，Presenter 也只挑出：

- `importedAt`
- `importType`
- `createdByName`
- `fileName`
- `originalDocumentId`

WHY 不整包返回？因为 source metadata 往往是最容易随着导入、迁移、外部系统接入而膨胀的结构。Presenter 在这里充当了一个稳定边界。

Sources: [server/presenters/document.ts](server/presenters/document.ts), [server/models/helpers/DocumentHelper.tsx](server/models/helpers/DocumentHelper.tsx)

## `presentDocuments` 说明 Presenter 层甚至会顺手做 N+1 优化

`presentDocuments(...)` 不是简单 `documents.map(presentDocument)`。

它会先把所有文档的 `importId` 收集起来，然后一次性查询：

- `FileOperation.unscoped().findAll(...)`

再把结果回填到对应 `doc.import`。

WHY 这一步不放到 route 里？因为它明显是“为了把一批文档正确呈现出来”而存在的。把这类与展示高度耦合的批量预取放在 Presenter 里，能让调用方继续只关心“我要呈现这些文档”。

这也说明 Presenter 层在 Outline 里不是只做纯函数映射，它偶尔也承担少量**为展示服务的数据补全**。

Sources: [server/presenters/document.ts](server/presenters/document.ts)

## `presentCollection` 和 `presentDocument` 共享同一套“内容双表示”思路

集合 Presenter 的设计和文档非常像，但它强调的契约点稍微不同。

### 集合描述支持历史兼容：`description` 和 `data` 双轨

`presentCollection` 同样会根据：

- `x-api-version`

决定是返回：

- `data`（ProseMirror JSON）
- 还是 `description`（旧字符串字段）

这和文档的 `data/text` 双轨是同一个策略。

### 公开集合会隐藏不少管理态字段

私有路径下会额外返回：

- `index`
- `sharing`
- `commenting`
- `templateManagement`
- `permission`
- `deletedAt`
- `archivedAt`
- `archivedBy`
- `sourceMetadata`

但公开视图并不会全部透出。

这再次说明 Presenter 是数据暴露边界，而不是序列化捷径。

### `DocumentHelper.toJSON(collection)` 暗示 collection 内容也复用了编辑器文档模型

这点很关键。集合描述虽然是“集合资源”的字段，但在 API 契约里，它仍然复用了文档编辑器 JSON 能力。Presenter 把这一层统一起来，前端就不需要为“文档内容”和“集合描述内容”维护两套渲染逻辑。

Sources: [server/presenters/collection.ts](server/presenters/collection.ts)

## 用户、团队、分享、事件这些 presenter 更像“裁剪器”

不是所有 presenter 都像文档那样复杂。有一批 presenter 的主要价值是精确裁剪和条件暴露。

## `presentUser`：细节暴露由调用方显式选择

`presentUser(user, { includeDetails, includeEmail })` 非常典型：

- 基础字段总是返回
- `email` 只有在显式允许时才返回
- `preferences`、`notificationSettings`、`language` 只有 `includeDetails` 才返回

WHY 要设计成 options 开关，而不是 route 自己删字段？因为用户对象被很多地方复用：

- 用户列表
- 评论作者
- share 创建者
- 事件 actor

这些场景需要的暴露粒度都不一样。

### 调用方会先通过 policy 决定能不能看这些细节

例如用户列表 route 会在 presenter 前先判断：

- `can(actor, "readEmail", user)`
- `can(actor, "readDetails", user)`

然后再把结果喂给 `presentUser(...)`。

这让权限系统和 Presenter 层形成了一个很清楚的配合：

- policy 决定“能不能看”
- presenter 决定“看到时长什么样”

Sources: [server/presenters/user.ts](server/presenters/user.ts), [server/routes/api/users/users.ts](server/routes/api/users/users.ts), [server/policies/user.ts](server/policies/user.ts)

## `presentShare` 和 `presentEvent`：管理员视图会多出敏感字段

这两个 presenter 的模式非常接近：

- 默认返回公共业务字段
- `isAdmin` 时再多给一些敏感信息

`presentShare` 会对非管理员隐藏：

- `lastAccessedAt`

`presentEvent` 会对非管理员隐藏：

- `changes`
- `actorIpAddress`

WHY 这值得单独拎出来？因为它说明 Presenter 层不只是“公开 / 私有”二分，有时还要支持**同一资源针对不同权限级别输出不同视图**。

Sources: [server/presenters/share.ts](server/presenters/share.ts), [server/presenters/event.ts](server/presenters/event.ts)

## `presentRevision` 展示了 Presenter 如何吃掉历史兼容细节

`presentRevision` 里有一段很能说明设计方向：

- 先 `parseTitle(revision.title)` 提取旧版 emoji / 标题信息
- 再通过 `DocumentHelper` 同时生成 `data` 和 `text`
- 再把 `collaborators` 统一映射成用户视图

这说明 revision 的 API 契约不仅是“回显数据库快照”，而是会顺手兜住历史数据格式差异。

换句话说，Presenter 还是一个对外的**兼容适配层**。

Sources: [server/presenters/revision.ts](server/presenters/revision.ts)

## 有些 presenter 根本不是模型序列化，而是“前端运行配置投影”

这也是很容易忽略的一点。

### `presentEnv` 明确是公开环境变量边界

这个 presenter 前面专门写了注释：

- 整个对象会被字符串化进客户端 HTML
- 不要把 secret 或 password 放进来

所以这里根本不是“把 env 原样暴露”，而是一个安全白名单。

### `presentProviderConfig` 则是在把插件 Hook 投影成登录按钮配置

它接收的是 auth provider 插件配置，输出的是：

- `id`
- `name`
- `authUrl`

这说明 Presenter 层的适用面比“数据库模型 -> JSON”更广，它还可以把：

- 插件
- 配置
- 环境

这些服务端内部结构转成前端能理解的合同对象。

Sources: [server/presenters/env.ts](server/presenters/env.ts), [server/presenters/providerConfig.ts](server/presenters/providerConfig.ts)

## `presentPolicies` 让 Presenter 层成为权限契约出口

第 20 页讲过策略系统本身，这里要看的重点是：

- `presentPolicies(user, models)`

会把 `serialize(user, model)` 的结果统一包成：

- `id`
- `abilities`

然后和 `data` 一起返回。

这非常关键，因为它说明对前端来说，一个 API 响应真正的契约通常不是只有业务对象，而是：

```text
data + policies + pagination
```

而 Presenter 正是这条契约里“资源能力快照”的出口。

Sources: [server/presenters/policy.ts](server/presenters/policy.ts), [server/presenters/index.ts](server/presenters/index.ts)

## Route 层大量依赖 Presenter 来拼完整响应

如果只读 presenter 文件，你会知道单个资源长什么样；再看 route，就能看到这层是如何成为实际 API 契约的。

### 文档路由的典型返回不是只给文档对象

在 `documents` 路由里，很常见的返回形状是：

- `data: presentDocument(...)`
- `policies: presentPolicies(...)`
- `pagination: ...`（列表场景）

### 集合和用户路由也是同样套路

例如：

- `collections.info` 返回 `presentCollection + presentPolicies`
- `users.list` 返回 `presentUser[] + presentPolicies + pagination`

这说明 Presenter 层已经深度融进 API 组织方式里，而不是几个零散工具函数。

Sources: [server/routes/api/documents/documents.ts](server/routes/api/documents/documents.ts), [server/routes/api/collections/collections.ts](server/routes/api/collections/collections.ts), [server/routes/api/users/users.ts](server/routes/api/users/users.ts)

## 前端确实在把这些 Presenter 结果当契约消费

如果说服务端 route 侧证明了 Presenter 是“返回什么”，那前端 store / action 则证明了客户端真的把它当“可依赖合同”。

### `PoliciesStore` 直接消费 `presentPolicies` 的结构

前端存的 policy 不是自己算出来的，而是：

- 以模型 ID 为键
- 存 `abilities`
- 提供 `abilities(id)` 给 UI 读取

### Action 定义直接用这些能力决定入口是否显示

例如：

- `stores.policies.abilities(activeDocumentId).update`
- `stores.policies.abilities(activeCollectionId).createDocument`

分别决定：

- 编辑文档入口是否可见
- 集合下新建文档入口是否可见

这说明 Presenter 返回的 `policies` 并不是“给调试看的附属字段”，而是前端交互裁剪的基础输入。

Sources: [app/stores/PoliciesStore.ts](app/stores/PoliciesStore.ts), [app/actions/definitions/documents.tsx](app/actions/definitions/documents.tsx), [app/actions/definitions/collections.tsx](app/actions/definitions/collections.tsx)

## 为什么 Outline 需要这层显式 Presenter

Outline 的 API 返回面临几个现实问题：

1. **同一资源要服务登录态、公开分享、管理员视图和 WebSocket 推送**
2. **文档和集合内容既要兼容旧客户端，也要给新客户端结构化数据**
3. **权限、分页、环境配置、插件配置这些“非模型数据”也要纳入统一契约**
4. **不希望模型层直接背负前端兼容和公开字段裁剪责任**

在这种前提下，显式 Presenter 层的价值非常直接：

- 把 API 契约从模型内部剥离出来
- 把历史兼容分支集中收口
- 把公开 / 私有 / 管理员视图边界固定下来
- 让前后端能围绕一套稳定返回结构协作

它并不花哨，但对 Outline 这种长期演进的单页应用后端来说，非常必要。

## 建议继续阅读

- 想看这些 Presenter 操作的源对象本身：读 [数据模型层：Sequelize 模型定义、关联与生命周期钩子](18-shu-ju-mo-xing-ceng-sequelize-mo-xing-ding-yi-guan-lian-yu-sheng-ming-zhou-qi-gou-zi)
- 想看 `policies` 这部分契约是怎样算出来的：读 [权限系统：基于 CanCan 的策略（Policies）与授权机制](20-quan-xian-xi-tong-ji-yu-cancan-de-ce-lue-policies-yu-shou-quan-ji-zhi)
- 想看 route 如何把校验、授权、presenter 串成一条请求流水线：读 [API 路由设计：Schema 验证、中间件与错误处理](17-api-lu-you-she-ji-schema-yan-zheng-zhong-jian-jian-yu-cuo-wu-chu-li)
- 想看这些返回体后续如何触发异步通知、WebSocket 推送和后台处理：读 [异步任务与事件驱动：Bull 队列、Processor 与 Task 体系](22-yi-bu-ren-wu-yu-shi-jian-qu-dong-bull-dui-lie-processor-yu-task-ti-xi)
- 想回到前端请求侧看 `data/policies` 是怎样被消费的：读 [API 客户端：请求封装、错误处理与 CSRF 防护](11-api-ke-hu-duan-qing-qiu-feng-zhuang-cuo-wu-chu-li-yu-csrf-fang-hu)
