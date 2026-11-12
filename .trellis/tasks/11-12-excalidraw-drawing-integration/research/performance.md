# Excalidraw 性能与兼容性验证记录

日期：2026-11-12。锁定 SDK `@excalidraw/excalidraw@0.18.1`。

## 构建与首屏资源

`yarn vite:build` 成功，生成独立的 `ExcalidrawEditor.*.js`（约 527 KB）和 `ExcalidrawEditor.*.css`（约 142 KB）；它们由画板弹窗的动态导入触发。检查 `build/app/sw.js` 的预缓存清单，这两个资源均未出现。构建包含 234 个自托管字体文件，且这些 `.woff2` 不在 service worker 的预缓存模式中。普通文档路径的静态分块分析表明画板资源不属于首屏入口。尚未在完整 Outline 文档页使用浏览器网络面板逐请求录制首屏。

## 固定场景探针

`research/ui-probe.js` 包含 99 个矩形和 1 张内嵌 PNG，并在 Chromium Headless 1248 中挂载 SDK。探针确认画板 API 可交互、场景注入后 `elements=100`、`files=1`，并可触发缩放和撤销键盘事件。`--virtual-time-budget` 会冻结同步任务中的 `performance.now()`，因此该探针得到的操作耗时为 0，不能用于真实延迟判断。冷启动值约 50 ms 仅反映本机文件模块的处理，不含网络、应用上下文与真正的首帧绘制，不作为产品性能结论。

## 未完成的环境验收

当前环境没有运行中的 Outline 服务、登录会话、Safari、iOS Safari、Firefox、Edge 或 Electron 应用。仍需在这些目标环境中检查新建、重开、草稿、文件导出、触控、快捷键、真实首屏请求与画布操作延迟，并在已认证服务上完成 SVG 的 `attachments.create`/实际上传/下载/重新导入闭环。附件代码审查确认 `app/utils/files.ts` 首先提交 `file.size` 给 `/attachments.create`；服务端在发放上传凭据之前以 `FILE_STORAGE_UPLOAD_MAX_SIZE` 拒绝超限文件，错误文本含 `too large`，客户端将其映射为绘图过大提示。
