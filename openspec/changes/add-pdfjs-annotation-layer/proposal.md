## 为什么

当前 PDF 阅读态只在浏览器原生 iframe 旁边提供纯文本批注列表，不能在 PDF 页面上做真实高亮、矩形框选或跳转，用户体验与思源式 PDF 标注明显不匹配。用户希望支持的是“PDF 原件只读 + 页内标注层 + 侧车状态保存”，因此需要引入可控的 PDF 渲染与坐标体系，而不是继续扩展临时的右侧文字批注面板。

## 变更内容

- 新增基于 PDF.js 的全屏 PDF 阅读器，用 PDF.js 渲染页面 canvas 和 text layer，替换 `PdfViewerDialog` 中的原生 iframe 主阅读区。
- 新增 Outline 自己的 PDF annotation layer，支持文本高亮、矩形区域标注、颜色选择、标注列表、点击标注跳转页面。
- 移除当前用户可见的纯文本 sidecar 批注面板，不再把 note-style 批注作为正式 PDF 标注能力。
- 保留并升级现有 `AttachmentPdfState` 侧车存储/API/revision 机制，用于保存页内标注数据；PDF 原 attachment 文件仍不被修改。
- 允许新增 `pdfjs-dist` 作为 PDF 渲染和坐标引擎；禁止新增 PDF 写回库或完整 PDF 编辑 SDK。
- 新增 worker/CSP/Vite 构建验证，确保 PDF.js worker 在开发和生产构建中可加载。
- 第一版不实现 PDF 文件写回、导出带批注的新 PDF、表单字段保存、签名、手写 ink 和矩形截图上传。

## 功能 (Capabilities)

### 新增功能

- `pdfjs-annotation-layer`: 基于 PDF.js 的 PDF 阅读器和页内标注层，包括页面渲染、文本高亮、矩形标注、颜色、导航、只读模式和标注状态保存。

### 修改功能

- `pdf-attachment-state`: 将现有 PDF 侧车状态从临时纯文本 note 批注升级为页内标注持久化机制，并移除用户可见的纯文本批注面板。

## 影响

- 依赖：新增 `pdfjs-dist`；不新增 `pdf-lib`、`react-pdf`、`@react-pdf/*` 或 PDF 写回/编辑 SDK。
- 前端：重写 `app/components/PdfViewerDialog.tsx` 的主阅读区；新增 PDF.js loader/page/text layer/annotation layer/toolbar 相关组件或 hooks；调整相关测试。
- 共享类型：扩展 `shared/types.ts` 中 PDF annotation 数据结构，支持页内 rects、模式、选中文本和页面尺寸。
- 后端：复用 `AttachmentPdfState` 表和 `attachments.pdfState.get/update`，扩展 zod schema 和测试以校验新数据结构。
- 安全与构建：验证 PDF.js worker 的打包、加载路径、CSP worker/script 配置和 `/api/attachments.file` Range 请求兼容性。
- 产品行为：下载或打开原 PDF 仍返回原文件，不包含 Outline 标注。
