<!-- codebase-memory-mcp:start -->
# 代码库知识图谱（codebase-memory-mcp）

本项目使用 codebase-memory-mcp 维护一份代码库知识图谱。
进行代码检索时，始终优先使用 MCP 图谱工具，而不是 grep/glob/文件搜索。

## 优先级顺序
1. `search_graph` —— 按模式查找函数、类、路由、变量
2. `trace_path` —— 追踪某个函数的调用方或被调用方
3. `get_code_snippet` —— 读取指定函数/类的源码
4. `query_graph` —— 对复杂模式运行 Cypher 查询
5. `get_architecture` —— 项目的高层概览

## 何时回退到 grep/glob
- 搜索字符串字面量、错误信息、配置值
- 搜索非代码文件（Dockerfile、shell 脚本、配置文件）
- 当 MCP 工具返回的结果不充分时

## 示例
- 查找 handler：`search_graph(name_pattern=".*OrderHandler.*")`
- 谁调用了它：`trace_path(function_name="OrderHandler", direction="inbound")`
- 读取源码：`get_code_snippet(qualified_name="pkg/orders.OrderHandler")`
<!-- codebase-memory-mcp:end -->

--- project-doc ---

Outline 是一个为团队打造的快速、协作式知识库。前端和后端都使用 React 和 TypeScript 构建，采用实时协作引擎，在性能和用户体验上做了大量优化。后端是基于 Koa 的服务，提供 RPC API，使用 PostgreSQL 和 Redis。应用可以自托管，也可以作为云服务使用。

Web 客户端是完全响应式的，在移动端也能正常工作。

**Monorepo 结构：**

- **`app/`** —— 使用 MobX 做状态管理的 React Web 应用
- **`server/`** —— 使用 Sequelize ORM 的 Koa API 服务器，以及后台 worker
- **`shared/`** —— 共享的 TypeScript 类型、工具和编辑器组件
- **`plugins/`** —— 用于扩展功能的插件系统
- **`public/`** —— 直接对外服务的静态资源
- **各类配置文件** —— TypeScript、Vite、Vitest、oxfmt、Oxlint 的配置

详细的架构文档请参阅 /docs/ARCHITECTURE.md。

## 说明

你是以下领域的专家：

- TypeScript
- React 和 React Router
- MobX 和 MobX-React
- Node.js 和 Koa
- Sequelize ORM
- PostgreSQL
- Redis
- HTML、CSS 和 Styled Components
- Prosemirror（富文本编辑器）
- WebSockets 和实时协作

## 通用准则

- 关键 —— 不要新建 markdown（.md）文件。
- 使用早返回（early return）以保证可读性。
- 每行注释上方留一个空行，除非该注释是代码块的第一行。
- 强调类型安全和静态分析。
- 遵循统一的 oxfmt 格式。
- 不要把智能引号（""）或（''）替换为普通引号（""）。
- 不要手动添加翻译字符串；它们会自动从代码库中提取。

## 依赖与升级

- 所有依赖管理都使用 yarn。
- 更新依赖版本后，要执行安装以更新 lockfile：

```bash
yarn install
```

- 当为修复某个传递性依赖的安全公告而添加 `resolutions` 时，使用 `name@npm:<range>` 语法只针对具体的受影响描述符，而不是全局覆盖该包。检查 `yarn.lock` 找到上游包实际请求的精确范围，为每个有漏洞的范围添加一条记录，例如：

```json
"resolutions": {
  "qs@npm:^6.5.2": "^6.14.2",
  "qs@npm:^6.11.0": "^6.14.2",
  "qs@npm:^6.14.0": "^6.14.2"
}
```

这样可以把覆盖范围限制在受影响的依赖方内，避免把无关的使用者强制升到一个不兼容的版本。

## TypeScript 使用

- 使用严格模式（strict mode）。
- 除非绝对必要，否则避免使用 "unknown"。
- 永远不要使用 "any"。
- 优先使用类型定义；避免类型断言（as、!）。
- if 语句必须使用花括号。
- 私有属性避免使用 # 前缀。
- 对象形状优先使用 interface 而不是 type。

## 类与代码组织

### 类成员顺序

1. 公有静态变量
2. 公有静态方法
3. 公有变量
4. 公有方法
5. 受保护变量和方法
6. 私有变量和方法

### 导出

- 被导出的成员必须出现在文件顶部。
- 新组件和类始终使用具名导出（named export）。
- 所有公有/导出的函数都要用 JSDoc 写文档。

## React 使用

- 使用带 hooks 的函数式组件。
- 事件处理函数应以 "handle" 为前缀，例如 onClick 对应 handleClick。
- 通过合理使用 React.memo、useMemo、useCallback 来避免不必要的重渲染。
- 使用带 TypeScript interface 的描述性 prop 类型。
- 除非直接使用，否则不要 import React。
- 使用 styled-components 做组件样式。
- 通过 ARIA 角色和语义化 HTML 保证高可访问性（a11y）标准。
- 在跨导航保持挂载的组件中（layout、sidebar、command bar），不要使用 `useLocation`。改用 `useLocationSelector` 只选取你需要的值，或者在 effect 和事件处理函数中读取 `history.location`。
- 给 memoized 组件和 `observer` 组件传递稳定的 props，尤其是列表行。不要在每次渲染时新建数组、对象或 JSX；空数组使用共享常量。
- 不要在渲染期间读取 `ref.current` 并传给 props 或 context。使用 callback ref 把元素放进 state。
- 如果 `useState` 的初始值读取了 observable，请使用惰性初始化函数。否则该表达式会在每次渲染时都执行并订阅。

## MobX 状态管理

- 使用 MobX store 管理全局状态。
- store 放在 `app/stores/`。
- 恰当使用 `observable`、`action`、`computed` 装饰器。
- 优先使用 computed 值，而不是在渲染中手动计算。
- 把业务逻辑放在 store 里，而不是组件里。
- 不要只为了某个 effect 或单个 item 检查而在渲染中读取 observable。使用 `useComputed` 派生出一个窄值（例如 `isActive`），这样只有受影响的组件会重渲染。
- 当观察者按 key 检查成员是否存在时，使用 `observable.map` 而不是 set。`ObservableSet.has()` 会追踪整个 set，任何变化都会让所有观察者重渲染。
- 在列表的每一行中调用的 store 查找，不能扫描诸如 `orderedData` 这样的 computed 列表，因为这会让组件订阅 store 中的每一项。
- 在应用根部附近提供的 context 值不能在导航时变化。频繁变化的 store 值应以 getter 的形式暴露，访问时再读取，而不是在渲染期间读取。

## 数据库与 ORM

- 在 `server/models/` 中使用 Sequelize 模型。
- 用 Sequelize CLI 生成迁移：

```bash
yarn sequelize migration:create --name=add-field-to-table
```

- 用 `yarn db:migrate` 运行迁移。
- 跨表操作使用事务。
- 为查询性能添加合适的索引。
- 始终优雅地处理数据库错误。
- 更新 Sequelize 的数组或 JSON 属性时，要替换整个值而不是原地修改；在测试中重新加载模型来验证持久化，而不是信任内存中的状态。
- 依赖某个事务的可选后台任务，应在 `afterCommit` 中调度，并使用非致命的调度方式，使队列故障不会导致已提交的操作失败。

## API 设计

- RESTful 端点放在 `/api/` 下。
- 认证端点放在 `/auth/` 下。
- 使用一致的错误响应。
- 使用验证中间件和 schema 校验请求数据。
- 使用 presenter 格式化 API 响应。
- 保持 API 路由轻薄，业务逻辑放在模型方法中；跨多模型的逻辑放在 command 中。

## 认证与授权

- 使用 JWT token 做认证。
- 授权策略放在 `server/policies/`。
- 使用 cancan 风格的能力检查。
- 受保护的路由使用 authenticated 中间件。
- 数据访问前必须验证用户权限。
- 账号邮箱和 passkey 管理路由必须设置为 `AuthenticationType.APP`；API key 认证不允许修改登录凭证或认证器。

## 实时协作

- 使用 WebSocket 连接推送实时更新。
- 使用 Y.js 做协同编辑。
- 优雅处理连接状态变化。
- 对于会触发授权或 WebSocket 处理的批量删除，要在事务中加载受影响的模型，并逐个带请求上下文删除，这样下游处理能收到期望的逐项事件。
- 不要把 viewer 特定的 unfurl 持久化到共享文档 mention 中；只持久化能映射到稳定 mention 类型的 unfurl。

## 文档

- 所有公有/导出的函数和类都必须有 JSDoc。
- 需要包含：
  - 描述
  - @param 和 @return（首字母小写，句末加句号）
  - 如适用，加 @throws
- 描述与 @ 块之间要有一个换行。
- 使用正确的标点。

## 测试

- 使用 Vitest 运行测试：

```bash
# 运行指定的测试文件（推荐）
yarn test path/to/test.spec.ts

# 运行所有测试（避免）
yarn test

# 运行测试套件（避免）
yarn test:app      # 所有前端测试
yarn test:server   # 所有后端测试
yarn test:shared   # 所有共享代码测试
```

- 为工具函数和业务逻辑编写单元测试，放在与被测代码同级的 .test.ts 文件中。
- 服务端测试在多个文件之间共享模块注册表。使用 `vi.mock` 或 `vi.resetModules` 的服务端测试必须以 `// @vitest-isolate true` 开头，以便隔离运行。
- 不要新建测试目录。
- 在 **mocks** 目录中适当 mock 外部依赖。
- 目标是高代码覆盖率，但要聚焦在关键路径上。

## 代码质量

- 使用 Oxlint 做 lint：`yarn lint`
- 使用 oxfmt 格式化代码：`yarn format`
- 使用 TypeScript 检查类型：`yarn tsc`
- 提交前通过 Husky 自动运行 pre-commit 钩子。
- 提交前先修复 lint 问题。

## 错误处理

- 使用 `server/errors.ts` 中的自定义错误类。
- 始终恰当地捕获和处理错误。
- 带上合适的上下文记录错误日志。
- 返回对用户友好的错误信息。
- 永远不要在错误中暴露敏感信息。

## 性能

- 对昂贵的组件使用 React.memo。
- 大列表实现分页。
- 有效使用数据库索引。
- 缓存昂贵的计算。
- 用合适的工具监控性能。
- 在合适的地方对路由和组件做懒加载。

## 安全

- 对所有用户输入进行消毒。
- 在 ProseMirror 的 `toDOM` 方法中设置来自用户可控数据的 `href` 或 `src` 时，始终使用 `sanitizeUrl()`——无论它是通过别名导入还是相对路径导入。与 React 组件不同，`toDOM` 直接写入原生 DOM，不会对属性值做消毒。
- 使用 CSRF 防护。
- 在敏感端点上使用 rateLimiter 中间件。
- 遵循 OWASP 指南。
- 永远不要在数据库中明文存储敏感数据。
- 使用环境变量存放密钥。
