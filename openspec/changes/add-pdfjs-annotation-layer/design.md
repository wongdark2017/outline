## 上下文

Outline 当前已经具备 PDF attachment 上传、下载、重定向和文档内预览能力。上一阶段 `add-pdf-attachment-state` 新增了 `AttachmentPdfState` 表、`attachments.pdfState.get/update` API、权限校验和 revision 并发控制，但前端只是用原生 iframe 展示 PDF，并在右侧提供纯文本批注列表。

这种 UI 不是真正的 PDF 标注：它不能在页面原文上高亮，不能做矩形框选，也无法将标注与 PDF 页面坐标关联。思源式体验需要可控的 PDF 渲染层和文本层，因此必须从浏览器原生 PDF viewer 切换到 PDF.js。PDF 原件仍保持只读，标注作为 Outline 内部侧车状态保存。

## 目标 / 非目标

**目标：**

- 使用 `pdfjs-dist` 在全屏 PDF 阅读态中渲染 PDF 页面、文本层和自定义标注层。
- 移除当前用户可见的纯文本 note sidecar 批注面板。
- 支持文本选择高亮、矩形标注、颜色选择、标注列表和点击标注跳转页面。
- 复用 `AttachmentPdfState` 的 `(documentId, attachmentId)` 作用域、权限校验和 revision 并发控制。
- 将侧车状态升级为页内标注模型，保存稳定的页面归一化坐标，而不是屏幕像素。
- 保持文档内 PDF preview 和原 PDF 下载行为可用。
- 验证 PDF.js worker、Vite 构建、CSP 和 Range 请求在开发/生产下可用。

**非目标：**

- 不修改 PDF 原文件内容。
- 不写回或导出包含标注的新 PDF。
- 不保存 PDF 表单字段。
- 不实现签名。
- 不实现手写 ink。
- 不实现矩形标注截图上传。
- 不做多用户实时协同编辑标注。
- 不把标注 JSON 写入 ProseMirror attachment 节点 attrs。
- 不新增 `pdf-lib`、`react-pdf`、`@react-pdf/*` 或商业 PDF 编辑 SDK。

## 决策

### 决策 1：使用 PDF.js Display 层自建阅读器，而不是 iframe 或官方完整 Viewer

`PdfViewerDialog` 的主阅读区改为 Outline 自己的 PDF.js 阅读器。阅读器直接使用 `pdfjs-dist` 加载 `/api/attachments.file?id=<attachmentId>`，按页渲染 canvas，并渲染 text layer 以支持文字选择和坐标计算。

替代方案一是继续使用 iframe。iframe 无法稳定访问浏览器内置 PDF viewer 的文本 selection、页面坐标和 DOM 结构，不能实现可靠高亮，因此不采用。

替代方案二是嵌入 PDF.js 官方完整 Viewer。官方 Viewer 带来路由、工具栏、状态和样式的整套产品形态，难以和 Outline 权限、保存按钮、标注状态、主题和测试体系融合，因此不采用。

### 决策 2：sidecar 存储保留，用户可见的纯文本 sidecar 批注 UI 删除

删除当前右侧“添加文字批注 / 保存批注”的临时体验。`AttachmentPdfState` 表和 API 继续保留，因为页内标注仍然需要和 PDF 原件分离保存。

现有 `version: 1` note-style 状态不作为正式能力继续展示。新标注状态使用 `version: 2`，表示 PDF.js 页内标注数据。读取到旧 `version: 1` 状态时，前端可以忽略旧 note 列表或显示非阻塞兼容提示；服务端 schema 在迁移期可以接受 `version: 1 | 2`，但 update 只写 `version: 2`。

### 决策 3：坐标保存为页面归一化坐标

标注 rect 使用相对于 PDF 页面 viewport 的归一化坐标：

```text
x = left / pageWidth
y = top / pageHeight
width = rectWidth / pageWidth
height = rectHeight / pageHeight
```

渲染时再乘以当前页面显示尺寸。这样缩放、窗口变化和不同 DPR 下标注不会漂移。

替代方案是保存屏幕像素。该方案在缩放、响应式布局和移动端下不稳定，因此不采用。

### 决策 4：文本高亮通过 text layer selection 转换为 rects

文本高亮流程：

1. 用户在 text layer 中选中文字。
2. 前端读取 `window.getSelection()` 和 `Range.getClientRects()`。
3. 过滤出属于同一 PDF 页的 rect。
4. 将 DOM rect 转换为 page-local rect。
5. 归一化后保存到 annotation `rects`。
6. annotation layer 根据 rects 绘制半透明高亮块。

第一版只支持单页 selection。跨页 selection 必须拆分或拒绝，避免一次操作产生不清晰的数据。

### 决策 5：矩形标注通过 page overlay pointer events 创建

矩形模式下，页面 overlay 捕获 pointer down/move/up，显示临时矩形预览，释放后生成归一化 rect。标注模式支持 `fill` 和 `border` 两种呈现，颜色来自 toolbar 的当前颜色。

### 决策 6：标注状态模型升级为 version 2

建议数据形态：

```ts
interface AttachmentPdfStateDataV2 {
  version: 2;
  annotations: OutlinePdfAnnotationV2[];
}

interface OutlinePdfAnnotationV2 {
  id: string;
  pageIndex: number;
  type: "text" | "rectangle";
  mode: "highlight" | "fill" | "border";
  color: string;
  text: string;
  selectedText: string | null;
  rects: OutlinePdfRect[];
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}
```

`text` 用于列表和复制引用，`selectedText` 保存原文选区内容，`rects` 是标注定位来源。第一版不保存截图 attachment，也不保存块关联关系。

### 决策 7：前端组件按渲染、状态、交互分层

建议结构：

```text
app/components/PdfViewerDialog.tsx
app/components/PdfViewer/
  PdfJsDocument.tsx
  PdfJsPage.tsx
  PdfAnnotationLayer.tsx
  PdfAnnotationToolbar.tsx
  PdfAnnotationSidebar.tsx
  pdfCoordinates.ts
  pdfSelection.ts
  pdfState.ts
```

`PdfViewerDialog` 负责弹层壳、加载状态和 API 保存。PDF.js 具体渲染和坐标逻辑放到独立模块，便于测试。

### 决策 8：PDF.js worker 通过 Vite 资产管线加载

优先采用 Vite 兼容的 worker URL 导入方式，例如从 `pdfjs-dist/build/pdf.worker.mjs` 生成 worker URL，并设置 `GlobalWorkerOptions.workerSrc`。实现阶段必须验证开发和生产构建。

如果 CSP 阻止 worker 加载，则只为应用主 CSP 增加最小必要 `worker-src 'self' blob:` 或等效配置，不恢复旧 `/embedpdf/*` 静态路由，也不引入 `wasm-unsafe-eval`。

### 决策 9：文档内小预览暂不替换

`shared/editor/components/PDF.tsx` 的文档内 preview 可继续使用当前浏览器预览/卡片行为。第一阶段只替换全屏阅读态，降低性能、布局和编辑器节点风险。

## 风险 / 权衡

- PDF.js worker 被 CSP 或 Vite 打包路径阻止 → 先做 worker spike，并将构建验证列为任务。
- 大 PDF 一次性渲染所有页面导致性能差 → 第一版实现按可见区域懒渲染或有限预渲染；若虚拟化复杂，至少限制并发渲染和清理离屏 canvas。
- 高亮坐标在缩放后漂移 → 所有状态只存页面归一化坐标，坐标转换函数必须单元测试。
- text layer selection 跨多个 span/行 → 使用 Range rects，不依赖单个 span；第一版限制单页 selection。
- 移动端拖拽和文本选择冲突 → 移动端优先支持查看和跳转，标注创建可先优化桌面体验。
- 旧 version 1 note 状态无处展示 → 迁移期忽略或提示旧批注不可用；正式能力只写 version 2。
- revision 冲突导致用户丢标注 → 沿用当前冲突处理，保留本地状态并提示 reload；批注级 merge 放后续。
- 新依赖增加 bundle 体积 → PDF.js 阅读器保持 lazy load，仅打开 PDF 时加载。

## 迁移计划

1. 保留 `AttachmentPdfState` 表和 API 路径，扩展共享类型和 zod schema 支持 `version: 2`。
2. 删除或隐藏当前纯文本 note 批注 UI，不再提供 “Add annotation” 文本框。
3. 引入 `pdfjs-dist` 并实现最小 PDF.js 页面渲染 spike，确认 worker、CSP 和 Range 请求。
4. 替换全屏阅读态主区域为 PDF.js 阅读器。
5. 添加文本高亮、矩形标注、颜色、列表和跳转。
6. 保存只写 version 2 状态。
7. 若需要回滚，保留 API/表，关闭 PDF.js 阅读器入口，回退到原 iframe 阅读态但不恢复纯文本批注 UI。

## 待确认问题

- 旧 version 1 note 数据是否需要显示“旧批注已隐藏”的提示，还是直接忽略。
- 第一版是否需要复制引用文本，还是只做跳转和列表。
- 是否需要支持密码 PDF 的错误提示和输入流程。
- 文档内小预览是否后续也要换成 PDF.js 缩略图。
