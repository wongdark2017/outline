本文档是搭建 Outline 本地开发环境的完整指南。我们将从**前置依赖**的安装讲起，逐步引导你完成代码获取、环境配置、服务启动和测试运行的全过程，最终让你在本地机器上拥有一个完整可用的 Outline 开发实例。

Sources: [package.json](package.json#L1-L39), [Makefile](Makefile#L1-L28)

## 技术栈与前置依赖

在开始之前，你需要确认本地开发环境满足以下条件。Outline 的架构决定了它同时依赖多种基础设施服务。

### 核心依赖清单

| 依赖项 | 版本要求 | 用途 | 安装验证命令 |
|--------|----------|------|-------------|
| **Node.js** | `>=20.12 <21` 或 `22` 或 `24`（推荐 24） | 运行时环境 | `node -v` |
| **Yarn** | `4.11.0`（Berry 版本） | 包管理器 | `yarn -v` |
| **Docker** | 任何支持 `docker compose` 的版本 | 运行 PostgreSQL 和 Redis | `docker compose version` |
| **mkcert** | 最新版 | 生成本地 HTTPS 证书 | `mkcert -version` |

> **关于 Node.js 版本**：项目根目录的 [`.nvmrc`](.nvmrc#L1) 文件指定了 `24`。如果你使用 nvm 管理 Node.js 版本，只需在项目根目录执行 `nvm use` 即可自动切换到正确版本。

> **关于 Yarn**：Outline 使用 Yarn Berry（v4）作为包管理器，配置为 `node-modules` 链接模式。如果你全局安装的是 Yarn Classic（v1），可以通过 `corepack enable` 启用 Corepack 来自动识别项目所需的 Yarn 版本。

Sources: [package.json](package.json#L44-L46), [.nvmrc](.nvmrc#L1), [.yarnrc.yml](.yarnrc.yml#L1-L5), [package.json](package.json#L393-L394)

## 系统架构概览

在动手搭建之前，理解 Outline 本地开发环境的服务组成有助于后续排障。下图展示了开发模式下各服务之间的关系：

```mermaid
graph TB
    subgraph 浏览器
        FE["前端应用<br/>Vite Dev Server<br/>:3001"]
    end

    subgraph Node.js 进程
        API["API 服务 (web)"]
        WS["WebSocket 服务"]
        COLL["协作编辑服务<br/>(collaboration)"]
        WORKER["异步任务 Worker"]
        CRON["定时任务 (cron)"]
        ADMIN["Admin 面板"]
    end

    subgraph Docker 容器
        PG[("PostgreSQL<br/>:5432")]
        RD[("Redis<br/>:6379")]
    end

    FE -->|"API 请求 /proxy"| API
    FE -->|"WebSocket"| WS
    FE -->|"Hocuspocus 协作"| COLL
    API --> PG
    API --> RD
    WS --> RD
    COLL --> PG
    COLL --> RD
    WORKER --> PG
    WORKER --> RD
    CRON --> PG

    style FE fill:#e1f5fe
    style API fill:#fff3e0
    style PG fill:#e8f5e9
    style RD fill:#fce4ec
```

开发模式下，所有后端服务（web、websockets、collaboration、worker、cron、admin）运行在**同一个 Node.js 进程**中，监听 **端口 3000**。前端由 Vite 开发服务器独立托管在 **端口 3001**，通过代理将 API 请求转发到后端。

Sources: [Makefile](Makefile#L1-L6), [package.json](package.json#L13), [server/services/index.ts](server/services/index.ts#L1-L15), [.env.development](.env.development#L1-L14)

## 快速启动：Make 一键启动

Outline 提供了一个 `Makefile`，将整个启动流程封装为一条命令。这是**推荐的新手启动方式**。

```bash
# 1. 克隆仓库
git clone https://github.com/outline/outline.git
cd outline

# 2. 切换到正确的 Node.js 版本
nvm use    # 自动读取 .nvmrc，切换到 Node 24

# 3. 一键启动
make up
```

`make up` 命令内部依次执行以下四个步骤：

| 步骤 | 命令 | 说明 |
|------|------|------|
| ① 启动基础设施 | `docker compose up -d redis postgres` | 后台启动 PostgreSQL 和 Redis 容器 |
| ② 生成 SSL 证书 | `yarn install-local-ssl` | 使用 mkcert 为 `*.outline.dev` 生成本地证书 |
| ③ 安装依赖 | `yarn install --immutable` | 按照锁文件安装所有 npm 包 |
| ④ 启动开发服务 | `yarn dev:watch` | 同时启动后端热重载和前端 Vite 开发服务器 |

启动成功后，访问 **https://local.outline.dev:3000** 即可看到 Outline 界面。

> **首次启动注意**：首次运行时会自动执行数据库迁移（migration），创建所需的表结构。如果你看到 "Running migrations…" 的日志，这是正常行为。

Sources: [Makefile](Makefile#L1-L6), [docker-compose.yml](docker-compose.yml#L1-L16), [server/scripts/install-local-ssl.js](server/scripts/install-local-ssl.js#L1-L24), [server/utils/startup.ts](server/utils/startup.ts#L12-L52)

## 手动搭建：分步详解

如果你希望理解每个步骤的具体细节，或者需要自定义配置，可以按照以下步骤手动搭建。

### 第一步：克隆代码并安装依赖

```bash
git clone https://github.com/outline/outline.git
cd outline

# 确保 Node.js 版本正确
nvm use

# 安装依赖（Yarn Berry 会自动通过 Corepack 启用）
yarn install
```

依赖安装完成后，`postinstall` 脚本会自动运行 `patch-package`，为部分第三方包应用项目自定义补丁。

Sources: [package.json](package.json#L21), [patches](patches/)

### 第二步：配置环境变量

Outline 使用 `.env` 文件管理环境变量。环境变量的加载遵循以下优先级（从低到高）：

1. `.env` — 基础配置
2. `.env.{environment}` — 环境特定配置（如 `.env.development`、`.env.local`）
3. 系统环境变量 — 最高优先级

**最小化开发配置**只需要创建 `.env` 文件并填入以下内容：

```bash
# .env — 本地开发最小配置
NODE_ENV=development

# 必须生成两个密钥，可用 openssl rand -hex 32 生成
SECRET_KEY=<用 openssl rand -hex 32 生成>
UTILS_SECRET=<用 openssl rand -hex 32 生成>

# 数据库和 Redis（与 docker-compose.yml 中的配置一致）
DATABASE_URL=postgres://user:pass@127.0.0.1:5432/outline
REDIS_URL=redis://127.0.0.1:6379

# 访问地址
URL=https://local.outline.dev:3000

# 至少配置一种登录方式（开发环境可用 OIDC 或 Google）
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
```

项目已经提供了 [`.env.development`](.env.development#L1-L14) 文件，其中预设了开发模式的数据库 URL、Redis URL 和调试级别等默认值。你只需确保 `.env` 中的 `SECRET_KEY` 和 `UTILS_SECRET` 已正确设置，以及至少配置了一种**认证服务**（Google、Slack、OIDC 等）。

> **密钥生成**：`SECRET_KEY` 必须是恰好 64 个十六进制字符（32 字节）。使用 `openssl rand -hex 32` 命令即可生成。`UTILS_SECRET` 没有严格格式要求，但同样建议使用随机值。

Sources: [.env.sample](.env.sample#L1-L60), [.env.development](.env.development#L1-L14), [server/utils/environment.ts](server/utils/environment.ts#L1-L37), [server/env.ts](server/env.ts#L66-L81)

### 第三步：启动基础设施服务

Outline 依赖 **PostgreSQL** 和 **Redis** 两个外部服务。项目已提供了 [`docker-compose.yml`](docker-compose.yml#L1-L16) 用于快速启动：

```bash
docker compose up -d redis postgres
```

这会启动以下容器：

| 服务 | 镜像 | 本地端口 | 凭据 |
|------|------|---------|------|
| PostgreSQL | `postgres` | `127.0.0.1:5432` | 用户: `user`，密码: `pass`，数据库: `outline` |
| Redis | `redis` | `127.0.0.1:6379` | 无认证 |

容器端口仅绑定到 `127.0.0.1`，不会暴露到外部网络。如果你本地已有 PostgreSQL 或 Redis 实例占用相同端口，需要先停止它们或修改 `docker-compose.yml` 中的端口映射。

Sources: [docker-compose.yml](docker-compose.yml#L1-L16)

### 第四步：生成本地 SSL 证书

本地开发使用 HTTPS，域名为 `local.outline.dev`（指向 `127.0.0.1`）。需要在 `/etc/hosts` 中添加该域名解析，并生成本地可信证书。

**配置域名解析：**

```bash
echo "127.0.0.1 local.outline.dev" | sudo tee -a /etc/hosts
```

**生成 SSL 证书（需预先安装 mkcert）：**

```bash
# 安装 mkcert（macOS）
brew install mkcert
mkcert -install

# 安装 mkcert（Linux）
sudo apt install libnss3-tools
# 或从 https://github.com/FiloSottile/mkcert/releases 下载二进制

# 生成证书（也可通过 yarn 命令）
yarn install-local-ssl
```

证书文件会被放置在 `server/config/certs/` 目录下（`private.key` 和 `public.cert`）。Vite 开发服务器和 Koa 后端都会读取这些文件来启用 HTTPS。

Sources: [server/scripts/install-local-ssl.js](server/scripts/install-local-ssl.js#L1-L24), [vite.config.ts](vite.config.ts#L11-L26)

### 第五步：初始化数据库

首次运行需要创建数据库表结构。Sequelize CLI 负责管理数据库迁移：

```bash
# 如果数据库不存在，先创建
yarn db:create

# 执行迁移
yarn db:migrate
```

数据库配置位于 [`server/config/database.js`](server/config/database.js#L1-L24)，Sequelize 通过 `DATABASE_URL` 环境变量连接数据库。开发模式下不需要 SSL 连接到 PostgreSQL（因为数据库和应用在同一台机器上）。

Sources: [server/config/database.js](server/config/database.js#L1-L24), [.sequelizerc](.sequelizerc#L1-L12), [package.json](package.json#L26-L29)

### 第六步：启动开发服务

Outline 提供了两种开发启动模式：

```bash
# 方式一：前后端同时启动（推荐）
yarn dev:watch

# 方式二：仅启动后端（前端另行启动）
yarn dev:backend

# 方式三：仅启动前端 Vite 开发服务器
yarn vite:dev
```

**`yarn dev:watch`** 的内部工作流程如下：

```mermaid
flowchart LR
    A["yarn dev:watch"] --> B["concurrently 并发"]
    B --> C["dev:backend<br/>Nodemon 监听后端文件变更"]
    B --> D["vite:dev<br/>Vite 前端热更新"]

    C --> C1["修改 server/ shared/ plugins/"]
    C1 -->|"文件变更"| C2["重新编译 (Babel)"]
    C2 --> C3["重启后端进程"]

    D --> D1["修改 app/ shared/"]
    D1 -->|"HMR 热更新"| D2["浏览器即时刷新"]
```

后端启动时，`nodemon` 监听 `server/`、`shared/`、`plugins/` 目录下的 `.ts`、`.tsx` 文件变更，以及 `.env`、`.env.local`、`.env.development` 配置文件变更。检测到变更后，自动重新编译并重启服务。前端则由 Vite 提供热模块替换（HMR）。

启动成功后，你会在终端看到两个命名进程的输出：**api**（蓝色）和 **collaboration**（紫色），分别对应 API 服务和协作编辑服务。

Sources: [package.json](package.json#L7-L16), [package.json](package.json#L36-L38)

### 验证服务运行

服务启动后，通过以下方式确认一切正常：

| 检查项 | 方法 | 预期结果 |
|--------|------|---------|
| 前端页面 | 浏览器访问 `https://local.outline.dev:3000` | 看到 Outline 登录页面 |
| API 健康 | 访问 `https://local.outline.dev:3000/_health` | 返回 "OK" |
| Vite 开发服务器 | `https://local.outline.dev:3001` | Vite 页面（通常被代理） |
| 数据库连接 | 查看终端日志 | 无 "ECONNREFUSED" 错误 |
| Redis 连接 | 查看终端日志 | 无 Redis 连接错误 |

Sources: [server/index.ts](server/index.ts#L157-L176), [vite.config.ts](vite.config.ts#L33-L38)

## 测试环境

### 运行测试

Outline 使用 **Vitest** 作为测试框架。最简单的方式是通过 Make 命令运行完整测试：

```bash
# 运行所有测试（会自动创建测试数据库）
make test

# 以 watch 模式运行测试
make watch
```

`make test` 内部执行以下操作：启动 PostgreSQL 容器 → 创建测试数据库 → 执行迁移 → 运行所有测试。

测试数据库配置位于 [`.env.test`](.env.test#L1-L55)，使用独立的数据库名 `outline-test`，与开发数据库互不干扰。

你也可以直接使用 Vitest 运行特定部分的测试：

```bash
# 仅运行后端测试
yarn test:server

# 仅运行前端测试
yarn test:app

# 仅运行共享层测试
yarn test:shared

# 运行单个测试文件（watch 模式）
yarn test path/to/file.test.ts --watch
```

Sources: [.env.test](.env.test#L1-L55), [Makefile](Makefile#L11-L22), [package.json](package.json#L31-L35), [README.md](README.md#L66-L86)

## 常用开发命令速查

| 命令 | 用途 |
|------|------|
| `make up` | 一键启动完整开发环境 |
| `make test` | 运行全部测试 |
| `make watch` | 以 watch 模式运行测试 |
| `make destroy` | 停止并删除 Docker 容器 |
| `yarn dev:watch` | 同时启动前后端开发服务 |
| `yarn dev:backend` | 仅启动后端开发服务 |
| `yarn vite:dev` | 仅启动前端 Vite 开发服务器 |
| `yarn build` | 构建生产版本（前端 + 后端 + i18n） |
| `yarn db:migrate` | 执行数据库迁移 |
| `yarn db:rollback` | 回滚最近一次迁移 |
| `yarn db:create-migration --name xxx` | 创建新迁移文件 |
| `yarn db:reset` | 重置数据库（删除 → 创建 → 迁移） |
| `yarn lint` | 运行 Oxlint 代码检查 |
| `yarn format` | 运行 Prettier 格式化代码 |
| `yarn build:i18n` | 提取并构建国际化翻译文件 |

Sources: [package.json](package.json#L6-L38), [Makefile](Makefile#L1-L28)

## 代码质量工具

项目配置了自动化的代码质量检查工具，在开发过程中无需手动关注格式问题：

- **Prettier**：代码自动格式化，配置文件为 [`.prettierrc`](.prettierrc)
- **Oxlint**：快速 TypeScript/JavaScript 静态分析，配置为 `--type-aware` 模式
- **Husky + lint-staged**：Git 提交时自动执行格式化和 lint 检查，配置在 [`lint-staged.config.mjs`](lint-staged.config.mjs#L1-L16)

当你执行 `git commit` 时，pre-commit 钩子会自动对暂存的文件执行：Prettier 格式化 → Oxlint 检查 → i18n 翻译文件更新。

Sources: [.husky/pre-commit](.husky/pre-commit#L1-L4), [lint-staged.config.mjs](lint-staged.config.mjs#L1-L16), [package.json](package.json#L16-L18)

## 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| `Port 3000 is already in use` | 端口被占用 | `lsof -i :3000` 查找占用进程并终止 |
| `Could not connect to the database` | PostgreSQL 未启动 | `docker compose up -d postgres` |
| SSL 证书错误 | mkcert 未安装或证书未生成 | 安装 mkcert 后运行 `yarn install-local-ssl` |
| `Environment configuration is invalid` | SECRET_KEY 格式不对 | 确保 SECRET_KEY 为 64 位十六进制字符 |
| 前端白屏 / Config could not be parsed | 后端未正常启动 | 检查后端日志，确认 3000 端口正常监听 |
| `ECONNREFUSED 127.0.0.1:6379` | Redis 未启动 | `docker compose up -d redis` |
| 数据库迁移失败 | 数据库不存在 | 先执行 `yarn db:create`，再 `yarn db:migrate` |

## 推荐阅读顺序

本地环境搭建完成后，建议按照以下顺序深入了解 Outline 的架构设计：

1. [项目整体架构：前后端与共享层的协作关系](3-xiang-mu-zheng-ti-jia-gou-qian-hou-duan-yu-gong-xiang-ceng-de-xie-zuo-guan-xi) — 理解代码库的整体组织方式和数据流向
2. [React 应用结构：场景（Scenes）、组件与路由体系](4-react-ying-yong-jie-gou-chang-jing-scenes-zu-jian-yu-lu-you-ti-xi) — 深入前端应用的页面组织结构
3. [API 路由与控制器：请求处理流程与验证机制](9-api-lu-you-yu-kong-zhi-qi-qing-qiu-chu-li-liu-cheng-yu-yan-zheng-ji-zhi) — 了解后端 API 的请求处理模式