## 1. 清理新增 PDF 库和运行时改动

- [x] 1.1 从 `package.json` 删除 `@embedpdf/react-pdf-viewer`，不新增任何替代 PDF 渲染/编辑库。
- [x] 1.2 运行 `yarn install` 更新 `yarn.lock`，确认仅由 `@embedpdf/react-pdf-viewer` 引入的 `@embedpdf/*` 条目被移除。
- [x] 1.3 删除 `public/embedpdf/` 中的 PDFium/WASM 和 EmbedPDF 静态资源。
- [x] 1.4 从 `server/routes/index.ts` 移除 `/embedpdf/*` 静态资源路径，并保持 `/images/*`、`/email/*`、`/fonts/*` 行为不变。
- [x] 1.5 从 `server/middlewares/csp.ts` 移除仅为 PDFium/WASM 添加的 `wasm-unsafe-eval` 和仅为 EmbedPDF worker 添加的 `workerSrc` 配置，除非确认其他现有功能仍需要该配置。
- [x] 1.6 删除或重写 `app/components/PdfViewerDialog.tsx` 中的 `@embedpdf/*` 依赖，确保全屏 PDF 阅读态只使用浏览器原生 `<object>` 或 `<iframe>` 预览。
- [x] 1.7 检查 `app/`、`shared/`、`server/`、`public/`、`package.json`、`yarn.lock` 中不存在未预期的 `@embedpdf`、`/embedpdf`、`pdfium` 或 `wasm-unsafe-eval` 引用。

## 2. 共享类型和数据模型

- [x] 2.1 在现有 `shared/types.ts` 中新增 PDF 状态类型，定义 `AttachmentPdfStateData`、`OutlinePdfAnnotation`、`OutlinePdfRect`、`OutlinePdfPoint` 和 API response/request 相关接口。
- [x] 2.2 在共享类型中限制批注类型为 `note`、`highlight`、`rectangle`、`ink`，并保持类型不依赖任何 PDF viewer 库。
- [x] 2.3 新增 `server/migrations/<timestamp>-create-attachment-pdf-states.js`，创建 `attachment_pdf_states` 表、外键、唯一索引和查询索引。
- [x] 2.4 新增 `server/models/AttachmentPdfState.ts`，声明 JSONB `data`、integer `revision`、team/document/attachment/user 关联和必要字段类型。
- [x] 2.5 在 `server/models/index.ts` 导出 `AttachmentPdfState`。

## 3. 服务端 API 和校验

- [x] 3.1 在 `server/routes/api/attachments/schema.ts` 新增 PDF 状态 get/update zod schema，校验 `documentId`、`attachmentId`、`revision` 和 `data`。
- [x] 3.2 在 schema 中限制 `version === 1`、annotation 数量、批注文本长度、页码、rect 数值、points 数量和批注类型。
- [x] 3.3 在 `server/routes/api/attachments/attachments.ts` 新增 helper，加载并校验 attachment 属于当前 team、属于请求 document 且 `contentType === "application/pdf"`。
- [x] 3.4 实现 `attachments.pdfState.get`：需要 auth、validate，校验 document read 权限；无记录时返回 `revision: 0` 和空状态。
- [x] 3.5 实现 `attachments.pdfState.update`：需要 auth、validate、transaction 和 document update 权限；无记录且 `revision === 0` 时创建状态。
- [x] 3.6 在 update 中实现 revision 乐观并发，当前 revision 与请求 revision 不一致时返回冲突错误并禁止覆盖。
- [x] 3.7 确保保存 PDF 状态不会修改 attachment 原文件、不会创建新 attachment、不会更新 ProseMirror attachment attrs。
- [x] 3.8 如项目已有 Presenter 模式适用，新增或复用 presenter 返回 `attachmentId`、`documentId`、`revision`、`data`。

## 4. 前端数据工具和阅读 UI

- [x] 4.1 新增 `app/utils/pdfAttachmentState.ts`，封装 `getPdfAttachmentState` 和 `updatePdfAttachmentState` API 调用。
- [x] 4.2 扩展 `shared/editor/lib/PdfDocument.ts` 的 `ActivePdfDocument`，加入 `attachmentId`、`contentType`、`size`，并从 attachment 节点 attrs 提取。
- [x] 4.3 调整 `shared/editor/nodes/Attachment.tsx`，打开 PDF 阅读态时传递足够的 document/attachment 信息，缺少 attachment id 时不显示状态保存入口。
- [x] 4.4 调整 `shared/editor/components/PDF.tsx`，保持现有浏览器 PDF preview，不引入新 PDF 库。
- [x] 4.5 在 PDF 阅读态中读取 `attachments.pdfState.get` 并展示 Outline 批注列表或批注面板。
- [x] 4.6 实现批注新增、编辑、删除的本地状态管理，保存时调用 `attachments.pdfState.update` 并带上当前 revision。
- [x] 4.7 readOnly 模式下只展示已有批注，不显示编辑和保存入口。
- [x] 4.8 revision 冲突时保留未保存的本地批注状态，并提示用户重新加载或重试。
- [x] 4.9 确保 UI 文案表达“保存批注”，不暗示保存或导出 PDF 文件本体。

## 5. 服务端测试

- [x] 5.1 扩展 `server/routes/api/attachments/attachments.test.ts`，覆盖 `attachments.pdfState.get` 无记录返回空状态。
- [x] 5.2 覆盖 PDF 状态创建、更新、revision 递增和 revision 冲突拒绝。
- [x] 5.3 覆盖无 read 权限不能读取、无 update 权限不能保存。
- [x] 5.4 覆盖非 PDF attachment、跨 team attachment、不属于请求 document 的 attachment 均被拒绝。
- [x] 5.5 覆盖 attachment 删除后 `AttachmentPdfState` 记录级联删除。
- [x] 5.6 覆盖无效 data：错误 version、错误 pageIndex、错误 type、过长 text、过多 annotations、过多 points。

## 6. 前端测试

- [x] 6.1 新增 `app/utils/pdfAttachmentState.test.ts`，覆盖 get/update API 请求参数、响应解析和冲突错误透传。
- [x] 6.2 新增或扩展 `app/components/PdfViewerDialog.test.tsx`，覆盖 PDF 阅读态不加载 `@embedpdf/react-pdf-viewer`。
- [x] 6.3 覆盖有 document id 和 attachment id 时读取 PDF 状态并展示批注。
- [x] 6.4 覆盖 readOnly 时展示批注但不显示编辑和保存入口。
- [x] 6.5 覆盖缺少 attachment id 时允许查看 PDF 原件但不显示状态保存入口。
- [x] 6.6 覆盖编辑批注后保存调用 `attachments.pdfState.update` 并带上 revision。
- [x] 6.7 覆盖 revision 冲突时保留本地未保存状态并显示冲突提示。

## 7. 验证与收尾

- [x] 7.1 运行 `rg "@embedpdf|/embedpdf|pdfium|wasm-unsafe-eval" package.json yarn.lock app shared server public`，确认没有未预期命中。
- [x] 7.2 运行 `yarn test server/routes/api/attachments/attachments.test.ts`。
- [x] 7.3 运行 `yarn test app/utils/pdfAttachmentState.test.ts`。
- [x] 7.4 运行 `yarn test app/components/PdfViewerDialog.test.tsx` 或实际采用的 PDF 阅读态组件测试文件。
- [ ] 7.5 运行 `yarn tsc --noEmit`。
- [x] 7.6 运行 `yarn lint`。
- [x] 7.7 手动验证 PDF attachment：可打开原 PDF、可读取/保存 Outline 批注、只读文档不可编辑批注、下载原 PDF 不包含侧车批注。
