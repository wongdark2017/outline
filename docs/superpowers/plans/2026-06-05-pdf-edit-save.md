# PDF 编辑与保存功能实现方案

## 一、结论

新方案需要先把之前额外加入的 PDF 库去掉。当前工作区里对应的是 `@embedpdf/react-pdf-viewer` 以及它带来的 `@embedpdf/*` 锁文件条目、`public/embedpdf` 静态资源、PDFium/WASM 相关 CSP 和静态路由调整。

移除后，方案不再依赖 EmbedPDF、PDFium、`ExportPlugin`、`AnnotationPlugin` 等 API。默认保存路径改为 SiYuan 风格的“PDF 原件不动，批注状态单独保存”：

```
用户查看 PDF
  -> Outline 读取 attachment 原文件
  -> Outline 读取 attachment/document 绑定的侧车 JSON 状态
  -> 用户保存批注状态
  -> 写入数据库 JSONB 侧车记录
  -> 下次打开 PDF 时恢复侧车状态
```

第一版不实现“把批注写回 PDF 文件本体”，也不实现“保存为包含批注的新 PDF 副本”。移除 PDF 渲染/编辑库后，可靠的页内坐标、文本选区、表单字段和签名写回都没有可用引擎支撑；这些能力如果仍然需要，必须作为后续单独选型和实现。

---

## 二、必须移除的新增 PDF 库内容

### 2.1 依赖和锁文件

**文件：**

- `package.json`
- `yarn.lock`

**要求：**

- 删除 `package.json` 中的 `@embedpdf/react-pdf-viewer`。
- 运行 `yarn install` 让 `yarn.lock` 移除所有仅由它引入的 `@embedpdf/*` 条目。
- 不新增 `pdfjs-dist`、`pdf-lib`、`react-pdf`、`@react-pdf/*` 或其他 PDF 渲染/编辑库。

### 2.2 静态资源

**路径：**

- `public/embedpdf/`

**要求：**

- 删除 PDFium wasm 和 EmbedPDF 相关静态文件。
- `server/routes/index.ts` 不再暴露 `/embedpdf/*` 静态路径。

### 2.3 CSP 和运行时配置

**文件：**

- `server/middlewares/csp.ts`

**要求：**

- 移除仅为 PDFium/WASM 添加的 `wasm-unsafe-eval`。
- 移除仅为 EmbedPDF worker 添加的 `workerSrc: ["'self'", "blob:"]`，除非其他现有功能已经需要它。

### 2.4 前端组件

**文件：**

- `app/components/PdfViewerDialog.tsx`
- `shared/editor/nodes/Attachment.tsx`
- `shared/editor/lib/PdfDocument.ts`
- `shared/editor/components/PDF.tsx`

**要求：**

- 删除所有 `@embedpdf/*` import。
- 如果保留独立 PDF 阅读弹层，使用现有浏览器 PDF 预览能力，不引入新库。
- `shared/editor/components/PDF.tsx` 继续作为现有 attachment preview，不承担批注渲染引擎职责。

---

## 三、SiYuan 参考结论

SiYuan 的 PDF 保存模型不是重写 PDF 文件，而是把 PDF 原件和注释数据拆开：

- PDF 原件保留为 `assets/foo.pdf`。
- 注释状态保存为并列的 `assets/foo.pdf.sya` JSON 文件。
- 前端把批注页码、坐标、颜色、内容、类型等信息写到 `/api/asset/setFileAnnotation`。
- 后端写入 `.sya` 并触发同步。
- 打开 PDF 时读取 `.sya`，再把注释渲染到 PDF 页面上。
- PDF 重命名、导出时会连带复制 `.sya`。

对 Outline 的启发：

- 不应把每次保存都变成“创建新 attachment”。
- 侧车状态应跟 PDF attachment 绑定，而不是写进 ProseMirror 节点 attrs。
- Outline 不适合照搬 `.sya` 文件；更合适的是数据库 JSONB 侧车，这样能沿用权限、事务、审计和团队隔离。

---

## 四、更新后的目标

### 4.1 默认保存：PDF 侧车状态

默认保存只持久化 Outline 自己定义的 PDF 批注状态，PDF attachment 原文件不变。

第一版支持范围：

- 批注列表。
- 页码级批注。
- 可选的矩形区域、颜色、文本内容和作者信息。
- 读取和保存侧车状态。

第一版不支持范围：

- PDF 文件本体写回。
- 表单字段写回。
- 签名写回。
- 文本选区高亮的精确坐标捕获。
- 导出包含批注的新 PDF 文件。

### 4.2 权限

- 有文档 read 权限的用户可以读取 PDF 侧车状态。
- 有文档 update 权限的用户才可以保存 PDF 侧车状态。
- 只读模式下展示已保存状态，不显示编辑或保存入口。

### 4.3 产品边界

移除 PDF 库后，第一版应把“保存批注状态”定义为 Outline 内部能力，而不是完整 PDF 编辑器能力。用户直接打开原始 attachment 或下载原 PDF 时，不会看到侧车批注。

---

## 五、核心架构

### 5.1 数据模型

新增服务端模型 `AttachmentPdfState`，对应表 `attachment_pdf_states`。

建议字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `teamId` | UUID | 权限隔离和查询过滤 |
| `documentId` | UUID | 当前文档 |
| `attachmentId` | UUID | PDF attachment |
| `data` | JSONB | PDF 侧车状态 |
| `revision` | integer | 乐观并发版本，从 0 开始递增 |
| `createdById` | UUID | 首次创建用户 |
| `updatedById` | UUID | 最近更新用户 |
| `createdAt` / `updatedAt` | timestamp | 标准时间戳 |

约束和索引：

- 唯一索引：`(documentId, attachmentId)`。
- 外键：`attachmentId -> attachments.id ON DELETE CASCADE`。
- 外键：`documentId -> documents.id ON DELETE CASCADE`。
- 索引：`teamId`、`attachmentId`、`documentId`。

`data` 使用库无关结构：

```ts
export interface AttachmentPdfStateData {
  version: 1;
  annotations: OutlinePdfAnnotation[];
}

export interface OutlinePdfAnnotation {
  id: string;
  pageIndex: number;
  type: "note" | "highlight" | "rectangle" | "ink";
  color: string;
  text: string;
  rect: OutlinePdfRect | null;
  points: OutlinePdfPoint[] | null;
  createdById: string;
  updatedById: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutlinePdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OutlinePdfPoint {
  x: number;
  y: number;
}
```

### 5.2 API

在 `server/routes/api/attachments/attachments.ts` 增加两个端点：

```text
attachments.pdfState.get
attachments.pdfState.update
```

`attachments.pdfState.get` 入参：

```ts
interface AttachmentPdfStateGetRequest {
  documentId: string;
  attachmentId: string;
}
```

返回：

```ts
interface AttachmentPdfStateResponse {
  attachmentId: string;
  documentId: string;
  revision: number;
  data: AttachmentPdfStateData;
}
```

如果没有记录，返回空状态：

```ts
{
  version: 1,
  annotations: [],
}
```

`attachments.pdfState.update` 入参：

```ts
interface AttachmentPdfStateUpdateRequest {
  documentId: string;
  attachmentId: string;
  revision: number;
  data: AttachmentPdfStateData;
}
```

服务端逻辑：

1. 校验 attachment 存在、属于当前 team，且 `contentType === "application/pdf"`。
2. 校验 document 存在，并 authorize 当前用户。
3. `get` 需要 document read 权限。
4. `update` 需要 document update 权限。
5. 当前记录 revision 和请求 revision 不一致时返回冲突错误，第一版不自动合并。
6. 写入成功后 revision 加 1，并返回最新状态。

---

## 六、实施步骤

### 步骤 0：移除新增 PDF 库

**文件和路径：**

- 修改：`package.json`
- 修改：`yarn.lock`
- 修改：`server/routes/index.ts`
- 修改：`server/middlewares/csp.ts`
- 删除：`public/embedpdf/`
- 修改或删除：`app/components/PdfViewerDialog.tsx`

**具体操作：**

- 从 `package.json` 删除 `@embedpdf/react-pdf-viewer`。
- 运行 `yarn install` 更新 `yarn.lock`。
- 删除 `public/embedpdf/`。
- 从 `server/routes/index.ts` 移除 `/embedpdf/*`。
- 从 `server/middlewares/csp.ts` 移除 PDFium/WASM 专用 CSP。
- 删除前端所有 `@embedpdf/*` import。

**验证：**

```bash
rg "@embedpdf|/embedpdf|pdfium|wasm-unsafe-eval" package.json yarn.lock app shared server public
```

期望：没有结果，除非命中本方案文档或历史说明文件。

### 步骤 1：新增共享 PDF 状态类型

**文件：**

- 新增：`shared/types/PdfAttachmentState.ts`

**职责：**

- 定义 `AttachmentPdfStateData`。
- 定义 `OutlinePdfAnnotation`。
- 定义 `OutlinePdfRect`。
- 定义 `OutlinePdfPoint`。
- 不引用任何 PDF viewer 或 PDF 编辑库类型。

### 步骤 2：新增服务端模型、迁移和 API

**文件：**

- 新增：`server/models/AttachmentPdfState.ts`
- 修改：`server/models/index.ts`
- 新增：`server/migrations/<timestamp>-create-attachment-pdf-states.js`
- 修改：`server/routes/api/attachments/schema.ts`
- 修改：`server/routes/api/attachments/attachments.ts`

**职责：**

- 创建 `attachment_pdf_states` 表。
- 新增 `attachments.pdfState.get`。
- 新增 `attachments.pdfState.update`。
- 实现 attachment/document/team 校验。
- 实现 read/update 权限校验。
- 实现 revision 冲突保护。
- 限制 `data` 体积，避免单个 PDF 状态无限增长。

### 步骤 3：扩展 ActivePdfDocument

**文件：**

- 修改：`shared/editor/lib/PdfDocument.ts`

**职责：**

- 在 `ActivePdfDocument` 增加 `attachmentId`、`contentType`、`size`。
- `createActivePdfDocument` 从 attachment 节点 attrs 提取这些字段。
- 保持 `href` 经过 `sanitizeUrl()`。
- 不引入 PDF viewer 依赖。

### 步骤 4：实现前端 PDF 状态 API 工具

**文件：**

- 新增：`app/utils/pdfAttachmentState.ts`

**职责：**

- 封装 `client.post("/attachments.pdfState.get", ...)`。
- 封装 `client.post("/attachments.pdfState.update", ...)`。
- 返回类型使用 `AttachmentPdfStateResponse`。
- 不在组件里散落 API method 字符串。

### 步骤 5：调整 PDF 阅读 UI

**文件：**

- 修改：`shared/editor/components/PDF.tsx`
- 修改：`shared/editor/nodes/Attachment.tsx`
- 修改或删除：`app/components/PdfViewerDialog.tsx`

**职责：**

- 保留现有浏览器 PDF 预览能力。
- 如果保留全屏阅读弹层，只使用原生 `<object>` / `<iframe>` 预览，不加载第三方 PDF 库。
- 在阅读态旁边展示 Outline 批注列表。
- 批注编辑保存调用 `attachments.pdfState.update`。
- readOnly 时只读取和展示批注列表。

**边界：**

- 不实现页内文本选区高亮。
- 不实现 PDF 表单字段保存。
- 不实现签名工具。
- 不实现 PDF 副本导出。

### 步骤 6：测试

**依赖清理验证：**

```bash
rg "@embedpdf|/embedpdf|pdfium|wasm-unsafe-eval" package.json yarn.lock app shared server public
```

期望：没有结果，除非命中本方案文档或历史说明文件。

**服务端测试：**

```bash
yarn test server/routes/api/attachments/attachments.test.ts
```

覆盖：

- `attachments.pdfState.get` 空状态和已有状态。
- `attachments.pdfState.update` 创建、更新、revision 冲突。
- 权限、team 隔离、非 PDF 拒绝。
- attachment 删除后侧车记录级联删除。

**前端工具测试：**

```bash
yarn test app/utils/pdfAttachmentState.test.ts
```

覆盖：

- `getPdfAttachmentState` 请求参数。
- `updatePdfAttachmentState` 请求参数。
- 空状态响应。
- revision 冲突错误透传。

**编辑器测试：**

```bash
yarn test app/editor/index.test.tsx
yarn test app/components/PdfViewerDialog.test.tsx
```

覆盖：

- 有 document id 和 attachment id 时读取侧车状态。
- readOnly 时不传保存能力。
- 缺少 attachment id 时不显示保存入口。
- 批注保存调用 `attachments.pdfState.update`。
- 不加载 `@embedpdf/react-pdf-viewer`。

**类型检查：**

```bash
yarn tsc --noEmit
```

---

## 七、生命周期与产品取舍

### 7.1 旧附件堆积问题

侧车保存不会创建新附件，因此不再把旧附件堆积作为日常保存成本。

第一版取消“保存为 PDF 副本”后，也不会因为 PDF 编辑保存产生新的 attachment 版本。

### 7.2 侧车状态的可见性

侧车状态只在 Outline 内可见。用户直接打开原始 attachment 或下载原 PDF 时，不会看到侧车批注。

### 7.3 并发策略

PDF 侧车状态不接入当前 ProseMirror/Y.js 协作链路。第一版使用乐观并发：

- 打开时拿到 `revision`。
- 保存时带上 `revision`。
- revision 冲突时阻止覆盖，并提示重新加载。

不在第一版实现多用户 annotation merge。

### 7.4 为什么不把状态放到节点 attrs

不建议把 PDF 批注 JSON 放进 ProseMirror attachment attrs：

- 会增大文档内容体积。
- 每次批注变化都会污染文档 revision。
- 多个 attachment 节点引用同一 PDF 时难以定义共享/隔离语义。
- 批注生命周期应该跟 attachment/document 绑定，而不是跟编辑器节点内容混在一起。

---

## 八、最终推荐

采用“先清理依赖，再实现库无关侧车状态”的方案：

1. 移除之前新增的 `@embedpdf/react-pdf-viewer` 和相关 PDFium/WASM 改动。
2. 默认保存到 `AttachmentPdfState` JSONB 侧车。
3. 第一版只做 Outline 内部批注状态保存，不做 PDF 文件写回和 PDF 副本导出。
4. 如果后续必须实现页内精确批注、表单、签名或 PDF 写回，再单独做 PDF 渲染/编辑引擎选型。
