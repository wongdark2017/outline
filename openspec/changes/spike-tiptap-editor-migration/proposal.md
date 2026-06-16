## 为什么

Outline 当前编辑器是自维护的 ProseMirror 平台，而不是单一 React 组件。迁移到 Tiptap 的主要风险不在 UI 替换，而在保持现有 ProseMirror JSON、Yjs `default` fragment、Markdown 序列化和编辑器公共 API 语义不变。

在进入正式迁移前，需要一个有时间盒的 spike，用真实文档和当前协作状态验证可行性、量化工作量，并给出继续、调整或停止迁移的依据。

## 变更内容

- 新增一个 Tiptap 编辑器迁移 spike，用于验证版本族选择、ProseMirror 单实例风险、schema/attrs 兼容性、Yjs binary 往返、Markdown 序列化和旧编辑器 API 契约。
- 明确 spike 不会替换生产编辑器，不会迁移数据库内容，不会修改 Hocuspocus 服务端版本，也不会引入新的编辑器功能。
- 产出失败节点清单、兼容性矩阵、风险清单、建议版本族和后续迁移阶段的 go/no-go 判断。
- 将正式迁移拆分为后续独立变更，只有 spike 结果满足退出条件后才进入实现。

## 功能 (Capabilities)

### 新增功能
- `editor-migration-spike`: 定义 Tiptap 迁移前置探针的行为、输出和安全边界。

### 修改功能

## 影响

- 受影响的调查区域包括 `app/editor`, `app/components/Editor.tsx`, `app/scenes/Document/components/MultiplayerEditor.tsx`, `app/editor/extensions/Multiplayer.ts`, `shared/editor`, `server/collaboration`, `server/commands/documentCollaborativeUpdater.ts` 和 `server/collaboration/PersistenceExtension.ts`。
- 可能需要临时安装或解析 Tiptap v2/v3、`@tiptap/pm`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-cursor`, `@tiptap/y-tiptap` 等包以完成探针。
- 不应改变生产运行时行为、数据库 schema、已有文档内容、Yjs state、Hocuspocus 服务端实现或用户可见编辑体验。
