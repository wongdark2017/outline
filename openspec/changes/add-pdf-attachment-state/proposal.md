## 为什么

当前 PDF 编辑保存方案曾引入 `@embedpdf/react-pdf-viewer`、PDFium/WASM 静态资源和配套 CSP/路由改动，但团队现在希望移除这些新增 PDF 库，避免把 Outline 变成完整 PDF 编辑器并减少依赖、运行时和安全策略复杂度。

仍然需要保留一个可落地的 PDF 保存能力：PDF 原件不变，Outline 将批注状态保存为和 `documentId + attachmentId` 绑定的数据库侧车状态，参考 SiYuan 的“PDF 文件 + 注释侧车”模型。

## 变更内容

- 移除之前新增的 PDF 渲染/编辑库依赖和运行时配套改动：
  - 删除 `@embedpdf/react-pdf-viewer` 依赖。
  - 清理 `yarn.lock` 中仅由该依赖引入的 `@embedpdf/*` 条目。
  - 删除 `public/embedpdf/` 静态资源。
  - 移除 `/embedpdf/*` 静态资源路由。
  - 移除仅为 PDFium/WASM 添加的 CSP 配置。
  - 删除前端所有 `@embedpdf/*` import。
- 新增 PDF attachment 侧车状态能力：
  - 新增库无关的 PDF 批注状态类型。
  - 新增 `AttachmentPdfState` 服务端模型和 `attachment_pdf_states` 表。
  - 新增 `attachments.pdfState.get` 和 `attachments.pdfState.update` API。
  - 使用 `revision` 做乐观并发控制。
  - 在现有 PDF 预览/阅读 UI 中读取、展示和保存 Outline 内部批注状态。
- 第一版明确不实现 PDF 文件本体写回、PDF 副本导出、表单字段保存、签名工具和可靠文本选区高亮。
- 无破坏性变更。普通 PDF attachment 原文件和现有浏览器预览能力保持可用。

## 功能 (Capabilities)

### 新增功能

- `pdf-attachment-state`: 为 PDF attachment 提供 Outline 内部批注侧车状态，包括读取、保存、权限校验、并发保护、依赖清理和库无关 UI 集成边界。

### 修改功能

无。

## 影响

- 依赖：移除 `@embedpdf/react-pdf-viewer` 和相关 `@embedpdf/*` transitive lock 条目；不新增其他 PDF 渲染/编辑库。
- 静态资源：删除 `public/embedpdf/`，停止服务 `/embedpdf/*`。
- 安全策略：回退 PDFium/WASM 专用 CSP 变更。
- 后端：新增 Sequelize 模型、迁移、attachments API schema/route、权限校验和相关测试。
- 前端：新增 PDF 状态 API 工具，调整 PDF 阅读/预览 UI 以展示和保存 Outline 批注状态，但不加载第三方 PDF viewer。
- 数据模型：新增 `attachment_pdf_states` 表，并通过 `(documentId, attachmentId)` 唯一约束定义批注状态作用域。
