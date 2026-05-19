如果只把 `server/models/` 当成一组 Sequelize 表映射，你会低估 Outline 很多关键设计。这里的模型层实际上同时承担了五类职责：

- 描述数据库字段、关联和默认 scope
- 暴露带业务语义的查询入口
- 在 hook 里维护结构性不变量
- 通过 `withCtx` 方法把事件、事务和请求上下文串起来
- 提供一批真正带领域含义的实例方法，而不是只有 CRUD

也就是说，Outline 的模型层不是“数据库适配器”，而是后端领域逻辑的第一层承载面。

Sources: [server/models/base/Model.ts](server/models/base/Model.ts), [server/models/base/IdModel.ts](server/models/base/IdModel.ts), [server/models/base/ParanoidModel.ts](server/models/base/ParanoidModel.ts), [server/models/base/ArchivableModel.ts](server/models/base/ArchivableModel.ts), [server/models/Document.ts](server/models/Document.ts), [server/models/Collection.ts](server/models/Collection.ts), [server/models/User.ts](server/models/User.ts), [server/models/Attachment.ts](server/models/Attachment.ts), [server/models/Revision.ts](server/models/Revision.ts), [server/models/decorators/Fix.ts](server/models/decorators/Fix.ts), [server/models/decorators/Changeset.ts](server/models/decorators/Changeset.ts)

## 先把模型层的边界想清楚

在 Outline 里，一条“读写模型”的路径通常不是：

```text
Route -> Model.find / Model.save -> 返回
```

更常见的是：

```text
Route / Command
  -> 模型 scope 预加载关联
  -> policy 依赖预加载关系做授权
  -> 模型 hook 维护衍生结构
  -> Model 基类自动生成 event / changeset
  -> presenter 再把模型序列化给客户端
```

所以这里的模型层并不孤立，它和：

- API 路由层
- command 层
- policy 层
- event / queue 层

是紧耦合协作的。

## 继承链不是样板，而是把通用语义一层层压进所有模型

Outline 模型的公共语义不是散落在每个类里手写，而是沿着继承链逐层叠加：

| 基类 | 提供的能力 |
|---|---|
| `Model` | `withCtx` 持久化方法、changeset 计算、自动事件插入、批量遍历 helper |
| `IdModel` | `id`、`createdAt`、`updatedAt` |
| `ParanoidModel` | `deletedAt` 与 `isDeleted` |
| `ArchivableModel` | `archivedAt` 与 `isArchived` |

这条链让像 `Document`、`Collection` 这种核心模型天然带上：

- 删除语义
- 归档语义
- 带上下文写入
- 变更跟踪

而不需要每个模型重新实现一遍。

### `@Fix` 不是装饰性代码，而是模型定义可用性的前提

几乎每个模型上都挂了：

- `@Fix`

这个 decorator 做的事情并不“业务”，但非常关键：

- 修正 `sequelize-typescript` 和 Babel / TypeScript 组合下的属性覆写问题
- 为原始字段和 association 补 getter / setter
- 避免 association 赋值把 Sequelize 的 `changed` 标记弄乱

所以它不是项目风格偏好，而是当前这套模型写法能稳定运行的基础兼容层。

### `SkipChangeset` 说明模型层从一开始就在区分“重要变更”和“噪声变更”

`server/models/decorators/Changeset.ts` 提供了：

- `@SkipChangeset`

被标记的字段在 `Model.changeset` 里会被跳过。常见例子包括：

- `Document.content`
- `Document.state`
- `Document.text`
- `Revision.content`
- `Attachment.lastAccessedAt`

WHY 要做这层区分？因为 Event / audit 并不适合记录所有大字段、二进制字段或导出型字段。否则：

- 变更日志太噪
- JSON / BLOB 差异难读
- 事件体积会失控

Sources: [server/models/base/IdModel.ts](server/models/base/IdModel.ts), [server/models/base/ParanoidModel.ts](server/models/base/ParanoidModel.ts), [server/models/base/ArchivableModel.ts](server/models/base/ArchivableModel.ts), [server/models/decorators/Fix.ts](server/models/decorators/Fix.ts), [server/models/decorators/Changeset.ts](server/models/decorators/Changeset.ts)

## `Model` 基类把“带请求上下文的持久化”做成默认路径

`server/models/base/Model.ts` 里最值得先抓住的不是字段，而是这些方法：

- `saveWithCtx`
- `updateWithCtx`
- `destroyWithCtx`
- `restoreWithCtx`
- `createWithCtx`
- `findOrCreateWithCtx`

它们的共同点是：**写数据库时顺手把请求上下文一起带进去。**

### `ctx.context` 里装的不只是 transaction

这些 `withCtx` 方法会把以下信息拼进 hook context：

- `transaction`
- `auth`
- `ip`
- `event`

这意味着后续 hook 不需要再自己回头找“这次是谁改的、要不要发事件、是否在事务里”。这些信息在模型保存路径上已经齐了。

### 自动事件不是 route 手工发，而是模型 hook 默认发

基类通过：

- `@AfterCreate`
- `@AfterUpdate`
- `@AfterDestroy`
- `@AfterRestore`
- `@AfterUpsert`

统一调用 `insertEvent(...)`。

`insertEvent` 会自动推断：

- `modelId`
- `collectionId`
- `documentId`
- `userId`
- `teamId`
- `actorId`
- `changes`

并根据 `event.persist` / `event.publish` 决定：

- 持久化进 `events` 表
- 或只在事务提交后丢进队列

这说明 Outline 的事件系统不是“业务代码偶尔记得发”，而是模型写路径自带的默认行为。

### `eventNamespace` 让事件名既统一又能局部覆写

多数模型默认使用 `tableName` 作为事件前缀，但也有显式覆写的例子：

- `Template.eventNamespace = "templates"`
- `ApiKey.eventNamespace = "api_keys"`
- `UserPasskey.eventNamespace = "passkeys"`

WHY 不直接把完整事件名写死在各处？因为事件命名需要：

- 有统一命名空间规则
- 又允许少数模型和表名脱钩

基类统一收口后，这件事就不必散落在命令和路由里。

### `changeset` 不是简单的 `changed()` 包装

`Model.changeset` 会：

- 跳过 virtual / blob / skipped fields
- 对对象字段做深比较
- 只保留真正变化的键
- 缓存在 `previousChangeset`

这样后续 `Event.changes` 看到的不是一整坨对象，而是更接近“这次真正改了什么”。

Sources: [server/models/base/Model.ts](server/models/base/Model.ts), [server/models/Event.ts](server/models/Event.ts)

## scope 和 `findByPk` 重写说明模型层同时扮演查询边界

Outline 的模型查询并不是“谁用谁自己拼 include”。`Document` 和 `Collection` 都把大量查询习惯写进了：

- `@DefaultScope`
- `@Scopes`
- 自定义 `findByPk`

### `Document` 默认就不是什么都读

`Document` 默认 scope 会做几件事：

- 预加载 `createdBy` 和 `updatedBy`
- 过滤 `publishedAt != null`
- 过滤 trial import
- 过滤 template 文档
- 默认不把巨大 `state` 列整份捞出来

甚至还专门定义了：

- `stateIfContentEmpty`

只有 `content` 为空时，才把 `state` 当回退列带上。

WHY 这很重要？因为协作文档的 `state` 是二进制大字段，默认查询它的成本很高。把“什么时候真的要它”沉到模型层，比让每个调用者自己记更可靠。

### `Collection` 和 `Document` 都把权限相关预加载做成 scope

你会在两个模型里看到：

- `withMembership`
- `withAllMemberships`
- `withViews`
- `withDocumentStructure`
- `withCollection`

这些 scope 的作用不只是方便查询，更关键的是给后面的 policy 层喂足数据。

例如文档权限要判断：

- 直接 `memberships`
- `groupMemberships`
- collection 是否 private

如果没提前 preload，policy 文件里会直接 `invariant(...)` 报开发错误。也就是说，这里不是“推荐 include”，而是**授权契约的一部分**。

### `findByPk` 其实已经带着一点 repository 味道

`Document.findByPk` 和 `Collection.findByPk` 都支持：

- 传 UUID
- 传前端 slug URL
- 根据选项切换不同 scope
- 按 `userId` 自动带会员关系
- 在 `rejectOnEmpty` 时抛更明确的错误

这说明 Outline 并没有单独抽一层 repository，但部分 repository 语义已经长进模型静态方法里了。

Sources: [server/models/Document.ts](server/models/Document.ts), [server/models/Collection.ts](server/models/Collection.ts)

## 关联不是只为 join，它还是权限、导航和协作语义的地基

如果只看 `@BelongsTo` / `@HasMany`，会觉得很常规；但把实际用途连起来看，会发现这些关联支撑了很多上层行为。

### 文档和集合的关联直接驱动导航树

`Collection` 维护：

- `documents`
- `documentStructure`

而 `Document` 维护：

- `collection`
- `parentDocument`
- `revisions`
- `memberships`
- `groupMemberships`
- `views`

这让模型层不仅知道“这条记录属于哪个表”，还知道：

- 它在知识树里的位置
- 它有哪些成员
- 它有哪些版本和浏览痕迹

### 多对多 membership 不是边缘关系，而是权限系统核心原料

例如：

- `Collection <-> UserMembership`
- `Collection <-> GroupMembership`
- `Document <-> UserMembership`
- `Document <-> GroupMembership`

模型上还专门提供了：

- `Collection.membershipUserIds(...)`
- `Document.membershipUserIds(...)`

把直接成员和组成员汇总成用户 ID 列表。

WHY 模型层要关心这个？因为权限既不是纯 route 逻辑，也不是前端逻辑，它和数据结构本身深绑定。

### 一些“看起来像缓存”的字段，本质也是模型层负责维护

例如：

- `Document.collaboratorIds`
- `Collection.documentStructure`
- `Document.previousTitles`

这些都不是单纯的原始用户输入，而是衍生结构。Outline 选择在模型 hook 和实例方法里维护它们，而不是另开一套同步器。

Sources: [server/models/Document.ts](server/models/Document.ts), [server/models/Collection.ts](server/models/Collection.ts), [server/models/Revision.ts](server/models/Revision.ts)

## 生命周期 hook 真正在维护业务不变量

Outline 的模型 hook 不是只做“填默认值”，很多都直接守住业务边界。

## `Document` 的 hook 在维护标题、协作状态和树结构

### `processUpdate` 会顺手维护多项衍生信息

`Document` 在 `@BeforeCreate` / `@BeforeUpdate` 里会：

- 保证 `title` 至少是空字符串
- 把旧标题收进 `previousTitles`
- 内容缺失时回填 `content`
- 把 `lastModifiedById` 加入 `collaboratorIds`
- `revisionCount += 1`

这说明一条文档更新不是“改字段然后保存”，而是会联动维护一串历史和协作元数据。

### `checkParentDocument` 防止树结构自环

当 `parentDocumentId` 变化时，模型会：

- 禁止指向自己
- 递归找所有子孙文档 ID
- 禁止挂到自己的后代下面

这种约束如果只放在前端或 route 很容易漏掉，放在模型 hook 才能保证所有写路径都守规矩。

### 标题、图标、颜色变化会反推 collection 结构

`updateCollectionStructure` 和 `addDocumentToCollectionStructure` 会在保存前后：

- 锁 collection
- 更新 `documentStructure`
- 让导航树里的节点标题 / url / 图标保持同步

也就是说，侧边栏树不是“另一个异步投影系统”，而是文档模型写入流程的一部分。

### 文档状态变更还会通知协作服务

`notifyCollaborationServer` 在 `state` 改变时，会调用：

- `APIUpdateExtension.notifyUpdate(...)`

它把普通 API 写入和协作内存态重新对齐。这说明模型 hook 甚至已经延伸到了跨进程同步边界。

Sources: [server/models/Document.ts](server/models/Document.ts)

## `Collection` 的 hook 在维护索引、成员和缓存

`Collection` 上几段 hook 很能代表 Outline 的模型风格：

- `setIndex` 用 `fractional-index` 生成或修正排序键
- `onAfterCreate` 自动给创建者补一条 `UserMembership(Admin)`
- `checkLastCollection` 禁止删掉团队最后一个 collection
- `deleteDocuments` 在删 collection 时顺手标记其下文档删除
- `publishPermissionChangedEvent` 在权限或分享状态变化时发事件
- `cacheDocumentStructure` 在事务提交后把 `documentStructure` 写进缓存

这里尤其值得注意的一点是：对 JSONB 结构做 `splice` / 递归修改后，代码会显式调用：

- `this.changed("documentStructure", true)`

WHY 要这么做？因为 Sequelize 对 JSONB 内部变更感知不稳定，不手工标记就可能根本不落库。这种 ORM 现实问题被直接写进模型方法里了。

Sources: [server/models/Collection.ts](server/models/Collection.ts)

## `User`、`Attachment`、`Revision` 展示了不同类型的 hook 风格

### `User` 主要守账号生命周期约束

`User` 的 hook 会：

- 禁止删除团队最后一个用户
- 禁止删除最后一个管理员
- 删除前抹除可识别信息
- 降级角色时同步调整 membership permission
- 头像更换后异步清理旧附件

这类逻辑很典型地说明：用户模型不是纯 profile 记录，而是账户治理规则中心。

### `Attachment` 同时守数据和外部存储

`Attachment` 会：

- 创建前清洗 key
- 更新时禁止改 key
- 删除前尽力删对象存储里的文件

而且删除 S3 失败时只记 warning，不阻断数据库删除。WHY？因为附件记录和外部对象存储不能强耦合到“一起成功一起失败”，否则脏数据和重试成本会更高。

### `Revision` 则更偏审计/历史快照

`Revision.clearData` 在销毁前会清空：

- `content`
- `text`
- `title`

这说明 revision 虽然是历史记录，但也保留了被清理或降载的能力。

Sources: [server/models/User.ts](server/models/User.ts), [server/models/Attachment.ts](server/models/Attachment.ts), [server/models/Revision.ts](server/models/Revision.ts)

## 模型实例方法里已经有不少“真正的领域动作”

Outline 的模型并不把所有业务都外包给 command。以 `Document` 和 `Collection` 为例，模型实例本身就带着很强的领域操作能力。

### `Document` 自己就能完成发布、反发布、归档和恢复

`Document` 上有一批明显不是 CRUD 的方法：

- `publish`
- `unpublishWithCtx`
- `archiveWithCtx`
- `restoreTo`
- `restoreFromRevision`
- `findAllChildDocumentIds`
- `toNavigationNode`

这些动作都会顺带处理：

- collection 结构更新
- parent / child 关系
- group 与 user membership 复制
- 事件发布
- `createdById` / `lastModifiedById` 调整

### `Collection` 则拥有一整套树结构操作能力

`Collection` 上集中维护了：

- `getDocumentTree`
- `removeDocumentInStructure`
- `updateDocument`
- `addDocumentToStructure`
- `getAllDocumentIds`
- `toNavigationNode`

WHY 这些方法适合留在模型里？因为它们操作的核心对象就是 `collection.documentStructure` 本身，把它们拆去外层 service 反而会弱化“谁拥有这份结构”的语义。

Sources: [server/models/Document.ts](server/models/Document.ts), [server/models/Collection.ts](server/models/Collection.ts)

## 为什么这套模型层设计适合 Outline

Outline 的后端面对的是：

1. **强关联的数据结构**  
   文档、集合、成员关系、修订、协作状态彼此强相关。

2. **很多写路径都会触发衍生结构更新**  
   例如导航树、协作者列表、事件、缓存、权限。

3. **同一份模型既要服务 API，也要服务 worker、协作进程、队列任务**

在这种约束下，把模型层做成“字段声明 + 领域方法 + hook 不变量 + 事件桥接”的组合，比纯 ActiveRecord 或纯 repository 都更贴近项目现实。

它当然更重，但换来的好处是：**不管从哪条写路径进入，很多核心约束都能在模型层被统一兜住。**

## 建议继续阅读

- 想先看这些模型怎样被 API 路由和中间件组织起来：读 [API 路由设计：Schema 验证、中间件与错误处理](17-api-lu-you-she-ji-schema-yan-zheng-zhong-jian-jian-yu-cuo-wu-chu-li)
- 想看为什么复杂跨模型操作没有全塞进模型方法里：读 [Command 模式：跨模型的复杂业务操作封装](19-command-mo-shi-kua-mo-xing-de-fu-za-ye-wu-cao-zuo-feng-zhuang)
- 想看 `withMembership` 这些预加载为什么会直接影响授权：读 [权限系统：基于 CanCan 的策略（Policies）与授权机制](20-quan-xian-xi-tong-ji-yu-cancan-de-ce-lue-policies-yu-shou-quan-ji-zhi)
- 想看 presenter 最终怎样把这些模型输出成前后端契约：读 [数据 Presenter 层：模型序列化与前后端数据契约](21-shu-ju-presenter-ceng-mo-xing-xu-lie-hua-yu-qian-hou-duan-shu-ju-qi-yue)
- 想看文档 `state/content` 双轨存储和协作写回是怎样配合的：读 [实时协作编辑：Hocuspocus、Y.js CRDT 与 WebSocket 持久化](15-shi-shi-xie-zuo-bian-ji-hocuspocus-y-js-crdt-yu-websocket-chi-jiu-hua)
