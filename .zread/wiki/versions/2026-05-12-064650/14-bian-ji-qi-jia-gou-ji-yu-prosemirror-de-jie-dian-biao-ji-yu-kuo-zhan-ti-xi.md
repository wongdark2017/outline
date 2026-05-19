Outline 的编辑器不是“把 ProseMirror 包一层 React”这么简单。它更像一个**扩展驱动的富文本平台**：Node、Mark、Plugin、InputRule、Keymap、Widget、Markdown 解析器、React NodeView、协作插件，最后都被收口进同一条装配链里。你理解了这条链，后面再看评论、高亮、嵌入、表格、协作同步，都会轻松很多。

Sources: [app/editor/index.tsx](app/editor/index.tsx), [shared/editor/lib/ExtensionManager.ts](shared/editor/lib/ExtensionManager.ts), [shared/editor/lib/Extension.ts](shared/editor/lib/Extension.ts), [shared/editor/nodes/index.ts](shared/editor/nodes/index.ts), [app/editor/extensions/index.ts](app/editor/extensions/index.ts), [app/scenes/Document/components/Editor.tsx](app/scenes/Document/components/Editor.tsx)

## 先看总装配图：文档页是怎么把编辑器拼起来的

如果从文档场景入口往下看，主链其实很清楚：

```text
DocumentEditor
  -> 选择扩展集合 withUIExtensions(withComments(richExtensions))
  -> 把扩展、文案、embeds、回调、权限等 props 传给 shared Editor
  -> Editor 创建 ExtensionManager
  -> ExtensionManager 产出 nodes / marks / schema / plugins / commands / parser / serializer
  -> Editor 用这些产物创建 EditorState 和 EditorView
  -> React NodeView 与 Widget 再把复杂节点渲染回 React 世界
```

这个流程说明一件很重要的事：**Outline 编辑器的核心不是某个巨型组件，而是“扩展集合 + 扩展管理器 + 共享 Editor 装配器”三者的配合。**

### 文档场景本身只做装配，不重写编辑器内核

`app/scenes/Document/components/Editor.tsx` 主要负责的是：

- 选择扩展集合
- 接上评论相关回调
- 提供 `dictionary`
- 提供 embed 配置
- 决定是否使用多人协作版本编辑器
- 把标题、元数据、正文区拼成一个完整页面

它没有去改写 ProseMirror 底层，而是把具体产品语境喂给共享 `Editor`。WHY 这样划分合理？因为项目里不止一个地方要用富文本能力，内核应该共享，页面场景只负责装配。

Sources: [app/scenes/Document/components/Editor.tsx](app/scenes/Document/components/Editor.tsx)

## `Extension` 是这套体系真正的统一抽象

### 三类扩展共用同一个祖先概念

在 Outline 里，扩展大致分成三种：

| 类型 | 基类 | 负责什么 |
|---|---|---|
| `extension` | `Extension` | 纯行为层能力，如插件、快捷键、工具栏、协作等 |
| `node` | `Node` | 定义 ProseMirror 节点 schema 与节点行为 |
| `mark` | `Mark` | 定义文本标记 schema 与标记行为 |

但它们最终都共享一组统一能力：

- `plugins`
- `rulePlugins`
- `keys`
- `inputRules`
- `commands`
- `widget`

也就是说，在 Outline 的设计里，“扩展”不是狭义上的 schema 节点，而是**所有可插拔编辑器能力的共同接口**。

### `Extension` 本身并不知道自己要做什么

基类 `Extension` 默认几乎都是空实现：

- `plugins` 返回空数组
- `rulePlugins` 返回空数组
- `widget()` 返回 `undefined`
- `keys()` / `inputRules()` / `commands()` 默认也都是空

这意味着 Outline 并没有把“编辑器必然具备哪些行为”写死在一个巨大类里，而是要求每个扩展按需声明自己贡献什么。

### `allowInReadOnly` 很值得注意

`Extension` 里有个关键属性：`allowInReadOnly`。默认是 `false`。它表达的意思不是“这个扩展能不能存在于 schema 里”，而是：

- 对于纯 `Extension` 类型
- 只在可编辑模式需要的能力
- 在只读模式里可以直接跳过实例化

WHY 这很重要？因为只读态和编辑态在 Outline 里都非常常见，如果每次都把所有编辑辅助扩展一股脑装上，不仅浪费，还会制造行为歧义。

Sources: [shared/editor/lib/Extension.ts](shared/editor/lib/Extension.ts), [shared/editor/nodes/Node.ts](shared/editor/nodes/Node.ts), [shared/editor/marks/Mark.ts](shared/editor/marks/Mark.ts)

## `Node` / `Mark` 把 schema、Markdown 和行为绑定在同一个类上

### `Node` 不只是 schema 定义

`Node` 除了 `schema` 外，还能定义：

- `markdownToken`
- `parseMarkdown()`
- `toMarkdown()`
- `inputRules()`
- `keys()`
- `commands()`

也就是说，一个节点类不只是在声明“文档结构长什么样”，还顺手承担了：

- Markdown 如何进来
- Markdown 如何出去
- 键盘输入怎么触发
- 命令如何暴露

这比把 schema、解析、快捷键、命令拆到四处更容易维护。

### `Mark` 也走同样路线

`Mark` 和 `Node` 的思路一致，只不过默认命令实现会回到 `toggleMark(type, attrs)`。这说明在作者心里，mark 也是一个独立能力单元，而不是“schema 里顺带挂一个对象”。

### `ReactNode` 再补上一层 React 渲染能力

有些节点只需要原生 DOM `toDOM()` 就够了；但像：

- mention
- image
- attachment
- embed
- video

这类节点往往需要：

- 选中态
- hover 状态
- resize 手柄
- 本地按钮
- 更复杂的交互

因此 `ReactNode` 又在 `Node` 基础上增加了 `component(...)`，让节点能被挂成 React NodeView。

Sources: [shared/editor/nodes/Node.ts](shared/editor/nodes/Node.ts), [shared/editor/marks/Mark.ts](shared/editor/marks/Mark.ts), [shared/editor/nodes/ReactNode.ts](shared/editor/nodes/ReactNode.ts)

## 扩展集合是分层组织的，而不是一份平铺大数组

`shared/editor/nodes/index.ts` 很值得认真读，因为它几乎就是编辑器功能地图。

### 共享扩展先按内容形态分组

源码里先组织了几组基础集合：

- `inlineExtensions`
- `listExtensions`
- `tableExtensions`

然后基于这些再组合出：

- `basicExtensions`
- `richExtensions`

例如：

- `basicExtensions` 更偏简单编辑器
- `richExtensions` 则包含代码块、嵌入、附件、公式、mention、toggle block、表格等完整能力

WHY 这样组织比“一个超级数组”更好？因为它让“不同场景想要什么级别的编辑能力”可以通过组合表达，而不是只能全开。

### `withComments()` 是一个很漂亮的装饰器式组合

`withComments(nodes)` 会把：

- `Mention`
- `Comment`

加回一组已有扩展里，并避免 mention 重复。

这说明“评论能力”在 Outline 里不是写死在 rich editor 内核中的，而是作为可叠加的横切能力加上去的。

### app 层再叠加一批 UI 扩展

`app/editor/extensions/index.ts` 里的 `withUIExtensions()` 会继续在共享扩展之上叠加：

- `SmartText`
- `PasteHandler`
- `ClipboardTextSerializer`
- `BlockMenu`
- `EmojiMenu`
- `MentionMenu`
- `FindAndReplace`
- `HoverPreviews`
- `SelectionToolbar`
- `Diagrams`
- `PreventTab`
- `Keys`

这层扩展的意义在于：**共享编辑器核心不直接依赖应用界面，但应用层可以把自己的交互 UI 再盖上去。**

### 文档页真正用的是三层叠加后的结果

文档场景最终选择的是：

```ts
const extensions = withUIExtensions(withComments(richExtensions));
```

这句代码非常能说明设计思路：

1. 先拿共享富文本内容能力
2. 再打开评论/mention
3. 最后再装应用侧菜单、工具条、智能文本等 UI 行为

Sources: [shared/editor/nodes/index.ts](shared/editor/nodes/index.ts), [app/editor/extensions/index.ts](app/editor/extensions/index.ts), [app/scenes/Document/components/Editor.tsx](app/scenes/Document/components/Editor.tsx)

## `ExtensionManager` 是真正的编辑器工厂

如果说扩展类定义了“每个积木长什么样”，那 `ExtensionManager` 就负责把积木装成一台可运行的机器。

### 构造阶段就会处理只读裁剪和 editor 绑定

构造函数支持两种输入：

- 扩展类本身
- 已经实例化的扩展对象

同时它会在只读模式下跳过那些：

- `type === "extension"`
- `allowInReadOnly === false`

的纯行为扩展。随后又会调用 `extension.bindEditor(editor)`，把共享 Editor 实例注入每个扩展。

这一步很重要，因为很多扩展后面都需要访问：

- `this.editor.view`
- `this.editor.schema`
- `this.editor.props`

### 它会从扩展列表里反推 schema

`nodes` getter 会：

1. 过滤出所有 node 扩展
2. 用每个扩展的 `schema` 生成节点映射
3. 再把节点 schema 里 `marks` 字段裁剪成“当前 schema 里真的存在的 marks”

`marks` getter 也会做类似工作，把 `excludes` 里不存在的 mark 过滤掉。

WHY 这个裁剪值得做？因为 Outline 允许按场景组合扩展，不同编辑器实例未必总有同一批 mark。如果不做清理，schema 很容易引用到当前根本没注册的 mark。

### 它同时还负责 Markdown 解析器和序列化器

`serializer()` 会把每个 node/mark 的 `toMarkdown` 收集起来。

`parser()` 会把每个 node/mark 的：

- `parseMarkdown()`
- `markdownToken` 或 `name`

收集成 `MarkdownParser` 的 token 规则。

这意味着 Markdown 能力不是编辑器外部附带的，而是由扩展自己声明，再由管理器统一组装。

### 插件、快捷键、输入规则、命令也都从这里汇总

`ExtensionManager` 还会统一产出：

- `plugins`
- `rulePlugins`
- `keymaps()`
- `inputRules()`
- `commands()`

其中 `commands()` 的包装尤其关键，它会：

1. 先拿到扩展暴露的命令工厂
2. 在执行前检查只读模式是否允许
3. 必要时先 `view.focus()`
4. 再把 `state` / `dispatch` / `view` 真正喂给 ProseMirror command

这让外层调用者看到的是一套统一命令表，而不用关心每个命令背后到底来自 node、mark 还是 extension。

Sources: [shared/editor/lib/ExtensionManager.ts](shared/editor/lib/ExtensionManager.ts)

## 共享 `Editor` 组件负责把产物按正确顺序装起来

`app/editor/index.tsx` 是整个系统的总装配点。

### 初始化顺序非常讲究

`init()` 的顺序是：

1. `createExtensions()`
2. `createNodes()`
3. `createMarks()`
4. `createSchema()`
5. `createPlugins()`
6. `createRulePlugins()`
7. `createSerializer()`
8. `createParser()`
9. `createNodeViews()`
10. `createWidgets()`
11. 如果只读：
    - 不创建 keymaps
    - 不创建 input rules
    - `pasteParser = parser`
12. 如果可编辑：
    - 创建 keymaps
    - 创建 input rules
    - 创建更宽松的 `pasteParser`
13. `createView()`
14. `createCommands()`

这个顺序背后的逻辑很强：

- schema 必须先于 parser / state
- nodeViews 依赖扩展实例和 schema
- commands 依赖已经创建好的 `EditorView`

如果顺序乱掉，后面很多能力根本没法绑定。

### 只读和可编辑是两套不同装配路径

只读模式下，EditorState 只挂：

- 扩展插件
- `anchorPlugin()`

而编辑模式下还会额外挂：

- keymaps
- `dropCursor`
- `gapCursor`
- `inputRules`
- `baseKeymap`

这再次说明只读态不是“把 `editable` 设成 false 就结束了”，而是从装配层面就明确裁掉一批编辑行为。

### 输入内容支持三种表示

`createDocument()` 会接受：

- `ProsemirrorNode`
- Markdown 字符串
- ProseMirror JSON

其中：

- 字符串 -> `parser.parse(...)`
- JSON -> `ProsemirrorNode.fromJSON(schema, content)`
- 节点实例 -> 直接复用

反过来 `value()` 又能把当前文档导出成：

- Markdown 字符串
- 或 JSON

这让 editor 成了多个表示之间的桥，而不是只能吃一种格式。

Sources: [app/editor/index.tsx](app/editor/index.tsx)

## React NodeView 与 Widget 把复杂节点重新拉回 React 世界

ProseMirror 原生 `toDOM()` 足够表达简单结构，但很多富节点需要更多交互，因此 Outline 做了两层桥接。

### `createNodeViews()`：把带 `component` 的扩展接成 NodeView

Editor 会找出所有带 `component` 的扩展，并把它们包进 `ComponentView`。于是：

- ProseMirror 仍然掌握文档结构和选区
- React 组件则负责复杂节点的视觉和交互

这类节点最典型的包括：

- `Mention`
- `Embed`
- `Image`
- `Attachment`
- `Video`

### `widget()`：给编辑器挂“树外 UI”

扩展除了定义节点本身，还可以通过 `widget()` 返回 React 组件。这类 widget 不绑定某个具体节点，常见用途包括：

- 工具条
- 浮层
- 菜单
- 辅助面板

它们会被渲染在 editor context 里，但不属于文档树本身。这让“文档内容”和“围绕文档的编辑 UI”保持了清晰分层。

Sources: [app/editor/index.tsx](app/editor/index.tsx), [shared/editor/nodes/ReactNode.ts](shared/editor/nodes/ReactNode.ts), [shared/editor/lib/Extension.ts](shared/editor/lib/Extension.ts)

## 看几个具体扩展，就能理解这套设计的味道

### `Link` mark：schema、输入规则、点击行为、命令全放在一处

`shared/editor/marks/Link.tsx` 同时做了这些事：

- schema 声明 `href` / `title`
- `toDOM()` 时对 `href` 做 `sanitizeUrl()`
- 定义 `[text](url)` 的输入规则
- 定义 `Mod-Enter` 打开链接
- 暴露 `addLink` / `updateLink` / `removeLink` / `openLink`
- 通过 plugin 区分：
  - 只读态点击应直接跳转
  - 编辑态点击应先选中链接、打开工具条

这就是前面说的：一个 mark 类不是纯 schema，它是该能力的完整封装单元。

### `Heading` node：连折叠、锚点、持久化都绑在节点类里

`Heading` 不只定义了 `level`，还定义了：

- 折叠态 `collapsed`
- `Shift-Ctrl-1~4` 快捷键
- `Enter` / `Backspace` 的行为
- 插件 decoration，为每个标题加锚点按钮和折叠按钮
- 折叠状态通过 `Storage` 做持久化

这说明 Outline 把“标题可折叠的交互”视为标题节点自身的固有行为，而不是额外挂一层页面逻辑。

### `Mention` node：一个节点承载多种资源类型

`Mention` 是很有代表性的 inline atom。它支持：

- User
- Group
- Document
- Collection
- Issue
- Pull Request
- Project
- URL

同一个节点类里既定义了 DOM / Markdown / 命令，也按 type 分发到不同 React 组件渲染，并通过 plugin 保证 mention id 唯一。这说明 node 不是“文档结构的一块砖”，而是有完整业务语义的富对象。

### `Embed` / `Image` / `Attachment` / `Video` 展示了 ReactNode 的价值

这些节点共同体现了几种模式：

- `toDOM()` 仍提供基础 HTML 回退
- 复杂展示走 React `component`
- 大量用户可控 URL 在 `toDOM()` 中显式 `sanitizeUrl()`
- resize / caption / preview / download 等行为都通过节点命令或 node markup 更新实现

这比单纯在 ProseMirror DOM 上硬拼交互稳得多，也更符合 React 项目的维护方式。

Sources: [shared/editor/marks/Link.tsx](shared/editor/marks/Link.tsx), [shared/editor/nodes/Heading.ts](shared/editor/nodes/Heading.ts), [shared/editor/nodes/Mention.tsx](shared/editor/nodes/Mention.tsx), [shared/editor/nodes/Embed.tsx](shared/editor/nodes/Embed.tsx), [shared/editor/nodes/Image.tsx](shared/editor/nodes/Image.tsx), [shared/editor/nodes/Attachment.tsx](shared/editor/nodes/Attachment.tsx), [shared/editor/nodes/Video.tsx](shared/editor/nodes/Video.tsx)

## 插件层处理的是“文档外行为”，不只是 schema

### `CodeHighlighting` 很能体现插件层价值

代码高亮扩展并没有把所有逻辑塞进节点里，而是通过 plugin：

- 懒加载 `refractor`
- 按语言动态导入语法包
- 缓存 decoration
- 在 paste、代码块变化、远程事务时重新计算高亮

这说明插件层最适合承载：

- decoration
- 远程事务感知
- 惰性资源加载
- 与文档结构松耦合的表现逻辑

### 编辑器状态本身也会叠加一批通用插件

可编辑模式下，Editor 还会把这些通用行为挂到 state 上：

- `anchorPlugin()`
- `dropCursor()`
- `gapCursor()`
- `inputRules(...)`
- `baseKeymap`

这让扩展自身的 plugin 和编辑器框架级 plugin 可以在同一处统一装配。

### 主题变化也要显式桥接进编辑器

根应用层的 `Theme` 会派发 `theme-changed` 事件，而 `Editor` 监听后会往 transaction 里写一段 meta。WHY 要这样做？因为编辑器世界里并不是所有视觉更新都天然跟着 React render 走，transaction/meta 是一个更稳定的同步通道。

Sources: [shared/editor/extensions/CodeHighlighting.ts](shared/editor/extensions/CodeHighlighting.ts), [app/editor/index.tsx](app/editor/index.tsx), [app/components/Theme.tsx](app/components/Theme.tsx)

## 协作能力并没有打破这套架构，反而是顺着它叠上去的

多人协作相关能力并不是另起一套编辑器，而是一个普通扩展：

- `app/editor/extensions/Multiplayer.ts`

它通过 `plugins` 注入：

- `ySyncPlugin`
- `yCursorPlugin`
- `yUndoPlugin`

并额外扩展了：

- 远端选区样式
- awareness 过滤
- undo / redo 命令

这说明协作能力在 Outline 里也遵循同一条规则：**不改共享 Editor 的装配方式，只通过 extension 接进去。**

完整的实时同步链路会涉及服务端协作进程、Y.js 文档和持久化，这一页先记住架构位置就够了。

Sources: [app/editor/extensions/Multiplayer.ts](app/editor/extensions/Multiplayer.ts), [shared/editor/lib/multiplayer.ts](shared/editor/lib/multiplayer.ts)

## 这套架构背后的几个关键设计判断

### 1. 先统一扩展接口，再谈功能数量

Outline 的编辑器功能很多，但作者没有先去堆功能，而是先建立：

- Node / Mark / Extension
- ExtensionManager
- shared core + app UI layering

所以功能虽然多，结构仍然能维持清晰。

### 2. 只读态和编辑态从装配层就分开

很多编辑器实现喜欢“所有能力都装上，再靠运行时判断禁用”。Outline 没这么做，而是从扩展实例化和 state plugin 装配时就做裁剪，结果更稳。

### 3. React 只负责自己最擅长的部分

纯文档结构交给 ProseMirror，复杂交互节点交给 React NodeView，树外工具 UI 交给 widget。这是非常务实的分工。

### 4. Markdown、JSON、DOM 之间必须能双向走通

因为 Outline 不只是一个屏幕内编辑器，它还要面对：

- 导入导出
- 粘贴解析
- 协作同步
- 历史版本
- 分享与只读渲染

所以 parser / serializer 被提升成一等公民，而不是附属能力。

### 5. 安全约束直接写进节点实现

像 `Link`、`Embed`、`Mention`、`Image`、`Attachment`、`Video` 这些节点/标记在 `toDOM()` 里都显式调用了 `sanitizeUrl()`。这不是小细节，而是富文本系统必须长期坚持的底线。

## 为什么这套编辑器架构很适合 Outline

Outline 需要的不是一个只会粗粒度编辑文本的控件，而是一套能长期扩展的内容平台，因为它要同时承载：

1. **文档正文编辑**
2. **评论与高亮**
3. **分享只读渲染**
4. **图片、附件、视频、嵌入、公式、Mermaid、表格**
5. **多人协作与远端选区**

在这种前提下，扩展驱动 + 分层装配几乎是必然选择。它成本不低，但后续每加一种富内容能力，都有明确落点。

## 建议继续阅读

- 想看这套编辑器如何接上实时协作：读 [实时协作编辑：Hocuspocus、Y.js CRDT 与 WebSocket 持久化](15-shi-shi-xie-zuo-bian-ji-hocuspocus-y-js-crdt-yu-websocket-chi-jiu-hua)
- 想看嵌入、公式、Mermaid 等具体扩展能力：读 [编辑器扩展：代码高亮、数学公式、Mermaid 图表与嵌入组件](16-bian-ji-qi-kuo-zhan-dai-ma-gao-liang-shu-xue-gong-shi-mermaid-tu-biao-yu-qian-ru-zu-jian)
- 想看编辑器使用的主题 token 和全局样式从哪里来：读 [主题系统与全局样式设计](12-zhu-ti-xi-tong-yu-quan-ju-yang-shi-she-ji)
- 想看传给编辑器的 `dictionary`、`embeds`、评论回调是怎样由页面层组合出来的：读 [React Hooks 工具库：常用自定义 Hooks 详解](13-react-hooks-gong-ju-ku-chang-yong-zi-ding-yi-hooks-xiang-jie)
