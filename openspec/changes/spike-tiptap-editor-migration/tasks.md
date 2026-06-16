## 1. Spike 边界和样本准备

- [ ] 1.1 确认 spike 时间盒、输出位置和不修改生产编辑器/数据库/Hocuspocus 服务端的边界。
- [ ] 1.2 确定样本来源：真实只读数据库抽样、脱敏 fixture、现有测试 fixture，或组合方案。
- [ ] 1.3 收集 10-20 份覆盖自定义节点的文档 JSON 样本，至少包含 notice、toggle、checkbox、embed、attachment、image、math、code fence 和 table 代表案例。
- [ ] 1.4 收集或构造 Yjs binary state 样本，覆盖空文档、普通文档、自定义节点文档和协作文档。
- [ ] 1.5 建立样本脱敏规则，确保提交到仓库的 fixture 不包含用户正文、团队信息、附件 URL token 或其他敏感数据。

## 2. Tiptap 版本族和依赖调查

- [ ] 2.1 记录 Tiptap v2 包线：`@tiptap/react`、`@tiptap/core`、`@tiptap/pm`、`@tiptap/extension-collaboration`、`@tiptap/extension-collaboration-cursor` 和 `y-prosemirror` 的版本与 peer dependencies。
- [ ] 2.2 记录 Tiptap v3 包线：`@tiptap/react`、`@tiptap/core`、`@tiptap/pm`、`@tiptap/extension-collaboration`、`@tiptap/extension-collaboration-cursor` 和 `@tiptap/y-tiptap` 的版本与 peer dependencies。
- [ ] 2.3 对比 v2/v3 与当前 Outline React、Yjs、ProseMirror 和 Hocuspocus 依赖的兼容性。
- [ ] 2.4 给出推荐版本族、阻塞项和暂缓项，并说明是否建议先采用 Tiptap v2。

## 3. ProseMirror 单实例探针

- [ ] 3.1 编写或运行临时探针，比较 `@tiptap/pm/model` 与 `prosemirror-model` 导出的 `Node`、`Fragment`、`Slice` 构造函数身份。
- [ ] 3.2 比较 `@tiptap/pm/state` 与 `prosemirror-state` 导出的 `Selection`、`NodeSelection`、`TextSelection` 构造函数身份。
- [ ] 3.3 比较 `@tiptap/pm/transform` 与 `prosemirror-transform` 导出的 `ReplaceStep`、`ReplaceAroundStep`、`AddMarkStep`、`RemoveMarkStep` 构造函数身份。
- [ ] 3.4 如果任一构造函数身份不一致，记录受影响的 Outline 代码路径和风险等级。
- [ ] 3.5 记录 package manager 解析结果和避免双实例的依赖安装约束。

## 4. Tiptap schema 探针

- [ ] 4.1 构建最小 Tiptap extension 集合，保留 Outline 旧节点名和 attrs 键名，不直接使用未重命名的 StarterKit 作为最终 schema。
- [ ] 4.2 按 marks、基础 block、atom/custom block、结构块、table 的顺序补齐 probe extensions。
- [ ] 4.3 对样本文档执行 `setContent` / `getJSON` 往返，并记录每个样本的通过、失败或可接受归一化状态。
- [ ] 4.4 对失败样本提取最小复现 JSON，并记录失败节点、失败 attrs、错误信息和建议处理方式。
- [ ] 4.5 分类记录 `null`、`undefined`、默认 attrs、空 content 和 mark 排序等归一化差异。

## 5. Yjs default fragment 探针

- [ ] 5.1 使用现有 `y-prosemirror` 路径从样本 Yjs state 输出 `yDocToProsemirrorJSON(ydoc, "default")` 作为基线。
- [ ] 5.2 使用候选 Tiptap collaboration 配置读取同一 Yjs state 的 `"default"` fragment，并与基线 JSON 比较。
- [ ] 5.3 使用候选 Tiptap editor 写入内容，确认生成的 Yjs update 写入 `"default"` fragment。
- [ ] 5.4 覆盖空 Yjs document 和未初始化 fragment，记录 Tiptap 与当前实现的初始化差异。
- [ ] 5.5 记录 Yjs state、IndexedDB local persistence 和服务端持久化路径的兼容性结论。

## 6. Markdown 和 Editor API 契约探针

- [ ] 6.1 使用当前 Outline serializer 为样本文档生成 Markdown 基线。
- [ ] 6.2 验证候选 Tiptap wrapper 可以实现 `value(true, trim)` 返回 Markdown 字符串，并与基线输出比较。
- [ ] 6.3 验证候选 Tiptap wrapper 可以实现 `value(false, trim)` 返回保留旧节点名和 attrs 的 ProseMirror JSON。
- [ ] 6.4 验证候选 Tiptap wrapper 的 `onChange` 可以继续传递 getter 函数，而不是直接传 JSON 或 Markdown。
- [ ] 6.5 列出旧编辑器公共 API 中正式迁移必须适配的方法和属性，包括 `view`、`commands`、`focusAtEnd`、`insertFiles`、`getComments`、`removeComment` 和评论相关方法。

## 7. 灰度和混用策略

- [ ] 7.1 分析旧编辑器客户端和候选 Tiptap 客户端在同一 Yjs document 中只产生旧 schema 内容时的混用风险。
- [ ] 7.2 分析新客户端产生旧客户端未知节点或 attrs 时的风险，并提出 feature flag、`EDITOR_VERSION` 或能力开关约束。
- [ ] 7.3 定义正式迁移的灰度候选策略，包括团队 allowlist、用户百分比、文档级提示或版本混用提示。
- [ ] 7.4 明确 Hocuspocus v4 升级必须作为后续独立变更处理。

## 8. Spike 报告和决策

- [ ] 8.1 汇总版本族建议、ProseMirror 单实例结果、JSON 往返结果、Yjs 往返结果、Markdown/API 契约结果和灰度约束。
- [ ] 8.2 产出失败节点清单和后续 Tiptap custom extension 工作量估算。
- [ ] 8.3 给出 go/no-go 结论：继续正式迁移、暂缓迁移或调整策略。
- [ ] 8.4 如果建议继续迁移，列出正式迁移的下一阶段变更名称、范围和优先任务。
- [ ] 8.5 清理 spike 临时依赖或说明保留理由，确保生产依赖和 lockfile 没有未解释变更。
