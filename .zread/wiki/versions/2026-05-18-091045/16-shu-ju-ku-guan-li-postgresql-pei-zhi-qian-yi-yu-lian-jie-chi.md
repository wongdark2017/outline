Outline 使用 PostgreSQL 作为核心关系型数据库，通过 Sequelize ORM（搭配 `sequelize-typescript` 装饰器）管理所有持久化数据。整个数据层围绕"**一份配置驱动多种连接模式**"的理念构建——从单机开发到生产级读写分离，都通过环境变量灵活切换。本文将深入剖析数据库连接的创建与配置、迁移机制的自动化运行、连接池策略，以及读副本（Read Replica）在异步任务中的实际运用。

Sources: [database.ts](server/storage/database.ts#L1-L14), [package.json](package.json#L242-L243)

## 整体架构概览

数据库管理子系统的核心由三个模块构成：环境变量校验层（`server/env.ts`）定义所有数据库相关配置的约束与默认值；连接工厂层（`server/storage/database.ts`）负责创建 Sequelize 实例、连接池和迁移运行器；启动引导层（`server/utils/startup.ts`）在应用启动时自动检测并执行待运行的迁移。这三者形成自上而下的数据流：环境变量 → 连接配置 → 实例创建 → 迁移执行。

```mermaid
flowchart TB
    subgraph 环境配置
        A["DATABASE_URL<br/>或组件变量"]
        B["DATABASE_CONNECTION_POOL_*"]
        C["DATABASE_READ_ONLY_URL"]
        D["PGSSLMODE / DATABASE_SCHEMA"]
    end

    subgraph 连接工厂["server/storage/database.ts"]
        E["getDatabaseConfig()"]
        F["createDatabaseInstance()"]
        G["sequelize<br/>主连接"]
        H["sequelizeReadOnly<br/>只读连接"]
        I["migrations<br/>Umzug 运行器"]
    end

    subgraph 启动引导["server/index.ts + startup.ts"]
        J["checkConnection()"]
        K["checkPendingMigrations()"]
        L["migrations.up()"]
    end

    A --> E
    B --> F
    E --> F
    D --> F
    F --> G
    C --> H
    G --> I
    G --> J
    I --> K
    K --> L
```

Sources: [database.ts](server/storage/database.ts#L20-L46), [env.ts](server/env.ts#L86-L187), [startup.ts](server/utils/startup.ts#L12-L52)

## 数据库连接配置

### 双模式配置入口

Outline 支持两种数据库连接配置方式，通过 `getDatabaseConfig()` 函数自动判断：如果设置了 `DATABASE_URL` 环境变量，直接使用连接字符串；否则从 `DATABASE_HOST`、`DATABASE_NAME`、`DATABASE_USER` 等独立组件变量拼装配置对象。这两种方式在环境变量层面通过 `@CannotUseWith("DATABASE_URL")` 装饰器互斥——不能同时设置 `DATABASE_URL` 和组件变量，否则校验器会在启动时报错退出。

| 环境变量 | 用途 | 默认值 | 校验规则 |
|---|---|---|---|
| `DATABASE_URL` | 连接字符串（如 `postgres://user:pass@host:5432/db`） | 无 | `@IsDatabaseUrl()`，不能与组件变量共存 |
| `DATABASE_HOST` | 数据库主机地址 | 无 | `@CannotUseWith("DATABASE_URL")` |
| `DATABASE_PORT` | 数据库端口 | `5432` | `@IsNumber()` |
| `DATABASE_NAME` | 数据库名 | 无 | `@CannotUseWith("DATABASE_URL")` |
| `DATABASE_USER` | 数据库用户 | 无 | `@CannotUseWith("DATABASE_URL")` |
| `DATABASE_PASSWORD` | 数据库密码 | 无 | `@CannotUseWith("DATABASE_URL")` |
| `DATABASE_SCHEMA` | 自定义数据库 schema | 无 | 可选，Sequelize 层面传入 |
| `PGSSLMODE` | SSL 连接模式 | 无 | `disable` / `allow` / `require` / `prefer` / `verify-ca` / `verify-full` |

Sources: [database.ts](server/storage/database.ts#L20-L40), [env.ts](server/env.ts#L86-L187)

### 连接池专用 URL

`DATABASE_CONNECTION_POOL_URL` 提供了一个重要的灵活性：当连接池需要指向与主连接不同的数据库端点时（例如通过 PgBouncer 等连接池代理），可以单独设置此变量。在 `database.ts` 中，它的优先级高于 `getDatabaseConfig()` 的结果：

```typescript
const databaseConfig = env.DATABASE_CONNECTION_POOL_URL || getDatabaseConfig();
```

这意味着你可以让应用直连 PostgreSQL 进行迁移和认证，同时通过 PgBouncer 池化日常查询连接。

Sources: [database.ts](server/storage/database.ts#L45-L46), [env.ts](server/env.ts#L152-L159)

### SSL 与生产环境

SSL 配置遵循一个简洁规则：在**生产环境**下且 `PGSSLMODE` 未设置为 `disable` 时，Sequelize 的 `dialectOptions.ssl` 被启用，同时设置 `rejectUnauthorized: false` 以兼容自签名证书。开发环境和测试环境默认关闭 SSL。这一逻辑在 `createDatabaseInstance()` 函数的 `commonOptions` 中集中处理。

Sources: [database.ts](server/storage/database.ts#L69-L78)

## 连接实例创建与连接池策略

`createDatabaseInstance()` 是整个数据层的核心工厂函数。它接收数据库配置（URL 字符串或对象）、模型集合、以及可选参数（如 `readOnly`），返回一个完整配置的 Sequelize 实例。所有实例共享一组**通用选项**（`commonOptions`），包括日志、类型校验、连接池、重试策略和自定义 schema。

### 连接池参数

| 参数 | 写连接默认值 | 只读连接默认值 | 说明 |
|---|---|---|---|
| `pool.max` | `DATABASE_CONNECTION_POOL_MAX`（默认 5） | 写连接的 **2 倍** | 只读连接无写争用，可安全使用更大池 |
| `pool.min` | `DATABASE_CONNECTION_POOL_MIN`（默认 0） | 同写连接 | 最小保持连接数 |
| `pool.acquire` | 30000ms | 同写连接 | 获取连接超时时间 |
| `pool.idle` | 10000ms | 同写连接 | 连接空闲回收时间 |

只读连接池容量翻倍的设计考量是：读操作不涉及事务锁争用，增大池可以在高并发读取场景（如导出任务、热门度评分计算）中更高效地利用数据库资源。

Sources: [database.ts](server/storage/database.ts#L48-L104)

### 死锁重试机制

写连接配置了自动重试策略，专门针对 PostgreSQL 的死锁（deadlock）错误：

```typescript
retry: isReadOnly ? undefined : {
  match: [/deadlock/i],
  max: 3,
  backoffBase: 200,
  backoffExponent: 1.5,
},
```

这意味着写操作在遇到死锁时会最多重试 3 次，退避基准为 200ms，指数因子 1.5（即 200ms → 300ms → 450ms）。只读连接不配置重试，因为读操作不会产生死锁。

Sources: [database.ts](server/storage/database.ts#L87-L96)

### 客户端断连保护

一个精巧的设计是：Sequelize 实例在 `beforeFind` 和 `beforeCount` 钩子中检查发起查询的 HTTP 请求的 socket 是否已被销毁（即客户端已断开连接）。如果 socket 已销毁，直接抛出 `ClientClosedRequestError`，避免在数据库上执行永远无法返回结果的查询。这通过 `AsyncLocalStorage` 中的请求上下文实现。

Sources: [database.ts](server/storage/database.ts#L112-L122), [requestContext.ts](server/storage/requestContext.ts#L1-L11)

### 只读连接与读副本

`sequelizeReadOnly` 是系统的第二个 Sequelize 实例，通过 `DATABASE_READ_ONLY_URL` 环境变量配置。当该变量未设置时，`sequelizeReadOnly` 直接回退为主连接 `sequelize`，确保在无读副本的环境下无需任何额外配置。

只读实例的特殊行为包括：连接池容量翻倍、无死锁重试、以及通过 `beforeCreate` / `beforeUpdate` / `beforeDestroy` 等钩子对写操作发出警告日志。这些钩子不会阻止写操作（因为 Sequelize 模型可能在某些场景下需要写），但会在日志中清晰标识出"在只读连接上执行了写操作"的异常情况。

**使用场景**：只读连接主要被后台异步任务使用，如 `ExportTask`（数据导出）和 `UpdateDocumentsPopularityScoreTask`（文档热门度评分计算）。这些任务执行大量只读查询（甚至原始 SQL），使用独立的只读连接可以将读负载从主连接上卸载。

Sources: [database.ts](server/storage/database.ts#L264-L278), [ExportTask.ts](server/queues/tasks/ExportTask.ts#L24-L30), [UpdateDocumentsPopularityScoreTask.ts](server/queues/tasks/UpdateDocumentsPopularityScoreTask.ts#L11-L30)

## 数据库迁移系统

### Umzug 迁移框架

Outline 使用 **Umzug**（v3.8.2）作为迁移框架，而非 Sequelize 内置的迁移 CLI。迁移运行器通过 `createMigrationRunner()` 工厂函数创建，它将 Umzug 的迁移存储绑定到 Sequelize 的 `SequelizeStorage`，使用同一个数据库实例来追踪已执行的迁移记录（存储在 `UmzugMeta` 表中）。

迁移文件的 glob 模式配置为 `server/migrations/*.js`，每个迁移文件导出 `up` 和 `down` 两个异步函数，接收 `queryInterface`（Sequelize 的查询接口）和 `Sequelize`（数据类型引用）作为参数。

Sources: [database.ts](server/storage/database.ts#L182-L229)

### 迁移文件结构

项目目前包含 **289 个迁移文件**，从 2016 年的初始建表迁移延续至今。每个迁移文件遵循时间戳命名约定（`YYYYMMDDHHMMSS-description.js`），例如：

```javascript
// 20251125012929-add-popularity-score-to-documents.js
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("documents", "popularityScore", {
      type: Sequelize.FLOAT,
      allowNull: false,
      defaultValue: 0,
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("documents", "popularityScore");
  },
};
```

迁移涵盖以下几类操作：

| 迁移类型 | 典型操作 | 示例文件 |
|---|---|---|
| **建表** | `createTable` | `20160619080644-initial.js` |
| **加列/删列** | `addColumn` / `removeColumn` | `20251125012929-add-popularity-score-to-documents.js` |
| **索引管理** | `addIndex` / `removeIndex`（支持 `concurrently`） | `20250907220205-add-missing-indexes.js` |
| **扩展管理** | `CREATE EXTENSION` | `20240912222438-add-unaccent-extension.js` |
| **数据迁移** | `sequelize.query` 执行 SQL | `20231118195149-add-content-to-documents.js` |

Sources: [migrations/](server/migrations/20251125012929-add-popularity-score-to-documents.js#L1-L16), [migrations/](server/migrations/20250907220205-add-missing-indexes.js#L1-L18)

### 自动迁移执行

迁移在应用启动时自动执行。流程如下：

```mermaid
sequenceDiagram
    participant Master as master() 进程
    participant Startup as startup.ts
    participant Mutex as MutexLock
    participant Umzug as migrations (Umzug)
    participant DB as PostgreSQL

    Master->>DB: checkConnection(sequelize)
    DB-->>Master: 连接成功
    Master->>Startup: checkPendingMigrations()
    Startup->>Mutex: acquire("migrations", 10min)
    Mutex-->>Startup: 获取锁成功
    Startup->>Umzug: migrations.pending()
    Umzug->>DB: 查询已执行迁移列表
    Umzug-->>Startup: 返回待执行列表
    alt 有待执行迁移 且 无 --no-migrate
        Startup->>Umzug: migrations.up()
        Umzug->>DB: 逐个执行迁移
        Umzug-->>Startup: 迁移完成
    else 有待执行迁移 且 有 --no-migrate
        Startup->>Startup: Logger.fatal() 并退出
    end
    Startup->>Startup: checkDataMigrations()
    Startup->>Mutex: release(lock)
```

关键细节：

- **分布式锁保护**：`checkPendingMigrations()` 使用 `MutexLock.acquire("migrations", ...)` 获取一个 10 分钟过期的分布式锁（基于 Redis），防止多个实例同时执行迁移导致冲突。锁在应用关闭时自动释放（`releaseOnShutdown: true`）。
- **`--no-migrate` 标志**：如果传入此命令行参数，检测到待执行迁移时会直接 fatal 退出，而非自动执行。这在需要手动控制迁移时序的部署场景中很有用。
- **数据迁移检查**：`checkDataMigrations()` 是针对特定版本升级（0.54.0–0.61.1）的硬编码检查，确保旧版部署完成必要的数据迁移脚本。

Sources: [startup.ts](server/utils/startup.ts#L12-L79), [index.ts](server/index.ts#L50-L58)

### 手动迁移命令

通过 `package.json` 中的脚本和 `.sequelizerc` 配置，开发者可以使用以下命令管理迁移：

| 命令 | 用途 |
|---|---|
| `yarn db:migrate` | 执行所有待运行的迁移 |
| `yarn db:rollback` | 回滚最近一次迁移 |
| `yarn db:create-migration` | 创建新的迁移文件 |
| `yarn db:create` | 创建数据库 |
| `yarn db:reset` | 删除并重建数据库，然后运行全部迁移 |

`.sequelizerc` 文件指定了 Sequelize CLI 的路径配置，将 `config`、`migrations-path`、`models-path` 分别指向 `server/config/database.js`、`server/migrations/` 和 `server/models/`。在加载配置之前，它还会根据 `NODE_ENV` 选择正确的 `.env` 文件（测试环境用 `.env.test`，其他用 `.env`）。

Sources: [.sequelizerc](.sequelizerc#L1-L11), [package.json](package.json)

## 事务管理

Outline 在路由层面提供了事务中间件 `transaction()`，用于将整个请求的处理包裹在一个数据库事务中。中间件将 Sequelize 事务对象挂载到 `ctx.state.transaction`，后续的命令层代码可以从上下文中获取事务并传递给所有数据库调用。

```typescript
// server/middlewares/transaction.ts
export function transaction() {
  return async function transactionMiddleware(ctx: AppContext, next: Next) {
    await sequelize.transaction(async (t: Transaction) => {
      ctx.state.transaction = t;
      return next();
    });
  };
}
```

这种模式在命令层中被广泛使用——例如 `documentCreator`、`documentMover`、`teamPermanentDeleter` 等命令都从 `ctx.state.transaction` 获取事务实例，确保复杂的多步数据库操作具有原子性。

Sources: [transaction.ts](server/middlewares/transaction.ts#L1-L20), [documentCreator.ts](server/commands/documentCreator.ts#L68)

## 健康检查与连接验证

### 启动时连接验证

应用主进程在 `master()` 函数中调用 `checkConnection(sequelize)`，通过 `sequelize.authenticate()` 发送测试查询。如果连接失败且错误信息包含"does not support SSL"，会给出明确的修复建议（设置 `PGSSLMODE=disable` 或启用数据库 SSL）。其他连接错误则直接 fatal 退出。

### 运行时健康端点

每个 Outline 服务实例都暴露了 `/_health` 端点，同时检查 PostgreSQL 和 Redis 的连通性：

```typescript
router.get("/_health", async (ctx) => {
  try {
    await sequelize.query("SELECT 1");
  } catch (err) {
    ctx.status = 500;
    return;
  }
  // ... Redis 检查
  ctx.body = "OK";
});
```

这个端点适合配置在负载均衡器或 Kubernetes 的存活探针（liveness probe）中。

Sources: [database.ts](server/storage/database.ts#L167-L180), [index.ts](server/index.ts#L158-L176)

## 连接名称与调试

`getConnectionName()` 函数为每个 Sequelize 连接生成一个描述性名称，通过 `dialectOptions.application_name` 传递给 PostgreSQL。在开发模式下，名称格式为 `{进程PID}:{服务列表}`（如 `12345:web-worker`），在生产模式下前缀固定为 `outline`。这个名称会出现在 PostgreSQL 的 `pg_stat_activity` 视图中，便于在数据库层面追踪连接来源。

Sources: [utils.ts](server/storage/utils.ts#L1-L13)

## Docker 开发环境

`docker-compose.yml` 提供了开箱即用的 PostgreSQL 和 Redis 服务：

```yaml
services:
  postgres:
    image: postgres
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: outline
```

对应的 `.env` 配置为 `DATABASE_URL=postgres://user:pass@postgres:5432/outline`。`Makefile` 中的 `test` 目标会自动启动 PostgreSQL 容器，然后用 `NODE_ENV=test` 依次执行数据库创建和迁移，最后运行测试套件。

Sources: [docker-compose.yml](docker-compose.yml#L1-L16), [Makefile](Makefile)

## 实战配置示例

### 单机开发环境

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/outline
PGSSLMODE=disable
DATABASE_CONNECTION_POOL_MIN=0
DATABASE_CONNECTION_POOL_MAX=5
```

### 生产环境（带读写分离）

```bash
DATABASE_URL=postgres://app:secret@primary-db.internal:5432/outline
DATABASE_READ_ONLY_URL=postgres://app:secret@replica-db.internal:5432/outline
DATABASE_CONNECTION_POOL_MIN=2
DATABASE_CONNECTION_POOL_MAX=10
```

### 通过 PgBouncer 池化

```bash
DATABASE_URL=postgres://app:secret@primary-db:5432/outline
DATABASE_CONNECTION_POOL_URL=postgres://app:secret@pgbouncer:6432/outline
DATABASE_CONNECTION_POOL_MAX=20
```

此配置下，应用启动和迁移直连主库，日常查询通过 PgBouncer 连接池代理，实现更高效的连接复用。

Sources: [.env.sample](.env.sample), [env.ts](server/env.ts#L86-L176)

## 相关页面

- 数据模型的具体定义和生命周期钩子参见 [数据模型层：Sequelize ORM 模型体系与生命周期钩子](10-shu-ju-mo-xing-ceng-sequelize-orm-mo-xing-ti-xi-yu-sheng-ming-zhou-qi-gou-zi)
- 分布式锁和缓存相关的 Redis 配置参见 [缓存与会话：Redis 的多种用途与存储策略](17-huan-cun-yu-hui-hua-redis-de-duo-chong-yong-tu-yu-cun-chu-ce-lue)
- Docker 部署的完整配置参见 [部署指南：Docker 容器化与环境变量配置](24-bu-shu-zhi-nan-docker-rong-qi-hua-yu-huan-jing-bian-liang-pei-zhi)