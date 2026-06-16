## 上下文

Outline 已有 PDF attachment 能力：attachment 节点保存 `id`、`href`、`title`、`size`、`contentType` 等属性，`shared/editor/components/PDF.tsx` 使用浏览器原生 PDF 预览能力展示附件，服务端 attachment API 负责上传、下载、重定向和删除。

此前方案曾引入 `@embedpdf/react-pdf-viewer`、PDFium/WASM 静态资源、`/embedpdf/*` 静态路由和 CSP 放宽，用来支持完整 PDF 查看/编辑/导出。当前方向已经改变：第一版必须移除新增 PDF 库，不把 Outline 变成完整 PDF 编辑器，只保存 Outline 内部批注状态。

这次变更借鉴 SiYuan 的“PDF 原件 + 注释侧车”思路，但不照搬 `.sya` 文件。Outline 更适合用数据库 JSONB 表保存侧车状态，因为它能复用现有 team/document/attachment 权限、事务和测试体系。

## 目标 / 非目标

**目标：**

- 移除之前新增的 PDF 渲染/编辑库和 PDFium/WASM 配套改动。
- 新增 `AttachmentPdfState` 数据模型，将 PDF 批注状态绑定到 `(documentId, attachmentId)`。
- 新增 `attachments.pdfState.get` 和 `attachments.pdfState.update` API。
- 只允许有 document read 权限的用户读取状态，只允许有 document update 权限的用户保存状态。
- 使用 `revision` 做乐观并发，防止静默覆盖。
- 保持 PDF 原 attachment 文件不变，避免每次保存生成新附件。
- 前端使用现有浏览器 PDF 预览能力，并在 Outline UI 中展示和编辑批注状态。

**非目标：**

- 不写回 PDF 文件本体。
- 不导出包含批注的新 PDF 副本。
- 不保存 PDF 表单字段。
- 不实现签名工具。
- 不实现可靠的文本选区高亮或页内精确 PDF 标注引擎。
- 不新增 `pdfjs-dist`、`pdf-lib`、`react-pdf`、`@react-pdf/*` 或其他 PDF 渲染/编辑库。
- 不把批注状态写入 ProseMirror attachment 节点 attrs。

## 决策

### 决策 1：先移除 EmbedPDF 依赖和运行时改动

实现前先删除 `@embedpdf/react-pdf-viewer`、`@embedpdf/*` lock 条目、`public/embedpdf/`、`/embedpdf/*` 静态路由和 PDFium/WASM CSP。这样能确保后续实现不会继续依赖已经被产品边界排除的 PDF 编辑引擎。

替代方案是保留 EmbedPDF 作为隐藏依赖，仅不暴露完整编辑器。该方案会继续带来 WASM、worker、CSP 和 bundle 复杂度，也容易让后续代码重新依赖 plugin API，因此不采用。

### 决策 2：使用数据库 JSONB 侧车，而不是文件侧车或节点 attrs

新增 `attachment_pdf_states` 表保存状态，唯一键为 `(documentId, attachmentId)`。`data` 存储库无关的批注 JSON，`revision` 用于并发控制。

替代方案一是照搬 SiYuan 的 `.sya` 文件。该方案需要额外处理文件存储、权限、同步和生命周期，不符合 Outline 的 API/模型体系，因此不采用。

替代方案二是把批注 JSON 写入 ProseMirror attachment 节点 attrs。该方案会增大文档体积，使批注变化污染 document revision，并在同一 PDF attachment 被多个文档引用时难以定义共享语义，因此不采用。

### 决策 3：状态作用域为 document + attachment

同一个 attachment 在不同 document 中可以有不同批注状态。这样符合“某篇文档中的 PDF 批注”语义，也避免跨文档泄露上下文。

替代方案是只按 `attachmentId` 全局保存状态。该方案更像“附件级批注”，但会让一个文档中的批注出现在另一个文档中，并带来权限和意图混淆，因此不采用。

### 决策 4：第一版使用库无关、低精度批注模型

`AttachmentPdfStateData` 第一版只保存 Outline 自己能稳定理解的数据：批注 id、页码、类型、颜色、文本、可选矩形、可选点集、作者和时间戳。没有 PDF 引擎时，矩形和点集只能作为 Outline 内部状态存在，不能承诺与浏览器 PDF 内部页面精确对齐。

替代方案是尝试通过 `<object>` 或 `<iframe>` 操作浏览器 PDF viewer DOM。浏览器内置 PDF viewer 不提供稳定跨浏览器 DOM/API，风险高且不可测试，因此不采用。

### 决策 5：权限基于 Document，Attachment 只做归属校验

读取状态需要 document read 权限，保存状态需要 document update 权限；attachment 必须属于同一 team、是 PDF，并且与请求 document 关联。这样和“文档上下文批注”的作用域一致。

替代方案是基于 attachment owner 权限读写状态。该方案会让文档协作者无法保存当前文档中的 PDF 批注，和 Outline 文档编辑权限不一致，因此不采用。

### 决策 6：使用 revision 冲突保护，不做自动合并

`attachments.pdfState.get` 返回当前 `revision`，`update` 必须带回该 revision。服务端发现 revision 不一致时返回冲突错误，前端提示重新加载。第一版不做批注级 merge。

替代方案是最后写入者胜出。该方案会静默覆盖其他用户的批注，不符合协作知识库的预期，因此不采用。

## 风险 / 权衡

- 用户误以为保存会修改 PDF 文件 -> UI 文案使用“保存批注”而不是“保存 PDF”，并在设计和规范中明确下载原 PDF 不包含侧车批注。
- 没有 PDF viewer 库导致页内精确批注能力有限 -> 第一版只承诺批注列表和库无关状态保存，不承诺文本选区、表单、签名或 PDF 写回。
- JSONB 状态过大 -> 服务端 schema 限制 annotation 数量、文本长度、点集长度和整体数据大小。
- 并发保存冲突 -> 使用 revision 乐观并发，冲突时阻止静默覆盖。
- attachment/document 绑定错误 -> 服务端同时校验 attachment team、contentType、documentId 和 document 权限。
- 删除 attachment 后残留状态 -> `attachment_pdf_states.attachmentId` 使用外键级联删除。
- 移除 CSP/静态路由影响其他功能 -> 只移除 PDFium/WASM 专用配置；若其他功能也需要 worker/blob 或 wasm policy，必须由对应功能单独证明和保留。

## 迁移计划

1. 清理新增 PDF 库和运行时配套改动，确认 `rg "@embedpdf|/embedpdf|pdfium|wasm-unsafe-eval"` 不再命中应用代码、依赖和 public 资源。
2. 添加共享 PDF 状态类型。
3. 添加 `attachment_pdf_states` 迁移、模型导出和服务端 API。
4. 添加前端 PDF 状态 API 工具。
5. 调整 PDF attachment 阅读 UI，展示 Outline 批注状态并保存到 API。
6. 补充服务端、前端工具和编辑器/组件测试。

回滚策略：

- 若侧车状态功能需要回滚，先隐藏前端批注 UI 和 API 调用，再回滚服务端 API 注册。
- 数据库迁移回滚删除 `attachment_pdf_states` 表；PDF 原 attachment 文件不受影响。
- 已删除的 PDF 库不需要恢复，除非后续单独批准新的 PDF 引擎选型。

## 待确认问题

- 第一版批注 UI 采用“侧栏列表”还是“阅读弹层右侧面板”更适合现有产品体验；实现时应优先选择能稳定测试、不会假装页内精确定位的形态。
- 如果未来需要真实页内批注或 PDF 写回，需要单独创建 PDF 引擎选型变更。
