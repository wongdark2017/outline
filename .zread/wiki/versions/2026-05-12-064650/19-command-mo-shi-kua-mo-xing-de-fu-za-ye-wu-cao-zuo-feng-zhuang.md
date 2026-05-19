如果第 18 页回答的是“模型层到底承担了多少业务语义”，这一页要回答的就是另一个紧跟着出现的问题：**为什么 Outline 还需要 `server/commands/` 这一层？**

答案很简单，因为很多核心操作根本不是“改一个模型再保存”：

- 文档移动要同时改集合树、子文档、pin 和事件
- 登录开通要串起 team、user、auth provider、group sync 和 onboarding
- 协作写回要绕开部分 hook，避免和在线协作循环打架

这类动作如果硬塞进 route，会让路由层又长又脆；如果硬塞进单个 model，又会把跨模型编排和持久化细节糊在一起。`command` 层就是用来吃掉这部分复杂度的。

Sources: [server/commands/documentCreator.ts](server/commands/documentCreator.ts), [server/commands/documentUpdater.ts](server/commands/documentUpdater.ts), [server/commands/documentMover.ts](server/commands/documentMover.ts), [server/commands/documentDuplicator.ts](server/commands/documentDuplicator.ts), [server/commands/documentCollaborativeUpdater.ts](server/commands/documentCollaborativeUpdater.ts), [server/commands/teamCreator.ts](server/commands/teamCreator.ts), [server/commands/teamProvisioner.ts](server/commands/teamProvisioner.ts), [server/commands/userProvisioner.ts](server/commands/userProvisioner.ts), [server/commands/userInviter.ts](server/commands/userInviter.ts), [server/commands/accountProvisioner.ts](server/commands/accountProvisioner.ts), [server/commands/revisionCreator.ts](server/commands/revisionCreator.ts), [server/routes/api/documents/documents.ts](server/routes/api/documents/documents.ts)

## 先别把 command 想成经典 GoF 那种类对象

Outline 的 command 基本不是：

- `class UpdateDocumentCommand { execute() {} }`

而是更直接的：

- 一个具名的 async 函数
- 第一个参数是 `APIContext`
- 第二个参数是结构化 `Props`

例如：

- `documentUpdater(ctx, props)`
- `documentMover(ctx, props)`
- `teamProvisioner(ctx, props)`

这说明这里的 “command” 更接近：

- 明确命名的业务动作
- 带类型约束的函数式编排单元

而不是某种强调面向对象包装的设计模式教材实现。

### route 不是没有业务，但会把“主动作”让给 command

以文档路由为例，route 通常负责：

- 认证
- schema 校验
- 预加载模型
- 授权检查

真正跨多模型、多副作用的动作，再交给 command。

这种分工让你读 route 时先看清：

- 入口约束是什么
- 资源是怎么加载的

再去读 command 看：

- 真正发生了哪些变更

Sources: [server/routes/api/documents/documents.ts](server/routes/api/documents/documents.ts)

## command 层解决的核心问题不是 CRUD，而是“跨边界编排”

可以把这层最常见的任务概括成下面几类：

| 类型 | 代表 command | 主要复杂度 |
|---|---|---|
| 单资源但多副作用 | `documentUpdater` | Markdown 转换、事件、发布分支、协作通知 |
| 结构迁移 | `documentMover` | 锁集合、改树、改子树、清 pin |
| 派生创建 | `documentDuplicator`、`revisionCreator` | 复制内容、修剪 mark、保留上下文 |
| 账户开通 | `accountProvisioner`、`teamProvisioner`、`userProvisioner` | 多模型创建、provider 绑定、邀请流、group sync |
| 协作落库 | `documentCollaborativeUpdater` | Yjs 转 JSON、版本比较、跳过 hook |

这张表背后的重点是：**command 的价值不在于“多包一层函数”，而在于把原本会散在多个模型和 route 里的编排步骤收敛成一个名字清楚的动作。**

## `APIContext + Props` 是这层非常稳定的统一接口

几乎所有 command 都遵循同一个输入模型：

- `ctx` 提供当前用户、认证类型、事务、IP 等运行时上下文
- `props` 提供这次业务动作真正需要的领域参数

### 这让 command 很容易复用到不同入口

比如 `documentCreator` 可以被：

- API 路由直接调用
- `documentDuplicator` 复用
- 导入流程复用

因为它并不依赖某个特定 route 的局部变量，而是只依赖标准化的上下文和入参。

### 类型约束能把边界提前钉死

例如 `documentUpdater` 的 `Props` 里明确区分：

- `publish`
- `collectionId`
- `editMode`
- `findText`
- `done`

这让“什么字段是一次 update 行为真正允许改的”在函数签名层就清楚了，而不是运行到一半才靠隐式判断。

Sources: [server/commands/documentCreator.ts](server/commands/documentCreator.ts), [server/commands/documentUpdater.ts](server/commands/documentUpdater.ts), [server/types.ts](server/types.ts)

## 事务边界很明确：能复用请求事务就复用，不能复用就自己开

这是 Outline command 层很值得注意的一点。它没有“一律自己开事务”，而是根据场景选择。

### API 请求里的 command 优先复用 route 已经打开的事务

像：

- `documentUpdater`
- `documentMover`
- `documentCreator`

都会直接使用：

- `ctx.state.transaction`

也就是事务中间件提前准备好的事务。

WHY 这样设计好？因为 route 往往还要在 command 前后做别的数据库操作。复用同一事务，边界最清楚。

### 脱离普通 API 请求生命周期的动作会自己开事务

例如：

- `documentCollaborativeUpdater` 直接 `sequelize.transaction(...)`
- `revisionCreator` 包一层事务再创建 revision
- `teamProvisioner` 在创建全新 team 时内部再调用 `teamCreator`

这类动作的调用源头往往不是一条普通 `/api` 写请求，或者它本身就该作为一个完整原子单元独立存在。

### 有些命令还会在事务级别做额外控制

`documentCollaborativeUpdater` 里专门执行：

- `SET LOCAL lock_timeout = '15s'`

并对 `Document` 行加 `UPDATE` 锁。

WHY？因为协作落库碰到的是高并发热文档，锁策略必须比普通 CRUD 更明确。

Sources: [server/commands/documentUpdater.ts](server/commands/documentUpdater.ts), [server/commands/documentMover.ts](server/commands/documentMover.ts), [server/commands/documentCollaborativeUpdater.ts](server/commands/documentCollaborativeUpdater.ts), [server/commands/revisionCreator.ts](server/commands/revisionCreator.ts)

## `documentUpdater` 很能代表“单资源但多副作用”的 command 风格

`documentUpdater` 表面上像“更新文档”，实际上它把好几层逻辑收进了一个动作里。

### 它先统一处理字段更新和文本转换

函数会顺序处理：

- `title / icon / color`
- `editorVersion / templateId / fullWidth / insightsEnabled`
- `text`

其中 `text` 不是直接写回字符串，而是先经过：

- `TextHelper.replaceImagesWithAttachments(...)`
- `DocumentHelper.applyMarkdownToDocument(...)`

也就是说，更新一段 Markdown 文本，背后可能顺手完成：

- base64 图片转附件
- Markdown 到 ProseMirror 内容树映射
- append / prepend / patch 等编辑模式分支

### “发布”不是 update 的一个字段，而是一条不同写路径

如果 `publish && cId`，它不会简单保存 `document.collectionId = ...`，而是转去调用：

- `document.publish(ctx, ...)`

否则才是普通 `saveWithCtx(...)`。

WHY 这点重要？因为发布意味着的不只是“publishedAt = now”，还可能涉及：

- collection 结构
- membership 复制
- 事件语义

把这条路径和普通 save 分开，读起来更清晰。

### 即便没字段变化，也可能要补事件

如果文档内容没变，但 `done` 为真，`documentUpdater` 仍会：

- `Event.schedule({ name: "documents.update", ... })`

这说明 command 层关心的不只是数据库最终有没有 diff，还关心“本次业务动作有没有完成语义需要广播”。

Sources: [server/commands/documentUpdater.ts](server/commands/documentUpdater.ts), [server/models/Document.ts](server/models/Document.ts), [server/models/helpers/DocumentHelper.tsx](server/models/helpers/DocumentHelper.tsx), [server/models/helpers/TextHelper.ts](server/models/helpers/TextHelper.ts)

## 结构迁移为什么更适合放进 command：看 `documentMover`

`documentMover` 是一个非常典型的跨模型编排命令。

### 它一上来先锁当前集合和目标集合

如果文档已发布，命令会：

- 加载当前 collection
- 必要时加载目标 collection
- 对文档结构相关记录加锁

这为后续“移出旧树、插入新树”提供了安全前提。

### 同一次移动会联动多个对象

一条 move 里不仅改当前文档：

- 还要修改旧 collection 的 `documentStructure`
- 还要修改新 collection 的 `documentStructure`
- collection 变化时还要批量更新所有子文档的 `collectionId`
- 移到草稿区时要调整 `publishedAt` / `parentDocumentId`

也就是说，它的中心对象虽然是 document，但写入影响范围远超一张表。

### 它还顺手清理了“跨集合残留 pin”这种产品细节

如果文档从一个 collection 挪到另一个 collection，命令还会：

- 查旧 collection 上的 pin
- 调 `pin.destroyWithCtx(ctx)`

WHY 这要放在 move 里而不是交给别处异步扫尾？因为这本来就是移动动作的一部分语义，不清掉会让用户看到“文档被钉在不再属于它的集合里”。

### 最后返回的是“所有受影响模型”，不是只有主对象

`documentMover` 的返回值包含：

- `collections`
- `documents`
- `collectionChanged`

这说明 command 的职责不只是完成数据库修改，还会尽量把“调用方接下来需要回传给前端的那批变更对象”一起整理好。

Sources: [server/commands/documentMover.ts](server/commands/documentMover.ts)

## 派生创建类命令让“复用已有内容”变得可控

## `documentCreator` 把文档创建时的各种来源统一到一个入口

创建文档时，内容来源可能是：

- 直接给 `content`
- 给 Markdown `text`
- 给 `state`
- 基于模板生成
- 导入流程回填已有时间戳 / ID

`documentCreator` 会在一个地方处理：

- `urlId` 冲突回退
- 模板变量替换
- Markdown 转 ProseMirror
- content/state/title/icon/color 合并
- 保存后可选发布

所以它不是简单的 `Document.create(...)` 包装，而是“所有创建来源的统一归口”。

## `documentDuplicator` 说明 command 非常适合表达“基于已有资源派生新资源”

复制文档时，代码会：

- 复用 `documentCreator`
- 去掉 comment marks
- 带上 `originalDocumentId`
- 递归复制子文档
- 依照原 collection 结构排序子节点

WHY 不把这些逻辑塞回 `Document.duplicate()`？因为复制本身涉及：

- 原文档
- 新 collection
- 结构排序
- 递归子树
- 内容清洗

它比单模型内聚操作更像一次业务编排。

Sources: [server/commands/documentCreator.ts](server/commands/documentCreator.ts), [server/commands/documentDuplicator.ts](server/commands/documentDuplicator.ts)

## 账户开通流程展示了 command 之间如何层层组合

如果想看 command 层在“非文档场景”里的价值，`accountProvisioner` 是最好的例子之一。

### 它不是一个大而全的黑盒，而是一串有边界的组合

登录开通时，大致流程是：

```text
accountProvisioner
  -> teamProvisioner
  -> userProvisioner
  -> provisionFirstCollection
  -> 可选 groupsSyncer
```

每个子命令各自处理一类问题：

- team 是否存在、auth provider 是否匹配
- user 是否已存在、是否是 invite、是否要绑新 provider
- 首次团队是否要补 onboarding collection
- 外部 SSO group 是否需要同步

### `teamProvisioner` 体现了“先找、再兜底创建、再处理异常分支”

它会先查：

- 同 auth provider 的活跃 team

找不到时，再查：

- 已删除 team 对应 provider，必要时抛 `TeamPendingDeletionError`

再不行，才会去：

- 调 `teamCreator(...)` 新建团队

这说明 command 层很适合封装那种“有多条历史兼容分支”的业务流程。

### `userProvisioner` 则把邀请流、SSO 绑定和新用户创建统一起来

它要处理的分支包括：

- 已有 `UserAuthentication`
- 只有同邮箱用户记录，没有 auth 记录
- invited shell user 首次激活
- 全新用户注册但受团队域名 / inviteRequired 限制

而且还会顺手触发：

- 头像上传任务
- 邀请接受邮件
- 外部 provider 迁移

这类逻辑如果散在认证 route 里，会非常难维护。

Sources: [server/commands/accountProvisioner.ts](server/commands/accountProvisioner.ts), [server/commands/teamProvisioner.ts](server/commands/teamProvisioner.ts), [server/commands/teamCreator.ts](server/commands/teamCreator.ts), [server/commands/userProvisioner.ts](server/commands/userProvisioner.ts)

## command 层也是副作用管理的收口点

Outline 很多业务动作除了写数据库，还会带一串外部副作用：

- 发事件
- 发邮件
- 调队列任务
- 通知协作服务
- 写 trace span

command 层正好适合把这些动作和主要写操作放在一起读。

### 有些命令会显式发事件，有些则依赖模型 `withCtx`

例如：

- `documentUpdater` 在“done 但没内容变化”时手工 `Event.schedule`
- `documentCollaborativeUpdater` 直接构造 `documents.update`
- `User.createWithCtx` / `Document.saveWithCtx` 又会经由模型基类自动插事件

这不是混乱，而是两种不同粒度：

- 模型层负责默认事件
- command 层负责少数额外业务事件

### `traceFunction` 说明作者把 command 当作可观测业务单元

并不是所有命令都加 trace，但像：

- `documentMover`
- `teamCreator`
- `teamProvisioner`
- `accountProvisioner`

都被 `traceFunction` 包起来了。

WHY 这些命令更值得 trace？因为它们通常：

- 执行时间更长
- 跨模型更多
- 更容易出现线上排障需求

### 协作写回命令还会刻意绕开部分模型 hook

`documentCollaborativeUpdater` 更新文档时使用：

- `hooks: false`

注释里写得很直白：否则 `Document` 的 `AfterUpdate` 逻辑可能引发无限处理。

这很能说明 command 层的现实价值。它有时不是“复用一切模型默认行为”，而是**在知道默认行为会出问题时，选择一条受控旁路**。

Sources: [server/commands/documentCollaborativeUpdater.ts](server/commands/documentCollaborativeUpdater.ts), [server/commands/documentUpdater.ts](server/commands/documentUpdater.ts), [server/models/base/Model.ts](server/models/base/Model.ts)

## 为什么这套 command 模式适合 Outline

Outline 的复杂业务通常同时具备几个特征：

1. **跨多个模型和关系表**
2. **需要精确事务边界**
3. **要伴随事件、缓存、通知、队列等副作用**
4. **很多流程带历史兼容分支或产品级细节**

在这种场景下：

- 只靠 route 会太碎
- 只靠 model 会太重
- 单独搞 service + repository 双层又未必划算

于是 command 层就成了一个很务实的中间层：**把“一个能被命名的业务动作”收成一个函数。**

## 建议继续阅读

- 想先看 command 操作的底层数据对象本身：读 [数据模型层：Sequelize 模型定义、关联与生命周期钩子](18-shu-ju-mo-xing-ceng-sequelize-mo-xing-ding-yi-guan-lian-yu-sheng-ming-zhou-qi-gou-zi)
- 想看 command 被 API 请求是怎样调用起来的：读 [API 路由设计：Schema 验证、中间件与错误处理](17-api-lu-you-she-ji-schema-yan-zheng-zhong-jian-jian-yu-cuo-wu-chu-li)
- 想看 command 里很多 `authorize` / `can` 判断背后的能力系统：读 [权限系统：基于 CanCan 的策略（Policies）与授权机制](20-quan-xian-xi-tong-ji-yu-cancan-de-ce-lue-policies-yu-shou-quan-ji-zhi)
- 想看 command 产出的模型最后怎样被 presenter 组织成返回体：读 [数据 Presenter 层：模型序列化与前后端数据契约](21-shu-ju-presenter-ceng-mo-xing-xu-lie-hua-yu-qian-hou-duan-shu-ju-qi-yue)
- 想看更偏异步与后台执行的那一侧：读 [异步任务与事件驱动：Bull 队列、Processor 与 Task 体系](22-yi-bu-ren-wu-yu-shi-jian-qu-dong-bull-dui-lie-processor-yu-task-ti-xi)
- 想看登录开通和 SSO 这些命令最终服务的上层主题：读 [认证集成：Google、OIDC、Azure、Slack 与 Passkeys](26-ren-zheng-ji-cheng-google-oidc-azure-slack-yu-passkeys)
