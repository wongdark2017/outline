# TikZ 实现与验收记录

状态：开发与生产路径的修复及检查通过。工作提交完成；归档与日志由 Trellis 收尾工具记录。

## 环境与证据范围

- 分支：`codex/tikz-diagrams`；基线：`feat/custom-themes` / `6d3607b0e`。
- 真实 Chromium、生产前端和生产 CSP；本地 PostgreSQL、Redis、文件附件存储。
- 浏览器使用独立账号、文档集和文档。登录凭据只存于权限为 0600 的临时文件，不进入仓库。
- 本地 HTTPS 使用现有自签名证书。仅测试 Chromium 忽略该证书错误。
- 验收进程覆盖本地 URL、端口、Redis、数据库 SSL 和请求配额；没有修改环境文件。
- 首次生产启动发现基线构建脚本遗漏部分插件产物。对本地 `build/plugins` 额外运行 SWC 后启动；没有修改 `build.js`。
- 本文中的实际运行证据与 `ui-design.md` 中的静态设计稿分开记录。

## 自动检查

独立完整检查见 [check-report.md](check-report.md)。

- 全量 TypeScript 和 lint 通过。lint 的 178 条现有警告没有纳入本次改动。
- 任务范围格式检查和 `git diff --check` 通过。
- 最终组合测试：18 个项目文件结果，153 项通过，1 项按环境跳过。
- 正常翻译提取后增加 25 个英文键；原有英文和中文值保留。
- 其余语言目录保持原字节；重复提取结果一致。见 [validation-i18n.json](validation-i18n.json)。
- 完整生产构建通过。编辑器为动态入口，引擎未进入 Workbox 预缓存。
- 449 个上游引擎资源 SHA256 一致；第三方字节保持不变。

最终诊断修复后，全量 TypeScript 和 lint 再次通过。真实引擎 9 个基础用例和 2 个长宏包名用例符合预期；生产前端使用最终冻结代码重建通过。

## 实际浏览器检查

| 证据 | 覆盖范围 |
| --- | --- |
| [initial-browser.json](validation/initial-browser.json) | `/tikz`、默认预览、真实附件上传和插入图片；打开前没有引擎或重型编辑器请求。 |
| [browser-acceptance.json](validation/browser-acceptance.json) | 最终生产构建：E01/E02/E03/E05/E08、原始行号、120 px 错误滚动、10 秒真实循环、完整 TikZ-CD+中文+7pt 留白、上传失败保留、编辑保存刷新、打印/PDF、白色预览与生产 CSP。Chrome 全局代理阻断外部网络，只有本地地址绕过，涵盖 Worker。 |
| [ui-lifecycle.json](validation/ui-lifecycle.json) | 初始焦点、Tab、撤销重做、深色与打印样式、上传取消后旧响应、E04/E06/E07、390/320 视口、Esc、遮罩、灯箱关闭焦点、实际 Worker 终止。 |
| [reader-export.json](validation/reader-export.json) | 只读账号、匿名分享、真实 HTML 导出；均没有引擎请求。导出 HTML 在深色系统偏好下保持浅色。 |
| [import.json](validation/import.json) | 实际粘贴思源 SVG、附件上传、重新编辑的原始 CDATA 源码、普通图片不使用 TikZ 深色滤镜。 |
| [menu.json](validation/menu.json) | 正常浏览器菜单顺序、全部 7 个关键词、仅搜索不加载引擎。完整 Electron 外壳不可用；菜单过滤分支的 2 项单元测试通过。 |

代表性实际界面：

- [创建图表](validation/01-create.png)
- [文档中的图表](validation/02-saved.png)
- [缺失宏包和原始行号](validation/03-package-error.png)
- [完整文档、TikZ-CD 和中文](validation/04-full-document.png)
- [最终深色界面](validation/05-dark-editor.png)
- [窄屏错误](validation/06-mobile-error.png)
- [源码加载失败](validation/07-source-error.png)
- [只读灯箱](validation/08-reader-lightbox.png)
- [匿名分享](validation/09-public-share.png)
- [浅色 HTML 导出](validation/10-exported-html.png)
- [深色编辑器](validation/11-dark-keyboard.png)
- [思源源码编辑](validation/12-siyuan-import.png)

## 检查发现与修复

1. Widget 注册发生在会话打开前。关闭状态仍返回轻量包装，打开时再加载编辑器。
2. threads 默认将绝对 Worker URL 包为 blob。显式关闭该行为，保留 `worker-src 'self'`。
3. XML 会规范化换行。元数据用字符引用保留 CRLF 和 CR。
4. 上传结束后必须读取当前文档。映射原选中图片，保留协作期间的尺寸和对齐；删除后不改写同地址的其他图片。
5. 铺满视口的 Modal Content 会截住遮罩点击。扩展布局单独识别面板外点击。
6. 固定引擎会删除含 `documentclass` 的注释行。编译时清除注释内容并保留百分号的吞换行语义；保存原文。
7. 真实引擎在已有 DVI 时会返回部分 SVG，即使发生 TeX 错误。缺失宏包还会被虚拟文件系统当作空文件。运行时读取公开诊断通道，识别换行与截断；唯一前缀恢复原名，歧义时不猜测。诊断和文件轨迹分别限制为 16,384 和 1,024 字符。

## 边界与未验证项

- 没有接入实际 S3 桶；附件端到端验证使用本地文件存储。
- 320/390 为真实 Chromium 的视口模拟；没有验证实体移动设备软键盘。
- 完整 Electron 外壳未运行。用户代理模拟未完成界面流程，未计为通过；实际菜单过滤分支由单元测试验证。
- 上游预编译 worker、WASM 与格式镜像的精确构建源码映射仍未确认。来源和适用许可证见引擎目录的 `SOURCES.txt` 与 `NOTICE.txt`。本任务未部署或发布。
- 用户的 `.env.development`、`AGENTS.md` 和并行 `server/main.ts` 改动不属于本次提交范围。

## 数据清理

本地验收服务停止。独立测试团队、文档、附件文件、分享和凭据完成清理，见 [cleanup.json](validation/cleanup.json)。未删除其他团队数据。`.env.development` 和 `AGENTS.md` 的 SHA256 与实现前一致。

## 复验脚本

从仓库根目录运行 `browser-fixture.cjs` 创建隔离数据。它只将凭据写入权限为 0600 的临时文件。按顺序运行 `browser-create.mjs`、`browser-ui-lifecycle.mjs`、`browser-reader-export.mjs`、`browser-import.mjs`、`browser-menu.mjs`、`browser-acceptance.mjs`。默认使用本地 HTTPS 4117 端口和本机 Chromium。停止验收服务后运行 `browser-fixture.cjs cleanup`。这些脚本需要同一数据库/存储配置和编译后的服务器工厂。完整命令和变量见脚本；不得把临时凭据加入仓库。

## 提交与收尾

代码、规格和验收完成后，按 Trellis 3.4 提交规则呈现一次具体提交方案。
提交方案呈现后，用户要求“继续完成”；本轮据此执行同一任务范围的提交、归档和日志记录。

## 2026-11-05 开发环境补充回归

用户在当前开发服务打开默认模板时收到 E04。此前验收使用生产构建，未覆盖开发代理返回的 Worker/压缩资产响应头。

确认的两个根因：

- Vite 代理先于页面 CSP 中间件结束请求。`run-tex.js` 继承默认 Helmet 策略，缺少 WebAssembly 权限；Worker 使用自己的脚本响应策略。
- Vite 将引擎的 `.gz` 资源误标为 HTTP `Content-Encoding: gzip`。浏览器自动解压后，固定引擎再次解压而失败。默认模板实际返回引擎错误 `-3`；浏览器读取的 core 数据为 163,840,000 字节，而原始 gzip 为 5,979,317 字节。

修复范围：仅 `server/middlewares/vite.ts` 中当前版本引擎路径的响应头，并增加同目录回归测试。保留普通静态资源、页面和生产环境行为。当前服务通过原有开发监听自动生效，没有手动重启用户服务。冷态和热缓存验证结果如下。

补充的缓存根因：旧 gzip 响应经历 304 后，浏览器会保留旧 Content-Encoding，因而仍返回错误 `-3`。仅对固定引擎 gzip 输入移除转发的条件校验头，使浏览器收到完整 200 响应并替换错误元数据。普通路径继续使用 304。

| 验证 | 结果与证据 |
| --- | --- |
| 当前开发服务 3000 | 默认模板生成 20,782 字符 SVG，浏览器 gzip 魔数为 `1f8b`，没有错误事件。见 [dev-engine-after.json](validation/dev-engine-after.json)。 |
| 同一浏览器旧缓存恢复 | 修复前重试仍返回 `-3`；最终修复后恢复成功。Worker 继续 304，gzip 实体使用 200。见 [dev-cache-before.json](validation/dev-cache-before.json)、[dev-cache-after.json](validation/dev-cache-after.json)和对应 HTTP 记录。 |
| 受影响测试 | `vite.test.ts`、`csp.test.ts`、`renderTikz.test.ts` 共 44 项通过。 |
| 类型、lint、格式 | 全量 TypeScript、全量 lint 和两份改动文件的格式检查通过。 |

代理中断后，主会话完成类型、缓存恢复修正及最终运行检查。检查代理恢复后完成最终独立复核，没有必须修复项。当前 3000 服务也确认 Worker 条件请求返回 304、gzip 条件请求返回 200。没有手动重启用户服务，没有修改三份用户所有文件。详细补充见 [dev-engine-check.md](dev-engine-check.md)。

工作提交：`5e0c70609f13fab8356efb15ebe1a303572b1c66`，正常 Husky 钩子通过。钩子后确认三份用户文件保持原字节。

归档工具完成目录移动，但自动提交因未跟踪的旧路径失效而中断。归档提交仅补齐该任务目的目录；未修改 Trellis 脚本或其他任务。
