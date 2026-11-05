# TikZ Trellis 全范围检查记录

检查日期：2026-11-05。
检查角色：独立 `trellis-check`。
检查依据：已批准的 PRD 第 6 版、界面设计第 1 版、requirements、design、implement 和 check.jsonl 所列项目规格。

## 已修复

1. `app/editor/lib/tikz/prepareSource.ts`：引擎会删除含有字面量 `\documentclass` 的整行，包括注释中的文字。编译前清除注释内容，保留 `%` 和换行的 TeX 语义。原始源码仍原样嵌入 SVG。新增回归覆盖相邻代码、宏中的百分号吞换行和转义百分号。
2. `.oxlintrc.json`、`server/.oxlintrc.json`、`.oxfmtrc.json`：全量 lint 会扫描原样发布的压缩引擎，产生 1,839 条 vendor 错误。只忽略版本化 `tikzjax-*` 子树。服务端嵌套配置覆盖根忽略规则，因此两处 lint 配置均需保留。未改动引擎文件。
3. `app/components/Modal.tsx`：`Dialog.Content` 铺满视口，面板外空白属于 Content，无法触发 `onPointerDownOutside`。仅对 `expanded` 模式处理直接命中 Content 本身的 pointer 事件，使 TikZ 遮罩可以关闭。面板内部不会关闭。旧弹窗分支不变。真实浏览器回归由主会话执行。
4. `app/editor/extensions/TikzSession.ts`：`setNodeMarkup` 会生成边界映射报告为 deleted 的 `ReplaceAroundStep`。此前协作调整同一图片尺寸或对齐方式会误使会话失效。现在逐步映射，只允许保持原图完整内容 gap、同 src/source 和类型的边界替换。保存使用最新节点属性。真实图片替换、删除和 source 变化仍使目标失效。
5. `app/editor/extensions/Tikz.test.ts`：新增真实文档和上传路径回归。覆盖重复地址目标映射、删除、源码修改取消、旧会话上传返回、编辑/上传期间尺寸与对齐更新、同地址或不同地址结构替换、source 变化。同步原有 session 测试 fixture。
6. `.trellis/spec/frontend/component-guidelines.md` 与索引：记录 Worker、惰性 widget、同源资源/PWA、原始元数据、会话映射、错误、暗色/导出和验证契约。

## 检查结果

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 全量 `yarn lint` | 通过；0 错误，178 条现有警告 | `/tmp/tikz-check-lint.log`。最后一行类型修正后，受影响文件额外 lint 通过且无警告。 |
| 全量 `yarn tsc` | 通过 | `/tmp/tikz-check-typecheck.log`。 |
| 完整聚焦 Vitest | 17 个项目文件结果通过；140 项通过，1 项按环境跳过 | `/tmp/tikz-check-tests.log`。最后一行类型修正后，2 个受影响文件额外 22 项通过。 |
| 变更范围 oxfmt | 40 个源文件/配置通过 | `/tmp/tikz-check-format.log`。排除第三方引擎和无关用户改动。 |
| `git diff --check` | 通过 | 无空白错误。 |
| 版本引擎清单 | 449 个文件 SHA256 全部吻合；9,696,446 字节 | 与 `server/static/tikzjax-e374921f/SHA256SUMS` 对照。 |
| 翻译提取、生产构建、实际浏览器 | 主会话负责 | 本记录不替代主会话验证结果。 |

组合测试命令：

```sh
yarn test app/editor/lib/tikz/prepareSource.test.ts app/editor/lib/tikz/renderTikz.test.ts app/editor/lib/tikz/svg.test.ts app/editor/extensions/Tikz.test.ts app/editor/extensions/TikzSession.test.ts app/editor/components/tikzErrors.test.ts app/components/LightboxState.test.ts app/components/LightboxImageSelection.test.ts shared/editor/extensions/Diagrams.test.ts shared/editor/lib/FileHelper.test.ts shared/editor/nodes/Image.test.ts shared/editor/queries/findImageNodeBySrc.test.ts server/middlewares/csp.test.ts --maxWorkers=2
```

全范围路径检查包括：启动前取消与清理、10 秒完整预算、SVG 活性内容/字体保留、源码 XML/CRLF/Unicode 往返、原始宏包行号、组件惰性依赖、widget 注册、会话隔离、重复图片身份、Lightbox 实际关闭回调、Modal 尺寸/错误区、固定异常文案、静态/暗色/打印样式、图片标识和 URL 消毒、CSP、PWA 和 vendored 资源。

## 未修复与边界

- 上游预编译 worker/WASM/core 的精确构建源码映射未建立。`SOURCES.txt` 和 `NOTICE.txt` 已准确记录。该问题依赖上游来源材料，不能通过局部代码修改解决。未宣称已经满足全部分发义务，也未把整个目录归为单一许可证。
- 检查期间出现无关 `server/main.ts` 改动，导致自动汇总全部变更的格式检查失败。该文件不属于 TikZ 任务，未修改、未暂存；最终任务范围格式检查排除了该文件。
- 主会话报告生产启动存在基线插件编译产物不完整的问题。检查器未独立复现，也未修改 `build.js`。主会话通过补编译本地构建产物开展验收。
- 真实移动浏览器软键盘、生产 CSP、遮罩点击、Lightbox 焦点、读者请求隔离、导入/保存/刷新和输出行为，需要以主会话真实浏览器证据为准。

检查器未执行提交、暂存、部署或发布。未修改 `.env.development`、`AGENTS.md`、`server/main.ts` 或翻译目录。

## 追加检查：真实引擎诊断

主会话生产浏览器验收发现：该固定引擎可以在 TeX 报错后仍返回部分 DVI/SVG。缺失宏包也可能被引擎的虚拟文件 fallback 处理为空文件，无 `!` 错误并返回成功。

runtime 实现接入 `showConsole: true`，从原始 Worker 字符串消息保留首个编译错误。独立复查确认其忽略协议对象、加载期消息和普通警告；编译失败时丢弃部分 SVG；主动取消和超时分类优先于已收集的错误；所有结束路径移除 message 监听。

独立真实 Chromium 补测还发现两种可重现的漏判：

- `tikz-missing-` 加 55 个 `x`，包名共 68 字符。请求仍包含完整 `.sty`，虚拟文件轨迹在 TeX 日志中换行并截成未闭合引号的包名前缀，原单行 `.sty` 正则漏判。
- `tikz-missing-` 加 75 个 `x`，包名共 88 字符。实际请求路径已经截断并丢失 `.sty`，日志只剩未闭合引号的原文件名前缀。这里未根据长度推定上限，而是保存实际请求和 stdout 证据。

检查器将文件轨迹解析改为最多 1,024 字符的滚动缓冲。解析时合并日志换行。完整虚拟缺包轨迹直接识别；缺少后缀或虚拟路径前缀的未闭合轨迹，仅在与原始声明存在唯一前缀匹配时恢复原包名。多声明前缀歧义时返回通用编译失败，不猜包名或行号。实现不依赖宏包白名单。首错误及后续日志仍最多保留 16,384 个字符。

新增回归覆盖：诊断后 Worker 拒绝、诊断后取消/超时、监听移除、无遗留计时器、跨消息换行、两种真实文件名截断及歧义处理。所有源码和 vendored 引擎仍保持既定边界，未改引擎字节。

原始证据：

- `/tmp/tikz-check-diagnostics-wrapped-raw-report.json`：68 字符名称的实际 stdout 和请求。
- `/tmp/tikz-check-diagnostics-long-raw-report.json`：88 字符名称的实际 stdout 和请求。
- `/tmp/tikz-check-diagnostics-wrapped-report.json`、`/tmp/tikz-check-diagnostics-long-report.json`：修复后两种情况均返回 `compile`，原包名和原始声明第 1 行正确，CSP 违规为 0。
- `/tmp/tikz-engine-diagnostics-smoke-report.json`：固定引擎的原 9 个真实样例回归。最终检查结果由后续追加的验证记录确认。

追加修复后的检查结果：全量 `yarn tsc` 通过；两份诊断文件的 Oxlint 和 oxfmt 检查通过；运行 `yarn test app/editor/lib/tikz app/editor/components/tikzErrors.test.ts --maxWorkers=2`，4 个文件、47 项测试全部通过。原 9 个真实引擎样例再次通过预期断言：6 个正常样例成功；缺包为 compile 且定位原始第 3 行；未知命令为 compile；无输出为 invalid-svg；CSP 违规为 0。另两种长文件名样例均为 compile 且恢复正确原名和第 1 行。未重建或重启主会话验收服务器。

最终组合检查额外纳入主会话新增的 `app/editor/menus/block.test.ts`。该文件的 2 项回归验证浏览器菜单顺序，以及 Electron 隐藏 diagrams.net 后仍保留 TikZ。此证据是命令级回归，不替代不可用的完整 Electron 外壳验收。最终组合命令如下：

```sh
yarn test app/editor/lib/tikz/prepareSource.test.ts app/editor/lib/tikz/renderTikz.test.ts app/editor/lib/tikz/svg.test.ts app/editor/extensions/Tikz.test.ts app/editor/extensions/TikzSession.test.ts app/editor/components/tikzErrors.test.ts app/editor/menus/block.test.ts app/components/LightboxState.test.ts app/components/LightboxImageSelection.test.ts shared/editor/extensions/Diagrams.test.ts shared/editor/lib/FileHelper.test.ts shared/editor/nodes/Image.test.ts shared/editor/queries/findImageNodeBySrc.test.ts server/middlewares/csp.test.ts --maxWorkers=2
```

最终组合结果：18 个项目文件结果通过，153 项通过，1 项按环境跳过。其中主会话新增的菜单文件贡献 2 项；其余 17 个项目文件结果贡献 151 项通过。日志为 `/tmp/tikz-check-tests.log`。纳入菜单文件后的全量 `yarn tsc` 再次通过；全量 `yarn lint` 再次通过，0 错误、178 条现有警告，日志为 `/tmp/tikz-check-diagnostics-tsc.log` 和 `/tmp/tikz-check-diagnostics-full-lint.log`。最终两份诊断文件格式通过，`git diff --check` 通过。
