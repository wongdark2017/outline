Outline 前端的状态管理不是“一个大 Store 管全局”的粗粒度做法，也不是 Redux 式的“单一不可变状态树 + reducer”路径。它更像一套**以实体模型为中心、以 Store 为集合容器、以 RootStore 为装配层**的 MobX 架构。你在代码里看到的 `Document`、`Collection`、`User` 这些模型，不只是接口定义，而是真正会在运行时承载行为、关系和生命周期的对象。这也是为什么读 Outline 前端时，先理解 Model/Store/RootStore 的分工，比先看某个页面组件更划算。

Sources: [app/stores/RootStore.ts](app/stores/RootStore.ts), [app/stores/base/Store.ts](app/stores/base/Store.ts), [app/models/base/Model.ts](app/models/base/Model.ts)

## 先把三层分工记牢

可以先用一句话概括这套架构：

- **Model** 代表“一个实体”
- **Store** 代表“一组同类实体 + 与后端同步的方法”
- **RootStore** 代表“把所有 Store 装起来，并提供跨 Store 协作入口”

如果展开成表格，会更清楚：

| 层级 | 典型类 | 主要职责 | WHY 这样分层 |
|---|---|---|---|
| `Model` | `Document`、`Collection`、`User` | 保存单条实体数据、关系、派生属性、保存/删除行为 | 让业务对象本身有行为，而不是沦为被动 JSON |
| `Store<T>` | `DocumentsStore`、`CollectionsStore` | 管理一类实体集合、缓存、查询、CRUD、分页 | 把“集合级逻辑”从组件和单实体里抽出来 |
| `RootStore` | `RootStore` | 统一创建和持有所有 store，提供跨 store 查找与清空能力 | 保证整个应用只维护一套状态图谱 |

这套设计最重要的收益是：页面组件很少直接处理“数据从哪来、更新谁、如何联动关系”这种问题，它们更多只是消费已经组织好的模型与集合。

Sources: [app/stores/RootStore.ts](app/stores/RootStore.ts), [app/stores/base/Store.ts](app/stores/base/Store.ts), [app/models/Document.ts](app/models/Document.ts)

## `RootStore`：整个应用状态图的总装配点

### 它做的不是业务，而是装配

`RootStore` 的职责非常纯粹：在构造函数里把所有 Store 实例化，并让它们彼此都能通过 `rootStore` 找到对方。当前这层已经注册了 30 多个 store，分成两类：

| 类别 | 例子 | 特征 |
|---|---|---|
| **模型型 Store** | `DocumentsStore`、`CollectionsStore`、`UsersStore` | 管理某类 Model 集合，通常继承 `Store<T>` |
| **非模型型 Store** | `UiStore`、`DialogsStore`、`DocumentPresenceStore` | 管理 UI 或连接态，不一定对应后端实体 |

你会看到它用 `registerStore()` 做统一注册，而不是在字段里手工 `new DocumentsStore(...)` 一大串。WHY 是为了让“按模型名反查 store”成为可能，也让命名规则保持一致。

### 为什么 `AuthStore` 一定最后初始化

源码里有一句非常关键的注释：

```ts
// AuthStore must be initialized last as it makes use of the other stores.
```

这意味着 `AuthStore` 并不只是“登录状态开关”，它在启动时会：

- 从本地存储反序列化用户、团队和 policy
- 调用 `fetchAuth()` 拉取当前会话
- 把返回的 `user`、`team`、`groups`、`groupUsers` 分发到其他 store

如果它在其他 store 之前初始化，整套“先恢复已有状态，再补全服务端最新状态”的流程就会缺少着陆点。这不是编码习惯问题，而是启动顺序依赖。

Sources: [app/stores/RootStore.ts](app/stores/RootStore.ts), [app/stores/AuthStore.ts](app/stores/AuthStore.ts)

## `Store<T>`：集合容器 + 同步层 + 缓存层

`Store<T>` 是 Outline 状态架构里最值得仔细读的一层。它不是简单的 `Map<string, T>` 包装，而是把一整套集合级行为抽成了基类。

### 内部状态长什么样

每个 `Store<T>` 至少带着这些核心状态：

| 字段 | 作用 |
|---|---|
| `data: Map<string, T>` | 以 id 为 key 的实体缓存 |
| `isFetching` | 当前是否在拉取数据 |
| `isSaving` | 当前是否在保存数据 |
| `isLoaded` | 是否至少完成过一次列表加载 |
| `requests: Map<string, Promise>` | 对 `fetch(id)` 做并发去重 |
| `model` / `modelName` | 当前 store 管理的模型类型 |
| `apiEndpoint` | 默认推导出的 RPC 命名空间 |

这套状态让 Store 既能充当缓存，又能把请求进行中的元信息暴露给 UI。

### 为什么 API endpoint 是自动推导的

如果某个 Store 没有自己指定 `apiEndpoint`，基类会把 `Model.modelName` 做 `lowerFirst + pluralize`，例如：

- `Document` -> `documents`
- `Collection` -> `collections`

于是 `Store<T>` 的通用 CRUD 就能直接拼出：

- `/documents.info`
- `/documents.list`
- `/documents.create`
- `/documents.update`
- `/documents.delete`

这说明前端 Store 设计和后端 RPC 命名是配套的。它不是“随便猜个 URL”，而是把前后端约定固化进了基类。

Sources: [app/stores/base/Store.ts](app/stores/base/Store.ts)

## `Store<T>` 的几项关键能力

### 1. `add()`：把服务端响应变成活的模型

`add()` 的逻辑不是粗暴覆盖，而是：

1. 如果传入的已经是 Model 实例，直接进 `data`
2. 如果是普通对象且本地已有旧实例，就调用旧实例 `updateData()`
3. 如果是普通对象且本地没有，才 `new ModelClass(item, this)`

WHY 这么做？因为一旦组件、关系字段、autorun 或 computed 已经持有某个 Model 引用，替换整对象会破坏响应式引用稳定性。更新现有实例比替换实例更符合 MobX 的细粒度更新模型。

### 2. `fetch(id)`：按实体级别去重请求

`fetch()` 有个很实用的细节：如果同一个 id 正在请求中，它会直接复用 `requests` 里的 Promise，而不是重复发请求。这个设计在详情页、侧边栏、评论面板等多个区域同时请求同一文档时特别有价值。

它还会在遇到 `AuthorizationError` 或 `NotFoundError` 时主动 `remove(id)`。WHY？因为这通常意味着本地缓存里的实体已经不再可见或不存在，继续保留只会制造 UI 幻觉。

### 3. `fetchPage()` / `fetchAll()`：分页与全量加载

`fetchPage()` 对应后端 `*.list` RPC，返回数组，同时把分页信息挂到一个符号属性上。`fetchAll()` 则根据第一页返回的总数继续拉后续页，并在需要时补关系加载。

这说明 Outline 的 Store 不只是“拿到一页数据就算完”，而是主动把分页协议抽象成前端通用能力。

### 4. `orderedData`：把排序责任前移到 Store

基类直接提供 `orderedData` computed，默认按 `createdAt desc` 排序。很多具体 store 再在此基础上继续派生：

- `DocumentsStore.recentlyViewed`
- `DocumentsStore.popular`
- `DocumentsStore.archived`

WHY 强调 computed？因为这样组件拿到的是已经组织好的视图数据，不用在 render 时临时做大量排序和过滤。

Sources: [app/stores/base/Store.ts](app/stores/base/Store.ts), [app/stores/DocumentsStore.ts](app/stores/DocumentsStore.ts)

## `Model`：单实体不是 POJO，而是有行为的对象

`Model` 基类把“一个实体”从纯数据提升成了一个运行时对象。

### 它负责哪些事

| 能力 | 说明 |
|---|---|
| `updateData()` | 用新字段更新自己，并触发生命周期钩子 |
| `save()` | 通过所属 store 持久化自己 |
| `delete()` | 调用所属 store 删除自己 |
| `loadRelations()` | 根据 `@Relation` 自动把依赖实体拉入内存 |
| `toAPI()` | 只序列化被 `@Field` 标记的字段 |
| `isDirty()` | 判断当前字段是否相对上次持久化有变化 |

这里最重要的设计点是：**Model 知道自己属于哪个 Store**。因此它既能触发集合级保存，又不用自己重新关心 API 端点在哪里。

### `toAPI()` 为什么只认 `@Field`

`toAPI()` 并不会把模型上所有属性都发回后端，而是只取 `@Field` 收集到的字段。这样做的 WHY 很关键：

- 避免把纯前端状态误发给服务端
- 避免把关系对象整块序列化
- 把“哪些字段属于持久化协议”显式写在模型定义上

例如 `Document` 上的：

- `collectionId`
- `title`
- `icon`
- `color`
- `templateId`
- `parentDocumentId`

这些是会被发回 API 的；而像 `notifications` 这种 computed，或 `embedsDisabled` 这种本地 UI 偏好，就不会被直接带上。

Sources: [app/models/base/Model.ts](app/models/base/Model.ts), [app/models/Document.ts](app/models/Document.ts), [app/models/decorators/Field.ts](app/models/decorators/Field.ts)

## 三个装饰器是这套模型系统的真正骨架

### `@Field`：声明“这是可持久化字段”

`@Field` 做的事情非常简单，但意义很大。它只是在一个全局 map 里记录某个类的哪些属性需要进入 `toAPI()`。简单，正因为它简单，规则才清楚。

### `@Relation`：把外键字段升格为真正关系

`@Relation(() => Collection)` 这样的写法，最终会在原型上定义 getter/setter：

- getter 通过 `rootStore.getStoreForModelName()` 找到对应 store
- 再根据 `collectionId` 或 `collectionIds` 去拿真正的模型实例
- setter 在写入外键 id 的同时，把传入模型加入目标 store

这意味着在使用层面，你可以像操作 ORM 一样使用：

- `document.collection`
- `document.parentDocument`
- `document.createdBy`

但底层其实仍然是前端内存中的 store 查找，不是数据库查询。WHY 这样体验好？因为组件和业务代码拿到的是“关系对象”，而不是到处手动 `rootStore.collections.get(document.collectionId)`。

更细一点说，`@Relation` 还记录了：

- `required`
- `multiple`
- `onDelete`
- `onArchive`

这些选项后来会被 `Store.remove()` 和 `Store.addToArchive()` 用来处理级联或置空行为。也就是说，关联不只是“方便读”，还影响实体联动删除和归档策略。

### `@Lifecycle`：把本地模型生命周期显式化

`LifecycleManager` 支持：

- `beforeCreate` / `afterCreate`
- `beforeUpdate` / `afterUpdate`
- `beforeChange` / `afterChange`
- `beforeRemove` / `afterRemove`
- `beforeDelete` / `afterDelete`

这让模型层可以在不污染组件的前提下，对本地状态变化插入副作用或同步逻辑。相比把这些逻辑散落在页面里，集中到模型生命周期更容易维护。

Sources: [app/models/decorators/Field.ts](app/models/decorators/Field.ts), [app/models/decorators/Relation.ts](app/models/decorators/Relation.ts), [app/models/decorators/Lifecycle.ts](app/models/decorators/Lifecycle.ts)

## `Document` 是最典型的综合样本

如果只选一个模型来理解 Outline 的状态架构，`Document` 是最好的样本，因为它同时体现了：

- `@Field` 持久化字段
- `@Relation` 关系对象
- `@computed` 派生属性
- 本地 `autorun` 偏好存储
- 和所属 `DocumentsStore` 的双向协作

例如：

- `collectionId` 用 `@Field`
- `collection` 用 `@Relation(() => Collection, { onDelete: "cascade" })`
- `parentDocument` 也用 `@Relation`，并定义归档/删除时级联
- `searchContent` 和 `searchSuppressed` 用 computed 暴露搜索语义
- `embedsDisabled` 这种每篇文档的本地偏好，则保存在浏览器 Storage 中

你会发现，模型已经不只是“接口实例”，而是带着展示语义、搜索语义、关系语义和保存语义的对象。

Sources: [app/models/Document.ts](app/models/Document.ts)

## `DocumentsStore` 说明具体 Store 是如何在基类上长出业务能力的

基类只提供通用 CRUD，真正的业务味道是在具体 Store 中长出来的。`DocumentsStore` 是最典型的例子：

- 它定义了 `backlinks`、`similar` 这些文档特有缓存
- 提供 `recentlyViewed`、`popular`、`drafts()` 等文档视图
- 覆盖了 `get(id)`，允许按标准 id 或 `urlId` 两种方式命中
- 封装了搜索、移动、复制、归档、恢复、清空回收站等文档操作

这说明 Outline 的设计不是“所有业务都往基类塞”，而是：

- 基类只保留真正稳定的共性
- 领域行为仍然回到各自 Store 中实现

这样既保住了复用，又不会把抽象层做成没人敢碰的巨石。

Sources: [app/stores/DocumentsStore.ts](app/stores/DocumentsStore.ts)

## `AuthStore` 是一个“非典型但关键”的 Store

`AuthStore` 虽然形式上也继承自 `Store<Team>`，但它承担的是会话中枢角色：

- 启动时从 localStorage 恢复 `user/team/policies`
- 调 `fetchAuth()` 拉当前真实会话
- 维护 `currentUserId`、`currentTeamId`、`collaborationToken`
- 处理跨标签页登录态同步
- 在登出时清理缓存并重定向

WHY 让它也继承 `Store`？因为团队实体本身仍然受 Store/Model 体系管理，而认证状态只是叠加在这个体系上的“当前指针”。这样做避免了再造一套平行的团队数据模型。

Sources: [app/stores/AuthStore.ts](app/stores/AuthStore.ts)

## 组件是怎么拿到这些状态的

在应用入口 `app/index.tsx` 中，MobX 的 `Provider` 会把 `stores` 注入 React 树。随后组件通过 `useStores()` 从 `MobXProviderContext` 取回 RootStore。

这个模式的好处是：

- 组件只依赖它需要的 store
- store 之间仍能通过 `rootStore` 协作
- 调试时开发环境还会把 `window.stores` 暴露出来，方便直接在控制台检查状态

对页面作者来说，常见体验就是：

```ts
const { documents, auth, ui } = useStores();
```

然后直接消费这些 store 提供的 computed、方法和模型对象。

Sources: [app/index.tsx](app/index.tsx), [app/stores/index.ts](app/stores/index.ts), [app/hooks/useStores.ts](app/hooks/useStores.ts)

## 这套架构为什么适合 Outline

Outline 之所以很适合 Model/Store/RootStore 这种 MobX 架构，有三个现实原因：

1. **文档、集合、成员、评论、权限之间关系非常密**  
   需要对象关系和跨 store 联动，而不是纯扁平列表。

2. **很多界面都在同时读写同一实体**  
   比如侧边栏、正文页、搜索结果、通知面板可能都持有同一篇文档。保留稳定的模型实例比频繁替换 JSON 更合适。

3. **前端不仅展示数据，还要承载大量本地行为**  
   例如本地偏好、协作状态、未保存变更、派生权限、嵌入控制等，这些都更适合放在“活的对象”里，而不是纯函数 reducer 链。

如果换成更强调不可变快照的模式也不是做不到，但实现成本和样板代码会明显更高。

## 推荐继续读哪里

- 想看这些 store 和 model 如何进入页面：读 [路由系统与页面场景（Scenes）组织方式](10-lu-you-xi-tong-yu-ye-mian-chang-jing-scenes-zu-zhi-fang-shi)
- 想看 Store 最终如何和后端同步：读 [API 客户端：请求封装、错误处理与 CSRF 防护](11-api-ke-hu-duan-qing-qiu-feng-zhuang-cuo-wu-chu-li-yu-csrf-fang-hu)
- 想看后端模型对应层：读 [数据模型层：Sequelize 模型定义、关联与生命周期钩子](18-shu-ju-mo-xing-ceng-sequelize-mo-xing-ding-yi-guan-lian-yu-sheng-ming-zhou-qi-gou-zi)
