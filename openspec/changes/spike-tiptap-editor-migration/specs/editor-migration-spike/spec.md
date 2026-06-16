## 新增需求

### 需求:Spike 必须限定迁移前置调查范围
系统必须将本变更限定为 Tiptap 编辑器迁移前置 spike，并禁止替换生产编辑器、迁移文档数据或升级 Hocuspocus 服务端。

#### 场景:不替换生产编辑器
- **当** spike 实现完成后
- **那么** 生产文档编辑路径必须仍使用现有 Outline 编辑器

#### 场景:不迁移现有文档数据
- **当** spike 实现完成后
- **那么** 系统不得修改现有 `Document.content`、`Document.state` 或数据库 schema

#### 场景:不升级 Hocuspocus 服务端
- **当** spike 实现完成后
- **那么** `@hocuspocus/server`、`@hocuspocus/provider` 和服务端 collaboration extensions 必须保持在本变更前的生产行为

### 需求:Spike 必须给出 Tiptap 版本族建议
系统必须比较 Tiptap v2 和 v3 的相关包线，并给出正式迁移应优先采用的版本族建议。

#### 场景:记录协作扩展兼容性
- **当** spike 分析 Tiptap 包线
- **那么** 输出必须记录 `@tiptap/react`、`@tiptap/core`、`@tiptap/pm`、`@tiptap/extension-collaboration`、`@tiptap/extension-collaboration-cursor` 和 Yjs binding 的版本与 peer dependency 关系

#### 场景:解释版本族选择
- **当** spike 给出版本族建议
- **那么** 输出必须说明选择 Tiptap v2、Tiptap v3 或暂缓选择的理由和阻塞项

### 需求:Spike 必须验证 ProseMirror 运行时单实例风险
系统必须验证 Tiptap 导出的 ProseMirror 构造函数与 Outline 直接导入的 ProseMirror 构造函数是否为同一运行时实例。

#### 场景:验证 model 构造函数身份
- **当** spike 比较 `@tiptap/pm/model` 和 `prosemirror-model`
- **那么** 输出必须记录 `Node`、`Fragment` 和 `Slice` 的构造函数身份是否一致

#### 场景:验证 state 构造函数身份
- **当** spike 比较 `@tiptap/pm/state` 和 `prosemirror-state`
- **那么** 输出必须记录 `Selection`、`NodeSelection` 和 `TextSelection` 的构造函数身份是否一致

#### 场景:验证 transform 构造函数身份
- **当** spike 比较 `@tiptap/pm/transform` 和 `prosemirror-transform`
- **那么** 输出必须记录 `ReplaceStep`、`ReplaceAroundStep`、`AddMarkStep` 和 `RemoveMarkStep` 的构造函数身份是否一致

#### 场景:单实例验证失败
- **当** 任一关键构造函数身份不一致
- **那么** spike 输出必须标记该版本族为高风险并说明可能受影响的 Outline 代码路径

### 需求:Spike 必须验证 ProseMirror JSON 往返
系统必须使用包含 Outline 自定义节点和 marks 的真实或脱敏文档样本验证 Tiptap schema 的 `setContent` / `getJSON` 往返。

#### 场景:覆盖自定义节点
- **当** 构建 JSON 往返样本
- **那么** 样本必须覆盖 `container_notice`、`container_toggle`、`checkbox_item`、`embed`、`attachment`、`image`、`math_inline`、`math_block`、`code_fence` 和 table 节点中的代表性组合

#### 场景:保留旧节点名和 attrs
- **当** Tiptap 探针 schema 解析样本文档
- **那么** 输出 JSON 中的节点 `type` 名称和 attrs 键名必须与输入样本保持一致，除非差异被明确归类为可接受归一化

#### 场景:记录失败节点清单
- **当** 任一样本文档无法被 Tiptap schema 解析或往返后不一致
- **那么** spike 输出必须记录失败节点、失败 attrs、最小复现样本和建议处理方式

### 需求:Spike 必须验证 Yjs default fragment 往返
系统必须验证 Tiptap collaboration 配置能够使用现有 Yjs fragment 名 `"default"` 读取和生成与服务端持久化路径兼容的文档内容。

#### 场景:读取历史 Yjs state
- **当** spike 对历史或构造的 Yjs binary state 应用 update
- **那么** Tiptap 探针必须从 `"default"` fragment 读取内容并输出可比较的 ProseMirror JSON

#### 场景:写回 default fragment
- **当** Tiptap 探针编辑或设置内容
- **那么** 生成的 Yjs update 必须写入 `"default"` fragment，而不是其他 fragment 名称

#### 场景:覆盖空文档
- **当** Yjs state 为空或文档没有已初始化内容
- **那么** spike 必须记录 Tiptap 与当前 `y-prosemirror` 对空 `"default"` fragment 初始化行为的差异

### 需求:Spike 必须验证 Markdown 和 Editor API 契约
系统必须验证 Tiptap wrapper 能保留现有 editor 公共 API 的关键语义，尤其是 `value(asString, trim)` 和 `onChange` getter 契约。

#### 场景:value true 返回 Markdown
- **当** 调用候选 Tiptap wrapper 的 `value(true, trim)`
- **那么** 返回值必须是 Markdown 字符串，并与旧编辑器 serializer 输出进行差异比较

#### 场景:value false 返回 JSON
- **当** 调用候选 Tiptap wrapper 的 `value(false, trim)`
- **那么** 返回值必须是 ProseMirror JSON，并保持旧节点名和 attrs

#### 场景:onChange 传递 getter
- **当** 候选 Tiptap wrapper 触发内容变化
- **那么** `onChange` 必须接收可按需调用的 getter 函数，而不是直接接收 JSON 或 Markdown 值

### 需求:Spike 必须输出灰度和混用约束
系统必须分析新旧编辑器客户端在同一 Yjs document 中混用的安全边界，并输出正式迁移的灰度约束。

#### 场景:同 schema 混用
- **当** 新旧客户端只产生旧 schema 已知节点和 attrs
- **那么** spike 输出必须说明灰度混用的预期风险和验证要求

#### 场景:未知节点能力
- **当** 新客户端可能产生旧客户端不认识的节点或 attrs
- **那么** spike 输出必须要求通过 feature flag、editor version 或能力开关阻止该能力在混用期间启用

### 需求:Spike 必须产出 go/no-go 结论
系统必须在 spike 结束时产出可操作的 go/no-go 结论，并列出正式迁移前必须满足的条件。

#### 场景:输出继续迁移建议
- **当** JSON、Yjs、Markdown 和 API 契约探针均达到退出条件
- **那么** spike 输出必须给出建议的正式迁移阶段、优先级和主要任务清单

#### 场景:输出暂缓迁移建议
- **当** 任一核心探针发现无法接受的数据破坏或运行时身份风险
- **那么** spike 输出必须给出暂缓迁移的理由、阻塞项和可选替代路径

## 修改需求

无。

## 移除需求

无。
