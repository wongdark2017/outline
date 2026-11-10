# 提交计划

拟提交一笔：`feat: add searchable code block language picker`。

## 产品代码与依赖

- `app/editor/components/CodeLanguagePicker.tsx`
- `app/editor/components/ToolbarMenu.tsx`
- `app/editor/components/SelectionToolbar.tsx`
- `app/editor/menus/code.tsx`
- `app/components/primitives/Drawer.tsx`
- `shared/editor/lib/code.ts`
- `shared/editor/lib/code.test.ts`
- `shared/i18n/locales/en_US/translation.json`
- `shared/i18n/locales/zh_CN/translation.json`
- `package.json`
- `yarn.lock`

## Trellis 文档与验证记录

- `.trellis/spec/frontend/index.md`
- `.trellis/spec/frontend/editor-controls.md`
- `.trellis/tasks/11-10-code-block-search/` 内的需求、设计、实施、上下文清单、研究与验证文件。

`.vscode/settings.json` 出现了本任务未修改的设置变更，排除在提交之外。原检出的其他任务内容未复制到本工作区。

用户查看效果并确认语言名单行修复后反馈「现在没啥问题了」，按此清单执行工作提交；归档和日志按 Trellis 流程另行提交。不推送。
