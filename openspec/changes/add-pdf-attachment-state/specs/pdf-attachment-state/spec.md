## 新增需求

### 需求:系统必须移除新增 PDF 编辑库依赖
系统必须移除之前为 PDF 编辑保存引入的第三方 PDF 渲染/编辑库和配套运行时改动，并禁止第一版重新引入其他 PDF 渲染/编辑库。

#### 场景:移除 EmbedPDF 依赖
- **当** 依赖清理完成后
- **那么** `package.json` 中不得包含 `@embedpdf/react-pdf-viewer`

#### 场景:清理 EmbedPDF 锁文件条目
- **当** 依赖清理完成后
- **那么** `yarn.lock` 中不得包含仅由 `@embedpdf/react-pdf-viewer` 引入的 `@embedpdf/*` 条目

#### 场景:删除 PDFium 静态资源
- **当** 依赖清理完成后
- **那么** `public/embedpdf/` 必须不存在

#### 场景:移除 EmbedPDF 静态路由
- **当** 服务端静态资源路由加载时
- **那么** 系统禁止暴露 `/embedpdf/*` 静态资源路径

#### 场景:移除 PDFium 专用 CSP
- **当** CSP 中不存在其他功能需要 PDFium/WASM 配置
- **那么** 系统必须移除仅为 PDFium 添加的 `wasm-unsafe-eval` 和 EmbedPDF worker 配置

#### 场景:禁止新增替代 PDF 库
- **当** 第一版实现完成后
- **那么** 系统不得新增 `pdfjs-dist`、`pdf-lib`、`react-pdf`、`@react-pdf/*` 或其他 PDF 渲染/编辑库依赖

### 需求:系统必须保存 PDF attachment 侧车状态
系统必须为 PDF attachment 提供 Outline 内部侧车状态，状态绑定到当前 document 和 attachment，而不是写入 PDF 文件本体或 ProseMirror 节点 attrs。

#### 场景:无状态时返回空状态
- **当** 有 document read 权限的用户请求一个尚未保存批注状态的 PDF attachment
- **那么** 系统返回 `revision = 0` 和 `{ version: 1, annotations: [] }`

#### 场景:保存新状态
- **当** 有 document update 权限的用户提交 `revision = 0` 和合法批注数据
- **那么** 系统创建 `AttachmentPdfState` 记录并返回 `revision = 1`

#### 场景:更新已有状态
- **当** 有 document update 权限的用户提交当前 revision 和合法批注数据
- **那么** 系统更新同一 `(documentId, attachmentId)` 状态并返回递增后的 revision

#### 场景:状态不写入 PDF 文件
- **当** 用户保存 PDF 批注状态
- **那么** 系统不得修改 attachment 原文件、不得上传新 PDF、不得更新 ProseMirror attachment 节点的 `id` 或 `href`

#### 场景:状态不写入节点 attrs
- **当** 用户保存 PDF 批注状态
- **那么** 系统不得把批注 JSON 写入 ProseMirror attachment 节点 attrs

### 需求:系统必须按文档和附件限定状态作用域
系统必须使用 `(documentId, attachmentId)` 唯一确定一个 PDF 批注状态，并允许同一个 attachment 在不同 document 中拥有不同状态。

#### 场景:同文档同附件唯一
- **当** 同一 document 中同一 attachment 已有 PDF 状态
- **那么** 后续保存必须更新该状态而不是创建重复记录

#### 场景:不同文档状态隔离
- **当** 同一个 attachment 被不同 document 引用
- **那么** 每个 document 必须读取和保存自己的 PDF 状态，不得返回其他 document 的状态

#### 场景:删除 attachment 级联删除状态
- **当** PDF attachment 被删除
- **那么** 系统必须删除与该 attachment 关联的 PDF 状态记录

### 需求:系统必须校验 PDF 状态读写权限
系统必须基于 document 权限控制 PDF 状态读写，并校验 attachment 属于当前团队、当前 document 且是 PDF。

#### 场景:读取需要文档 read 权限
- **当** 用户拥有 document read 权限并请求该 document 中 PDF attachment 的状态
- **那么** 系统返回该 PDF 状态

#### 场景:无 read 权限不能读取
- **当** 用户没有 document read 权限
- **那么** 系统禁止读取 PDF 状态

#### 场景:保存需要文档 update 权限
- **当** 用户拥有 document update 权限并提交合法 PDF 状态
- **那么** 系统允许保存 PDF 状态

#### 场景:无 update 权限不能保存
- **当** 用户没有 document update 权限
- **那么** 系统禁止保存 PDF 状态

#### 场景:拒绝非 PDF attachment
- **当** 用户请求保存 `contentType` 不是 `application/pdf` 的 attachment 状态
- **那么** 系统拒绝请求

#### 场景:拒绝跨团队 attachment
- **当** 请求中的 attachment 不属于当前用户团队
- **那么** 系统禁止读取或保存 PDF 状态

#### 场景:拒绝不属于文档的 attachment
- **当** 请求中的 attachment 不属于请求中的 document
- **那么** 系统禁止读取或保存 PDF 状态

### 需求:系统必须防止 PDF 状态并发静默覆盖
系统必须使用 revision 乐观并发控制 PDF 状态更新，禁止旧 revision 静默覆盖新状态。

#### 场景:revision 匹配时保存成功
- **当** 请求中的 revision 与当前状态 revision 一致
- **那么** 系统保存状态并返回递增后的 revision

#### 场景:revision 不匹配时拒绝保存
- **当** 请求中的 revision 低于或不同于当前状态 revision
- **那么** 系统拒绝保存并返回冲突错误

#### 场景:冲突时前端不覆盖本地状态
- **当** 前端收到 revision 冲突错误
- **那么** 前端必须保留当前未保存批注状态并提示用户重新加载或重试

### 需求:系统必须校验 PDF 状态数据
系统必须校验 PDF 状态 JSON 的结构和大小，防止无效数据或过大数据写入数据库。

#### 场景:拒绝无效版本
- **当** 用户提交 `version` 不是 `1` 的 PDF 状态
- **那么** 系统拒绝请求

#### 场景:拒绝无效页码
- **当** 用户提交 `pageIndex` 小于 0 或不是整数的批注
- **那么** 系统拒绝请求

#### 场景:拒绝无效批注类型
- **当** 用户提交不在 `note`、`highlight`、`rectangle`、`ink` 范围内的批注类型
- **那么** 系统拒绝请求

#### 场景:拒绝过长文本
- **当** 用户提交超过服务端限制长度的批注文本
- **那么** 系统拒绝请求

#### 场景:拒绝过多批注
- **当** 用户提交超过服务端允许数量的批注列表
- **那么** 系统拒绝请求

#### 场景:拒绝过大点集
- **当** 用户提交超过服务端允许点数的 `points`
- **那么** 系统拒绝请求

### 需求:前端必须以库无关方式展示和保存 PDF 批注状态
前端必须继续使用现有浏览器 PDF 预览能力，并在 Outline UI 中读取、展示和保存 PDF 批注状态，不得加载第三方 PDF viewer。

#### 场景:读取 PDF 状态
- **当** 用户打开带有 attachment id 的 PDF attachment 阅读视图
- **那么** 前端请求 `attachments.pdfState.get` 并展示返回的批注状态

#### 场景:保存 PDF 状态
- **当** 有 update 权限的用户编辑批注并点击保存
- **那么** 前端调用 `attachments.pdfState.update` 并带上当前 revision

#### 场景:只读用户不显示保存入口
- **当** 用户只能读取文档
- **那么** 前端必须展示已有批注状态但不显示批注编辑或保存入口

#### 场景:缺少 attachment id 时不保存
- **当** PDF attachment 节点缺少 attachment id
- **那么** 前端必须允许查看 PDF 原件但不显示 PDF 状态保存入口

#### 场景:不加载第三方 PDF viewer
- **当** PDF 阅读视图渲染
- **那么** 前端不得 import 或加载 `@embedpdf/react-pdf-viewer`

### 需求:系统必须明确 PDF 侧车状态可见性
系统必须把 PDF 批注状态定义为 Outline 内部状态，并禁止向用户暗示原始 PDF 文件已被修改。

#### 场景:下载原 PDF 不包含侧车批注
- **当** 用户直接打开或下载原始 attachment
- **那么** 系统返回原 PDF 文件且不承诺包含 Outline 侧车批注

#### 场景:UI 文案区分批注保存和 PDF 保存
- **当** 前端展示保存操作
- **那么** 文案必须表达保存的是批注状态，而不是保存或导出 PDF 文件本体

## 修改需求

无。

## 移除需求

无。
