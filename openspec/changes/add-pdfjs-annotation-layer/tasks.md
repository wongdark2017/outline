## 1. 依赖和技术探针

- [x] 1.1 确认 `add-pdf-attachment-state` 已实现的 `AttachmentPdfState` 表、API、权限和 attachment id 修复可作为本变更基础，记录需要替换的临时纯文本批注 UI。
- [x] 1.2 使用 yarn 添加 `pdfjs-dist`，不添加 `pdf-lib`、`react-pdf`、`@react-pdf/*` 或其他 PDF 写回/编辑 SDK。
- [x] 1.3 新增最小 PDF.js worker 配置探针，验证开发环境可加载 worker 并渲染 `/api/attachments.file?id=<id>` 的第一页。
- [x] 1.4 验证生产 `yarn vite:build` 下 PDF.js worker 产物路径可加载。
- [x] 1.5 检查 CSP，如有必要仅添加最小 `worker-src` 配置，禁止恢复 `/embedpdf/*` 路由和 `wasm-unsafe-eval`。

## 2. 类型和服务端状态模型

- [x] 2.1 扩展 `shared/types.ts`，新增 `AttachmentPdfStateDataV2`、`OutlinePdfAnnotationV2`、`OutlinePdfAnnotationMode`，支持 `text`、`rectangle`、`highlight`、`fill`、`border`、`selectedText` 和 `rects`。
- [x] 2.2 调整 `AttachmentPdfStateData` 类型，使读取可兼容旧 `version: 1`，写入正式使用 `version: 2`。
- [x] 2.3 扩展 `server/routes/api/attachments/schema.ts` 的 PDF state schema，校验 version 2 标注类型、模式、颜色、页码、归一化 rects、文本长度和标注数量。
- [x] 2.4 保持 `attachments.pdfState.get/update` API 路径不变，确保 update 接受并返回 version 2 状态。
- [x] 2.5 扩展服务端测试，覆盖 version 2 创建、更新、revision 冲突、无效 type/mode/color/rect/text/数量，以及原 PDF 文件不被修改。

## 3. PDF.js 阅读器基础组件

- [x] 3.1 新增 `app/components/PdfViewer/` 模块，拆分 PDF.js document loader、page renderer、toolbar、annotation layer、sidebar 和坐标工具。
- [x] 3.2 在全屏阅读态中使用 PDF.js 加载 `getViewerSrc(document.src)`，替换 iframe 主阅读区。
- [x] 3.3 实现 PDF 页面 canvas 渲染、加载状态、错误状态和打开原文件入口。
- [x] 3.4 实现 text layer 渲染，确保页面文本可选择。
- [x] 3.5 实现页面滚动、当前页显示、页码跳转、放大、缩小和适宽缩放。
- [x] 3.6 对大 PDF 渲染做基础限制：限制并发渲染，避免一次性阻塞主线程；必要时只渲染可见页附近页面。

## 4. 标注坐标和状态工具

- [x] 4.1 新增坐标转换工具，将 DOM rect 转换为 page-local rect，并转换为归一化 rect。
- [x] 4.2 新增反向转换工具，将归一化 rect 根据当前页面显示尺寸转换为 CSS rect。
- [x] 4.3 新增 selection 工具，从单页 text layer 的 `window.getSelection()` 提取选中文本和 rects。
- [x] 4.4 对坐标转换、缩放后重绘、窗口尺寸变化后重绘和跨页 selection 拒绝/拆分逻辑添加单元测试。
- [x] 4.5 新增前端状态工具，将 API 返回的 version 1 状态安全忽略或降级提示，并将编辑保存统一写为 version 2。

## 5. 文本高亮标注

- [x] 5.1 在 toolbar 中实现文本高亮模式和颜色选择。
- [x] 5.2 在 text layer selection 后显示创建高亮操作。
- [x] 5.3 创建 text 标注时保存 `pageIndex`、`type: "text"`、`mode: "highlight"`、颜色、选中文本和归一化 rects。
- [x] 5.4 在 annotation layer 中根据 rects 渲染半透明文本高亮覆盖层。
- [x] 5.5 只读模式下禁止显示创建高亮操作，但必须渲染已有高亮。
- [x] 5.6 添加组件测试覆盖高亮创建、保存 payload、只读隐藏编辑入口和缩放后位置保持。

## 6. 矩形区域标注

- [x] 6.1 在 toolbar 中实现填充矩形和边框矩形模式。
- [x] 6.2 在 PDF 页面 overlay 中实现 pointer down/move/up 拖拽创建矩形预览。
- [x] 6.3 创建 rectangle 标注时保存 `pageIndex`、`type: "rectangle"`、`mode: "fill" | "border"`、颜色和归一化 rects。
- [x] 6.4 在 annotation layer 中渲染填充矩形和边框矩形。
- [x] 6.5 只读模式下禁止进入矩形创建模式，但必须渲染已有矩形。
- [x] 6.6 添加组件测试覆盖矩形创建、模式切换、保存 payload、只读隐藏编辑入口和缩放后位置保持。

## 7. 标注列表、跳转和删除

- [x] 7.1 用标注列表替换当前纯文本 note sidecar 面板，列表展示页码、类型、颜色和文本摘要。
- [x] 7.2 移除 `Annotation text` textarea、`Add annotation` 按钮和纯文本 note 创建逻辑。
- [x] 7.3 点击标注列表项时滚动到对应页面并短暂突出显示该标注。
- [x] 7.4 有编辑权限时允许删除标注，并从 annotation layer 和待保存状态中移除。
- [x] 7.5 保存按钮只保存 version 2 页内标注状态，文案必须表达保存标注而不是保存 PDF。
- [x] 7.6 保留 revision 冲突处理，冲突时保留本地未保存标注并提示重新加载。

## 8. 前端 API 和阅读态测试

- [x] 8.1 更新 `app/utils/pdfAttachmentState.ts` 和测试，覆盖 version 2 请求序列化、响应解析和冲突错误透传。
- [x] 8.2 重写 `app/components/PdfViewerDialog.test.tsx`，覆盖 PDF.js 阅读态不渲染 iframe 主阅读区。
- [x] 8.3 覆盖有 document id 和 attachment id 时读取 PDF state 并渲染 version 2 标注。
- [x] 8.4 覆盖缺少 attachment id 时可查看 PDF 但不显示保存入口。
- [x] 8.5 覆盖 readOnly 时展示标注但不显示创建、删除、保存入口。
- [x] 8.6 覆盖加载失败时显示错误状态并保留打开原文件入口。

## 9. 兼容性和清理

- [x] 9.1 确保旧 `version: 1` note 状态不再作为正式 PDF 标注渲染，不显示旧纯文本创建面板。
- [x] 9.2 保持 `shared/editor/components/PDF.tsx` 文档内 preview 行为不破坏。
- [x] 9.3 确保 `/api/attachments.file` PDF 响应的 Range、Content-Type、Content-Disposition 和 CSP 行为仍满足 PDF.js 加载。
- [x] 9.4 检查 `rg "@embedpdf|/embedpdf|pdfium|wasm-unsafe-eval"` 不出现未预期回归。
- [x] 9.5 检查 `rg "pdf-lib|react-pdf|@react-pdf"` 不出现未批准依赖。

## 10. 验证

- [x] 10.1 运行 `yarn test server/routes/api/attachments/attachments.test.ts`。
- [x] 10.2 运行 `yarn test app/utils/pdfAttachmentState.test.ts`。
- [x] 10.3 运行 PDF viewer 相关组件测试文件。
- [x] 10.4 运行新增坐标/selection 工具测试文件。
- [x] 10.5 运行 `yarn tsc --noEmit`。
- [x] 10.6 运行 `yarn lint`。
- [x] 10.7 运行 `yarn vite:build` 验证 PDF.js worker 生产构建。
- [x] 10.8 手动验证：打开 PDF、缩放、创建文本高亮、创建填充矩形、创建边框矩形、保存、刷新后恢复、只读用户不可编辑、下载原 PDF 不包含标注。
