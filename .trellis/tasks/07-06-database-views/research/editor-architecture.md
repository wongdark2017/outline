# Research: Outline 编辑器扩展架构（为"数据库表格块"做准备）

- **Query**: shared/editor 扩展基础、table 节点实现、复杂交互节点先例、块菜单注册、文档存储与 server 端解析
- **Scope**: internal
- **Date**: 2026-07-06

---

## 1. shared/editor 扩展体系

### 1.1 目录结构

```
shared/editor/
├── nodes/        # 节点扩展（Node/ReactNode 子类），index.ts 定义 basic/rich 预设
├── marks/        # 标记扩展（Mark 子类）
├── extensions/   # 纯行为扩展（无 schema，只有 plugins/keys/inputRules），如 Mermaid、History
├── commands/     # 可复用 ProseMirror 命令（table.ts、insertFiles.ts 等）
├── components/   # React 组件（被 ReactNode.component 引用），如 Video、Embed、Caption
├── plugins/      # 独立 ProseMirror Plugin（FixTablesPlugin、PlaceholderPlugin 等）
├── embeds/       # EmbedDescriptor 注册表（第三方服务 iframe 嵌入）
├── rules/        # markdown-it 规则插件（rulePlugins），用于 Markdown 解析
├── queries/      # 状态查询工具（findParentNode、isInList 等）
├── lib/          # Extension 基类、ExtensionManager、markdown 序列化器、multiplayer 工具
└── styles/       # EditorStyleHelper 等样式常量
```

### 1.2 基类

| 文件 | 关键点 |
|---|---|
| `shared/editor/lib/Extension.ts:15` | `Extension<TOptions>` 基类。可覆写：`get name`、`get plugins`（ProseMirror 插件，:38）、`get rulePlugins`（markdown-it 插件，:42）、`widget()`（在编辑器 React 树中渲染的全局组件，:70）、`keys()`（快捷键，:79）、`inputRules()`（:92）、`commands()`（:105）。`allowInReadOnly`（:55）控制只读模式是否实例化 |
| `shared/editor/nodes/Node.ts:14` | `Node` 抽象类，扩展了 `get schema(): NodeSpec`（:21）、`toMarkdown()`（:48，必须实现，否则序列化抛错）、`parseMarkdown(): ParseSpec`（:52）、`markdownToken`（:29） |
| `shared/editor/nodes/ReactNode.ts:4-10` | `ReactNode` 抽象类 = `Node` + `abstract component: (props) => React.ReactElement`。**有 `component` 属性即自动获得 React NodeView** |
| `shared/editor/marks/Mark.ts` | Mark 基类（结构与 Node 类似） |

### 1.3 注册管线：ExtensionManager

`shared/editor/lib/ExtensionManager.ts:17` 收集扩展类数组并派生一切：

- `get nodes`（:78）/ `get marks`（:100）→ 构建 ProseMirror `Schema`
- `serializer()`（:122）→ MarkdownSerializer（聚合各扩展 `toMarkdown`）
- `parser()`（:146）→ MarkdownParser（聚合 `parseMarkdown` + `rulePlugins`）
- `get plugins`（:176）、`keymaps()`（:194）、`inputRules()`（:212）、`commands()`（:238，命令自动绑定 view/dispatch 并暴露为 `editor.commands[name]`）
- `get widgets`（:64）→ 自动用 mobx `observer` 包装

节点预设：`shared/editor/nodes/index.ts` — `inlineExtensions`（:55）、`basicExtensions`（:97）、`richExtensions`（:103，完整文档编辑器用）、`tableExtensions`（:84，注意注释：Table 必须放在 TableCell/TableHeader 之后以保证插件注册顺序）。文档场景组装：`app/scenes/Document/components/Editor.tsx:43` `withUIExtensions(withComments(richExtensions))`；UI 扩展列表在 `app/editor/extensions/index.ts`（BlockMenu、SelectionToolbar、Multiplayer 等）。

### 1.4 React NodeView 机制（关键）

- `app/editor/index.tsx:445-467` `createNodeViews()`：遍历所有含 `component` 属性的扩展，为每个 node type 注册 `NodeViewConstructor`，构造 `ComponentView`。
- `app/editor/components/ComponentView.tsx:24`：实现 ProseMirror NodeView 接口。创建 `div`/`span` 容器（inline 判断在 :67），通过 `NodeViewRenderer` 渲染 React；`update()`（:82）按 node type 和 `attrs.id` 判断复用；`stopEvent()`（:150）默认拦截除 mousedown/drag/drop 外的所有事件（即 React 组件内部交互不会传给 ProseMirror）；`ignoreMutation()`（:163）恒 true。
- `app/editor/components/NodeViewRenderer.tsx:6`：mobx observable props + `createPortal` 渲染进 NodeView 的 DOM 元素；所有 renderer 汇入 `editor.renderers`（`app/editor/index.tsx:254`），在编辑器 render 中统一挂载（:1145）——即 NodeView 是 React Portal，共享主 React 树 context。
- 组件收到的 props：`ComponentProps`（`shared/editor/types.ts`）= `{ node, view, isSelected, isEditable, getPos, decorations }`。
- 非 React 的原生 NodeView 也存在：`TableView`（见下）、`ToggleBlockView`、`CheckboxListView`（通过 plugin 的 `nodeViews` prop 或 `columnResizing({ View })` 注册）。

---

## 2. 现有 table 节点实现

| 文件 | 内容 |
|---|---|
| `shared/editor/nodes/Table.ts:56` | Table 节点。schema（:61）：`content: "tr+"`, `tableRole: "table"`, `isolating: true`, group block，唯一 attr 是 `layout`（全宽布局）。commands（:88）：createTable/sortTable/增删行列/合并拆分/背景色等（实现在 `shared/editor/commands/table.ts`，约 40 个命令）。keys（:118）：Tab 导航等。inputRules（:140）：输入 `\|--` 建表。plugins（:161）：prosemirror-tables 的 `columnResizing({ View: TableView })` + `tableEditing()` + `FixTablesPlugin` + `TableLayoutPlugin` |
| `shared/editor/nodes/TableView.ts:7` | 继承 prosemirror-tables 的 `TableView`（原生 DOM NodeView，非 React），加滚动容器、滚动阴影、sticky header |
| `shared/editor/nodes/TableCell.ts` / `TableHeader.ts` / `TableRow.ts` | 单元格/表头/行节点；cell attrs 含 colspan/rowspan/colwidth/背景；含行列 grip 选择插件 |
| `shared/editor/commands/table.ts` | 所有表格命令（sortTable、moveTableRow/Column、exportTable 等） |
| `shared/editor/rules/tables.ts` | markdown-it 表格解析规则（GFM 表格 round-trip） |
| `app/editor/menus/table.tsx`、`tableRow.tsx`、`tableCol.tsx` | 表格悬浮工具栏菜单 |

**局限**：内容是纯 ProseMirror 富文本网格（tr/td），无字段类型、无行记录模型、无筛选/多视图；`sortTable` 只是一次性重排文档节点；数据即文档内容，没有独立数据层。

---

## 3. 复杂交互节点先例

### 3.1 ReactNode + atom（最接近数据库块的模式）

- **Video** `shared/editor/nodes/Video.tsx:20`：schema `atom: true`（:54）+ attrs（id/src/width/height/title）。`component`（:166）渲染 React 播放器 + Caption。**attrs 持久化范式**：交互回调里 `view.dispatch(tr.setNodeMarkup(getPos(), undefined, {...node.attrs, width, height}))`（:98-114）——所有持久状态都放 attrs，通过事务写回文档。
- **Attachment** `shared/editor/nodes/Attachment.tsx:28`：atom 节点（:66），component（:143）渲染文件卡片/PDF 预览。
- **Embed** `shared/editor/nodes/Embed.tsx:24`：atom 节点，attrs `{href,width,height}`；component（:121）从 `editor.props.embeds`（EmbedDescriptor 注册表 `shared/editor/embeds/index.ts`）匹配渲染 iframe；`toDOM`（:69）提供只读/复制时的静态 fallback。commands（:134）演示了 `replaceSelectionWith(type.create(attrs))` 的标准插入命令。
- **Emoji / Mention / MemoTag**：inline atom ReactNode 例子。

### 3.2 Decoration widget 模式（Mermaid）

`shared/editor/extensions/Mermaid.ts`（607 行，纯 Extension 无 schema）：不建新节点，而是复用 `code_fence` 节点（language=mermaidjs），用 Plugin state 维护 `DecorationSet`，对每个 mermaid 代码块附加 `Decoration.widget`（:329）挂载 `MermaidRenderer`（:131，直接操作 DOM 注入 SVG，带 localStorage 缓存 :32）。协同兼容：用 `isRemoteTransaction`（`shared/editor/lib/multiplayer.ts`）区分远端事务、`mapDecorations` 在事务间映射 decoration 位置。**数据 = code fence 的文本内容**，因此 Y.js 文本同步天然生效。

- **CodeFence** `shared/editor/nodes/CodeFence.ts`（707 行）：也是 decoration 密集型（语法高亮、复制按钮、折叠按钮均为 widget decoration），非 React NodeView。

### 3.3 Y.js 协同

- `app/editor/extensions/Multiplayer.ts:36`：注册 `ySyncPlugin(type)` / `yCursorPlugin` / `yUndoPlugin`（:119-124）。y-prosemirror 自动把整个 ProseMirror 文档（含所有节点 attrs 与内容）映射为 Y.XmlFragment——**自定义节点无需额外协同代码，attrs 修改会自动同步**；但 atom 节点的 attrs 是整体替换语义（并发编辑同一 attr 是 last-writer-wins，不是细粒度合并）。
- widget/decoration 不进入 Y 文档；只有 schema 内容和 attrs 会同步。

---

## 4. 块菜单 / 斜杠命令注册

- 触发：`app/editor/extensions/BlockMenu.tsx:13` `BlockMenuExtension extends Suggestion`，trigger 为 `/`（:16）；基类 `app/editor/extensions/Suggestion.ts:43` 处理触发正则与打开状态；`widget`（BlockMenu.tsx:109）渲染菜单 UI。
- 菜单项定义：`app/editor/menus/block.tsx:44` `blockMenuItems(t, documentRef)` 返回 `MenuItem[]`（`{name, title, icon, keywords, shortcut, attrs}`）。**新增块 = 在此数组加一项**。
- 执行：`app/editor/components/SuggestionsMenu.tsx:294-312` `insertNode()`：先查 `commands[item.name]`，否则调 `commands["create" + Capitalize(name)]`，attrs 透传——即节点扩展需提供同名 command（如 Table 的 `createTable`）。菜单项过滤逻辑在 :645-657（无对应 command 的项会被隐藏）。
- 选区工具栏（转换已有块）：`app/editor/extensions/SelectionToolbar.tsx` + `app/editor/menus/*.tsx`。

---

## 5. 文档存储与 server 端解析

- **模型** `server/models/Document.ts`：
  - `text`（:341，TEXT）：Markdown，已标记 @deprecated;
  - `content`（:353，JSONB）：ProseMirror JSON 快照（`ProsemirrorData` 类型在 `shared/types.ts`）；
  - `state`（:365，BLOB）：Y.js CRDT 状态（`Y.encodeStateAsUpdate`），协作的事实源。
- **协作持久化**：`server/collaboration/PersistenceExtension.ts:40-95` 加载时优先用 `state`，否则从 `content`/`text` 经 `ProsemirrorHelper.toYDoc` 重建；保存走 `server/commands/documentCollaborativeUpdater.ts:52-53`：`state = Y.encodeStateAsUpdate(ydoc)`、`content = yDocToProsemirrorJSON(ydoc, "default")`，两者同时落库。
- **server 端 schema**：`server/editor/index.ts:22-41` 用**同一套 shared 扩展**（`withComments(richExtensions)`）在 Node 端构建 Schema/parser/serializer（stub editor :19）。因此**新增节点会同时进入 server schema**，server 才能解析/导出/索引含该节点的文档。
- 解析入口：`server/models/helpers/DocumentHelper.tsx`（toProsemirror/toMarkdown/toHTML 等）；`shared/utils/ProsemirrorHelper.ts` 提供共享遍历工具。

---

## 6. 若要嵌入"数据库块"，编辑器侧要做什么（要点清单）

1. **新建节点** `shared/editor/nodes/DatabaseView.tsx`（建议继承 `ReactNode`）：
   - schema：`group: "block"`, `atom: true`, `selectable: true`, `defining: true`；attrs 存配置（如 `id`、视图设置，或字段/行数据本体——见第 4 点权衡）；提供 `toDOM` 静态 fallback（只读/复制场景）与 `parseDOM`。
   - `component`：React 表格 UI；交互写回统一走 `tr.setNodeMarkup(getPos(), undefined, newAttrs)`（参照 Video.tsx:98-114）；`ComponentView.stopEvent` 已默认放行组件内部事件。
   - 必须实现 `toMarkdown`（fallback 序列化，如链接或 GFM 表格快照）与 `parseMarkdown`；若需 Markdown round-trip 还要加 `rules/` 下的 markdown-it 规则（参照 Video 的 attachmentsRule）。
2. **注册**：加入 `shared/editor/nodes/index.ts` 的 `richExtensions`（自动进入 web 端和 `server/editor/index.ts` 的 server schema，两端 schema 必须一致，否则协作/持久化会丢节点）。
3. **命令与菜单**：在节点 `commands()` 里提供 `createDatabase`（或同名 `database`）命令（参照 Embed.tsx:134 的 `replaceSelectionWith`）；在 `app/editor/menus/block.tsx` 加 MenuItem 即出现在 `/` 菜单。
4. **数据存放的两种先例路径**：
   - a) 数据全在文档内（attrs JSON 或子节点结构，像 table 那样）：随 Y.js 自动协同，但 atom attrs 并发是整体覆盖，细粒度协同需把行/单元格建为 schema 子节点；
   - b) 数据在服务端独立模型，节点只存 `documentId/viewId` 引用（像 Attachment 只存 href/id）：编辑器组件通过 API/store 拉取，协同由服务端处理——这需要 server 侧新模型+API（超出编辑器范围）。
5. **协同**：走路径 a 时无需额外代码（ySyncPlugin 自动同步节点与 attrs）；若组件内做 DOM 级异步渲染，参考 Mermaid 的 `isRemoteTransaction`/`mapDecorations` 处理远端事务。
6. **只读/导出链路**：确认 `DocumentHelper.toHTML/toMarkdown`、分享页、全文索引对新节点的降级表现（`leafText` 可提供纯文本表示，参照 Video.tsx:85）。

## Caveats / Not Found

- 未发现任何现成的"多视图数据表/字段类型"雏形；最接近的仅是 prosemirror-tables 富文本表格。
- `.trellis/spec/frontend|backend/` 下无编辑器专项 spec，只有通用组件/状态管理规范。
- plugins/ 目录（仓库根）为服务端插件体系（认证/存储等），与编辑器节点扩展无关，不能用于注册编辑器节点。
