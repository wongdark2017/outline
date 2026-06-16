## 上下文

Outline 当前编辑器不是外部 `rich-markdown-editor` 组件，而是仓库内自维护的 ProseMirror 平台。`app/editor/index.tsx` 使用 `ExtensionManager` 组装 schema、plugins、keymaps、NodeViews、Markdown parser/serializer，再手动创建 `EditorView`。`shared/editor/nodes/index.ts` 中存在大量自定义节点和 mark 名称，例如 `container_notice`、`container_toggle`、`checkbox_item`、`code_inline`、`td`、`th` 和 `tr`。

协作层当前使用 Hocuspocus 1.1.3、Yjs 和 `y-prosemirror`。服务端持久化依赖 Yjs fragment 名称 `"default"`：加载时从 `Document.state` 应用 Yjs update，保存时使用 `yDocToProsemirrorJSON(ydoc, "default")` 得到 `Document.content`。因此 Tiptap 迁移的首要约束是保持 ProseMirror JSON、Yjs binary state、fragment 名和 Markdown 输出契约不变。

当前 npm 元数据也显示 Tiptap 版本族需要先决策：Tiptap v3 已是 `@tiptap/react` latest，但 `@tiptap/extension-collaboration-cursor` latest 仍处于 v2 线。Tiptap v2 是更保守的候选，但仍然必须验证 `@tiptap/pm` 与项目现有 `prosemirror-*` 依赖不会产生重复运行时实例。

## 目标 / 非目标

**目标：**

- 在有时间盒的 spike 中量化 Tiptap 迁移可行性和工作量。
- 给出 Tiptap v2/v3 版本族建议，并记录选择理由。
- 验证 `@tiptap/pm` 与直接 `prosemirror-*` 导入的构造函数身份一致性。
- 使用真实或脱敏的 Outline 文档样本验证 ProseMirror JSON 往返。
- 使用现有 Yjs binary state 验证 `default` fragment 往返。
- 验证 Markdown 序列化和 `value(asString, trim)` 旧公共契约可保留。
- 产出失败节点清单、差异分类、风险清单和 go/no-go 建议。

**非目标：**

- 不替换生产编辑器。
- 不迁移数据库内容、`Document.content` 或 `Document.state`。
- 不升级 Hocuspocus 服务端到 v4。
- 不引入新的编辑器用户功能、block 功能、拖拽手柄或 slash menu。
- 不修改现有编辑器调用方以适配 Tiptap。
- 不允许 spike 结果依赖用户手动检查才能判定通过。

## 决策

### 决策 1：把本变更限定为 spike，而不是正式迁移

本变更只产出可复现证据和迁移建议。正式实现必须在 spike 结果满足退出条件后单独创建变更。

替代方案是直接实现 Tiptap wrapper 和 custom extensions。该方案会在 schema、Yjs、Markdown 和公共 API 风险尚未量化前扩大改动面，因此不采用。

### 决策 2：优先评估 Tiptap v2 作为保守候选，但不跳过 v3 事实核对

Tiptap v2 与当前 collaboration cursor 包线更一致，且生态资料更成熟。Tiptap v3 仍需记录当前阻塞点，因为未来正式迁移或后续升级可能转向 v3。

替代方案是直接选 v3。该方案会立即遇到 collaboration cursor 包线不一致和 `@tiptap/y-tiptap` 行为差异，需要更多不确定性处理，因此不作为默认候选。

### 决策 3：用构造函数身份验证 ProseMirror 单实例，而不是只比较解析路径

`require.resolve("@tiptap/pm/model")` 通常解析到 re-export 文件，未必等于 `require.resolve("prosemirror-model")`。真正需要验证的是运行时构造函数身份，例如 `@tiptap/pm/model` 导出的 `Node` 是否与 `prosemirror-model` 导出的 `Node` 是同一个对象，`@tiptap/pm/transform` 导出的 `ReplaceStep` 是否与 `prosemirror-transform` 导出的 `ReplaceStep` 是同一个对象。

替代方案是仅比较物理路径。该方案容易误判，因为 re-export 路径不同不必然表示运行时实例不同，因此不采用。

### 决策 4：schema 探针必须保留旧节点名和 attrs

探针中的 Tiptap extensions 必须使用 Outline 现有 JSON 中的 type 名称和 attrs 键名。StarterKit 可作为参考，但不得作为默认 schema 基础，因为它会注册 Tiptap 默认命名并可能造成 JSON 结构漂移。

替代方案是把历史 JSON 迁移到 Tiptap 默认命名。该方案会同时影响 `Document.content`、Yjs binary state、IndexedDB local persistence 和旧客户端兼容，不适合作为第一阶段。

### 决策 5：Yjs 探针必须固定 fragment 名 `"default"`

Tiptap collaboration 配置必须验证 `field: "default"` 或等价 fragment 传入方式。只验证 JSON 不足以证明现有 collaborative state 可读写，因为服务端落库路径直接依赖 `yDocToProsemirrorJSON(ydoc, "default")`。

替代方案是只从 `Document.content` JSON 初始化编辑器。该方案无法覆盖历史 Yjs state、本地缓存和实时协作路径，因此不采用。

### 决策 6：保留旧 `Editor.value()` 和 `onChange` 契约作为 spike 判定项

当前 `value(true)` 默认返回 Markdown，`value(false)` 返回 ProseMirror JSON，`onChange` 传递 getter 函数而不是直接值。Tiptap wrapper 必须能表达同等语义，否则文档保存、评论草稿、模板编辑和导出路径会静默出错。

替代方案是把 `value()` 简化为 `editor.getJSON()`。该方案破坏现有调用方契约，因此不采用。

### 决策 7：灰度策略优先于强制全量切换，但灰度必须受能力约束

如果新旧客户端只产生同一 schema 中的节点和 attrs，Yjs 收敛性理论上允许灰度混用。若新客户端产生旧客户端不认识的节点或 attrs，则必须通过 feature flag、editor version 或能力开关阻止混用。

替代方案是要求所有在线用户同时刷新并强制全量切换。该方案部署复杂度高，且不利于小范围验证，因此不作为默认策略。

## 风险 / 权衡

- ProseMirror 双实例导致 `instanceof` 判断静默失败 -> spike 必须验证 `Node`、`Fragment`、`Slice`、`Selection`、`NodeSelection`、`TextSelection`、`ReplaceStep`、`ReplaceAroundStep`、`AddMarkStep`、`RemoveMarkStep` 等构造函数身份。
- Tiptap extension 默认命名污染 JSON -> 探针禁止直接使用未重命名的 StarterKit 作为最终 schema 基础。
- `null`、`undefined`、默认 attrs 和空 content 归一化导致 false negative -> spike 必须区分可接受归一化和数据破坏，并记录归一化规则。
- Yjs 空文档和 `default` fragment 初始化行为差异 -> Yjs 探针必须覆盖空文档、有内容文档和历史 state。
- Markdown 输出差异影响保存和导出 -> Markdown 探针必须对比旧 serializer 输出，并标记语义等价但字符串不同的案例。
- 灰度混用产生旧客户端未知节点 -> spike 必须输出灰度约束，正式迁移前不得新增旧客户端未知能力。
- 真实文档样本含敏感内容 -> fixtures 必须脱敏，或在只读本地环境中执行并只提交统计和最小复现样本。
- spike 结果被误解为迁移已完成 -> 输出必须包含 go/no-go 判断和正式迁移前置条件。

## 迁移计划

本变更本身不是生产迁移。执行顺序如下：

1. 建立 spike 时间盒和样本选择规则。
2. 调查 Tiptap v2/v3 包线、协作扩展和 ProseMirror 依赖身份。
3. 构造真实或脱敏文档 fixture corpus。
4. 实现 JSON、Yjs 和 Markdown 往返探针。
5. 记录失败节点、差异分类和风险。
6. 给出版本族建议、正式迁移阶段建议和 go/no-go 判断。

回滚策略：

- 本变更不改变生产代码路径和数据，因此回滚只需要移除 spike 相关临时代码、fixtures 和依赖声明。
- 如果 spike 临时加入依赖，必须在结束时明确保留或移除，并保证 lockfile 不留下未解释的生产依赖。

## 待确认问题

- spike 的真实文档样本从数据库直接读取、从现有测试 fixture 构造，还是两者结合。
- 是否允许 spike 临时修改 `package.json` 安装 Tiptap 候选包，还是使用临时目录或 package manager cache 做依赖探针。
- 灰度期间是否以 `EDITOR_VERSION`、feature flag、用户百分比还是团队 allowlist 作为正式迁移的切换机制。
