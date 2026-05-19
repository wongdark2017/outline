如果第 19 页讲的是同步请求里那种“一个被命名的业务动作”，这一页要看的就是同步边界之外的另一半世界：**Outline 怎样把事件、后台任务、定时任务和 WebSocket 推送拆成一套可恢复、可重试、可横向扩展的异步系统。**

这套系统并不是单一一条 Bull 队列，而是至少拆成了四层：

- 模型或命令先产出 Event
- `globalEventQueue` 把 Event 分发给各类 Processor
- Processor 再决定是否继续派生 Task 或 WebSocket 消息
- `taskQueue` 执行真正耗时、可延后的后台工作

如果只盯着某一个 Task 类，你会看不见整条流水线；而一旦顺着这条链读，Outline 的后台架构会非常清楚。

Sources: [server/queues/index.ts](server/queues/index.ts), [server/queues/queue.ts](server/queues/queue.ts), [server/services/worker.ts](server/services/worker.ts), [server/services/websockets.ts](server/services/websockets.ts), [server/services/cron.ts](server/services/cron.ts), [server/queues/HealthMonitor.ts](server/queues/HealthMonitor.ts), [server/queues/processors/BaseProcessor.ts](server/queues/processors/BaseProcessor.ts), [server/queues/processors/index.ts](server/queues/processors/index.ts), [server/queues/processors/DebounceProcessor.ts](server/queues/processors/DebounceProcessor.ts), [server/queues/processors/RevisionsProcessor.ts](server/queues/processors/RevisionsProcessor.ts), [server/queues/processors/NotificationsProcessor.ts](server/queues/processors/NotificationsProcessor.ts), [server/queues/processors/ImportsProcessor.ts](server/queues/processors/ImportsProcessor.ts), [server/queues/tasks/base/BaseTask.ts](server/queues/tasks/base/BaseTask.ts), [server/queues/tasks/base/CronTask.ts](server/queues/tasks/base/CronTask.ts), [server/queues/tasks/index.ts](server/queues/tasks/index.ts), [server/queues/tasks/DocumentImportTask.ts](server/queues/tasks/DocumentImportTask.ts), [server/queues/tasks/ImportTask.ts](server/queues/tasks/ImportTask.ts), [server/queues/tasks/APIImportTask.ts](server/queues/tasks/APIImportTask.ts), [server/queues/tasks/DeleteAttachmentTask.ts](server/queues/tasks/DeleteAttachmentTask.ts), [server/queues/tasks/DocumentUpdateTextTask.ts](server/queues/tasks/DocumentUpdateTextTask.ts), [server/queues/tasks/CleanupDeletedDocumentsTask.ts](server/queues/tasks/CleanupDeletedDocumentsTask.ts), [server/queues/tasks/UpdateDocumentsPopularityScoreTask.ts](server/queues/tasks/UpdateDocumentsPopularityScoreTask.ts), [server/queues/tasks/EmailTask.ts](server/queues/tasks/EmailTask.ts), [server/emails/templates/BaseEmail.tsx](server/emails/templates/BaseEmail.tsx), [server/models/Event.ts](server/models/Event.ts)

## 先画一张异步系统总图

Outline 的后台流水线大致可以先压成下面这张图：

```text
Model.saveWithCtx / Event.schedule / Event.createFromContext
  -> globalEventQueue
  -> 按 applicableEvents 分发给各 Processor
  -> Processor:
       - 直接执行业务副作用
       - 或 schedule Task
       - 或投递 websocketQueue
  -> taskQueue / websocketQueue 分别由 worker / websockets 服务消费
  -> cron 服务定时把 CronTask 送进 taskQueue
```

这条链里最关键的一点是：**Event、Processor、Task 并不是一回事。**

- Event 更像“发生了什么”
- Processor 更像“哪些反应器要处理这类事情”
- Task 更像“一个真正要跑的后台工作单元”

把这三者拆开后，系统的扩展性会大很多。

## 队列层先分成四类，而不是所有东西都丢一个 `tasks` 队列

`server/queues/index.ts` 里定义了四个懒加载队列：

| 队列 | 用途 |
|---|---|
| `globalEventQueue` | 接收全局事件总线里的 Event |
| `processorEventQueue` | 已经确定目标 Processor 的处理任务 |
| `websocketQueue` | 专门给 websockets 服务消费的事件 |
| `taskQueue` | 各类后台异步任务 |

### 为什么要多拆一层 `processorEventQueue`

这不是多余的一次 hop。`globalEventQueue` 的职责是：

- 收到一个 Event
- 找出所有适用 Processor
- 为每个 Processor 单独派发一个 job

这样做的好处是：

- Event 分发和 Processor 执行解耦
- 某个 Processor 失败不会让整个 fan-out 逻辑混在一起
- 每个 Processor 有自己独立的重试生命周期

### `websocketQueue` 单独隔离出来非常重要

`worker.ts` 里专门把 `WebsocketsProcessor` 当特殊分支处理：

- 不在 worker 里直接发 socket
- 而是把 job 丢给 `websocketQueue`

再由 `server/services/websockets.ts` 的独立服务消费。

WHY 这层隔离必要？因为 WebSocket 推送必须由真正持有 socket server 的进程来做，普通 worker 不能假装自己有这个能力。

Sources: [server/queues/index.ts](server/queues/index.ts), [server/services/worker.ts](server/services/worker.ts), [server/services/websockets.ts](server/services/websockets.ts)

## `createQueue` 把 Bull 运行时约束集中收口

每个队列都不是裸 `new Queue(...)`，而是统一走：

- `createQueue(name, defaultJobOptions)`

### Redis 连接复用和连接类型分流都在这里

它会根据 Bull 的连接类型区分：

- `client`
- `subscriber`
- `bclient`

其中：

- 常规 client / subscriber 复用全局 Redis 连接
- `bclient` 单独新建连接，避免阻塞式消费通道和共享连接打架

这说明队列基础设施层已经在处理 Bull + Redis 的真实运行细节，而不是只管 API。

### 队列指标和关闭逻辑也被统一打包

`createQueue` 还顺手注册了：

- stalled / completed / error / failed metrics
- 定时 gauge 队列长度和 delayed 数量
- `ShutdownHelper` 关闭钩子

也就是说，队列在 Outline 里从第一天起就被当成正式基础设施，而不是“一个能用的后台库”。

Sources: [server/queues/queue.ts](server/queues/queue.ts)

## Worker 服务是整个异步系统的调度中心

`server/services/worker.ts` 是真正把几类队列挂起来的地方。

## 第一层：处理全局事件总线

`globalEventQueue().process(...)` 的逻辑并不直接执行业务，而是：

1. 取出一个 Event
2. 遍历所有注册 Processor
3. 检查 `applicableEvents`
4. 把命中的 Processor 再投到 `processorEventQueue`
5. 特殊处理 `WebsocketsProcessor`

这本质上是一层 fan-out dispatcher。

### 为什么不是拿到 Event 后就立刻依次执行每个 Processor

因为那样会有几个问题：

- 某个 Processor 慢，会拖住其他 Processor
- 某个 Processor 出错，重试粒度太粗
- 很难区分“分发失败”和“具体处理失败”

分成两级队列后，这几个问题都更容易控制。

## 第二层：只执行单个 Processor 的 job

到了 `processorEventQueue`，job 数据已经变成：

- `{ event, name }`

Worker 再实例化对应 `ProcessorClass`，只执行：

- `processor.perform(event)`

如果达到最后一次重试，还会调用：

- `processor.onFailed(event)`

这说明 Processor 被当成一个真正独立的执行单元，而不是全局回调列表。

## 第三层：执行 Task

`taskQueue().process(...)` 的模式又和 Processor 类似：

- 取出 `{ name, props }`
- 找到 `TaskClass`
- 实例化
- 执行 `task.perform(props)`
- 失败时最后一次调用 `task.onFailed(props)`

也就是说，在 Outline 里：

- Processor 和 Task 的运行时调度模型几乎一致
- 它们的区别主要在职责语义，而不是框架形状

Sources: [server/services/worker.ts](server/services/worker.ts), [server/queues/processors/BaseProcessor.ts](server/queues/processors/BaseProcessor.ts), [server/queues/tasks/base/BaseTask.ts](server/queues/tasks/base/BaseTask.ts)

## Processor 是“对哪类事件作出反应”的注册单元

Processor 的抽象非常轻：

- `static applicableEvents`
- `perform(event)`
- 可选 `onFailed(event)`

### 注册方式是目录扫描 + 插件 Hook

`server/queues/processors/index.ts` 会：

- 扫描 `server/queues/processors/`
- 自动注册默认导出类
- 再把插件系统里 `Hook.Processor` 提供的类挂进来

这说明事件处理器本身也是可扩展点，而不是硬编码死的清单。

### `applicableEvents` 让 Processor 更像订阅者

每个 Processor 明确声明自己关心哪些事件，例如：

- `RevisionsProcessor` 关心 `documents.publish`、`documents.update`、`documents.update.debounced`
- `NotificationsProcessor` 关心评论、修订、分享、文档发布等事件

这很接近消息系统里的订阅模型，只不过订阅表是代码静态声明的。

Sources: [server/queues/processors/index.ts](server/queues/processors/index.ts), [server/queues/processors/BaseProcessor.ts](server/queues/processors/BaseProcessor.ts)

## `DebounceProcessor` 很能说明 Event 和 Processor 分离后的好处

文档更新事件不是每打一个字就立刻生成 revision。实际链路更绕一点：

1. `documents.update`
2. `DebounceProcessor` 再丢一个延迟的 `documents.update.delayed`
3. 到点后检查文档是否又被改过
4. 如果没有，再产出 `documents.update.debounced`

这个设计非常像“分布式防抖器”。

### WHY 不在编辑请求结束时直接延时生成 revision

因为文档更新可能来自：

- 普通 API
- 协作持久化
- 不同 worker

把防抖逻辑写成 Event -> Processor 的一段独立流水线，才能保证无论事件从哪儿来，都走同一套延迟判断。

Sources: [server/queues/processors/DebounceProcessor.ts](server/queues/processors/DebounceProcessor.ts)

## `RevisionsProcessor` 展示了 Processor 和 Task / Command 的配合方式

当 revision 真正该生成时，`RevisionsProcessor` 会做几件事：

- 从 Redis 取这次修订以来的协作者集合
- 拉当前文档和最近一个 revision
- 如果内容没变，直接跳过
- schedule 一个 `DocumentUpdateTextTask`
- 调 `revisionCreator(...)` 写 revision

这条链很能说明分工：

- Processor 负责“什么时候该反应”
- Task 负责某个额外异步副作用（更新 text / 语言）
- Command 负责真正创建 revision 这一业务动作

这三个层次没有混在一起。

Sources: [server/queues/processors/RevisionsProcessor.ts](server/queues/processors/RevisionsProcessor.ts), [server/queues/tasks/DocumentUpdateTextTask.ts](server/queues/tasks/DocumentUpdateTextTask.ts), [server/commands/revisionCreator.ts](server/commands/revisionCreator.ts)

## `NotificationsProcessor` 说明 Processor 很适合做“二次派发”

通知处理器自己并不直接发所有通知，而是按事件类型再 schedule 对应任务：

- `DocumentPublishedNotificationsTask`
- `CollectionCreatedNotificationsTask`
- `CommentCreatedNotificationsTask`
- `ReactionCreatedNotificationsTask`
- `ShareSubscriptionNotificationsTask`

WHY 不把所有通知逻辑全塞进一个 Processor？因为通知本身就有很多分支：

- 邮件
- 站内通知
- 订阅触发
- group mention

Processor 作为“事件分流器”，Task 作为“具体执行者”，层次会清楚很多。

Sources: [server/queues/processors/NotificationsProcessor.ts](server/queues/processors/NotificationsProcessor.ts)

## `WebsocketsProcessor` 展示了事件系统如何把异步结果推回客户端

WebSocket 推送并不是另外一套独立逻辑，它直接消费 Event 系统。

### 它会根据事件加载最新模型，再走 Presenter

例如处理文档更新时，它会：

- 重新查 `Document`
- 调 `presentDocument(...)`
- 找到应该广播的频道
- 再发 `entities` 或具体事件名消息

这点很关键，因为它说明 WebSocket 推送的数据契约和 API 返回并没有完全分叉，而是尽量复用同一套 Presenter。

### 房间模型和权限系统是联动的

连接建立后，socket 会加入：

- `team-<id>`
- `user-<id>`
- `collection-<id>`
- `group-<id>`

后来客户端请求 `join` 额外房间时，服务端还会再次用：

- `can(user, "read", collection)`
- `can(user, "read", group)`

做检查。

也就是说，异步推送不是“权限外通道”，它仍然被权限系统约束。

Sources: [server/services/websockets.ts](server/services/websockets.ts), [server/queues/processors/WebsocketsProcessor.ts](server/queues/processors/WebsocketsProcessor.ts), [server/presenters/document.ts](server/presenters/document.ts)

## Task 是“真正要做的后台工作单元”

和 Processor 相比，Task 更接近大家熟悉的后台 job：

- 明确入参
- 可重试
- 可带优先级
- 可以被别的任务或业务代码 schedule

### `BaseTask` 把调度协议统一起来了

所有 Task 都继承：

- `BaseTask<T>`

并获得：

- `schedule(props, options)`
- 默认 `attempts`
- 默认指数退避
- `TaskPriority`
- 可选 `onFailed`

这让任务类本身只需要关心自己的业务逻辑，不用每次都手写队列协议。

### 注册方式和 Processor 一样，也是目录扫描 + 插件扩展

`server/queues/tasks/index.ts` 会：

- 扫描 `server/queues/tasks/`
- 自动注册默认导出类
- 再挂插件提供的 Task

这保证了新任务加入系统的成本很低。

Sources: [server/queues/tasks/base/BaseTask.ts](server/queues/tasks/base/BaseTask.ts), [server/queues/tasks/index.ts](server/queues/tasks/index.ts)

## CronTask 把“定时任务”也纳入同一个 Task 体系

Outline 没有单独再造一套 cron job 框架，而是让定时任务继续继承 Task。

### `CronTask` 在 `BaseTask` 之上又加了调度和分片语义

它要求子类声明：

- `cron.interval`
- 可选 `partitionWindow`

并提供：

- `getStaggerDelay(...)`
- `getPartitionBounds(...)`
- `getPartitionWhereClause(...)`

这说明定时任务并不只是“每小时跑一下”，而是从抽象层面就考虑了：

- 启动时间错峰
- UUID 范围分片
- 跨 worker 分摊扫描压力

### `cron` 服务只是一个轻量调度器

`server/services/cron.ts` 的工作很直接：

- 扫描所有 tasks
- 找出 `instanceof CronTask`
- 按 `Day` / `Hour` 定时 schedule

它自己并不执行任务，只负责把任务送进同一个 `taskQueue`。这让 cron 和普通异步任务共享完全一致的执行环境。

Sources: [server/queues/tasks/base/CronTask.ts](server/queues/tasks/base/CronTask.ts), [server/services/cron.ts](server/services/cron.ts)

## 几个代表性 Task 能看出这层的职责边界

## `DocumentImportTask`：外部文件导入是“同步解析 + 事务写入 + 最终清理”

它会：

- 从存储取文件 buffer
- 调 `documentImporter(...)` 做内容转换
- 在事务里调用 `documentCreator(...)`
- 无论成功失败都清理上传临时文件

WHY 这很适合 Task？因为文件导入：

- 可能比较慢
- 会吃 CPU / IO
- 需要脱离请求生命周期
- 又必须保证最终清理

这正是后台 job 的典型场景。

## `DeleteAttachmentTask`：有些任务就是极小、极明确的延后动作

这个任务只做一件事：

- 找到附件
- 删除它

并且用：

- `TaskPriority.Background`

降低优先级。

这说明 Task 不一定都复杂；哪怕只是“把一个可能慢、但不必阻塞当前请求的动作异步化”，也值得单独封装成任务。

## `DocumentUpdateTextTask`：异步补衍生字段

它会根据文档 `content`：

- 重新序列化 `text`
- 用 `franc` 猜语言
- 再保存回文档

这种逻辑并不影响主写路径立刻返回，但又需要最终一致性，因此很适合被 revision 流水线异步触发。

Sources: [server/queues/tasks/DocumentImportTask.ts](server/queues/tasks/DocumentImportTask.ts), [server/queues/tasks/DeleteAttachmentTask.ts](server/queues/tasks/DeleteAttachmentTask.ts), [server/queues/tasks/DocumentUpdateTextTask.ts](server/queues/tasks/DocumentUpdateTextTask.ts)

## `ImportTask` 和 `APIImportTask` 展示了任务如何分阶段推进长流程

这两类抽象任务很值得看，因为它们不是一次 `perform` 就完的简单任务。

### `ImportTask` 统一了文件导入型任务的生命周期

它把流程拆成：

1. `fetchAndExtractData`
2. `parseData`
3. `persistData`
4. 更新 `FileOperationState`
5. 清理临时目录

这说明一个复杂任务也可以通过抽象基类获得稳定结构，而不是把所有 import provider 各自写成大泥球。

### `APIImportTask` 进一步做成了分段状态机

它会根据 `ImportTask.state` 在：

- `Created`
- `InProgress`
- `Completed`

之间推进，并且：

- 生成 child import tasks
- 回填 `output`
- 更新关联 `Import` 的计数和状态
- 在最终失败时通过 `onFailed` 把整条 import 标成 `Errored`

这已经很接近“工作流任务系统”，而不是单次 job。

Sources: [server/queues/tasks/ImportTask.ts](server/queues/tasks/ImportTask.ts), [server/queues/tasks/APIImportTask.ts](server/queues/tasks/APIImportTask.ts), [server/queues/processors/ImportsProcessor.ts](server/queues/processors/ImportsProcessor.ts)

## 邮件发送也被统一成 Task，而不是请求里直接发 SMTP

`BaseEmail.schedule()` 并不会直接发邮件，而是把：

- `name: "EmailTask"`
- `templateName`
- `props`

塞进 `taskQueue`。

### WHY 这样做值

因为邮件发送的几个现实问题都不适合放在主请求里：

- 外部 SMTP 可能慢
- 需要重试
- 可能因为配置缺失而 no-op
- 不应该拖慢用户操作

最终 `EmailTask` 再在 worker 里：

- 根据 `templateName` 找到具体 Email 类
- 实例化
- 调 `send()`

这让邮件系统和其他后台任务共享同一套可靠执行设施。

Sources: [server/emails/templates/BaseEmail.tsx](server/emails/templates/BaseEmail.tsx), [server/queues/tasks/EmailTask.ts](server/queues/tasks/EmailTask.ts)

## 定时清理和批处理任务说明这套系统不只服务“用户动作之后”

很多任务根本不是由用户事件直接触发的，而是系统治理任务。

## `CleanupDeletedDocumentsTask`：定时清垃圾

它会：

- 找 30 天前删除的文档
- 结合分片 WHERE 子句
- 调 `documentPermanentDeleter(...)`

这类任务很适合：

- hourly cron
- background priority

因为它既重要，又不需要实时。

## `UpdateDocumentsPopularityScoreTask`：复杂批处理也被收进 Task

这个任务更能说明系统成熟度。它不是简单遍历表，而是：

- 只按固定小时间隔跑
- 先清理 stale working tables
- 使用只读副本读取候选文档
- 在主库建 `UNLOGGED` working table
- 按批次处理并在批次间 sleep
- 最终总是清理临时表

WHY 这值得单独强调？因为它表明 Outline 的任务系统不是只能做“发个通知”这种轻活，也能承接比较重的数据库批处理，只是写法会更谨慎。

Sources: [server/queues/tasks/CleanupDeletedDocumentsTask.ts](server/queues/tasks/CleanupDeletedDocumentsTask.ts), [server/queues/tasks/UpdateDocumentsPopularityScoreTask.ts](server/queues/tasks/UpdateDocumentsPopularityScoreTask.ts), [server/storage/database.ts](server/storage/database.ts)

## 失败处理和健康监控不是补丁，而是默认设计的一部分

### `onFailed` 给了 Processor / Task 一个最后兜底点

例如：

- `ImportsProcessor.onFailed(...)` 会把 import 状态打成 errored
- `APIImportTask.onFailed(...)` 会在事务里同步更新 import 和 import_task

这让“最终失败后怎样把业务状态收好”也变成了正式接口，而不是靠日志人肉排查。

### `HealthMonitor` 盯的是“队列还在不在真正消费”

它会监控：

- 最近有没有 active / completed / failed 活动
- 如果长时间没活动且 waiting job 太多，就记 fatal

这和简单的进程健康检查不同，它更关心的是“worker 活着但不干活”的状态。

Sources: [server/queues/HealthMonitor.ts](server/queues/HealthMonitor.ts), [server/queues/processors/ImportsProcessor.ts](server/queues/processors/ImportsProcessor.ts), [server/queues/tasks/APIImportTask.ts](server/queues/tasks/APIImportTask.ts)

## 为什么这套异步系统适合 Outline

Outline 的后台动作有几个非常典型的特点：

1. **很多副作用不该阻塞主请求**  
   邮件、通知、搜索、修订、导入、清理都属于这一类。

2. **同一个事件常常需要触发多个后续动作**  
   文档更新既可能生成 revision，也可能发通知，还可能推 WebSocket。

3. **有些任务是重量级批处理，需要限流、错峰、分片**

4. **系统被拆成多个服务进程，某些能力只能由特定服务消费**  
   例如 WebSocket 推送。

在这些约束下，Outline 选择：

- 用 Event 表示“发生了什么”
- 用 Processor 表示“谁要响应”
- 用 Task 表示“真正要做什么后台工作”
- 用多个队列表达不同消费边界

这套设计比“一切都直接丢进一个 Bull 队列”重一些，但结构清楚得多，也更适合长期演进。

## 建议继续阅读

- 想看很多 Event 最初是怎样从模型写入路径里产生的：读 [数据模型层：Sequelize 模型定义、关联与生命周期钩子](18-shu-ju-mo-xing-ceng-sequelize-mo-xing-ding-yi-guan-lian-yu-sheng-ming-zhou-qi-gou-zi)
- 想看同步请求里的业务动作怎样和这些异步链路接上：读 [Command 模式：跨模型的复杂业务操作封装](19-command-mo-shi-kua-mo-xing-de-fu-za-ye-wu-cao-zuo-feng-zhuang)
- 想看 WebSocket 和 API 推送出去的数据契约来自哪里：读 [数据 Presenter 层：模型序列化与前后端数据契约](21-shu-ju-presenter-ceng-mo-xing-xu-lie-hua-yu-qian-hou-duan-shu-ju-qi-yue)
- 想看数据库 schema 与 backfill 怎样支撑这些后台任务演进：读 [数据库迁移管理：Sequelize 迁移与数据回填脚本](23-shu-ju-ku-qian-yi-guan-li-sequelize-qian-yi-yu-shu-ju-hui-tian-jiao-ben)
- 想看 Redis 在队列、协作和缓存里还承担了哪些角色：读 [Redis 缓存策略与会话管理](25-redis-huan-cun-ce-lue-yu-hui-hua-guan-li)
- 想从服务拆分角度看 worker / websockets / cron 在整体架构里的位置：读 [后端服务拆分：Web、Collaboration、Websockets、Worker 与 Cron](7-hou-duan-fu-wu-chai-fen-web-collaboration-websockets-worker-yu-cron)
