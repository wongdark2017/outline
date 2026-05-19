Outline 是一个为团队打造的快速协作型知识库。前后端都基于 React 和 TypeScript 构建，使用实时协作引擎，并以出色的性能和用户体验为目标。后端是一个带 RPC API 的 Koa 服务，并使用 PostgreSQL 和 Redis。应用既可以自托管，也可以作为云服务使用。

项目提供完全响应式的 Web 客户端，并可在移动设备上使用。

**Monorepo 结构：**

- **`app/`** - 使用 MobX 进行状态管理的 React Web 应用
- **`server/`** - 使用 Sequelize ORM 和后台 worker 的 Koa API 服务
- **`shared/`** - 共享的 TypeScript 类型、工具和编辑器组件
- **`plugins/`** - 用于扩展功能的插件系统
- **`public/`** - 直接提供服务的静态资源
- **Various config files** - TypeScript、Vite、Jest、Prettier、Oxlint 配置文件

详细架构文档请参阅 /docs/ARCHITECTURE.md。
<!-- {"_type":"newapi_channel_conn","key":"sk-PVoBHy4DLPVWke3UsQ8HBSbZui8ZUPVXPQSoCOqHeVpV063g","url":"https://user.tocodex.com"} -->
## 说明

你在以下领域具备专家级能力：

- TypeScript
- React and React Router
- MobX and MobX-React
- Node.js and Koa
- Sequelize ORM
- PostgreSQL
- Redis
- HTML, CSS and Styled Components
- Prosemirror（富文本编辑器）
- WebSockets and real-time collaboration

## 通用准则

- 重要：不要创建新的 markdown（`.md`）文件。
- 为了提高可读性，优先使用早返回。
- 强调类型安全和静态分析。
- 保持一致的 Prettier 格式。
- 不要将智能引号（“”）（‘’）替换为普通引号（""）（''）。
- 不要手动添加翻译字符串；它们会从代码库中自动提取。

## 依赖与升级

- 所有依赖管理都使用 yarn。
- 更新依赖版本后，执行安装以更新 lockfile：

```bash
yarn install
```

## TypeScript 使用规范

- 使用 strict mode。
- 除非绝对必要，否则避免使用 `unknown`。
- 永远不要使用 `any`。
- 优先使用类型定义，避免类型断言（`as`、`!`）。
- `if` 语句始终使用花括号。
- 避免使用 `#` 私有属性。
- 对对象结构优先使用 `interface` 而不是 `type`。

## 类与代码组织

### 类成员顺序

1. Public static variables
2. Public static methods
3. Public variables
4. Public methods
5. Protected variables & methods
6. Private variables & methods

### 导出规范

- 导出的成员必须出现在文件顶部。
- 新组件和新类一律使用具名导出。
- 所有公开/导出的函数都必须使用 JSDoc 编写文档。

## React 使用规范

- 使用带 hooks 的函数组件。
- 事件处理函数应以 `handle` 开头，例如给 `onClick` 配套使用 `handleClick`。
- 合理使用 `React.memo`、`useMemo` 和 `useCallback`，避免不必要的重新渲染。
- 使用具有描述性的 TypeScript interface 来定义 props。
- 除非直接使用，否则不要导入 React。
- 组件样式使用 styled-components。
- 使用 ARIA role 和语义化 HTML，确保高标准的可访问性（a11y）。

## MobX 状态管理

- 使用 MobX store 管理全局状态。
- store 保存在 `app/stores/` 中。
- 正确使用 `observable`、`action` 和 `computed` 装饰器。
- 在渲染中优先使用 computed 值，而不是手工计算。
- 业务逻辑应放在 store 中，而不是组件中。

## 数据库与 ORM

- 在 `server/models/` 中使用 Sequelize 模型。
- 使用 Sequelize CLI 生成迁移：

```bash
yarn sequelize migration:create --name=add-field-to-table
```

- 使用 `yarn db:migrate` 执行迁移。
- 多表操作要使用事务。
- 根据查询性能需要添加合适的索引。
- 始终妥善处理数据库错误。

## API 设计

- RESTful 接口位于 `/api/` 下。
- 认证接口位于 `/auth/` 下。
- 使用统一的错误响应格式。
- 使用校验中间件和 schema 校验请求数据。
- 使用 presenter 格式化 API 响应。
- API 路由应保持精简；业务逻辑优先放在模型方法中，如果跨多个模型则使用 command。

## 认证与授权

- 使用 JWT token 进行认证。
- 授权策略位于 `server/policies/`。
- 使用 cancan 风格的 ability 检查。
- 受保护路由使用 authenticated 中间件。
- 在访问数据前始终验证用户权限。

## 实时协作

- 使用 WebSocket 进行实时更新。
- 使用 Y.js 实现协同编辑。
- 妥善处理连接状态变化。

## 文档规范

- 所有公开/导出的函数和类都必须编写 JSDoc。
- 内容需包含：
  - 描述
  - `@param` 和 `@return`（首字母小写，句末加句号）
  - 如适用，添加 `@throws`
- 描述与 `@` 块之间要空一行。
- 使用正确标点。

## 测试

- 使用 Jest 运行测试：

```bash
# 运行指定测试文件（推荐）
yarn test path/to/test.spec.ts

# 运行全部测试（避免）
yarn test

# 运行测试套件（避免）
yarn test:app      # 全部前端测试
yarn test:server   # 全部后端测试
yarn test:shared   # 全部共享代码测试
```

- 为工具函数和业务逻辑编写与代码就近放置的 `.test.ts` 单元测试。
- 不要创建新的测试目录。
- 在 **mocks** 文件夹中适当 mock 外部依赖。
- 目标是高覆盖率，但重点优先放在关键路径上。

## 代码质量

- 使用 Oxlint 进行 lint：`yarn lint`
- 使用 Prettier 进行格式化：`yarn format`
- 使用 TypeScript 进行类型检查：`yarn tsc`
- pre-commit hook 会通过 Husky 自动运行。
- 提交前修复 lint 问题。

## 错误处理

- 在 `server/errors.ts` 中使用自定义错误类。
- 始终正确捕获并处理错误。
- 记录错误时附带合适上下文。
- 返回对用户友好的错误信息。
- 不要在错误中暴露敏感信息。

## 性能

- 对开销较大的组件使用 `React.memo`。
- 为大列表实现分页。
- 有效利用数据库索引。
- 缓存高开销计算结果。
- 使用合适的工具监控性能。
- 在适当场景下对路由和组件进行懒加载。

## 安全

- 对所有用户输入进行清洗。
- 在 ProseMirror `toDOM` 方法中，只要 `href` 或 `src` 来源于用户可控数据，就必须使用 `sanitizeUrl()`，无论它是通过别名还是相对路径导入的。与 React 组件不同，`toDOM` 会直接写入原始 DOM，不会自动清洗属性值。
- 使用 CSRF 保护。
- 对敏感接口使用 `rateLimiter` 中间件。
- 遵循 OWASP 指南。
- 不要以明文存储敏感数据。
- 使用环境变量保存密钥。
