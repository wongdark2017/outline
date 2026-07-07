Outline 采用多阶段 Docker 构建与服务拆分架构，将单体应用拆分为 **web、worker、websockets、collaboration、cron、admin** 六个独立服务，通过环境变量和命令行参数灵活编排。本文将系统性地解析 Docker 镜像的构建流程、环境变量的分层验证机制、服务组合策略以及生产部署的关键配置项，帮助开发者理解 Outline 从容器构建到运行时配置的完整链路。

Sources: [server/services/index.ts](server/services/index.ts#L1-L16)

## Docker 镜像构建：多阶段分离

Outline 的容器化采用**构建-运行分离**的双 Dockerfile 策略，将编译期依赖与运行时镜像彻底解耦。

```mermaid
flowchart TB
    subgraph DockerfileBase["Dockerfile.base — 构建阶段"]
        A["node:24.15.0"] --> B["安装 cmake"]
        B --> C["yarn install --immutable"]
        C --> D["COPY 源码"]
        D --> E["yarn build<br/>(Vite + Babel)"]
        E --> F["yarn workspaces focus --production<br/>(剥离开发依赖)"]
        F --> G["yarn cache clean"]
    end

    subgraph DockerfileRuntime["Dockerfile — 运行阶段"]
        H["node:24.15.0-slim"] --> I["创建 nodejs 用户<br/>(uid=1001)"]
        I --> J["COPY build/server, public,<br/>node_modules 等"]
        J --> K["安装 wget(健康检查)"]
        K --> L["设置本地存储目录<br/>FILE_STORAGE_LOCAL_ROOT_DIR"]
        L --> M["VOLUME /var/lib/outline/data"]
        M --> N["EXPOSE 3000<br/>CMD node build/server/index.js"]
    end

    DockerfileBase -->|"产物复制<br/>--chown=nodejs:nodejs"| DockerfileRuntime
```

**Dockerfile.base** 承担完整的编译职责：基于完整的 Node.js 镜像，安装 cmake 等编译工具，通过 `yarn install --immutable` 锁定依赖版本，然后执行 `yarn build`（内部包含 Vite 前端构建和 Babel 后端编译）。构建完成后通过 `yarn workspaces focus --production` 精简依赖，仅保留生产运行时所需。值得注意的是，构建阶段设置了 `NODE_OPTIONS="--max-old-space-size=24000"` 以确保大规模 JavaScript 编译不会因内存溢出而失败。

Sources: [Dockerfile.base](Dockerfile.base#L1-L24), [Dockerfile](Dockerfile#L1-L48)

**Dockerfile**（运行时镜像）基于精简的 `node:24.15.0-slim`，仅复制构建产物（`build/`、`server/`、`public/`、`node_modules/`、`.sequelizerc`、`package.json`），将所有权全部赋予 `nodejs` 用户。镜像内置健康检查——每分钟通过 `wget` 请求 `/_health` 端点验证服务可用性。本地文件存储卷挂载在 `/var/lib/outline/data`，权限设置为 `1777`（sticky bit）以确保多用户场景下的安全写入。

Sources: [Dockerfile](Dockerfile#L1-L48)

### CI/CD 多架构发布

官方的 GitHub Actions 工作流采用**分架构构建 + manifest 合并**的策略。`build-arm` 和 `build-amd` 两个 Job 分别在 ARM64 和 AMD64 的 runner 上独立构建基础镜像和运行时镜像，然后通过 digest 上传为 artifact，最终在 `merge` 阶段通过 `docker buildx imagetools create` 创建多架构 manifest 并推送到 Docker Hub（`outlinewiki/outline`）。工作流在推送版本标签（`v*`）时触发。

Sources: [.github/workflows/docker.yml](.github/workflows/docker.yml#L1-L214)

### 构建产物的内部结构

`build.js` 脚本编排了服务端代码的编译流程。它通过 Babel 将 `server/`、`shared/` 以及所有插件的 `server/` 和 `shared/` 目录下的 TypeScript/TSX 文件编译到 `build/` 目录，同时复制静态资源（HTML 错误页面、协作服务 Procfile 文件、各插件的 `plugin.json`）。前端资源由 Vite 独立构建，产出直接进入 `build/` 目录。

Sources: [build.js](build.js#L1-L93)

## 服务拆分与编排

Outline 的后端由六个可独立部署的服务组成，通过 `SERVICES` 环境变量或 `--services` 命令行参数选择启用哪些服务：

| 服务 | 功能说明 | 是否必须 | 对应源码 |
|------|---------|---------|---------|
| **web** | HTTP API 与前端页面服务 | 是 | [server/services/web.ts](server/services/web.ts#L1-L104) |
| **worker** | Bull 队列消费者，处理异步任务和事件 | 是 | [server/services/worker.ts](server/services/worker.ts#L1-L180) |
| **websockets** | Socket.IO 实时通信 | 否 | [server/services/websockets.ts](server/services/websockets.ts#L1-L247) |
| **collaboration** | Hocuspocus 协同编辑服务 | 否 | [server/services/collaboration.ts](server/services/collaboration.ts#L1-L144) |
| **cron** | 定时任务调度器 | 否 | [server/services/cron.ts](server/services/cron.ts#L1-L37) |
| **admin** | Bull Board 队列监控面板（`/admin`） | 否 | [server/services/admin.ts](server/services/admin.ts#L1-L26) |

```mermaid
flowchart LR
    subgraph DefaultDocker["Docker 默认部署<br/>SERVICES=collaboration,websockets,worker,web"]
        direction TB
        W["web<br/>(API + 前端)"]
        WK["worker<br/>(异步任务)"]
        WS["websockets<br/>(实时通知)"]
        C["collaboration<br/>(协同编辑)"]
    end

    subgraph HerokuStyle["Heroku 风格部署<br/>(Procfile)"]
        direction TB
        HW["web: web + websockets + collaboration"]
        HWK["worker: worker"]
    end

    subgraph ScaleOut["水平扩展部署"]
        direction TB
        SW["web × N"]
        SWK["worker × N"]
        SC["collaboration × N<br/>(需 REDIS_COLLABORATION_URL)"]
    end

    Redis[("Redis")]
    PG[("PostgreSQL")]

    DefaultDocker --> Redis
    DefaultDocker --> PG
    HerokuStyle --> Redis
    HerokuStyle --> PG
    ScaleOut --> Redis
    ScaleOut --> PG
```

**默认配置**下（Docker 部署），所有服务运行在单一进程中。服务列表默认为 `collaboration,websockets,worker,web`，可通过 `SERVICES` 环境变量或命令行 `--services` 参数覆盖。注意 `--services` 参数优先级高于环境变量。

Sources: [server/env.ts](server/env.ts#L349-L358), [Procfile](Procfile#L1-L3), [docs/SERVICES.md](docs/SERVICES.md#L1-L46)

### 进程并发与协同限制

服务入口通过 `throng` 库实现多进程管理。`WEB_CONCURRENCY` 环境变量控制 Web 进程数量，建议值为服务器可用内存（MB）÷ 512。但存在一个关键约束：**如果当前进程同时运行 `collaboration` 服务且未设置 `REDIS_COLLABORATION_URL`，进程数将被强制限制为 1**——这是因为协同编辑的内存状态（Hocuspocus）在没有 Redis 桥接的情况下无法跨进程同步。

Sources: [server/index.ts](server/index.ts#L34-L48)

### 健康检查端点

所有服务共享 `/_health` 端点，该端点依次检查 PostgreSQL 连接（`SELECT 1`）和 Redis 连接（`PING`），任一失败返回 HTTP 500。Docker 的 `HEALTHCHECK` 指令每分钟调用此端点。

Sources: [server/index.ts](server/index.ts#L157-L176), [Dockerfile](Dockerfile#L44)

## 环境变量体系：加载、验证与分层

Outline 的环境变量管理采用**文件加载 → 密钥解析 → 类验证**的三层架构，以 `class-validator` 装饰器实现类型安全的配置验证。

### 环境变量加载顺序

```mermaid
flowchart TD
    A[".env 文件<br/>(dotenvx 解析)"] --> D["合并基础配置"]
    B[".env.{environment}<br/>(如 .env.production)<br/>按环境覆盖"] --> D
    D --> E["process.env<br/>(系统环境变量优先)"]
    E --> F{"遍历所有 *_FILE 变量"}
    F -->|基础变量未设置| G["读取文件内容<br/>trim() 后赋值给基础变量"]
    F -->|基础变量已设置| H["跳过，直接值优先"]
    G --> I["最终环境变量池"]
    H --> I
    I --> J["Environment 类<br/>class-validator 验证"]
```

环境变量的加载由 `server/utils/environment.ts` 驱动。首先解析 `.env` 文件作为基础配置，然后根据 `NODE_ENV` 加载对应的环境文件（`.env.production`、`.env.development`、`.env.local`、`.env.test`）。系统环境变量（`process.env`）具有最高优先级，会覆盖文件中的同名配置。

Sources: [server/utils/environment.ts](server/utils/environment.ts#L1-L81)

### 文件密钥机制（Docker Secrets 兼容）

任何环境变量都支持 `_FILE` 后缀变体，值指向一个文件路径。例如设置 `SECRET_KEY_FILE=/run/secrets/outline_secret_key`，系统会读取该文件的内容并赋值给 `SECRET_KEY`。如果 `SECRET_KEY` 直接设置了值，则文件路径被忽略——**直接变量始终优先**。文件内容会自动 `trim()` 去除首尾空白。这一机制完美兼容 Docker Swarm Secrets、Kubernetes Secrets 等文件注入式密钥管理系统。

Sources: [server/utils/environment.ts](server/utils/environment.ts#L46-L78), [.env.sample](.env.sample#L1-L17)

### 环境变量验证框架

`server/env.ts` 中的 `Environment` 类使用 `class-validator` 装饰器对每个配置项进行严格验证。验证在 `process.nextTick` 中执行，确保所有属性初始化完成后再检查。验证失败时输出详细错误信息并退出进程。

关键验证装饰器包括：

| 装饰器 | 作用 | 典型应用 |
|--------|------|---------|
| `@IsHexadecimal()` + `@Length(64,64)` | 验证 SECRET_KEY 为 64 位十六进制字符串 | 密钥安全性 |
| `@IsUrl({protocols: ["http","https"]})` | 验证 URL 格式 | URL、CDN_URL |
| `@IsDatabaseUrl()` | 自定义验证器，检查数据库连接串 | DATABASE_URL |
| `@CannotUseWith("other_var")` | 互斥约束 | DATABASE_URL 与分项配置互斥 |
| `@CannotUseWithout("other_var")` | 依赖约束 | SSL_KEY 依赖 SSL_CERT |
| `@IsIn(["local","s3"])` | 枚举值约束 | FILE_STORAGE |
| `@Public` | 标记为可暴露给前端 | CDN_URL、APP_NAME |

Sources: [server/env.ts](server/env.ts#L1-L50), [server/utils/validators.ts](server/utils/validators.ts#L1)

### 前端可见的环境变量

标记了 `@Public` 装饰器的环境变量会通过 `PublicEnvironmentRegister` 收集，最终由 `presenters/env.ts` 序列化注入到 HTML 页面的 `window.env` 对象中。前端通过 `app/env.ts` 和 `shared/env.ts` 访问这些变量。**绝不能将密钥或敏感信息标记为 `@Public`**。当前公开的变量包括：`ENVIRONMENT`、`URL`、`CDN_URL`、`COLLABORATION_URL`、`DEFAULT_LANGUAGE`、`APP_NAME`、`VERSION`、`EMAIL_ENABLED`、`AWS_S3_*`（存储桶 URL）、`SENTRY_DSN`、`DROPBOX_APP_KEY` 等。

Sources: [server/utils/decorators/Public.ts](server/utils/decorators/Public.ts#L1-L39), [server/presenters/env.ts](server/presenters/env.ts#L1-L23), [app/env.ts](app/env.ts#L1-L26)

## 核心环境变量配置详解

### 数据库（PostgreSQL）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | — | PostgreSQL 连接串（`postgres://user:pass@host:5432/dbname`），与分项配置互斥 |
| `DATABASE_HOST` / `DATABASE_PORT` / `DATABASE_NAME` / `DATABASE_USER` / `DATABASE_PASSWORD` | — | 数据库分项配置，不能与 `DATABASE_URL` 同时使用 |
| `DATABASE_READ_ONLY_URL` | — | 只读副本连接串，用于分担读查询负载 |
| `DATABASE_CONNECTION_POOL_MIN` / `MAX` | 0 / 5 | 每进程连接池大小，需确保不超过数据库最大连接数 |
| `PGSSLMODE` | — | SSL 模式：`disable`（同机免 SSL）、`require`、`verify-full` 等 |

Sequelize 的配置由 `server/config/database.js` 导出。生产环境默认启用 SSL（`rejectUnauthorized: false`），通过 `PGSSLMODE=disable` 可关闭。

Sources: [server/env.ts](server/env.ts#L85-L188), [server/config/database.js](server/config/database.js#L1-L24)

### 缓存与会话（Redis）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REDIS_URL` | **必填** | Redis 连接串，支持 `redis://` 或 `rediss://`（TLS），也支持 Base64 编码的 ioredis 配置对象（`ioredis://` 前缀） |
| `REDIS_COLLABORATION_URL` | 空 | 协同编辑专用 Redis，设置后支持 collaboration 服务多实例水平扩展 |
| `REDIS_HEALTHCHECK_INTERVAL` | 30000 | 健康检查间隔（毫秒） |
| `REDIS_HEALTHCHECK_TIMEOUT` | 5000 | PING 超时（毫秒），超时则强制重连 |

Sources: [server/env.ts](server/env.ts#L193-L223), [server/storage/redis.ts](server/storage/redis.ts#L1-L164)

### 文件存储

Outline 通过工厂模式在 `local`（本地磁盘）和 `s3`（S3 兼容存储）之间切换，由 `FILE_STORAGE` 环境变量控制：

```mermaid
flowchart LR
    FS["FILE_STORAGE"] -->|local| LS["LocalStorage<br/>存储到本地磁盘"]
    FS -->|s3 默认| S3["S3Storage<br/>存储到 S3 兼容服务"]
    
    LS --> DIR["FILE_STORAGE_LOCAL_ROOT_DIR<br/>/var/lib/outline/data"]
    S3 --> AK["AWS_ACCESS_KEY_ID"]
    S3 --> SK["AWS_SECRET_ACCESS_KEY"]
    S3 --> RG["AWS_REGION"]
    S3 --> BU["AWS_S3_UPLOAD_BUCKET_URL<br/>+ BUCKET_NAME"]
    S3 --> PS["AWS_S3_FORCE_PATH_STYLE=true<br/>(MinIO 等兼容服务)"]
```

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FILE_STORAGE` | `s3` | 存储后端，可选 `local` 或 `s3` |
| `FILE_STORAGE_LOCAL_ROOT_DIR` | `/var/lib/outline/data` | 本地存储根目录，Docker 镜像已为此目录创建 VOLUME |
| `FILE_STORAGE_UPLOAD_MAX_SIZE` | 1000000（~1MB） | 文件附件最大上传大小（字节） |
| `FILE_STORAGE_IMPORT_MAX_SIZE` | 等于 UPLOAD_MAX_SIZE | 文档导入大小限制 |
| `FILE_STORAGE_WORKSPACE_IMPORT_MAX_SIZE` | 等于 UPLOAD_MAX_SIZE | 工作区导入大小限制 |
| `AWS_S3_FORCE_PATH_STYLE` | `true` | 强制路径风格 URL，MinIO 等自托管 S3 兼容服务必须开启 |

Sources: [server/env.ts](server/env.ts#L668-L716), [server/storage/files/index.ts](server/storage/files/index.ts#L1-L9)

### SSL 与安全

Outline 支持三种 SSL 终止方式：

1. **环境变量注入**（推荐用于容器）：设置 `SSL_KEY` 和 `SSL_CERT` 为 Base64 编码的密钥和证书内容
2. **文件系统挂载**：将 `private.key`/`public.cert`（或 `.pem`）文件放到项目根目录或 `server/config/certs/` 目录
3. **反向代理终止**（最常见）：在 Nginx/Caddy 等代理层处理 SSL，设置 `FORCE_HTTPS=true`（默认）自动重定向 HTTP 到 HTTPS

当使用反向代理时，可通过 `PROXY_IP_HEADER` 指定获取客户端真实 IP 的请求头（默认 `X-Forwarded-For`）。

Sources: [server/env.ts](server/env.ts#L323-L374), [server/utils/ssl.ts](server/utils/ssl.ts#L1-L45)

### 认证提供者

至少需要配置一个第三方认证提供者，否则用户无法登录。所有认证提供者的凭据均以 OAuth 2.0 Client ID/Secret 形式配置：

| 提供者 | 必要变量 | 文档 |
|--------|---------|------|
| Slack | `SLACK_CLIENT_ID` + `SLACK_CLIENT_SECRET` | Slack 登录 |
| Google | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google 登录 |
| Microsoft Entra | `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET` + `AZURE_RESOURCE_APP_ID` | Azure AD 登录 |
| Discord | `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` + `DISCORD_SERVER_ID` | Discord 登录 |
| OIDC | `OIDC_CLIENT_ID` + `OIDC_CLIENT_SECRET` + `OIDC_AUTH_URI` + `OIDC_TOKEN_URI` + `OIDC_USERINFO_URI` | 通用 OIDC |

Sources: [.env.sample](.env.sample#L144-L192)

### 邮件服务（SMTP）

邮件功能通过 `SMTP_HOST` 或 `SMTP_SERVICE` 启用。两者互斥——如果设置 `SMTP_SERVICE`，系统使用 nodemailer 的[预定义服务配置](https://community.nodemailer.com/2-0-0-beta/setup-smtp/well-known-services/)（如 `"Gmail"`、`"SendGrid"`）。`EMAIL_ENABLED` 是一个只读计算属性，当设置了 `SMTP_HOST` 或 `SMTP_SERVICE` 时自动为 `true`（开发环境默认启用）。

Sources: [server/env.ts](server/env.ts#L386-L466)

### 限流配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RATE_LIMITER_ENABLED` | `true` | 全局限流开关 |
| `RATE_LIMITER_REQUESTS` | 1000 | 每个 IP 在时间窗口内的最大请求数 |
| `RATE_LIMITER_DURATION_WINDOW` | 60 | 时间窗口（秒） |
| `RATE_LIMITER_MULTIPLIER` | 1 | 端点级限流倍率，>1 放宽，<1 收紧 |
| `RATE_LIMITER_COLLABORATION_REQUESTS` | 50 | 每个 IP 的 WebSocket 协同连接限制 |

Sources: [server/env.ts](server/env.ts#L547-L596)

## 部署模式实战

### 本地开发环境

`docker-compose.yml` 提供 Redis 和 PostgreSQL 的开箱即用配置，`Makefile` 封装了完整的本地启动流程：

```bash
# Makefile up 目标会依次执行：
# 1. docker compose up -d redis postgres  # 启动依赖服务
# 2. yarn install-local-ssl               # 安装本地 SSL 证书
# 3. yarn install --immutable             # 安装依赖
# 4. yarn dev:watch                       # 启动前后端热重载开发服务器
make up
```

开发环境使用 `.env.development` 配置文件，设置了 `URL=https://local.outline.dev:3000`，并通过 `DEVELOPMENT_UNSAFE_INLINE_CSP=true` 允许浏览器中 React DevTools 正常工作。

Sources: [docker-compose.yml](docker-compose.yml#L1-L16), [Makefile](Makefile#L1-L28), [.env.development](.env.development#L1-L14)

### 单容器生产部署

最基本的部署方式是直接使用官方 Docker 镜像，通过环境变量传入所有配置。以下是典型架构：

```
[Nginx/Caddy 反向代理 :443]
        ↓
[Outline 容器 :3000]
  ├─ web + websockets + collaboration + worker + cron
  ├─ PostgreSQL (外部或 sidecar)
  └─ Redis (外部或 sidecar)
```

关键配置要点：

- `URL` 必须设置为用户访问的完整外部地址（含协议），Outline 以此为基准生成所有回调 URL 和 WebSocket 连接地址
- `COLLABORATION_URL` 默认派生自 `URL`（将 `http` 替换为 `ws`），仅在协同编辑服务独立部署时需要显式设置
- `SECRET_KEY` 使用 `openssl rand -hex 32` 生成，一旦设定不可更改，否则所有加密数据将无法解密
- 容器启动时自动执行数据库迁移（通过 `MutexLock` 确保多进程场景下只有一个进程执行迁移），可传入 `--no-migrate` 参数跳过

Sources: [server/utils/startup.ts](server/utils/startup.ts#L1-L104), [Dockerfile](Dockerfile#L44-L47)

### 多进程水平扩展

当单进程无法满足性能需求时，可按服务维度拆分部署。参考 Heroku Procfile 的模式：

```bash
# Web 进程组（处理 HTTP 请求 + WebSocket + 协同编辑）
yarn start --services=web,websockets,collaboration

# Worker 进程组（处理异步队列）
yarn start --services=worker
```

**协同编辑服务的水平扩展**需要额外配置：设置 `REDIS_COLLABORATION_URL` 指向专用 Redis 实例，Hocuspocus 的 Redis 扩展将通过 Pub/Sub 同步各实例间的文档状态变更。此时 `WEB_CONCURRENCY` 不再被强制限制为 1。

Sources: [Procfile](Procfile#L1-L3), [server/index.ts](server/index.ts#L34-L48), [server/services/collaboration.ts](server/services/collaboration.ts#L44-L71)

### 数据库迁移与版本升级

`yarn upgrade` 脚本（在 `package.json` 中定义）封装了标准的升级流程：`git fetch && git pull && yarn install && yarn heroku-postbuild`。其中 `heroku-postbuild` 等价于 `yarn build && yarn db:migrate`，会重新构建前端和后端代码并执行所有待处理的数据库迁移。

迁移执行受分布式互斥锁保护（`MutexLock.acquire("migrations")`），超时时间为 10 分钟，防止多实例并发迁移导致数据不一致。

Sources: [package.json](package.json#L6-L39), [server/utils/startup.ts](server/utils/startup.ts#L12-L52)

## 环境变量速查表

以下是按类别整理的完整环境变量清单，标注了是否必填和默认值：

### 核心配置

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `URL` | ✅ | — | 公网可访问的完整 URL |
| `SECRET_KEY` | ✅ | — | 64 位十六进制加密密钥（`openssl rand -hex 32`） |
| `UTILS_SECRET` | ✅ | — | 工具端点验证密钥 |
| `PORT` | 否 | 3000 | HTTP 监听端口 |
| `WEB_CONCURRENCY` | 否 | CPU 核数 | 进程并发数 |
| `DEFAULT_LANGUAGE` | 否 | `en_US` | 界面默认语言 |
| `SERVICES` | 否 | `collaboration,websockets,worker,web` | 启用的服务列表 |
| `NODE_ENV` | 否 | `production` | 运行环境 |

### 运维调优

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `LOG_LEVEL` | 否 | `info` | 日志级别：error/warn/info/http/verbose/debug/silly |
| `DEBUG` | 否 | 空 | 调试类别（逗号分隔） |
| `REQUEST_TIMEOUT` | 否 | 10000 | 请求超时（毫秒） |
| `WORKER_CONCURRENCY_EVENTS` | 否 | 10 | Worker 事件并发数 |
| `WORKER_CONCURRENCY_TASKS` | 否 | 10 | Worker 任务并发数 |
| `TELEMETRY` | 否 | `true` | 是否发送匿名统计 |
| `SEARCH_PROVIDER` | 否 | `postgres` | 搜索提供者 |

Sources: [server/env.ts](server/env.ts#L1-L946), [.env.sample](.env.sample#L1-L297)

## 延伸阅读

- 要深入了解日志、指标和链路追踪的生产配置，请参阅 [可观测性：日志、指标收集、Sentry 错误追踪与链路追踪](25-ke-guan-ce-xing-ri-zhi-zhi-biao-shou-ji-sentry-cuo-wu-zhui-zong-yu-lian-lu-zhui-zong)
- 数据库迁移和连接池的详细配置请参阅 [数据库管理：PostgreSQL 配置、迁移与连接池](16-shu-ju-ku-guan-li-postgresql-pei-zhi-qian-yi-yu-lian-jie-chi)
- Redis 在 Outline 中的多种用途请参阅 [缓存与会话：Redis 的多种用途与存储策略](17-huan-cun-yu-hui-hua-redis-de-duo-chong-yong-tu-yu-cun-chu-ce-lue)