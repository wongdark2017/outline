如果第 14 页讲的是编辑器“骨架”怎么搭起来，那这一页讲的就是 Outline 如何把一批真正有产品感的富内容能力塞进这套骨架里：代码高亮、数学公式、Mermaid 图表、diagrams.net、外部嵌入，以及一组带 React 交互的媒体节点。它们不是孤立功能点，而是都沿着同一条扩展链路长出来的。

Sources: [shared/editor/nodes/CodeFence.ts](shared/editor/nodes/CodeFence.ts), [shared/editor/extensions/CodeHighlighting.ts](shared/editor/extensions/CodeHighlighting.ts), [shared/editor/nodes/Math.ts](shared/editor/nodes/Math.ts), [shared/editor/nodes/MathBlock.ts](shared/editor/nodes/MathBlock.ts), [shared/editor/extensions/Mermaid.ts](shared/editor/extensions/Mermaid.ts), [shared/editor/extensions/Diagrams.ts](shared/editor/extensions/Diagrams.ts), [shared/editor/embeds/index.tsx](shared/editor/embeds/index.tsx)

## 先看这几类扩展分别落在哪一层

先把这些能力和落点对齐，会更容易读：

| 能力 | 主要落点 | 典型职责 |
|---|---|---|
| 代码块与代码高亮 | `CodeFence`、`CodeBlock`、`CodeHighlighting` | schema、语言属性、快捷键、语法高亮 decoration |
| 数学公式 | `Math`、`MathBlock`、`Math` plugin | inline / block 公式节点、输入规则、KaTeX NodeView |
| Mermaid 图表 | `CodeFence` + `Mermaid` plugin | 把特定语言的 code fence 渲染成图表预览 |
| diagrams.net | `Diagrams` extension + `Image` node | 弹窗编辑、导出 SVG/PNG、上传、回写图片节点 |
| 外部嵌入 | `EmbedDescriptor`、`Embed` node、`useEmbeds` | URL 匹配、iframe 或自定义组件渲染、团队级禁用/配置 |
| 媒体与复杂节点 | `Image`、`Attachment`、`Video`、`Mention` | React NodeView、选中态、尺寸、下载、预览 |

这张表背后的重点是：**Outline 不是为每种富内容重新造一套机制，而是让不同能力各自占住 schema、plugin、command、ReactNodeView 里合适的位置。**

## 代码块：`CodeFence` 是一整套能力包，而不只是一个节点

### schema 只是一部分

`shared/editor/nodes/CodeFence.ts` 定义的 schema 很直接：

- `language`
- `wrap`
- 内容是 `text*`
- group 是 `block`
- `code: true`

但真正重要的是，它同时还带着：

- 输入规则
- 快捷键
- 命令
- collapse 状态插件
- 代码高亮插件
- Mermaid 插件

这正好说明第 14 页的一个核心观点：节点类不是只管 ProseMirror schema，它是“该类富内容能力的总封装入口”。

### 语言和换行方式都属于节点属性

当前代码块节点最核心的两个 attrs：

- `language`
- `wrap`

WHY 这样设计值？因为：

- 高亮依赖语言
- UI 层要知道是否自动换行
- Markdown 序列化和菜单项也会依赖这些信息

把它们放在节点 attrs 上，后面 plugin、toolbar、render 样式都能直接消费。

### 代码块命令会记住最近一次使用的语言

`code_block` 命令不是每次都裸创建一个节点，而是会：

- 先读取 `getRecentlyUsedCodeLanguage()`
- 或回退到 `DEFAULT_LANGUAGE`
- 再切换块类型

这个细节很有产品感。WHY？因为用户连续插多个代码块时，最常见的行为就是复用同一种语言。把这个偏好沉到节点命令层，比每次都在菜单交互里重新点更顺手。

Sources: [shared/editor/nodes/CodeFence.ts](shared/editor/nodes/CodeFence.ts), [shared/editor/nodes/CodeBlock.ts](shared/editor/nodes/CodeBlock.ts)

## 代码块的 UI 并不只是高亮，还包括折叠和行号

### 折叠状态是插件态，不是节点 attrs

`CodeFence` 内部有一个 `collapseKey` 对应的插件状态，维护：

- 哪些块行数超过阈值
- 哪些块已被折叠
- 与之对应的 node/widget decorations

WHY 没把“是否折叠”写回文档 attrs？因为它更像当前阅读/编辑会话里的视图偏好，而不是文档语义本身。

### 折叠按钮和折叠样式都走 decorations

折叠态通过：

- `Decoration.node(...)` 加 `collapsed` class
- `Decoration.widget(...)` 插入展开/收起按钮

这是一种典型的 ProseMirror 做法：**文档内容不变，视图层叠出额外控制 UI**。

### 行号又和用户偏好绑定

`showLineNumbers` 来自：

- `userPreferences?.codeBlockLineNumbers ?? true`

也就是代码块的最终样子不只取决于节点本身，还会受到用户偏好影响。这进一步说明 Outline 的富内容实现一直在把：

- 文档语义
- 视图偏好
- 编辑器插件态

分开。

Sources: [shared/editor/nodes/CodeFence.ts](shared/editor/nodes/CodeFence.ts)

## `CodeHighlighting`：语法高亮是 decoration 插件，不是节点渲染逻辑

### 为什么高亮逻辑不写在 `CodeFence` 的 `toDOM()` 里

代码高亮依赖的是：

- 语言动态加载
- 文本内容变化
- decoration 重算
- 远端协作事务

它本质上是一个“随着文档状态不断重绘的表现层能力”，更适合独立成 plugin，而不是塞进节点 DOM 静态输出。

### 它按需加载 `refractor` 和语法包

`CodeHighlighting` 会：

1. 惰性加载 `refractor/core`
2. 根据语言名找 loader
3. 动态 import 对应语言定义
4. 注册后再生成 decorations

WHY 要做到这么细？因为支持语言很多，如果启动时一次性把全部高亮语言打进包里，体积和初始化成本都会变差。

### decorations 会做缓存，不是每次都全量重算

插件内部按 `block.pos` 缓存：

- 上次的 node
- 对应 decorations

只有在：

- 节点内容真的变了
- 语言包刚加载好
- paste
- 远端事务

这类情况下才会重建。这说明高亮系统不只是追求功能完整，也在明显压重算成本。

### 协作事务会强制重算高亮

插件在这些情况下会重新生成高亮：

- `transaction.docChanged`
- paste
- `langLoaded`
- `isRemoteTransaction(transaction)`

WHY 要特别点名 remote transaction？因为多人协作下，本地没输入代码，但远端可能刚改了一段代码内容。如果不把远端事务也纳入高亮重算触发条件，别人输入的代码可能不会立即着色。

Sources: [shared/editor/extensions/CodeHighlighting.ts](shared/editor/extensions/CodeHighlighting.ts), [shared/editor/lib/multiplayer.ts](shared/editor/lib/multiplayer.ts)

## Mermaid：这不是独立节点，而是“特殊代码块的第二视图”

Mermaid 在 Outline 里的设计非常巧，不是定义一个全新的 `mermaid` node，而是复用了 code fence。

### Mermaid 的语义仍然是代码块

判断方式来自：

- `isCode(node)`
- `isMermaid(node)`

也就是说，一个 Mermaid 图本质上还是一段带特定 language 的代码块。WHY 这样设计好？

- Markdown 里本来就是 fenced code block
- 文本源和图表预览需要可来回切换
- 编辑态仍然应该是“编辑源代码”

如果直接做成独立 diagram node，反而会把“源码”和“渲染图”拆裂。

### `Mermaid` plugin 自己维护编辑态和预览态

插件 state 里会记录：

- `decorationSet`
- `isDark`
- `editingId`

其中 `editingId` 决定当前某个 Mermaid 块是否处于“源码编辑”状态。它的要点不是文档结构改变，而是**同一块内容在源码编辑视图和图表预览视图之间切换**。

### 渲染图表用的是 widget decoration

每个 Mermaid 块旁边会被插入一个 widget，里面用 `MermaidRenderer` 异步生成 SVG。这个 renderer 会：

- 动态加载 `mermaid`
- 按当前主题决定 `dark/default`
- 注册 ELK layout loader
- 注册 FontAwesome icon pack
- 把生成的 SVG 缓存到 `sessionStorage`

这套实现说明 Mermaid 预览不是轻量小插件，而是完整的异步渲染子系统。

### 主题切换会重新渲染图表

插件会读 transaction meta 里的：

- `theme`

一旦暗色状态变化，就重建图表 preview。WHY？因为 Mermaid 图的配色本身就会受 theme 影响，不能只改页面背景而不重绘图表。

### 新建空 Mermaid 图时会自动进入编辑

如果刚创建的是一个空的 Mermaid 块，插件会自动把 `editingId` 设成当前块，直接进入源码编辑态。这是个很小但很好的细节，避免用户插入一个空图后还要多一步“切到编辑模式”。

Sources: [shared/editor/extensions/Mermaid.ts](shared/editor/extensions/Mermaid.ts), [shared/editor/lib/isCode.ts](shared/editor/lib/isCode.ts), [app/components/Theme.tsx](app/components/Theme.tsx)

## Mermaid 的命令入口其实还挂在 `CodeFence` 上

虽然 Mermaid 自己是个 plugin，但切换编辑态的命令入口来自：

- `CodeFence` 暴露的 `edit_mermaid`

同时 app 侧代码菜单也会根据当前块是不是 Mermaid、是不是正在编辑，决定显示：

- `edit_mermaid`
- 或普通代码块操作

这说明 Mermaid 虽然是插件，但它不是一个孤立世界，而是和代码块菜单、节点命令层紧密耦合的。

Sources: [shared/editor/nodes/CodeFence.ts](shared/editor/nodes/CodeFence.ts), [app/editor/menus/code.tsx](app/editor/menus/code.tsx)

## 数学公式：复用 `prosemirror-math`，但仍走 Outline 自己的扩展体系

### inline 和 block 公式是两个独立节点

当前用的是：

- `Math` -> `math_inline`
- `MathBlock` -> `math_block`

二者都直接复用 `@benrbray/prosemirror-math` 的 schema 片段。这说明 Outline 对这类成熟但结构固定的富文本能力，优先选择复用现有规范，而不是再自己造 schema。

### 输入规则贴近 Markdown 直觉

数学公式对应的典型输入方式是：

- `$...$` -> inline math
- `$$...$$` -> block math

这部分分别由：

- `REGEX_INLINE_MATH_DOLLARS`
- `REGEX_BLOCK_MATH_DOLLARS`

和对应 rule plugin 驱动。

### 公式真正怎么显示，由 `Math` plugin 提供 NodeView

`shared/editor/extensions/Math.ts` 里通过 `MathView` 注册：

- `math_inline`
- `math_block`

两个 nodeViews。首次用到时还会动态加载：

- `katex/dist/katex.min.css`

WHY 这里还是走 NodeView？因为数学公式的展示和源码编辑要在同一节点上来回切换，纯 `toDOM()` 很难优雅处理这类交互。

### 代码块中不会误触公式输入规则

inline math 的 input rule 明确先检查：

- `isInCode(state)`

如果当前在 code context，就直接跳过。这个边界很关键，否则用户在代码块里输入 `$...$` 很容易被错误转成公式。

Sources: [shared/editor/nodes/Math.ts](shared/editor/nodes/Math.ts), [shared/editor/nodes/MathBlock.ts](shared/editor/nodes/MathBlock.ts), [shared/editor/extensions/Math.ts](shared/editor/extensions/Math.ts), [shared/editor/rules/math.ts](shared/editor/rules/math.ts)

## diagrams.net：把外部图形编辑器变成图片节点的上游

Mermaid 是“代码转图”；diagrams.net 则是另一条路：**打开外部图形编辑器，最后回写为图片节点。**

### `Diagrams` extension 暴露的是一个编辑命令

它的核心命令叫：

- `editDiagram`

执行时会先看当前是否选中了 image node：

- 如果选中了，就编辑现有图
- 如果没选中，就先插入一个空的 diagrams placeholder image

也就是说 diagrams.net 在文档结构层面的落点，其实是：

- `image` node

而不是一个专门的 `diagram` node。

### 与 diagrams.net 的通信是显式协议，不是 iframe 内嵌偷用

`DiagramsNetClient` 会：

- `window.open(url)`
- 监听 `message`
- 处理 `init` / `save` / `export` / `exit`

并通过 postMessage 发送：

- `load`
- `export`

动作。WHY 这么做？因为 diagrams.net 本质上是一个独立应用，Outline 这里只是把它当成外部编辑器宿主。

### 导出结果会重新上传，再更新 image node

一旦收到 diagrams 导出的 base64：

1. 转成 SVG 或 PNG `File`
2. 获取尺寸
3. 走现有 `uploadFile()` 上传
4. 根据旧 `src` 在当前文档里找到对应 image node
5. 用新的 `src/width/height/source` 更新节点

这说明 diagrams.net 不是“嵌在文档里实时编辑”的模型，而是“外部编辑 -> 生成媒体资源 -> 回写到图片节点”。

### 为什么仍然值得放进 extension 体系

虽然 diagrams.net 是外部工具，但它仍通过 editor extension 接进来，结果是：

- 命令栏/菜单可以统一触发它
- 上传链路复用现有附件系统
- 图仍然落回标准 image node

这就是扩展体系真正的价值：外部工具也能被纳入统一内容流。

Sources: [shared/editor/extensions/Diagrams.ts](shared/editor/extensions/Diagrams.ts), [shared/editor/lib/DiagramsNetClient.ts](shared/editor/lib/DiagramsNetClient.ts), [shared/editor/components/DiagramPlaceholder.tsx](shared/editor/components/DiagramPlaceholder.tsx)

## Embed 注册表：外部内容接入的核心不是 node，而是 descriptor

### `EmbedDescriptor` 是 embed 体系真正的起点

`shared/editor/embeds/index.tsx` 里维护了一长串 `EmbedDescriptor`。每个 descriptor 可以声明：

- `id`
- `title`
- `name`
- `regexMatch`
- `transformMatch`
- `component`
- `keywords`
- `settings`
- `disabled`

也就是说，外部内容接入先是“一个 URL 匹配与渲染规则”，再由节点系统去消费。

### 两种主要渲染策略

一个 embed 通常会走两种方式之一：

1. 只需要 iframe  
   这种就提供 `transformMatch()`，把原 URL 变成 iframe `src`

2. 需要自定义表现  
   这种就提供 React `component`

这让简单接入和复杂接入都能共存，而不需要把所有 embed provider 都写成同一种重量级组件。

### `Embed` node 负责把 URL 变成真正的文档节点

`shared/editor/nodes/Embed.tsx` 做的事情包括：

- schema 声明 `href/width/height`
- `toDOM()` 时决定渲染 iframe 还是 fallback link
- command 支持直接插入 embed
- 还支持把一个 list 里的多条 URL 批量转成 embeds

这说明 embed registry 负责“描述规则”，而 `Embed` node 负责“文档落地”。

Sources: [shared/editor/embeds/index.tsx](shared/editor/embeds/index.tsx), [shared/editor/embeds/index.tsx](shared/editor/embeds/index.tsx), [shared/editor/nodes/Embed.tsx](shared/editor/nodes/Embed.tsx), [shared/editor/lib/embeds.ts](shared/editor/lib/embeds.ts)

## 团队配置还能在运行时改写 embed 能力

Embed 能力不是纯静态的。`useEmbeds()` 会把共享 embed 列表再结合：

- 当前团队的 Integration 设置
- `TeamPreference.DisabledEmbeds`

做二次加工：

- 如果某个 integration 匹配 service，就把 `settings` 注入 descriptor
- 如果被团队禁用，就把 `disabled = true`

WHY 这是个好设计？因为它把“技术上支持哪些 embed provider”和“这个团队实际允许哪些 provider”分开了。代码库里可以支持很多外部服务，但管理员可以在工作区级别裁掉不想开放的那部分。

Sources: [app/hooks/useEmbeds.ts](app/hooks/useEmbeds.ts), [shared/editor/embeds/index.tsx](shared/editor/embeds/index.tsx)

## 复杂媒体节点几乎都走 React NodeView

这一页虽然重点在 code/math/diagram/embed，但再看一眼 `Image`、`Attachment`、`Video`，会更能理解 Outline 的总体风格。

### `Image`

图片节点除了 `src/width/height` 外，还要处理：

- caption
- layout class
- 评论 mark
- lightbox
- 键盘交互
- 图像替换与下载

### `Attachment`

附件节点要处理：

- PDF preview
- 下载
- 双击替换
- 上传中占位

### `Video`

视频节点要处理：

- caption 编辑
- 节点选中态
- 尺寸变更

这些能力如果都靠静态 `toDOM()` 直接拼 HTML，会很难维护。所以 Outline 明显倾向于：

- 文档结构仍由 ProseMirror node 管
- 复杂交互交给 React component / NodeView

Sources: [shared/editor/nodes/Image.tsx](shared/editor/nodes/Image.tsx), [shared/editor/nodes/Attachment.tsx](shared/editor/nodes/Attachment.tsx), [shared/editor/nodes/Video.tsx](shared/editor/nodes/Video.tsx)

## 安全边界直接写进节点与标记实现

这类富内容能力还有一个很重要的共同点：`toDOM()` 里大量显式调用了：

- `sanitizeUrl()`

比如：

- `Link`
- `Embed`
- `Mention`
- `Image`
- `Attachment`
- `Video`

WHY 这里必须强制做？因为这些节点很多都会把用户可控 URL 直接写到真实 DOM 属性里。对富文本系统来说，渲染能力越强，越要把安全防线写在最底层，而不是指望调用者记得手工过滤。

Sources: [shared/editor/marks/Link.tsx](shared/editor/marks/Link.tsx), [shared/editor/nodes/Embed.tsx](shared/editor/nodes/Embed.tsx), [shared/editor/nodes/Mention.tsx](shared/editor/nodes/Mention.tsx), [shared/editor/nodes/Image.tsx](shared/editor/nodes/Image.tsx), [shared/editor/nodes/Attachment.tsx](shared/editor/nodes/Attachment.tsx), [shared/editor/nodes/Video.tsx](shared/editor/nodes/Video.tsx)

## 为什么这套“高级扩展”设计很适合 Outline

Outline 的富文本不是传统意义上的“加粗、斜体、标题”就结束了，它需要同时满足：

1. **技术内容写作**  
   代码块、高亮、数学公式、Mermaid 都是基础能力。

2. **产品文档与协作场景**  
   需要嵌入外部服务、附件、图片、视频、引用。

3. **团队级配置**  
   不是所有 embed provider 都该默认开放。

4. **多人协作**  
   远端事务到来时，这些预览和 decorations 还得继续正确工作。

在这些要求下，Outline 这套做法的优点很明确：

- 文档结构和 UI 表现分层
- 简单 provider 走 descriptor + iframe
- 复杂能力走 plugin + React NodeView
- 协作事务能被 decoration 类扩展识别
- 团队配置又能在运行时改写能力边界

所以你看到的不是“一组零碎 feature”，而是一套被同一架构约束住的扩展系统。

## 建议继续阅读

- 想先回到这套扩展系统的总骨架：读 [编辑器架构：基于 Prosemirror 的节点、标记与扩展体系](14-bian-ji-qi-jia-gou-ji-yu-prosemirror-de-jie-dian-biao-ji-yu-kuo-zhan-ti-xi)
- 想看代码高亮、Mermaid 这些插件为什么要关心远端事务：读 [实时协作编辑：Hocuspocus、Y.js CRDT 与 WebSocket 持久化](15-shi-shi-xie-zuo-bian-ji-hocuspocus-y-js-crdt-yu-websocket-chi-jiu-hua)
- 想看团队级 embed 配置和集成设置从哪里来：读 [插件系统：客户端与服务端的扩展机制](8-cha-jian-xi-tong-ke-hu-duan-yu-fu-wu-duan-de-kuo-zhan-ji-zhi)
- 想看这些扩展最终怎样通过 API、上传和请求层接到后端：读 [API 客户端：请求封装、错误处理与 CSRF 防护](11-api-ke-hu-duan-qing-qiu-feng-zhuang-cuo-wu-chu-li-yu-csrf-fang-hu)
