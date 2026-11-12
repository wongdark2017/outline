# Excalidraw 集成技术设计

## 改动边界

当前行为缺口是文档无法创建或重新打开本地编辑的 Excalidraw 图片。功能应落在编辑器 UI 扩展、现有图片节点和附件上传流程中，不需要新文档模型或新编辑器节点。预计涉及 `package.json` 和 `yarn.lock`（SDK）、`app/editor/extensions/` 与 `app/editor/components/`（会话和弹窗）、`app/editor/menus/block.tsx` 与 `app/editor/menus/image.tsx`（入口和操作）、`app/components/Lightbox.tsx`（编辑交接）、`shared/editor/lib/FileHelper.ts` 及图片渲染和序列化组件（来源识别、显示和导出），以及同级测试。只有确认现有上传或 SVG 安全处理存在缺口时才改后端。TikZ 和 diagrams.net 的既有行为必须保持；若调整共享图片逻辑，需用修改前后的测试证明这两条路径未变化。

## 架构与数据流

1. 通过 Yarn 加入 `@excalidraw/excalidraw`。仅在打开可编辑会话时动态加载组件和 CSS。生产 Web 客户端已有的 service worker 对首次请求后的 `/static/assets/*.js` 分块采用 `CacheFirst`；其他环境直接按需加载，不新增缓存系统。沿用现有静态资源策略，自托管其字体和资源，使自托管部署无需依赖 Excalidraw CDN。接入 UI 前先核对所选版本与 React、Vite、CSP 的兼容性。
2. 在 `app/editor/extensions/index.ts` 中、`TikzExtension` 旁注册一个 Excalidraw UI 扩展。它负责 `insertExcalidraw`、`editExcalidraw`、编辑会话、目标位置映射和延迟加载的弹窗组件。新建会话记录并映射插入位置；原插入段落被删除时立即关闭画布、丢弃会话内未保存绘图并提示，不能改在别处插入。编辑会话记录准确的选中图片及其原始 `src`。
3. 复用现有 `image` 节点和附件上传回调。增加 `ImageSource.Excalidraw`，并通过现有图片 HTML/Markdown 路径序列化来源属性；仅本功能保存的附件带此来源标记，上传或粘贴的 Excalidraw SVG 仍作为普通图片。编辑已有图时使用 `fetch(src, { cache: "no-store" })` 读取原 SVG。使用官方 SDK 的 `exportToSvg`，设置 `exportEmbedScene: true`、`exportWithDarkMode: false` 并包含场景文件；在修改文档前验证 `loadFromBlob` 能从结果中恢复场景。内嵌场景缺失或损坏时报告编辑加载错误，绝不以空白画布覆盖原图。场景数据存于 SVG 附件，不新增 ProseMirror 属性或数据库字段。
4. 画布状态保留在弹窗本地。`onChange` 记录元素、应用状态和文件。按用户补充的规则，以未删除元素的 `version` 总和、元素数量及文件 ID 作为与加载时基线比较的 dirty 指纹；删除和新增元素可能产生相同求和，实施前须用测试验证该算法不会漏报修改，必要时增加元素 ID 与版本配对。顶部状态跟随未保存修订；仅已有图的编辑会话同步本地草稿。点击“保存并退出”后锁定画布，导出 SVG 并经现有 `attachments.create` 元数据校验；服务端按 `DocumentAttachment` 的 `FILE_STORAGE_UPLOAD_MAX_SIZE` 在文件内容上传前拒绝超限。上传完成后再次检查会话身份、权限、目标映射和冲突状态，最后用一次 ProseMirror 事务插入或替换图片并经 Yjs 传播。新图在映射后的原光标位置调用 `replaceSelectionWith`；失败后解除锁定并保留画布。已过期的保存尝试不改变文档。
5. 只有编辑已保存图片时才持久化本地草稿，采用带版本与时间戳的场景快照，键为 `excalidraw-draft:<documentId>:<src>`。只保存已改变的场景，按 30 秒周期写入，并在 `pagehide` 与确认退出时尽力写入；七天后过期。若写入因配额不足而失败，保留最近一次成功写入的草稿和现有错误提示。新建会话首次保存前只保留画布内存状态，退出或关闭页面后直接丢弃，不写入 `new` 草稿，也不显示恢复栏。不设固定草稿大小阈值；只有已有图的本地草稿写入因浏览器配额不足而失败时，才显示设计稿中的“草稿过大”状态，不阻止手动保存。该配额与服务器附件大小限制无关。成功写入文档后只清除对应草稿。
6. 参照 `TikzSession.mapImagePosition`，通过事务映射精确追踪编辑目标。将目标承载场景的 `src` 与打开时的版本比较。原图被删除、替换，或另一张图碰巧使用相同 URL 时，不可误替换。若同一张图只发生布局、说明文字或评论属性变化，替换时保留最新属性；保留显示宽度，并按新 SVG 长宽比重算高度。出现冲突时，可在当前光标插入副本；只有原目标仍存在时，才允许显式覆盖。
7. 阅读者、静态 HTML、打印和导出继续将 Excalidraw 作为普通图片处理。按本功能写入的图片来源标记调整工具栏、小图判断、灯箱操作和仅屏幕生效的深色样式。用户上传或粘贴的 Excalidraw SVG 走普通图片路径；只读用户不加载画布。

## UI 与状态约定

- 弹窗状态包括加载中、无修改、未保存、保存中、空画布和草稿过大。保存期间禁用绘制与画布修改；退出确认与保存冲突是覆盖在画布上的独立对话框。保存失败显示提示消息，并保留场景、返回未保存状态。
- 只能通过弹窗自己的操作按钮关闭，原插入段落被协作者删除时的强制关闭除外。Escape 和背景点击不触发弹窗关闭。`⌘/Ctrl+S` 与顶部按钮调用同一个保存函数并阻止浏览器保存页面；Escape 由 Excalidraw 内部控件处理。
- 编辑已有图时，恢复或丢弃只改变本地草稿。新建会话退出时直接丢弃内存中的未保存绘图。文档内容仅在保存事务成功后变化。
- 素材库存于浏览器的 `localStorage`；只有实际进入当前场景的素材内容才会随该场景进入图片附件。

## 非功能性需求的实现边界

- **性能：**沿用 TikZ 的延迟加载模式。关闭画布时不挂载 Excalidraw，也不把其代码、样式或字体放进文档首屏资源。画布变化只更新内存中的场景快照；已有图的草稿按 30 秒周期持久化，SVG 导出与上传仅发生在手动保存时。以初始文档路径对 Excalidraw 专用资源零请求为验收关口；用固定的 100 元素、一张内嵌图片场景记录构建产物和浏览器性能报告，并检查草稿写入期间的绘图响应。本期不设置固定毫秒上限。
- **兼容性：**以仓库 `package.json` 的 `> 0.25%, not dead` 和 Vite 的 `browserslistToEsbuild()` 为应用目标，再核对选定 Excalidraw SDK 的浏览器支持范围。官方 SDK 当前的浏览器列表排除了 Safari 14.1 以下版本，最终支持矩阵应按实际锁定版本确认。Safari 桌面与 iOS 真机或真实 WebKit 的画布、触控、文件读写和草稿行为必须验证；不支持编辑时保留普通图片阅读能力。
- **埋点：**复用 `app/utils/Analytics.ts` 的 `track(event, action, metadata)` 入口。当前实现仅发送 Google Analytics 事件，但应用还会加载已配置的 Matomo 和 Umami，因此在现有入口中补齐这些已配置渠道，不新增分析平台、配置项或服务端端点。固定类别为 `excalidraw`，动作和元数据只取 PRD 允许的枚举。GA3 等不能传递全部元数据的渠道至少保留固定动作名。事件发送采用尽力而为；异常不进入保存流程。画布每次变化和定时草稿写入都不埋点。

## 兼容性与风险

- 内嵌场景可能超过现有附件限制。测试可接受的最大 SVG，尽可能在上传前提示大小错误；不截断场景数据。
- 现有 `attachments.create` 会先校验附件大小，再允许上传文件内容；文档附件的上限来自服务端 `FILE_STORAGE_UPLOAD_MAX_SIZE`，并非固定的团队数值。客户端无需新增配置或端点来复制该上限，须将服务端超限错误映射为绘图过大提示。
- 验证导出的 SVG 符合 Outline 的图片服务与 CSP 约束，且内嵌场景数据经过上传、获取、HTML 导出后仍能恢复。不增加自定义 SVG 脚本执行或外部资源加载。
- 用户提供的 dirty 指纹公式可能在删除一个元素并新增另一个同版本元素时得到相同结果；必须覆盖该场景，不能把实际修改误判为干净状态。
- 现有 service worker 会预缓存构建产物中的 CSS。若 Excalidraw CSS 被打成独立文件，需要验证它不会在打开画布前被预缓存，否则不满足 R09 的首屏资源要求。
- 编辑已有图时，`pagehide` 和移动端标签页终止时的写入只能尽力执行；周期性本地草稿是恢复基线。新图首次保存前不写草稿，页面关闭时不能恢复未保存绘图。
- 当前文档 Schema 与服务端渲染共享。增加图片来源枚举并复用图片节点预计不需要迁移，但必须实际验证服务端图片序列化。
- Excalidraw 包不提供宿主应用的实时协作；文档级保存冲突由本集成处理。

## 调研资料

- [Excalidraw 集成说明](https://plus.excalidraw.com/docs/sdk/excalidraw/integration)：React 组件与客户端加载。
- [导出工具](https://plus.excalidraw.com/docs/sdk/excalidraw/api/utils/export)：`exportToSvg` 与 `exportEmbedScene`。
- [SDK 工具](https://plus.excalidraw.com/docs/sdk/excalidraw/api/utils)：`loadFromBlob`、`serializeAsJSON` 和素材库工具。
- [组件参数](https://plus.excalidraw.com/docs/sdk/excalidraw/api/props)：`onChange`、`langCode`、`theme`、`UIOptions`。
- [安装说明](https://plus.excalidraw.com/docs/sdk/excalidraw/installation)：字体与资源自托管，以及画布容器尺寸。
- [Excalidraw 包的浏览器目标](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/package.json)：核对 Safari 等最低支持版本；实施时以锁定版本为准。
- [Matomo 事件追踪](https://developer.matomo.org/guides/tracking-javascript-guide)与[Umami 事件追踪](https://docs.umami.is/docs/tracker-functions)：现有已配置渠道的客户端事件接口。
