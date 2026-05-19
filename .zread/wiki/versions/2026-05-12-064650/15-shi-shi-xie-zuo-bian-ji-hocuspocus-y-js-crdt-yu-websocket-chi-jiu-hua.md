Outline 的实时协作并不是“把 WebSocket 接上编辑器”这么简单。它真正跑起来时，至少同时涉及五层能力：

- 文档页决定什么时候启用协作编辑器
- 客户端用 `Y.Doc + HocuspocusProvider + IndexedDB` 维护本地与远端状态
- ProseMirror 通过 `y-prosemirror` 插件把 CRDT 接进编辑器状态
- 独立的 collaboration 服务负责认证、连接限制、状态装载与持久化
- API 写入和协作写入还要彼此同步，避免两条写路径互相覆盖

如果你把这五层混成一团，协作系统会很难读；但顺着代码实际的数据流看，它的职责边界其实相当清晰。

Sources: [app/scenes/Document/components/Document.tsx](app/scenes/Document/components/Document.tsx), [app/scenes/Document/components/MultiplayerEditor.tsx](app/scenes/Document/components/MultiplayerEditor.tsx), [app/editor/extensions/Multiplayer.ts](app/editor/extensions/Multiplayer.ts), [server/services/collaboration.ts](server/services/collaboration.ts), [server/collaboration/PersistenceExtension.ts](server/collaboration/PersistenceExtension.ts), [server/commands/documentCollaborativeUpdater.ts](server/commands/documentCollaborativeUpdater.ts)

## 先建立一张协作编辑地图

可以先把整条链路概括成下面这张图：

```text
Document Scene
  -> 是否启用 MultiplayerEditor
  -> HocuspocusProvider 连接 /collaboration
  -> Y.Doc 承载共享文档状态
  -> ySyncPlugin / yCursorPlugin / yUndoPlugin 接入 ProseMirror
  -> collaboration 服务认证、加载、广播、持久化
  -> documentCollaborativeUpdater 落库并发事件
  -> APIUpdateExtension 把 API 写入反向同步到内存中的 Y.Doc
```

这条链里最值得先记住的一点是：**实时协作并没有替换原来的编辑器架构，而是在共享 Editor 之上再叠了一层同步协议。**

## 什么时候文档页会真的启用多人协作

协作编辑不是任何文档场景都开启的。`app/scenes/Document/components/Document.tsx` 里先做了一个很直接的判断：

- 文档不能是归档态
- 不能已删除
- 不能在看 revision 历史版本
- 不能是公开分享页

也就是：

```ts
const multiplayerEditor =
  !document.isArchived && !document.isDeleted && !revision && !isShare;
```

然后页面场景才把：

- `multiplayer={multiplayerEditor}`

传给 `DocumentEditor`，后者再决定用普通 `Editor` 还是 `MultiplayerEditor`。

WHY 这个判断要放这么外层？因为 revision、分享、归档这些场景，本质上就不是“一个可多人共同写入的活动文档”。越早在页面层剪掉，后面协作栈越简单。

Sources: [app/scenes/Document/components/Document.tsx](app/scenes/Document/components/Document.tsx), [app/scenes/Document/components/Editor.tsx](app/scenes/Document/components/Editor.tsx)

## `MultiplayerEditor`：客户端协作启动器

`app/scenes/Document/components/MultiplayerEditor.tsx` 是客户端协作层的总入口。它本身并不替代共享 Editor，而是负责：

- 创建 `Y.Doc`
- 创建本地缓存 provider
- 创建远端 Hocuspocus provider
- 把 `Multiplayer` 扩展动态塞进 Editor
- 处理同步前后的 UI、状态和容错

### 它会同时维护本地持久化和远端连接

初始化时，它做了两件关键事：

1. 创建 `Y.Doc`
2. 如果浏览器支持 IndexedDB，则再创建：
   - `new IndexeddbPersistence(name, ydoc)`

同时再创建：

- `new HocuspocusProvider({ url, name, document: ydoc, token, parameters })`

其中：

- `name` 是 `document.${documentId}`
- `token` 来自 `auth.collaborationToken`
- `parameters.editorVersion` 来自共享编辑器版本常量

这说明一个协作文档在客户端至少有两份“来源”：

- 浏览器本地缓存
- 远端实时连接

它们最终都写进同一个 `Y.Doc`。

### 本地缓存不是锦上添花，而是加载体验关键

如果本地缓存还没同步好、远端也还没同步完，组件会先渲染一个：

- 只读
- `cacheOnly`
- 基于上次缓存内容

的普通 `Editor` 作为占位版本。等远端或本地准备好，再把真正的协作版编辑器接管上来。

WHY 这样做值？因为多人文档的首屏体验很容易受网络影响。直接白屏等远端同步，体验会很差；用最近缓存先给用户一个只读视图，明显更稳。

Sources: [app/scenes/Document/components/MultiplayerEditor.tsx](app/scenes/Document/components/MultiplayerEditor.tsx), [app/stores/AuthStore.ts](app/stores/AuthStore.ts), [shared/editor/version.ts](shared/editor/version.ts)

## 客户端同步状态里有三类“已就绪”

`MultiplayerEditor` 明确区分了几种不同的同步概念：

| 状态 | 含义 |
|---|---|
| `hasLocalPersistence` | 当前浏览器是否有 IndexedDB 持久化能力 |
| `isLocalSynced` | 本地缓存是否已经加载出一个非空文档 |
| `isRemoteSynced` | 远端 Hocuspocus provider 是否完成初次同步 |

`onSynced()` 只有在：

- 没有本地持久化，或者本地已经 ready
- 并且远端已同步

时才会触发。

这说明 Outline 并没有把“连上 WebSocket”粗暴等同于“文档已可安全使用”，而是把“本地可读”和“远端可写”拆成了两步。

## awareness 不只用来画光标，还带着用户观察态和滚动位置

多人协作最直观的功能是远端光标，但 Outline 在 awareness 上做得更多。

### awareness 里会带当前用户信息

客户端会通过 `provider.setAwarenessField("user", user)` 写入：

- `id`
- `name`
- `color`

这让远端用户的光标、选区、观察态都能跟用户身份对应上。

### 还会同步滚动位置

组件会节流上报：

- `scrollY / window.innerHeight`

到 awareness。收到远端 awareness 更新后，如果当前正在“观察”某个用户，界面还会平滑滚动到对方大致位置。

这说明 awareness 在 Outline 里不仅服务于“我看到你光标在哪”，还服务于“我正在跟随你看文档”。

### presence store 会消费 awareness 变化

`provider.on("awarenessChange", ...)` 时，页面会调用：

- `presence.updateFromAwarenessChangeEvent(...)`

也就是把协作协议层的事件再翻译成应用自己的 presence 状态。

Sources: [app/scenes/Document/components/MultiplayerEditor.tsx](app/scenes/Document/components/MultiplayerEditor.tsx)

## 连接管理不是常连不关，而是会根据空闲和可见性主动断开

`MultiplayerEditor` 组合了：

- `useIdle()`
- `usePageVisibility()`

如果页面：

- 用户处于 idle
- 且标签页不可见
- 且当前连接还在 `Connected`

就会主动 `disconnect()`。反过来，只要重新活跃或重新可见，再自动 `connect()`。

WHY 这里要主动断？因为协作连接本身是昂贵资源：

- 服务端要保连接数
- awareness 要广播
- 选区要维护

对一个长时间挂后台的标签页，持续占着协作连接没有意义。

## 认证失败时，客户端会先尝试刷新会话，而不是直接放弃

远端 provider 一旦触发 `authenticationFailed`：

1. 会先停止自动重连
2. 递增 retry 次数
3. 重新调用 `auth.fetchAuth()`
4. 拿新的 `collaborationToken`
5. 重新 `connect()`
6. 如果仍失败，才跳回首页

这很关键，因为协作 token 往往比普通页面生命周期更敏感。如果每次 token 过期都让用户整页崩掉，协作体验会很差。

### editor 版本落后也会进入只读保护

如果 close code 是 `EditorUpdateError.code`，客户端会：

- 停止继续自动连接
- 设置 `editorVersionBehind = true`
- 把协作编辑器强制切回只读

这说明“新旧编辑器 schema 不兼容”被当成一类明确的一等错误，而不是模糊地显示“断线了”。

Sources: [app/scenes/Document/components/MultiplayerEditor.tsx](app/scenes/Document/components/MultiplayerEditor.tsx), [shared/collaboration/CloseEvents.ts](shared/collaboration/CloseEvents.ts)

## `Multiplayer` 扩展：把 Y.js 正式接进 ProseMirror

前面是页面层和 provider 层，真正把协作状态接进编辑器的是：

- `app/editor/extensions/Multiplayer.ts`

### 它是一个普通编辑器扩展

这个扩展没有走什么特殊通道，而是像别的 editor extension 一样，通过 `plugins()` 和 `commands()` 暴露能力。它最核心的三项插件是：

- `ySyncPlugin(type)`
- `yCursorPlugin(provider.awareness, ...)`
- `yUndoPlugin()`

这很能说明 Outline 的编辑器架构有多稳：即便是多人协作，也只是“再加一个扩展”。

### 它允许在只读模式下继续存在

`allowInReadOnly = true` 很关键。WHY？因为：

- 即便当前用户没有编辑权限
- 也依然可能需要看到远端正在发生的变化
- 还可能需要看到远端光标与选区

所以协作插件不能简单等同于“编辑能力”。

### 远端选区会自动褪去

扩展内部对 `yCursorPlugin` 做了额外包装：

- 用 `awarenessStateFilter` 记录某个用户最近一次 awareness 变化时间
- 用 `selectionBuilder` 在超过一定时间后把选区 opacity 降到 0

WHY 要这样做？因为如果某个用户停在那里不动，永久高亮一块远端选区会很碍眼。Outline 选择保留“刚发生过变化的上下文”，而不是永久挂一块彩色背景。

### PermanentUserData 让客户端 id 能映射回真实用户

扩展会在本地第一次产生真正编辑事务后，用：

- `new Y.PermanentUserData(doc)`

把当前 Yjs clientID 映射到真实 `user.id`。这样即便后面连接断开重连，文档协作历史里也仍然能还原参与者身份。

Sources: [app/editor/extensions/Multiplayer.ts](app/editor/extensions/Multiplayer.ts)

## 为什么很多装饰类插件都要识别“远端事务”

`shared/editor/lib/multiplayer.ts` 提供了两个关键辅助：

- `isRemoteTransaction(tr)`
- `mapDecorations(set, tr, force?)`

### `isRemoteTransaction()` 的作用

它通过 `ySyncPluginKey` 的 meta 判断当前事务是否来自远端同步，而不是本地输入。

这件事为什么重要？因为像：

- 代码高亮
- Mermaid 渲染
- toggle block
- 上传占位符

这些装饰或附加效果，在远端补丁到来时并不能总靠普通 transaction mapping 正确更新。

### `mapDecorations()` 会在远端事务里重建 transform

如果当前 decoration set 非空，且事务来自远端，它会尝试用：

- `recreateTransform(...)`

重新生成 mapping，再映射 decoration。WHY 要这么做？因为 CRDT 合并后的 remote transaction 有时不是简单本地 step 序列，直接沿用默认 mapping 更容易把 decoration 映错位置。

这就是为什么协作并不是只影响编辑器一个插件，而是会把一整批“基于位置的增强能力”都带上。

Sources: [shared/editor/lib/multiplayer.ts](shared/editor/lib/multiplayer.ts)

## collaboration 服务：独立 WebSocket 入口和 Hocuspocus 宿主

服务端协作进程的总装配点在：

- `server/services/collaboration.ts`

### 它使用独立的 `/collaboration` 升级入口

HTTP server 收到 upgrade 请求时，会检查：

- URL 是否以 `/collaboration` 开头
- 路径里是否带 document id

之后才把连接交给 Hocuspocus 处理。

### payload 大小在握手层就被限制

`WebSocket.Server` 配了：

- `maxPayload: DocumentValidation.maxStateLength`

当前最大协作状态大小来自共享校验常量：

- `DocumentValidation.maxStateLength = 1500 * 1024`

一旦超过这个值，服务端会优先记录 warning，而不是让进程直接异常崩掉。这说明文档过大不是单纯的业务问题，也被当成协作基础设施要防守的输入边界。

### Hocuspocus 自身还带了防抖与超时参数

当前配置里比较关键的几个参数有：

- `debounce: 3000`
- `maxDebounce: 10000`
- `timeout: 30000`

可以把它理解成：服务端不会为每个细碎变更都立刻做重持久化，而是允许短时间聚合。

Sources: [server/services/collaboration.ts](server/services/collaboration.ts), [shared/validations.ts](shared/validations.ts)

## 服务端扩展链：每个扩展只守一类约束

协作服务当前依次装配了这些扩展：

| 扩展 | 职责 |
|---|---|
| `Redis` | 多实例之间同步 Hocuspocus 文档状态 |
| `Throttle` | 限制协作请求频率 |
| `ConnectionLimitExtension` | 限制单文档最大连接数 |
| `EditorVersionExtension` | 拒绝过旧编辑器版本 |
| `AuthenticationExtension` | 校验 JWT 与文档权限 |
| `PersistenceExtension` | 装载和持久化文档状态 |
| `APIUpdateExtension` | 把 API 写入反向同步到协作文档 |
| `ViewsExtension` | 触摸 viewedAt / lastActiveAt |
| `LoggerExtension` | 协作链路日志 |
| `MetricsExtension` | 连接数、文档数、变更数等指标 |

这条扩展链非常有代表性：**协作服务不是一个“巨型 onMessage”函数，而是靠一串职责非常单一的扩展拼起来的。**

## 认证扩展：先判读权限，再决定是不是只读协作

`AuthenticationExtension` 做的事情很直接：

1. 从 `documentName` 里拆出 document id
2. 要求必须带 token
3. 用 `getUserForJWT(token, ["session", "collaboration"])` 校验会话
4. 查文档并做 `can(user, "read", document)` 权限校验
5. 如果能读但不能更，就把连接标成 `readOnly`

这很有价值，因为它说明 Outline 协作并没有把“能打开文档”和“能写文档”绑死成同一件事：

- 读权限通过 -> 可以加入同步会话
- 写权限缺失 -> 仍可接收更新，但本地改动不会广播

Sources: [server/collaboration/AuthenticationExtension.ts](server/collaboration/AuthenticationExtension.ts)

## 连接限制与版本限制：先在连接边界挡住坏请求

### `ConnectionLimitExtension`

它在内存里维护：

- `documentName -> Set<socketId>`

连接阶段先看当前文档连接数，超过：

- `env.COLLABORATION_MAX_CLIENTS_PER_DOCUMENT`

就直接拒绝，并返回 `TooManyConnections`。

### `EditorVersionExtension`

它要求握手参数里必须带：

- `editorVersion`

如果客户端 major 版本落后于服务端，就直接拒绝连接，并返回 `EditorUpdateError`。

这两种限制的共同点是：**都尽量发生在最早的连接阶段**，而不是等文档已经加载、选区已经广播后再告诉用户“不行”。

Sources: [server/collaboration/ConnectionLimitExtension.ts](server/collaboration/ConnectionLimitExtension.ts), [server/collaboration/EditorVersionExtension.ts](server/collaboration/EditorVersionExtension.ts), [shared/collaboration/CloseEvents.ts](shared/collaboration/CloseEvents.ts)

## `PersistenceExtension`：数据库状态、Markdown 内容与 Y.Doc 的桥

这是协作服务里最核心的扩展之一。

### 读取时优先使用已存在的 Yjs state

`onLoadDocument()` 的策略是：

1. 先看当前 Y.Doc 的 field 是否已非空
2. 再查数据库里 document.state
3. 如果已有 state，直接 `Y.applyUpdate(...)`
4. 如果还没有 state，才进入事务加锁并从旧内容创建

这种设计背后的 WHY 很明确：

- 已有二进制 state 时，直接用最省成本
- 只有历史文档还没迁移到 state 时，才需要从 `content` 或 `text` 转换

### 首次无 state 时会把旧内容升级成 Yjs state

如果数据库里还没有 `document.state`：

- 有 `content` -> `ProsemirrorHelper.toYDoc(content)`
- 否则有 `text` -> `ProsemirrorHelper.toYDoc(text)`

然后再用：

- `ProsemirrorHelper.toState(ydoc)`

反写回数据库。这相当于协作服务顺手把历史文档从“Markdown/PM JSON 存储”升级成了“Yjs state 可直接恢复”的格式。

### 变更期间会收集本轮协作者

`onChange()` 时，如果上下文里有 user，它会把：

- `user.id`

写进 Redis set `Document.getCollaboratorKey(documentId)`。这让服务端知道“自上次持久化以来，究竟哪些用户改过文档”。

Sources: [server/collaboration/PersistenceExtension.ts](server/collaboration/PersistenceExtension.ts), [server/models/helpers/ProsemirrorHelper.tsx](server/models/helpers/ProsemirrorHelper.tsx)

## 文档真正落库时，持久化命令会顺手整理协作者与版本信息

`onStoreDocument()` 最终调用的是：

- `documentCollaborativeUpdater(...)`

### 它先把当前 Y.Doc 转成两种存储形式

命令里会生成：

- `state = Y.encodeStateAsUpdate(ydoc)`
- `content = yDocToProsemirrorJSON(ydoc, "default")`

也就是说数据库里同时保留：

- 协作恢复更高效的 Yjs state
- 传统业务层仍然要用的 ProseMirror JSON 内容

### 只有真正变了才会落库

它会先比较：

- `document.content`
- 当前从 Y.Doc 得到的 `content`

如果没变化，直接返回。这样服务端不会因为客户端频繁同步心跳或无效事务而反复写数据库。

### 协作者列表来自三路合并

最终的 `collaboratorIds` 会综合：

- 文档原有协作者
- 本次 session 中 Redis set 记录的协作者
- `Y.PermanentUserData` 里记录的 client -> user 映射

这说明 Outline 并不只依赖“最后一个写入人”，而是尽量保留这次协作会话中所有真正参与过编辑的人。

### editorVersion 会取更新的一方

如果：

- 数据库里已有 `document.editorVersion`
- 当前协作客户端也上报了 `clientVersion`

就用 semver 取较新的那个。这让文档状态能跟着真实编辑器版本逐步前进。

Sources: [server/commands/documentCollaborativeUpdater.ts](server/commands/documentCollaborativeUpdater.ts)

## API 写入与协作写入不会互相蒙在鼓里

如果只靠 Hocuspocus，协作文档能同步“协作会话中的变更”；但 Outline 还有大量 API 路由也会修改文档，例如：

- 普通 `documents.update`
- 导入
- 自动化工具

这时就需要：

- `APIUpdateExtension`

来补上另一条同步路径。

### 它用 Redis pub/sub 做跨写路径通知

逻辑是：

1. 文档通过 API 被更新
2. 某处调用 `APIUpdateExtension.notifyUpdate(documentId, actorId)`
3. Redis 向 `collaboration:api-update:<documentId>` 发消息
4. 已加载该文档的协作实例收到消息
5. 再从数据库取最新 `state`
6. 用状态向量求 diff
7. 把差量 `Y.applyUpdate(...)` 回当前内存中的 Hocuspocus 文档

WHY 这里不直接整份替换？因为协作文档可能此刻还在其他客户端持续变化，直接硬替换更粗暴；状态向量 diff 更符合 CRDT 语义。

### 这让“两条写路径”重新收敛成一条状态源

从效果上看，不管文档是：

- 在协作编辑器里被改
- 还是通过普通 API 被改

最终都会回到同一份 Yjs 状态上。这就是这套架构最重要的收敛点。

Sources: [server/collaboration/APIUpdateExtension.ts](server/collaboration/APIUpdateExtension.ts), [server/routes/api/documents/documents.ts](server/routes/api/documents/documents.ts), [server/commands/documentUpdater.ts](server/commands/documentUpdater.ts)

## `ViewsExtension`、日志和指标说明协作服务不只是同步器

### `ViewsExtension`

它会在用户发生变更时，每分钟最多一次：

- `View.touch(documentId, user.id, true)`
- 更新 `user.lastActiveAt`

这说明协作服务顺手承担了“真实阅读/活动痕迹”的一部分采样。

### `LoggerExtension` 和 `MetricsExtension`

它们分别负责：

- 记录 load / connect / disconnect 等关键日志
- 统计 `collaboration.connect`、`collaboration.change`、连接数、文档数等指标

WHY 这很重要？因为协作系统出问题时，如果没有独立的日志和指标，排查成本会非常高。Outline 明显把 collaboration 当成一套独立基础设施，而不只是编辑器附属功能。

Sources: [server/collaboration/ViewsExtension.ts](server/collaboration/ViewsExtension.ts), [server/collaboration/LoggerExtension.ts](server/collaboration/LoggerExtension.ts), [server/collaboration/MetricsExtension.ts](server/collaboration/MetricsExtension.ts)

## 用户最终看到的“离线 / 断线 / 太多人 / 版本过旧”都来自明确 close code

客户端 `ConnectionStatus` 组件会把 `ui.multiplayerStatus` 和 `ui.multiplayerErrorCode` 翻译成用户看得懂的提示。当前重点处理的包括：

- 文档过大
- 认证失败
- 授权失败
- 同时连接人数过多
- 编辑器版本过旧

这和前面服务端扩展层是一一对应的。也就是说，Outline 协作系统的容错不是“日志里知道出错了”，而是从 close code 到 UI 提示都打通了。

Sources: [app/scenes/Document/components/ConnectionStatus.tsx](app/scenes/Document/components/ConnectionStatus.tsx), [shared/collaboration/CloseEvents.ts](shared/collaboration/CloseEvents.ts)

## 为什么这套协作架构适合 Outline

Outline 的文档编辑有几个现实要求：

1. **既要实时协作，也要允许离线或弱网先看到最近内容**
2. **既要支持只读旁观者，也要支持可编辑参与者**
3. **既有协作编辑写路径，也有普通 API 写路径**
4. **既要富文本结构正确，也要可追踪协作者与编辑器版本**

在这些约束下，这套设计的优点很明显：

- `Y.Doc` 成为唯一共享状态载体
- Editor 扩展体系让协作只是一层追加能力
- 独立 collaboration 服务把连接、认证、持久化隔离出来
- APIUpdateExtension 解决了双写路径同步问题
- 本地缓存、空闲断连、close code 提示把体验和基础设施一起顾到了

这不是最轻的协作实现，但它很符合 Outline 这种“富文本 + 多入口修改 + 长时间停留”的产品形态。

## 建议继续阅读

- 想先理解协作是如何接进编辑器内核的：读 [编辑器架构：基于 Prosemirror 的节点、标记与扩展体系](14-bian-ji-qi-jia-gou-ji-yu-prosemirror-de-jie-dian-biao-ji-yu-kuo-zhan-ti-xi)
- 想看协作下很多 decoration 为什么还要专门处理远端事务：读 [编辑器扩展：代码高亮、数学公式、Mermaid 图表与嵌入组件](16-bian-ji-qi-kuo-zhan-dai-ma-gao-liang-shu-xue-gong-shi-mermaid-tu-biao-yu-qian-ru-zu-jian)
- 想从服务部署角度看 collaboration 进程在整体架构中的位置：读 [后端服务拆分：Web、Collaboration、Websockets、Worker 与 Cron](7-hou-duan-fu-wu-chai-fen-web-collaboration-websockets-worker-yu-cron)
- 想看普通 API 写路径和协作写路径另一端是怎样设计的：读 [API 路由设计：Schema 验证、中间件与错误处理](17-api-lu-you-she-ji-schema-yan-zheng-zhong-jian-jian-yu-cuo-wu-chu-li)
