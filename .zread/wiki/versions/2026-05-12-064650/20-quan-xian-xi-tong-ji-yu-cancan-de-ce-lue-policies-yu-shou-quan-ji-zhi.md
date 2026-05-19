Outline 的权限系统不是“在路由里塞几个 `if (user.isAdmin)`”。它更像一套围绕能力计算构建的基础设施：

- 服务端用 `allow(...)` 注册规则
- `can / cannot / authorize` 在运行时做判断
- `serialize(...)` 把结果变成 API 响应里的 `policies`
- 前端再据此决定哪些操作入口可见

再往里看一步，会发现它还有一个不太常见、但很实用的设计：**能力结果不一定只是布尔值，还可能携带命中权限的 membership ID 列表。**

Sources: [server/policies/cancan.ts](server/policies/cancan.ts), [server/policies/index.ts](server/policies/index.ts), [server/policies/utils.ts](server/policies/utils.ts), [server/policies/document.ts](server/policies/document.ts), [server/policies/collection.ts](server/policies/collection.ts), [server/policies/user.ts](server/policies/user.ts), [server/policies/team.ts](server/policies/team.ts), [server/policies/share.ts](server/policies/share.ts), [server/presenters/policy.ts](server/presenters/policy.ts), [server/commands/documentLoader.ts](server/commands/documentLoader.ts), [app/stores/PoliciesStore.ts](app/stores/PoliciesStore.ts), [app/models/Policy.ts](app/models/Policy.ts), [app/actions/definitions/documents.tsx](app/actions/definitions/documents.tsx), [app/actions/definitions/collections.tsx](app/actions/definitions/collections.tsx)

## 先把“权限系统”理解成能力注册表，而不是单个中间件

权限规则的入口在：

- `server/policies/index.ts`

这个文件本身没什么逻辑，它做的关键事情是：

- 导出 `cancan` 的核心方法
- 用 side-effect import 把所有资源策略文件加载进来

也就是说，系统启动后会依次执行：

- `document.ts`
- `collection.ts`
- `user.ts`
- `team.ts`
- `share.ts`
- 以及其他资源策略文件

每个文件内部再通过：

- `allow(User, "read", Document, condition)`

这种调用向同一个 `CanCan` 实例注册能力。

WHY 这套结构比“每个模型自带一个 canRead()”更合适？因为 Outline 的权限规则经常是跨资源组合的，例如：

- 文档权限依赖 collection 权限
- share 权限依赖 document 或 collection 的 share 权限
- user 邀请权限依赖 team 设置

把规则集中注册，更容易看到完整图谱。

Sources: [server/policies/index.ts](server/policies/index.ts), [server/policies/cancan.ts](server/policies/cancan.ts)

## `CanCan` 的判断流程并不复杂，但有几个很关键的细节

`server/policies/cancan.ts` 的核心方法只有四个：

- `allow`
- `can`
- `authorize`
- `serialize`

但它们拼起来后，已经足够形成一整套能力系统。

### `allow` 按“执行者类型 + 动作 + 目标类型”注册规则

一次能力定义包含四部分：

- 哪类 performer，例如 `User`
- 哪个 action，例如 `"read"`、`"update"`
- 哪类 target，例如 `Document`、`Collection`、`Team`
- 可选 condition

condition 可以是：

- 函数
- 对象字面量

对象字面量会被转成“目标对象部分字段匹配”的条件函数。

### `can` 不只是查某个 action，还会自动把 `manage` 当通配动作

在匹配能力时，代码会同时检查：

- 指定 action
- `"manage"`

这让少数“全权限”规则有一个统一落点，而不用把所有动作都重复注册。

### `authorize` 本质上是带异常的 `can`

`authorize(...)` 内部如果发现 `cannot(...)`，就直接抛：

- `AuthorizationError("Authorization error")`

所以 route / command 层通常不需要自己写：

```ts
if (!can(...)) {
  throw ...
}
```

而是直接：

```ts
authorize(user, "read", document);
```

把失败分支统一交给错误处理中间件。

### `serialize` 把动态权限结果转成 API 契约

它会遍历当前 performer 对当前 target 的所有动作，输出：

```ts
{
  read: true,
  update: false,
  move: ["membership-id-1"]
}
```

这种结构后面会进入 presenter，再返回给前端。

Sources: [server/policies/cancan.ts](server/policies/cancan.ts), [server/presenters/policy.ts](server/presenters/policy.ts)

## 这里最不寻常的一点：权限结果可能是 membership ID 数组

`CanCan.can()` 的返回值不是纯 boolean，而是：

- `false`
- `true`
- `string[]`

### WHY 会返回字符串数组

在 `document.ts` 和 `collection.ts` 里，很多权限不是简单地由“你是不是 admin”决定，而是由：

- 哪条 `UserMembership`
- 或哪条 `GroupMembership`

授予的。

因此 `includesMembership(...)` 这类 helper 返回的不是单纯 `true`，而是：

- 命中的 membership IDs

这会一路透传到 `can()` 和 `serialize()` 的结果里。

### 这不是多余信息，前端真的会消费

前端 `Policy` 模型明确把 `abilities` 定义成：

- `Record<string, boolean | string[]>`

同时：

- `flattenedAbilities` 会把数组压平成 boolean
- `PoliciesStore.removeForMembership(id)` 又能在成员关系失效时，把对应 ability 数组里的 membership ID 删掉

也就是说，这个设计的价值不只是“可真可假”，而是**保留了能力是被哪条 membership 授予的来源信息**。

当前很多 UI 判断只把它当 truthy 用，但 store 仍然保留了更细粒度的撤销能力。

Sources: [server/policies/cancan.ts](server/policies/cancan.ts), [server/policies/document.ts](server/policies/document.ts), [server/policies/collection.ts](server/policies/collection.ts), [app/models/Policy.ts](app/models/Policy.ts), [app/stores/PoliciesStore.ts](app/stores/PoliciesStore.ts)

## `and` / `or` 与工具函数让策略表达保持可组合

`server/policies/utils.ts` 里那几个 helper 看起来很轻，但它们决定了策略文件能不能写得清楚。

### `and` / `or` 不是普通布尔工具

因为权限结果可能是：

- `false`
- `true`
- `string[]`

所以这里的组合函数也不是普通逻辑运算封装。它们要做到：

- 一路保留 truthy membership 数组
- 在需要时短路为 `false`

这样像：

```ts
and(can(actor, "read", document), includesMembership(...))
```

才不会把 membership 来源信息提前丢掉。

### 其余 helper 则把常见组织语义抽出来

最常用的几个包括：

- `isTeamModel`
- `isOwner`
- `isTeamAdmin`
- `isTeamMember`
- `isTeamMutable`
- `isGroupAdmin`

这些函数把团队边界、拥有者关系、管理员身份等概念变成可复用原语，避免每个 policy 文件都重新拼一遍条件。

Sources: [server/policies/utils.ts](server/policies/utils.ts)

## `Collection` 策略先决定集合边界，再给文档策略提供地基

如果你顺着资源层级读权限，最好先看 collection。

## `read` 和 `readDocument` 区分了“能看到集合”和“能读集合内文档”

在 `server/policies/collection.ts` 里：

- `read`
- `readDocument`

是两组接近但不完全相同的能力。

共同点是都会考虑：

- 是否同 team
- collection 是否 private
- user 是否 guest
- 是否有直接或组 membership

这意味着 collection 本身已经定义了“团队公开集合”和“私有集合”两层边界。

### `updateDocument` / `createDocument` 又进一步把写能力单独拆开

这几项能力会继续判断：

- 团队是否可写
- user 是否 viewer / guest
- collection 权限是否是 `ReadWrite`
- 或者是否有 `ReadWrite / Admin` membership

WHY 要把这些能力拆得这么细？因为对于 Outline 这种知识库产品：

- 能看到集合
- 能读文档
- 能在集合里新建或修改文档

是三个完全不同的产品能力层级。

### `share` 还叠加了团队与集合配置

集合能不能 share，不只看用户身份，还要看：

- `collection.sharing`
- `collection.permission`
- 当前用户是不是 viewer / guest

这说明权限系统并不只依赖“人”和“资源”，还会读取资源配置本身。

Sources: [server/policies/collection.ts](server/policies/collection.ts)

## `Document` 策略是在 collection 之上再叠文档级成员与生命周期

文档策略是整个系统里最有层次的一份之一。

### `read` 先看文档自身成员，再回退到 collection 级能力

`document.ts` 的 `read` 会同时接受：

- 文档 direct membership
- 文档 group membership
- 草稿作者本人
- `can(actor, "readDocument", document.collection)`

这说明 Outline 文档权限不是单层继承：

- 有时文档跟随 collection
- 有时文档自己额外开成员
- 草稿又有自己的特殊规则

### `update`、`move`、`archive`、`unpublish` 等动作都是在 `read` 之上再加限制

例如：

- `update` 需要文档活跃、团队可写、且有更高一级权限
- `move` 允许部分草稿特殊路径
- `archive` 要求不是 draft，且通常要到 admin 级文档权限或 collection 级 `updateDocument`
- `unpublish` 还显式要求文档必须已发布、集合存在并可更新

也就是说，动作名越“危险”，越会叠更多状态约束，而不是只复用一个统一的 `write`。

### 一些能力是“组合能力”，不是独立资源权限

例如：

- `listRevisions`
- `listViews`
- `download`
- `comment`
- `manageUsers`
- `createChildDocument`

这些都不是数据库里天然的一列权限，而是根据：

- 当前角色
- 团队偏好
- 文档状态
- collection 能力

临时组合出来的。

这很符合 Outline 的产品特征，因为很多界面操作本来就是“条件满足时才出现”的。

Sources: [server/policies/document.ts](server/policies/document.ts), [server/policies/team.ts](server/policies/team.ts)

## 这些策略强依赖模型预加载，没预加载会直接报开发错误

`document.ts` 和 `collection.ts` 里都用了 `invariant(...)` 检查：

- `memberships`
- `groupMemberships`

是否已经加载。

这点非常关键。它说明 policy 系统不是把 ORM 查询和授权逻辑完全解耦了，恰恰相反，它明确要求：

- 调用方必须用正确 scope 取模型

否则连判断都不允许继续。

这也是为什么前一页提到的：

- `withMembership`
- `withAllMemberships`

在 Outline 里不是“查询优化小技巧”，而是权限系统的前置条件。

Sources: [server/policies/document.ts](server/policies/document.ts), [server/policies/collection.ts](server/policies/collection.ts), [server/models/Document.ts](server/models/Document.ts), [server/models/Collection.ts](server/models/Collection.ts)

## 权限检查不是只在路由里做一次，command 和 loader 也会参与

最常见的调用点当然是 route：

- `authorize(user, "read", document)`
- `authorize(user, "update", collection)`

但权限并没有被限制在 HTTP 入口层。

### `documentLoader` 把常用文档读取授权收口了

`server/commands/documentLoader.ts` 会：

- 先按 `id` 取文档
- 如果已删除，检查 `restore`
- 否则检查 `read`

这样很多需要“安全加载文档”的路径就不必每次复制一份读取 + 授权组合。

### command 里也会直接用 `can(...)`

例如 `userInviter` 会先看：

- 当前用户能不能 `update` team

如果不能，再额外走域名限制检查。

这类用法说明 command 层既可能：

- 用 `authorize` 做硬失败
- 也可能用 `can` 来决定业务分支

### 甚至还有模型对模型的授权关系

例如文档路由恢复 revision 时会用：

- `authorize(document, "restore", revision)`

这里 performer 不是 `User`，而是 `Document` 本身，表示“这份 revision 是否属于这份 document”。这说明 `CanCan` 并不局限于用户身份鉴权，也能表达资源间关系约束。

Sources: [server/commands/documentLoader.ts](server/commands/documentLoader.ts), [server/commands/userInviter.ts](server/commands/userInviter.ts), [server/routes/api/documents/documents.ts](server/routes/api/documents/documents.ts)

## `serialize` 让权限结果变成 API 返回的一部分，而不是服务端内部细节

这套系统还有一个很重要的设计决定：权限不是服务端判断完就丢掉，而是会显式返回给前端。

### presenter 会把模型 ID 和 abilities 打包返回

`presentPolicies(user, models)` 最终输出：

- `id`
- `abilities`

数组里的每一项都和具体资源模型同 ID 对齐。

### API 路由大量返回 `policies`

像：

- `documents.list`
- `documents.info`
- `collections.info`
- `users.list`

都会把 `presentPolicies(...)` 的结果塞进响应。

这意味着前端不需要重新复制一份权限规则，只需要消费服务端给出的当前结果。

### 前端 action 定义直接读这些能力决定 UI 是否出现

例如前端会用：

- `stores.policies.abilities(activeDocumentId).update`
- `stores.policies.abilities(activeCollectionId).createDocument`

来决定：

- 编辑按钮是否显示
- 新建文档入口是否显示
- 集合编辑入口是否可用

也就是说，Outline 的权限系统不是“服务端阻止非法操作”就结束了，它还承担了前端交互裁剪的基础数据源角色。

Sources: [server/presenters/policy.ts](server/presenters/policy.ts), [server/routes/api/documents/documents.ts](server/routes/api/documents/documents.ts), [server/routes/api/collections/collections.ts](server/routes/api/collections/collections.ts), [server/routes/api/users/users.ts](server/routes/api/users/users.ts), [app/stores/PoliciesStore.ts](app/stores/PoliciesStore.ts), [app/actions/definitions/documents.tsx](app/actions/definitions/documents.tsx), [app/actions/definitions/collections.tsx](app/actions/definitions/collections.tsx)

## 为什么这套基于 CanCan 的授权设计适合 Outline

Outline 的权限现实并不简单：

1. **既有 team 级角色，也有 collection/document 级 membership**
2. **guest、viewer、member、admin 的边界不是一条线能讲完**
3. **很多动作不是 CRUD，而是 comment、share、archive、unpublish 这类产品动作**
4. **前端还需要知道当前用户“此刻能做什么”**

在这种前提下，这套设计的优点很明显：

- 能力名直接对齐产品动作
- 规则集中注册，便于跨资源组合
- membership 来源可保留，不只剩真假
- 服务端和前端共享同一份权限结果，而不是共享同一份规则代码

它不是最“纯”的 RBAC，也不是最“学术”的 ABAC，但对 Outline 这种长期演进、动作种类丰富的系统来说，非常实用。

## 建议继续阅读

- 想看这些策略依赖的 membership、scope 和模型结构来自哪里：读 [数据模型层：Sequelize 模型定义、关联与生命周期钩子](18-shu-ju-mo-xing-ceng-sequelize-mo-xing-ding-yi-guan-lian-yu-sheng-ming-zhou-qi-gou-zi)
- 想看这些 `authorize` / `can` 是怎样在实际业务动作里被调用的：读 [Command 模式：跨模型的复杂业务操作封装](19-command-mo-shi-kua-mo-xing-de-fu-za-ye-wu-cao-zuo-feng-zhuang)
- 想看整个 API 请求流水线如何把授权和 presenter 拼起来：读 [API 路由设计：Schema 验证、中间件与错误处理](17-api-lu-you-she-ji-schema-yan-zheng-zhong-jian-jian-yu-cuo-wu-chu-li)
- 想继续看 `policies` 最终如何和 `data` 一起形成响应契约：读 [数据 Presenter 层：模型序列化与前后端数据契约](21-shu-ju-presenter-ceng-mo-xing-xu-lie-hua-yu-qian-hou-duan-shu-ju-qi-yue)
- 想回到前端那一侧看 `policies` 如何影响请求与错误处理：读 [API 客户端：请求封装、错误处理与 CSRF 防护](11-api-ke-hu-duan-qing-qiu-feng-zhuang-cuo-wu-chu-li-yu-csrf-fang-hu)
