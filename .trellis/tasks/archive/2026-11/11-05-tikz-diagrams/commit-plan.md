# TikZ 提交方案

当前状态：生产与开发路径检查通过。用户在提交方案和故障修复期间要求“继续完成”，本轮按同一范围执行。

## 工作提交

`feat: add editable TikZ diagrams`

本提交包含以下文件组。完整逐文件清单见 [commit-files.txt](commit-files.txt)，SHA256 见 [commit-review-snapshot.json](commit-review-snapshot.json)。

- `app/editor/lib/tikz/`：源码适配、真实诊断、Worker 生命周期、SVG 元数据及测试。
- `app/editor/components/`、`app/editor/extensions/`、`app/editor/menus/`：编辑器、会话、菜单和回归测试。
- `app/components/Lightbox*`、`app/components/Modal.tsx`：灯箱编辑、图片选择和对话框布局。
- `shared/editor/`：图片识别、序列化、查询复用、暗色规则和测试。
- `server/static/tikzjax-e374921f/`：原字节资源、来源、校验与适用许可证。
- `server/middlewares/csp*`、`server/middlewares/vite*`、`vite.config.ts`：最小 CSP 放行、开发引擎压缩/缓存修复和预缓存排除。
- `package.json`、`yarn.lock`、三份 lint/format 配置：CodeMirror/threads 依赖和 vendor 忽略。
- `shared/i18n/locales/en_US/translation.json` 与 `zh_CN/translation.json`：提取键及批准的中文文案。
- `public/images/tikz.svg` 与 `.trellis/spec/frontend/`、`.trellis/spec/backend/`：图标和可执行契约。

## 不纳入提交

- `.env.development`：实现前已有的用户改动。
- `AGENTS.md`：用户维护的项目规则。
- `server/main.ts`：检查期间出现的并行改动。

## Trellis 收尾

工作提交完成后，使用 Trellis 工具归档本任务，自动提交任务文档/验收证据；随后记录开发日志并自动提交日志。其余任务不归档。不会推送远程或创建 PR。

确认依据：[workflow.md 第 3.4 步](../../../../workflow.md)明确要求：**“Present the plan once, ask for one-shot confirmation”**。该步骤的确认只针对本方案及后续 Trellis 收尾。

执行结果：工作提交 `5e0c70609` 完成，正常 Husky 钩子通过。提交后文件哈希与评审快照一致，三份用户文件保持原字节。
