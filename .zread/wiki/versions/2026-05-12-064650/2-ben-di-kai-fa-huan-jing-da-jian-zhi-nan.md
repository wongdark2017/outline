如果把 Outline 看成一套“前端界面 + 后端 API + 实时协作 + 异步任务”的组合拳，那么本地开发环境的目标就不是单纯把一个 Node 进程跑起来，而是把这几块协同关系一起复现出来。这个仓库已经把最麻烦的部分提前铺好了：`docker-compose.yml` 提供 PostgreSQL 和 Redis，`.env.development` 给出本地默认 URL 与数据库连接，`Makefile` 把常用启动步骤串成了一条命令。你真正要理解的是这些步骤为什么要这么排，而不是死记一串命令。

Sources: [README.md](README.md), [Makefile](Makefile), [docker-compose.yml](docker-compose.yml), [.env.development](.env.development)

## 先建立心智模型：本地要跑哪些东西

在默认开发流程里，Outline 实际上会同时启动四类东西：

| 组件 | 默认端口/入口 | 作用 | 为什么本地也要有 |
|---|---|---|---|
| **Web/API 服务** | `https://local.outline.dev:3000` | 提供页面壳、API、认证、OAuth、MCP 路由 | 前端大部分数据都依赖它，单开前端没有真实业务上下文 |
| **Vite 前端开发服务器** | `https://local.outline.dev:3001` | 提供 HMR、前端增量编译 | 改 React 组件时需要秒级反馈 |
| **PostgreSQL** | `127.0.0.1:5432` | 存储文档、用户、权限、修订记录等主数据 | Outline 不是“纯前端 demo”，核心状态都在数据库里 |
| **Redis** | `127.0.0.1:6379` | Bull 队列、缓存、锁、实时通信适配层 | 不开 Redis，Worker、WebSocket、部分缓存路径都会失真 |

这也是为什么仓库里的 `up` 流程不是“`yarn dev` 然后结束”，而是先起依赖，再配 SSL，再装依赖，最后才进入 `yarn dev:watch`。Outline 的开发体验本质上是在模拟一套完整运行时，而不是模拟单页应用。

Sources: [package.json](package.json), [Makefile](Makefile), [docker-compose.yml](docker-compose.yml), [server/env.ts](server/env.ts)

## 准备条件

开始之前，先把下面几项准备好：

| 条件 | 当前仓库要求 | 说明 |
|---|---|---|
| **Node.js** | `>=20.12 <21 || 22 || 24` | `.nvmrc` 当前固定为 `24`，直接用 Node 24 最省心 |
| **Yarn** | 仓库统一使用 Yarn | 所有脚本、依赖安装和 lockfile 都按 Yarn 设计 |
| **Docker / Docker Compose** | 推荐安装 | 本地数据库与 Redis 默认通过容器提供 |
| **mkcert** | 推荐安装 | 仓库会尝试生成 `*.outline.dev` 的本地证书，保证 HTTPS 开发路径可用 |

`mkcert` 不是“装了更好看”的可选项，而是因为仓库内置的开发 URL 就是 `https://local.outline.dev:3000`。很多涉及 Cookie、认证跳转、WebAuthn、OAuth 回调的逻辑，只有在接近真实 HTTPS 的环境里才更接近生产行为。

Sources: [package.json](package.json), [.nvmrc](.nvmrc), [server/scripts/install-local-ssl.js](server/scripts/install-local-ssl.js), [.env.development](.env.development)

## 最快启动路径：直接用 `make up`

如果你只是想尽快把项目跑起来，仓库已经把推荐路径写进 `Makefile` 了：

```bash
make up
```

这条命令等价于按顺序执行下面四步：

```bash
docker compose up -d redis postgres
yarn install-local-ssl
yarn install --immutable
yarn dev:watch
```

这样设计的原因很直接：

1. **先起 Redis 和 PostgreSQL**，避免后面的服务在启动阶段因为基础设施缺失而直接退出。
2. **再生成本地证书**，让 `vite.config.ts` 和服务端 SSL 检测都能读到开发证书。
3. **再安装依赖**，保证前后端、共享模块和插件目录使用同一份锁定依赖。
4. **最后进入 watch 模式**，同时启动后端热重载和 Vite 开发服务器。

这几步里，真正值得理解的是最后一条 `yarn dev:watch`。它不是简单起两个常驻进程，而是：

- 一个 `backend` 任务执行 `yarn dev:backend`
- 一个 `frontend` 任务执行 `yarn vite:dev`

而 `yarn dev:backend` 又会通过 `nodemon` 观察 `server/`、`shared/`、`plugins/` 和 `.env*` 文件变化，每次变动先重新编译后端，再调用 `yarn dev` 启动构建产物。也就是说，服务端开发并不是直接跑 TypeScript 源码，而是始终围绕 `build/server/index.js` 这个输出目录迭代。

Sources: [Makefile](Makefile), [package.json](package.json), [build.js](build.js)

## 环境变量是怎么加载的

Outline 的环境变量加载逻辑比很多项目更细致，理解这一点能省掉很多“我明明改了配置为什么没生效”的时间。

加载顺序来自 `server/utils/environment.ts`：

1. 先读取 `.env`
2. 如果 `NODE_ENV=development`，再读取 `.env.development`
3. 在开发环境下，如果存在 `.env.local`，它会在 `.env.development` 之后加载并覆盖同名配置
4. 最后再让真正的进程环境变量覆盖前面的文件值

这套顺序有两个好处：

- `.env.sample` 可以作为完整模板，记录“系统支持哪些配置项”
- `.env.development` 提供团队统一的本地默认值
- `.env.local` 只放你自己机器上的差异，不污染团队共识

当前仓库自带的 `.env.development` 已经给出这组关键本地值：

```dotenv
URL=https://local.outline.dev:3000
DATABASE_URL=postgres://user:pass@127.0.0.1:5432/outline
REDIS_URL=redis://127.0.0.1:6379
SMTP_FROM_EMAIL=hello@example.com
LOG_LEVEL=debug
```

这里有一个容易忽略的点：仓库会帮你生成 `*.outline.dev` 证书，但**不会自动替你配置本机 DNS / hosts 解析**。从源码里能看到 URL 被固定成了 `local.outline.dev`，却没有任何脚本去修改系统 hosts 文件。所以如果你的机器不能解析这个域名，需要自行把它映射到 `127.0.0.1`。这是基于仓库行为得出的推断，不是额外的项目约定。

Sources: [server/utils/environment.ts](server/utils/environment.ts), [.env.sample](.env.sample), [.env.development](.env.development), [server/scripts/install-local-ssl.js](server/scripts/install-local-ssl.js)

## 后端和前端各自是怎么跑的

### 后端：先编译，再运行构建产物

后端相关脚本分成三层：

| 命令 | 实际职责 |
|---|---|
| `yarn build:server` | 用 `build.js` 编译 `server/`、`shared/`、插件的 `server/` 与 `shared/` 子目录 |
| `yarn dev` | 运行 `build/server/index.js --services=cron,collaboration,websockets,admin,web,worker` |
| `yarn dev:backend` | 用 nodemon 监控源码变化，变更后重新构建并再次运行 `yarn dev` |

这一层设计的重点在于：**服务端、共享模块和插件不是三套独立包，而是一起编译进 `build/` 目录**。所以你改的不只是 `server/` 文件，任何被服务端依赖的 `shared/` 或插件后端代码，都会触发重新编译。

### 前端：Vite 单独提供开发体验

前端的开发服务器由 `yarn vite:dev` 启动，默认跑在 3001 端口。它负责：

- React 组件级热更新
- 浏览器侧模块解析
- `~` 和 `@shared` 的别名映射
- 本地 HTTPS 证书注入

这样拆开之后，前端热更新不必被后端重启拖慢，而后端又能继续保留自己的多服务编排和 Node 调试方式。两边分治，是因为 Outline 的代码库已经大到不适合“一个全能 dev server 全包”的阶段。

Sources: [package.json](package.json), [build.js](build.js), [vite.config.ts](vite.config.ts)

## 数据库、迁移与测试的基本节奏

Outline 的本地开发不只是“看页面”，绝大多数功能都需要真实数据库状态支撑，因此下面几个命令你很快就会反复使用：

| 命令 | 用途 |
|---|---|
| `yarn db:migrate` | 执行开发数据库迁移 |
| `yarn db:rollback` | 回滚最近一次迁移 |
| `make test` | 重新建测试数据库并执行 Jest |
| `yarn test path/to/file.test.ts` | 只跑单个测试文件，调试效率最高 |
| `yarn test:app` / `yarn test:server` / `yarn test:shared` | 按分层运行测试 |

`make test` 里其实做了三件事：拉起 PostgreSQL、重建测试库、跑 Jest。它之所以不顺手把 Redis 也拉上，是因为很多测试只依赖数据库而不依赖完整的运行时拓扑。反过来说，如果你在调试队列、协作或实时通知问题，那只跑测试数据库通常不够，还得把 Redis 一起带上。

Sources: [README.md](README.md), [Makefile](Makefile), [package.json](package.json)

## 开发时最常见的几个坑

### 1. 页面能打开，但登录或回调行为异常

先检查是不是没有走 `https://local.outline.dev:3000` 这一套地址。Outline 的 Cookie、认证跳转和一部分安全策略都围绕完整 URL 工作，随手改成 `http://localhost:3000` 虽然偶尔也能开页面，但很多细节会偏离真实部署环境。

### 2. 改了服务端代码却没生效

确认你改的是 `server/`、`shared/` 或 `plugins/*/server` 这几类会触发 `dev:backend` 重编译的目录。如果你只盯着浏览器刷新，却没有注意后端编译日志，很容易误以为代码热更新失效，实际上可能是构建失败了。

### 3. Redis 和 PostgreSQL 已经启动，但服务仍然起不来

优先看环境变量是否合法。`server/env.ts` 会在进程启动后用 `class-validator` 校验配置，只要关键变量格式不对，进程会直接退出。相比“先带病运行再在运行期炸掉”，这种做法更严格，但也意味着你要更早处理配置问题。

Sources: [server/env.ts](server/env.ts), [package.json](package.json), [server/index.ts](server/index.ts)

## 推荐的入门顺序

如果你是第一次读 Outline 代码库，建议把“把服务跑起来”和“开始改业务代码”之间留一个缓冲区。比较顺的顺序是：

1. 跑通 `make up`
2. 确认前端和 API 都能返回内容
3. 阅读 [项目目录结构与代码组织总览](3-xiang-mu-mu-lu-jie-gou-yu-dai-ma-zu-zhi-zong-lan)
4. 接着读 [整体架构：前后端 Monorepo 与共享模块设计](6-zheng-ti-jia-gou-qian-hou-duan-monorepo-yu-gong-xiang-mo-kuai-she-ji)
5. 再按方向分流到 [前端技术栈](4-qian-duan-ji-zhu-zhan-react-mobx-styled-components-yu-vite) 或 [后端技术栈](5-hou-duan-ji-zhu-zhan-koa-sequelize-redis-yu-bull-dui-lie)

原因很简单：Outline 的复杂度不是靠单个文件体现出来的，而是靠“服务怎么连起来、共享模块怎么复用、插件怎么插进去”这几个结构性问题体现出来的。开发环境搭好了，你才有资格开始看这些问题。
