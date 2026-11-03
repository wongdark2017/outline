# Outline项目后端代码结构与二次开发入门

这节我们来学习Outline项目的后端代码结构、各模块中核心代码的作用，以及如何从一个小改动开始进行二次开发。

Outline是一款面向团队的协作知识库，后端主要使用Node.js和TypeScript开发，通过Koa提供接口，使用PostgreSQL保存业务数据，并结合Redis完成缓存、任务队列和实时消息处理。

以下内容以当前仓库代码为准，目录树仅列出主要目录和代表性文件。前半部分介绍代码结构，后半部分按照“启动环境 → 修改页面 → 跟踪接口 → 增加字段 → 验证结果”的顺序介绍二次开发。

## 项目结构

Outline将前端、后端、共享代码和插件放在同一个仓库中，通过根目录的配置统一管理依赖与构建：

```text
outline
├── app -- React前端应用
├── server -- 后端接口、业务逻辑和运行服务
├── shared -- 前后端共享的类型、工具及编辑器代码
├── plugins -- 身份认证、搜索和第三方服务集成
├── public -- 静态资源
├── docs -- 项目说明文档
├── patches -- 第三方依赖补丁
├── package.json -- 项目依赖及开发、构建、测试命令
├── yarn.lock -- 依赖版本锁定文件
├── tsconfig.json -- TypeScript配置及导入路径别名
├── build.js -- 后端及相关共享代码的构建脚本
├── .swcrc -- SWC编译配置
├── .env.sample -- 环境变量配置示例
├── .sequelizerc -- Sequelize CLI配置文件
├── vite.config.ts -- 前端开发和构建配置
├── vitest.config.ts -- 测试配置
├── Dockerfile -- 应用容器构建配置
└── docker-compose.yml -- 容器编排配置
```

阅读后端代码时，可以先关注接口入口、业务处理、数据模型和基础设施，再了解协作编辑与插件扩展。

## 项目依赖与构建配置

根目录的[package.json](../package.json)统一声明项目依赖，后端主要使用以下组件：

| 依赖 | 作用 |
| --- | --- |
| `koa`、`@koa/router` | HTTP请求处理和路由管理 |
| `sequelize`、`sequelize-typescript` | 数据库访问、模型定义及关联管理 |
| `pg` | PostgreSQL数据库驱动 |
| `ioredis` | Redis连接和操作 |
| `bull` | 基于Redis的后台任务队列 |
| `zod` | 接口请求参数校验 |
| `socket.io` | 向客户端推送业务变化 |
| `yjs`、`@hocuspocus/server` | 多人协同编辑 |
| `nodemailer` | 邮件发送 |

其中，构建和启动相关配置如下，省略了其他脚本：

```json
{
  "scripts": {
    "build:server": "node ./build.js",
    "start": "node ./build/server/index.js",
    "db:migrate": "sequelize db:migrate",
    "test": "TZ=UTC vitest run",
    "lint": "oxlint --type-aware app server shared plugins",
    "format": "oxfmt app server shared plugins"
  }
}
```

执行`yarn build:server`时，[build.js](../build.js)通过SWC编译后端、共享代码以及插件中的服务端代码，输出到构建目录。执行`yarn start`时，启动编译后的后端入口。

代码中的`@server`、`@shared`等导入前缀来自[tsconfig.json](../tsconfig.json)中的路径配置，以下摘录了`compilerOptions.paths`的主要内容：

```json
{
  "paths": {
    "@server/*": ["./server/*"],
    "@shared/*": ["./shared/*"],
    "~/*": ["./app/*"],
    "plugins/*": ["./plugins/*"]
  }
}
```

例如，下面的导入表示从后端模型模块获取`Document`：

```ts
import { Document } from "@server/models";
```

## 模块代码结构

### server：后端主体

[server目录](../server)包含接口、权限、业务处理、数据访问和后台任务等代码，整体结构如下：

```text
server
├── index.ts -- 后端进程入口
├── main.ts -- 创建Koa应用并初始化运行服务
├── env.ts -- 环境变量定义、默认值及校验
├── errors.ts -- 业务异常定义
├── onerror.ts -- 全局异常处理和异常上报
├── services -- 各运行服务的启动入口
├── routes -- API、登录认证、网页等路由
├── middlewares -- 认证、参数校验、事务等公共中间件
├── commands -- 文档创建、移动等业务操作
├── models -- Sequelize数据模型及模型相关业务行为
├── policies -- 资源访问权限规则
├── presenters -- API响应数据转换
├── storage -- PostgreSQL、Redis和文件存储
├── config -- 数据库命令等配置
├── migrations -- 数据库迁移脚本
├── queues -- 事件处理和后台任务队列
├── collaboration -- 协同编辑扩展
├── emails -- 邮件发送及邮件模板
├── editor -- 服务端编辑器相关处理
├── converters -- 文档格式转换
├── mcp -- MCP服务及工具实现
├── logging -- 日志、指标及链路追踪
├── utils -- 后端公共工具
└── test -- 测试初始化、数据工厂及测试辅助工具
```

### services：运行服务入口

[services目录](../server/services)按运行职责组织代码，可以通过配置选择需要启动的服务：

```text
server/services
├── index.ts -- 按需加载运行服务
├── web.ts -- 挂载API、认证、OAuth、MCP和网页路由
├── websockets.ts -- 启动实时业务消息服务
├── collaboration.ts -- 启动文档协同编辑服务
├── worker.ts -- 启动后台任务处理服务
├── cron.ts -- 启动定时任务服务
└── admin.ts -- 提供Bull队列管理界面，仅限非生产环境
```

后端启动时，[index.ts](../server/index.ts)负责进程管理，[main.ts](../server/main.ts)创建Koa和HTTP或HTTPS服务，并根据配置初始化所需服务。

例如，下面的命令选择启动Web服务和后台任务服务：

```bash
yarn start --services=web,worker
```

服务选择也可以通过`SERVICES`环境变量配置。实际部署时，需要根据使用的功能配置协同编辑、实时消息等服务。

### routes：接口路由

[routes目录](../server/routes)按业务资源组织接口，文档、集合、用户等功能分别存放在对应目录中：

```text
server/routes
├── api
│   ├── index.ts -- 注册API公共中间件并汇总业务路由
│   ├── documents
│   │   ├── index.ts -- 导出文档路由
│   │   ├── documents.ts -- 文档查询、创建、更新、移动和导入等接口
│   │   ├── schema.ts -- 文档接口参数校验规则及请求类型
│   │   └── documents.test.ts -- 文档接口测试
│   ├── collections -- 知识集合相关接口
│   ├── users -- 用户相关接口
│   ├── teams -- 团队相关接口
│   ├── comments -- 评论相关接口
│   ├── searches -- 搜索相关接口
│   ├── attachments -- 附件相关接口
│   ├── shares -- 文档分享相关接口
│   └── middlewares
│       ├── apiResponse.ts -- 为普通对象响应补充status和ok字段
│       ├── apiErrorHandler.ts -- 将部分底层异常转换为业务异常
│       └── pagination.ts -- 分页参数处理
├── auth -- 登录认证路由
├── oauth -- OAuth相关路由
├── mcp -- MCP服务路由
└── app.ts -- Web应用页面路由
```

Outline的业务API采用RPC风格，通过“资源名称.操作名称”表达请求的目的。例如：

```text
POST /api/documents.create -- 创建文档
POST /api/documents.info -- 获取文档信息
POST /api/documents.update -- 更新文档
POST /api/documents.delete -- 删除文档
```

阅读某个接口时，可以先查看路由文件，再查看同目录中的请求校验规则，最后沿着调用关系进入业务命令和数据模型。

### middlewares与policies：身份认证和资源授权

公共中间件处理请求层面的通用工作，权限规则则判断当前用户能否操作具体资源：

```text
server
├── middlewares
│   ├── authentication.ts -- 解析认证凭据并确认当前用户身份
│   ├── validate.ts -- 使用Zod校验请求并生成有效输入
│   ├── transaction.ts -- 为接口执行过程提供数据库事务
│   ├── rateLimiter.ts -- 请求频率限制
│   ├── csrf.ts -- CSRF Token设置与校验
│   └── apiContext.ts -- 提供包含认证、事务和请求IP的上下文
└── policies
    ├── index.ts -- 加载资源权限规则并导出权限操作
    ├── cancan.ts -- allow、can、authorize等基础实现
    ├── document.ts -- 文档权限规则
    ├── collection.ts -- 集合权限规则
    ├── user.ts -- 用户操作权限规则
    └── team.ts -- 团队操作权限规则
```

[authentication.ts](../server/middlewares/authentication.ts)负责确认请求者身份，支持处理JWT、API Key等认证凭据。

[policies](../server/policies)进一步判断用户对某个资源是否具有读取、更新、删除等权限。例如，用户已经登录后，访问某篇文档仍需要通过该文档的权限检查。

### commands、models与presenters：业务处理和数据返回

这三个目录构成接口业务处理的主要部分：

```text
server
├── commands
│   ├── documentCreator.ts -- 创建文档，处理模板、正文转换及发布
│   ├── documentUpdater.ts -- 更新文档属性及接口提交的修改
│   ├── documentMover.ts -- 移动文档并调整集合目录结构
│   ├── documentDuplicator.ts -- 复制文档
│   ├── documentPermanentDeleter.ts -- 永久删除文档
│   └── userInviter.ts -- 邀请团队用户
├── models
│   ├── index.ts -- 汇总导出数据模型
│   ├── Document.ts -- 文档数据、关联及发布、归档等行为
│   ├── Collection.ts -- 知识集合及文档目录结构
│   ├── User.ts -- 用户模型
│   ├── Team.ts -- 团队模型
│   ├── Attachment.ts -- 附件元数据模型
│   ├── Comment.ts -- 评论模型
│   ├── Revision.ts -- 文档修订版本模型
│   ├── Share.ts -- 分享模型
│   ├── Event.ts -- 业务事件模型
│   └── base
│       ├── Model.ts -- ORM公共能力及携带请求上下文的数据操作
│       ├── IdModel.ts -- 带ID的基础模型
│       ├── ParanoidModel.ts -- 支持软删除的基础模型
│       └── ArchivableModel.ts -- 支持归档的基础模型
└── presenters
    ├── index.ts -- 汇总导出响应转换函数
    ├── document.ts -- 文档响应数据转换
    ├── collection.ts -- 集合响应数据转换
    ├── user.ts -- 用户响应数据转换
    ├── team.ts -- 团队响应数据转换
    └── policy.ts -- 将资源权限转换为客户端可使用的abilities数据
```

[commands](../server/commands)封装创建文档、移动文档等业务操作，适合组织涉及多个处理步骤或多个模型的逻辑。

[models](../server/models)通过`sequelize-typescript`定义数据库字段、表关联和模型行为。文档发布、归档等业务能力也会在模型中实现。

[presenters](../server/presenters)将模型转换为接口需要的数据结构，控制返回字段及正文格式，并为客户端提供相应的权限信息。

### storage与migrations：数据库及文件存储

数据库连接、Redis连接和附件存储统一放在存储相关目录中：

```text
server
├── config
│   └── database.js -- Sequelize CLI数据库连接配置
├── storage
│   ├── database.ts -- Sequelize连接、连接池及数据库迁移执行器
│   ├── redis.ts -- Redis连接封装
│   ├── QueryHelper.ts -- SQL查询辅助工具
│   ├── LockHelper.ts -- 锁操作工具
│   └── files
│       ├── index.ts -- 根据配置选择文件存储实现
│       ├── BaseStorage.ts -- 文件存储抽象基类
│       ├── LocalStorage.ts -- 本地文件系统存储
│       └── S3Storage.ts -- S3对象存储
└── migrations -- 按时间顺序组织的数据库迁移脚本
```

PostgreSQL保存文档、用户、集合等业务数据。附件的元数据由模型管理，文件内容则通过本地文件系统或S3存储。

数据库结构调整通过迁移脚本管理，相关命令如下：

```bash
# 创建迁移脚本
yarn sequelize migration:create --name=add-field-to-table

# 执行数据库迁移
yarn db:migrate
```

[env.ts](../server/env.ts)统一定义和校验后端环境变量，常见配置包括：

| 配置项 | 作用 |
| --- | --- |
| `URL` | 应用对外访问地址 |
| `DATABASE_URL` | PostgreSQL连接地址 |
| `REDIS_URL` | Redis连接地址 |
| `FILE_STORAGE` | 文件存储方式 |
| `COLLABORATION_URL` | 协同编辑服务地址 |
| `REDIS_COLLABORATION_URL` | 协作服务使用的Redis连接地址 |
| `SMTP_HOST`等 | 邮件发送配置 |

应用启动时通过[environment.ts](../server/utils/environment.ts)读取配置。开发环境可以在基础配置上叠加开发环境配置和本地配置，进程环境变量具有更高优先级。

### queues与emails：后台任务和邮件通知

文档导入、导出和邮件发送等操作可以交给后台任务执行：

```text
server
├── queues
│   ├── index.ts -- 定义事件、WebSocket和后台任务队列
│   ├── queue.ts -- 队列创建、Redis连接复用及关闭处理
│   ├── processors
│   │   ├── BaseProcessor.ts -- 事件处理器基类
│   │   ├── EmailsProcessor.ts -- 根据通知事件安排邮件发送
│   │   ├── NotificationsProcessor.ts -- 根据业务事件安排通知任务
│   │   ├── RevisionsProcessor.ts -- 文档修订记录相关处理
│   │   └── WebsocketsProcessor.ts -- 向客户端广播业务变化
│   └── tasks
│       ├── base
│       │   └── BaseTask.ts -- 任务调度与执行的公共接口
│       ├── EmailTask.ts -- 加载邮件模板并发送邮件
│       ├── DocumentImportTask.ts -- 文档导入任务
│       ├── ExportMarkdownZipTask.ts -- Markdown压缩包导出任务
│       └── CleanupExpiredAttachmentsTask.ts -- 清理过期附件
└── emails
    ├── mailer.tsx -- 邮件渲染及Nodemailer发送封装
    └── templates
        ├── BaseEmail.tsx -- 邮件模板基类及发送调度
        ├── SigninEmail.tsx -- 登录邮件模板
        ├── InviteEmail.tsx -- 用户邀请邮件模板
        └── DocumentSharedEmail.tsx -- 文档分享通知模板
```

[processors](../server/queues/processors)根据业务事件决定后续处理，[tasks](../server/queues/tasks)封装具体的后台任务。

例如，邮件发送可以先通过模板的调度方法加入队列，再由后台任务加载模板并调用邮件发送器。队列使用Bull实现，Redis负责保存队列状态和任务数据。

### collaboration：多人协同编辑

协同编辑通过Hocuspocus和Yjs组织文档同步，扩展代码如下：

```text
server/collaboration
├── AuthenticationExtension.ts -- 校验用户身份及文档访问、编辑权限
├── PersistenceExtension.ts -- 加载并持久化Yjs文档状态
├── APIUpdateExtension.ts -- 将API修改同步到在线协作会话
├── AwarenessIdentityExtension.ts -- 校验协作感知状态中的用户身份
├── ConnectionLimitExtension.ts -- 限制协作连接数量
├── EditorVersionExtension.ts -- 检查编辑器版本
├── ViewsExtension.ts -- 记录文档访问
├── LoggerExtension.ts -- 协作过程日志
└── MetricsExtension.ts -- 协作服务指标
```

这里需要区分两类实时通信：

| 实时能力 | 主要实现 | 作用 |
| --- | --- | --- |
| 业务变化通知 | Socket.IO及WebSocket事件处理器 | 将业务资源变化推送给客户端 |
| 文档协同编辑 | Hocuspocus、Yjs及协作扩展 | 同步多人编辑内容并持久化文档状态 |

[PersistenceExtension.ts](../server/collaboration/PersistenceExtension.ts)负责从数据库恢复协作文档，并通过业务更新逻辑保存编辑结果。

### plugins：功能扩展

身份认证、搜索和第三方集成通过插件组织，主要目录如下：

```text
plugins
├── email -- 邮箱登录
├── google -- Google身份认证
├── azure -- Microsoft身份认证
├── oidc -- OpenID Connect身份认证
├── passkeys -- Passkey认证及管理
├── github -- GitHub集成
├── gitlab -- GitLab集成
├── slack -- Slack集成
├── notion -- Notion内容导入
├── slab -- Slab内容导入
├── webhooks -- Webhook集成
├── storage -- 本地文件存储相关接口
└── search-postgres -- PostgreSQL全文搜索
    ├── plugin.json -- 插件元信息
    └── server
        ├── index.ts -- 注册搜索提供器
        └── PostgresSearchProvider.ts -- PostgreSQL全文检索实现
```

插件根据需要包含前端、后端或共享代码，由[PluginManager.ts](../server/utils/PluginManager.ts)提供认证、API、任务、事件处理器和搜索提供器等扩展点。

当前仓库自带的搜索实现位于[search-postgres](../plugins/search-postgres)，利用PostgreSQL全文检索能力查询文档。

### shared：前后端共享代码

后端使用的共享内容主要包括业务类型、编辑器结构和文档转换工具：

```text
shared
├── types
│   ├── index.ts -- 公共业务类型及枚举
│   ├── auth.ts -- 认证相关类型
│   ├── permissions.ts -- 权限相关类型
│   └── prosemirror.ts -- 编辑器相关类型
├── editor
│   ├── nodes -- ProseMirror节点定义
│   ├── marks -- 文本标记定义
│   └── lib
│       └── markdown -- Markdown解析和序列化逻辑
├── collaboration
│   └── CloseEvents.ts -- 协作连接关闭事件定义
├── utils
│   ├── ProsemirrorDataHelper.ts -- 富文本JSON数据处理
│   ├── ProsemirrorHelper.ts -- ProseMirror相关工具
│   └── time.ts -- 时间相关工具
├── constants.ts -- 公共常量
└── env.ts -- 共享环境配置
```

文档节点、正文数据结构和Markdown转换需要前后端保持一致，因此后端也会使用[共享编辑器代码](../shared/editor)。

## 接口调用流程

以[创建文档接口](../server/routes/api/documents/documents.ts)为例，可以把前面介绍的模块串起来：

```text
POST /api/documents.create
    ↓
API公共中间件
解析请求、准备上下文、执行CSRF检查等
    ↓
auth → rateLimiter → validate → transaction
身份认证、限流、参数校验、创建数据库事务
    ↓
authorizeDocumentCreate
检查目标集合、父文档等位置的创建权限
    ↓
documentCreator
处理正文及模板，构建并保存文档，按需发布
    ↓
Document模型
通过Sequelize完成数据库操作
    ↓
presentDocument + presentPolicies
生成文档响应和当前用户的权限信息
    ↓
apiResponse
补充响应状态字段，返回客户端
```

后续阅读其他接口时，也可以沿着“路由 → 校验与权限 → 业务命令或模型 → 响应转换”的顺序展开。涉及通知、导出或实时更新时，再继续查看相应的事件处理器和后台任务。

## 准备二次开发环境

下面演示源码和浏览器位于同一台开发机时的本地HTTPS开发方式。已经能正常运行项目的工作区，可以保留现有环境，直接阅读后面的二开练习。

### 1. 准备工具和依赖

| 工具 | 当前仓库的要求或用途 |
| --- | --- |
| Node.js | 满足`package.json`中的`engines`约束，本文以22.x且不低于22.12为例 |
| Yarn | 使用`packageManager`指定的版本，当前为4.18.0 |
| Docker Compose | 启动本地PostgreSQL和Redis |
| mkcert | 生成并安装本地HTTPS证书 |
| OpenSSL | 为新开发环境生成随机密钥 |

在项目根目录执行：

```bash
node --version
yarn --version
yarn install --immutable
```

`--immutable`用于按现有锁定文件安装依赖。实际新增或升级依赖时，按照项目约定使用Yarn，并更新对应的锁定文件。

### 2. 配置本地环境变量

首次准备工作区且尚无基础配置时，可以复制示例文件：

```bash
if [ ! -f .env ]; then
  cp .env.sample .env
fi
```

将基础配置中的`NODE_ENV`设为`development`。然后在`.env.local`中设置当前开发机使用的配置；已有该文件时，只调整需要变更的项目。

下面的数据库账号与仓库中的Docker Compose配置对应，密钥占位符需要替换成独立生成的值：

```dotenv
NODE_ENV=development
URL=https://local.outline.dev:3000
PORT=3000
WEB_CONCURRENCY=1

SECRET_KEY=replace_with_64_hex_characters
UTILS_SECRET=replace_with_another_generated_secret

DATABASE_URL=postgres://user:pass@127.0.0.1:5432/outline
PGSSLMODE=disable
REDIS_URL=redis://127.0.0.1:6379
REDIS_COLLABORATION_URL=

FILE_STORAGE=local
FILE_STORAGE_LOCAL_ROOT_DIR=./data
COLLABORATION_URL=
CDN_URL=

SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SMTP_HOST=
SMTP_SERVICE=
SMTP_USERNAME=
SMTP_PASSWORD=
```

新环境的两个密钥可以分别执行下面的命令生成。复用已有数据库时，应保留与该数据库配套的密钥：

```bash
openssl rand -hex 32
```

这个示例使用首次工作区设置和邮箱登录。示例文件中的Slack凭据包含非空占位符，未使用时需要清空；如果已有配置启用了其他身份提供器，也要确认其是否符合当前开发方式。

开发环境下，配置覆盖顺序为：

```text
进程环境变量 > .env.local > .env.development > .env
```

因此，本机配置放在`.env.local`中，可以覆盖仓库已有的开发配置。该文件已经在Git忽略规则中。

### 3. 启动PostgreSQL和Redis

```bash
docker compose up -d redis postgres
```

仓库中的Compose配置将数据库和Redis分别映射到本机5432、6379端口。全新的PostgreSQL容器会按配置初始化`outline`数据库；复用已有数据库实例时，需要确认数据库名称、账号和端口与应用配置一致。

### 4. 配置本地域名和HTTPS

在开发机的系统hosts文件中增加下面的映射：

```text
127.0.0.1 local.outline.dev
```

安装好mkcert后，在项目根目录执行：

```bash
yarn install-local-ssl
```

[证书脚本](../server/scripts/install-local-ssl.js)会创建`*.outline.dev`证书并安装本地信任，生成以下文件：

```text
server/config/certs
├── private.key -- 本地HTTPS私钥
└── public.cert -- 本地HTTPS证书
```

运行后确认两个文件已经生成，浏览器也信任本地证书。脚本在生成失败时可能仅打印提示，需要根据输出判断是否配置成功。

这里选用`local.outline.dev`作为开发域名。当前代码会将`https://app.outline.dev:3000`识别为云托管环境，因此自托管入门示例使用前者。

### 5. 启动前后端开发服务

```bash
NODE_ENV=development yarn dev:watch
```

这个命令同时启动后端监听和Vite。后端先编译，再启动Web、协作、实时消息及后台任务等开发服务；启动过程会检查并执行待处理的数据库迁移。

因此，首次按这个流程启动时，无需在后端编译之前额外执行迁移命令。这里连接的是自己的开发库；共享环境使用后面介绍的专门启动方式。

浏览器打开：

```text
https://local.outline.dev:3000
```

其中，3000是应用入口，3001用于Vite前端模块及热更新。开发页面会根据带`:3000`的应用地址生成`:3001`资源地址，因此示例保留了明确的端口。

如果源码运行在远程开发机，浏览器所在机器也需要能访问应用和Vite两个地址。使用端口转发时同时映射这两个端口，并保持域名、协议和证书配置一致；服务器上的hosts配置不会自动作用于本机浏览器。

### 6. 完成首次工作区设置

空的自托管安装在未配置SSO提供器时，会显示工作区初始化页面。填写工作区名称、管理员姓名和管理员邮箱后，后端创建团队及管理员，并直接建立登录会话。

相关代码位于[Login.tsx](../app/scenes/Login/Login.tsx)和[installation.create接口](../server/routes/api/installation/installation.ts)。已有工作区继续使用现有账号登录。

后续邮箱登录面向已存在的用户。开发环境没有配置SMTP用户名时，邮件发送器会尝试使用Ethereal测试邮箱，并在成功发送后输出预览地址；这个过程需要外部网络可用。也可以设置`LOG_LEVEL=debug`查看开发邮件日志，或配置自己的开发SMTP服务。邮件任务需要worker正常运行。

### 7. 区分应用配置与迁移命令配置

应用会合并前面介绍的多个环境文件，Sequelize CLI则通过[.sequelizerc](../.sequelizerc)加载配置：普通执行读取`.env`，`NODE_ENV=test`时读取`.env.test`，不会自动合并`.env.local`和`.env.development`。

因此，手动迁移时应明确指定与应用一致的数据库连接。仅针对本文的本地示例，可以这样执行：

```bash
yarn build:server
NODE_ENV=development DATABASE_URL=postgres://user:pass@127.0.0.1:5432/outline PGSSLMODE=disable yarn db:migrate
```

如果采用了其他连接配置，替换成相应开发库的值。检查迁移状态时，也需要为CLI提供同一组环境配置。

### 8. 初始化独立测试数据库

后端测试仍然使用真实PostgreSQL数据库，Redis和Bull由测试初始化代码替换。先检查`.env.test`，确保它指向专用测试库；终端已经导出的`DATABASE_URL`会覆盖文件配置，也需要一起确认。

以下命令只针对已经确认的测试环境，测试库不存在时才执行创建命令：

```bash
NODE_ENV=test yarn sequelize db:create
```

准备构建脚本、执行测试库迁移，然后运行一个相关测试文件：

```bash
yarn build:server
NODE_ENV=test yarn sequelize db:migrate
NODE_ENV=test yarn test server/routes/api/documents/documents.test.ts -t '#documents.update'
```

项目的`make test`和`make watch`都会先删除并重建测试库。日常验证可以沿用上面的单文件命令，无需每次重建整个测试环境。

### 已有Makefile命令怎么选

| 命令 | 当前仓库实际行为 |
| --- | --- |
| `make up` | 启动本地Redis和PostgreSQL，配置证书、安装锁定依赖并启动开发监听 |
| `make up-remote` | 读取`.env.shared`连接团队共用服务，以`--no-migrate`启动，可按配置建立SSH隧道 |
| `make migrate-status-remote` | 查看共享数据库迁移状态 |
| `make migrate-remote` | 安装依赖、构建后端并执行共享数据库迁移 |
| `make test` | 删除并重建测试库、执行迁移，然后运行整个测试集 |
| `make watch` | 删除并重建测试库、执行迁移，然后启动测试监听 |

使用共享开发环境时，按[Makefile](../Makefile)中的说明准备`.env.shared`。`--no-migrate`遇到待执行迁移会停止启动，需要团队先确认对应迁移，再更新共享数据库。

## 二次开发从哪里入手

第一次接触项目时，建议先完成一次小范围页面修改，再跟踪已有字段的保存过程，最后尝试增加持久化字段。这样每一步都能在页面上观察到结果，也方便判断问题发生在哪一层。

### 根据需求找到代码位置

| 二开需求 | 优先查看的位置 | 需要同时关注的内容 |
| --- | --- | --- |
| 调整页面说明、按钮文字和样式 | [app/scenes](../app/scenes)、[app/components](../app/components) | 国际化、移动端布局、加载及只读状态 |
| 增加页面或设置入口 | [app/routes](../app/routes)、[app/routes/scenes.ts](../app/routes/scenes.ts) | 路由注册、懒加载和访问权限 |
| 修改文档菜单及快捷操作 | [documents.tsx](../app/actions/definitions/documents.tsx)、[DocumentMenu.tsx](../app/menus/DocumentMenu.tsx) | 菜单、快捷键和其他入口复用同一个动作 |
| 调整标题、图标等现有属性 | [useDocumentSave.ts](../app/scenes/Document/hooks/useDocumentSave.ts)、[前端Document模型](../app/models/Document.ts) | 保存时机、接口参数和刷新后的回显 |
| 新增业务接口 | [server/routes/api](../server/routes/api)、[server/commands](../server/commands) | 参数校验、资源权限、事务和响应结构 |
| 新增数据库字段 | [server/migrations](../server/migrations)、[server/models](../server/models) | 前后端模型、写入入口、响应字段及旧数据兼容 |
| 调整登录页面外观 | [Login.tsx](../app/scenes/Login/Login.tsx) | 保留认证跳转和会话处理 |
| 接入新的登录协议 | [plugins/oidc](../plugins/oidc)等认证插件 | 插件注册、回调、身份校验和用户关联 |
| 增加编辑器交互 | [app/editor](../app/editor) | 编辑器菜单、命令与只读状态 |
| 新增富文本节点或格式 | [shared/editor](../shared/editor) | 服务端解析、粘贴、导入导出和协作兼容 |

### 前端需要先认识的目录

后端开发也需要知道页面从哪里发起请求。可以先阅读文档页面相关的这部分代码：

```text
app
├── index.tsx -- React挂载入口及应用初始化
├── routes
│   ├── index.tsx -- 应用路由入口
│   ├── authenticated.tsx -- 登录后的页面路由及布局
│   ├── scenes.ts -- 页面懒加载定义
│   └── settings.tsx -- 设置页面路由
├── scenes
│   └── Document
│       ├── index.tsx -- 文档页面入口
│       ├── components
│       │   ├── DataLoader.tsx -- 加载文档页面数据
│       │   ├── Document.tsx -- 组织文档页面及编辑状态
│       │   ├── Header.tsx -- 文档顶部按钮和操作入口
│       │   ├── Editor.tsx -- 组合标题、元信息和正文编辑器
│       │   └── DocumentTitle.tsx -- 标题、图标及图标颜色编辑
│       └── hooks
│           └── useDocumentSave.ts -- 保存、自动保存及脏状态处理
├── models
│   └── Document.ts -- 浏览器中的文档模型
├── stores
│   ├── RootStore.ts -- 组织各业务Store
│   ├── DocumentsStore.ts -- 文档集合及查询操作
│   └── base
│       └── Store.ts -- 通用增删改查和响应数据入库
├── hooks
│   ├── useStores.ts -- 获取应用Store
│   └── usePolicy.ts -- 获取当前用户对资源的操作权限
└── utils
    └── ApiClient.ts -- 统一HTTP请求、CSRF及错误处理
```

这里有两个同名的`Document.ts`：前端模型保存浏览器中的业务状态，后端模型映射数据库并执行相关业务行为。增加一个需要保存到数据库的新属性时，要分别检查两边的定义。

页面局部的弹窗开关等状态可以使用React状态；跨页面共享的业务数据通过MobX模型和Store管理。组件通过`observer`订阅模型变化，派生数据优先放到`computed`中。

## 第一个二开练习：调整文档编辑按钮

这个练习只调整已有按钮的文字，适合熟悉页面定位、热更新和权限条件。以下代码是练习说明，本文没有替你修改应用功能。

### 1. 找到现有按钮

打开[Header.tsx](../app/scenes/Document/components/Header.tsx)，搜索`editAction`。当前桌面端编辑按钮使用`t("Edit")`显示文字，同一组件的提示信息已经使用了`t("Edit {{noun}}", { noun: document.noun })`。

可以将按钮文字改为下面的形式，让用户看到更完整的操作对象：

```tsx
{isMobile
  ? null
  : t("Edit {{noun}}", {
      noun: document.noun,
    })}
```

这里复用已有翻译键。新增界面文案时，也应沿用`useTranslation()`和`t()`，翻译条目由提取流程生成，相关说明见[国际化文档](TRANSLATION.md)。

### 2. 保留原有行为

按钮的跳转地址、事件处理、移动端分支和权限条件都承担实际功能。这个练习只修改文字，继续使用原来的`documentEditPath(document)`和侧栏上下文。

该编辑按钮只会在满足相关条件时出现，包括当前用户有更新权限、页面不处于编辑状态、用户启用了独立编辑模式，以及当前页面不是历史版本。测试时先确认这些条件，避免为了显示按钮而删除`can.update`检查。

### 3. 在页面上验证

1. 打开一篇可编辑文档，确认按钮文字和点击后的跳转。
2. 切换到移动端宽度，确认仍保留原有图标显示方式。
3. 使用只读成员访问文档，确认操作权限没有改变。

这类低影响展示调整可以先做针对性的手动验证；业务规则、权限和持久化变化需要补充相应测试。

## 跟踪一次完整保存：修改文档图标颜色

完成页面练习后，可以通过已有的图标颜色功能学习前后端如何配合。这里的`color`表示文档图标颜色。

### 1. 从页面操作找到请求

在页面中修改文档图标颜色，同时打开浏览器开发者工具的Network面板，查找`documents.update`请求。前端调用关系如下：

```text
DocumentTitle.tsx中的图标选择
    ↓
Editor.tsx透传回调
    ↓
useDocumentSave.ts中的handleChangeIcon
    ↓
更新document.icon、document.color并保存
    ↓
app/models/Document.ts中的save
    ↓
DocumentsStore继承的Store.save与Store.update
    ↓
ApiClient.post
    ↓
POST /api/documents.update
```

保存请求通过[ApiClient.ts](../app/utils/ApiClient.ts)处理CSRF、同源凭据和错误转换。扩展功能时优先复用已有模型、Store和请求客户端，确保接口返回后Store中的数据也会更新。

下面只展示请求体中的相关字段，实际页面请求还可能携带其他属性：

```json
{
  "id": "目标文档的UUID",
  "color": "#FFDDEE"
}
```

### 2. 顺着后端处理链阅读

| 处理环节 | 文件 | 阅读重点 |
| --- | --- | --- |
| 请求参数校验 | [schema.ts](../server/routes/api/documents/schema.ts) | `DocumentsUpdateSchema`中的颜色格式和空值规则 |
| 接口入口 | [documents.ts](../server/routes/api/documents/documents.ts) | 搜索`documents.update`，查看身份认证、事务及文档加载 |
| 资源授权 | [document.ts](../server/policies/document.ts) | 当前用户是否拥有该文档的更新权限 |
| 属性修改 | [documentUpdater.ts](../server/commands/documentUpdater.ts) | 如何区分未提交属性和主动清空属性 |
| 数据库存储 | [Document.ts](../server/models/Document.ts) | `color`字段类型、校验和数据库列定义 |
| 响应转换 | [document.ts](../server/presenters/document.ts) | 保存后的颜色如何返回客户端 |

更新命令中有这样的处理：

```ts
if (color !== undefined) {
  document.color = color;
}
```

其中，`undefined`表示这次请求没有修改颜色，`null`表示主动清空颜色。二开时要保留这种区别，否则用户可能无法清空已有值。

请求Schema和模型装饰器都会对颜色进行校验。修改输入规则时，需要让两边保持一致，避免请求校验通过后又在数据库保存阶段失败。

### 3. 验证是否真正保存

修改颜色后刷新页面，确认颜色仍然存在；然后清空颜色，再次刷新确认结果。接口测试还应重新读取数据库中的文档，验证持久化结果。

现有[文档接口测试](../server/routes/api/documents/documents.test.ts)已经覆盖颜色设置、清空和只读用户更新等场景，可以先阅读这些用例，再为自己的变化补充测试。

文档正文编辑还涉及ProseMirror、Yjs和协作服务。开始修改正文结构之前，应继续阅读共享节点定义、协作状态持久化及导入导出逻辑。

## 进阶二开：增加一个持久化字段

假设准备为文档增加一个可选的业务编号`referenceCode`。这个字段是教学示例，当前项目没有因本文而新增该字段。可以按下面的顺序梳理改动范围：

| 步骤 | 修改位置 | 需要完成的工作 |
| --- | --- | --- |
| 明确规则 | 需求说明 | 确定长度、空值含义、旧数据默认值、修改权限和公开范围 |
| 增加数据库列 | [server/migrations](../server/migrations) | 新建迁移，编写`up`和`down`，考虑已有数据 |
| 定义后端属性 | [server/models/Document.ts](../server/models/Document.ts) | 补充类型、列定义及适用的字段校验 |
| 校验更新请求 | [schema.ts](../server/routes/api/documents/schema.ts) | 为更新Schema增加字段规则，明确省略和清空的区别 |
| 写入数据库 | [documentUpdater.ts](../server/commands/documentUpdater.ts) | 补充参数类型、解构和属性赋值，沿用事务及请求上下文 |
| 返回字段 | [文档Presenter](../server/presenters/document.ts) | 决定普通访问和公开分享分别返回哪些信息 |
| 定义前端属性 | [app/models/Document.ts](../app/models/Document.ts) | 按现有字段惯例补充类型、可观察状态及序列化配置 |
| 增加编辑入口 | 对应页面组件或Hook | 复用权限判断和保存方法，处理加载及错误状态 |
| 验证行为 | 现有接口、命令和Presenter测试 | 覆盖写入、清空、无权限、非法输入及持久化回读 |

### 创建和执行数据库迁移

使用仓库约定的命令生成迁移文件：

```bash
yarn sequelize migration:create --name=add-reference-code-to-documents
```

然后编辑生成的脚本，参考[已有单表字段迁移](../server/migrations/20260821164024-add-preferences-to-documents.js)的结构，实现新增字段和回滚逻辑。已执行过的历史迁移应保持原样，用新的迁移表达后续结构调整。

模型中的`@Column`与迁移脚本需要保持类型、空值及默认值一致。数据库列由迁移创建；修改模型定义后，还需要执行相应迁移。

部分迁移会调用编译后的服务端脚本，手动执行迁移前先运行`yarn build:server`。手动迁移使用的数据库连接也要与开发应用一致，环境配置方式见前面的开发环境说明。

### 检查其他读写入口

更新接口接通后，再按实际需求检查下面这些入口：

- 创建时就允许填写：同步检查创建Schema、创建路由和[documentCreator.ts](../server/commands/documentCreator.ts)。
- 复制后需要保留：检查[documentDuplicator.ts](../server/commands/documentDuplicator.ts)的复制字段。
- 侧栏需要展示：检查集合导航数据及其更新逻辑。
- 历史版本需要恢复：检查修订版本的字段保存和恢复逻辑。
- 导入导出需要携带：检查对应转换器、任务及数据格式。
- 公开分享需要展示：明确该字段在公开响应中的可见范围。

只有业务需要的入口才增加相应行为。例如内部业务编号是否允许出现在公开分享页面，需要先明确产品规则，再决定Presenter中的输出位置。

### 保留事务和事件上下文

已有命令通过`saveWithCtx()`携带当前用户、事务和业务事件配置。修改保存逻辑时，应沿用这套调用方式，让通知、实时更新等后续处理继续获得正确上下文。

对于JSON或数组属性，使用新对象或新数组替换旧值，并在测试中通过`reload()`检查落库结果。依赖事务提交结果的可选后台任务，应在`afterCommit`中安排，并使用不会让已提交操作失败的调度方式。

## 二开时的验证和排错

### 按改动范围选择测试

测试数据库准备完成后，可以从与改动最相关的文件开始：

```bash
yarn test server/routes/api/documents/documents.test.ts -t '#documents.update'
yarn test server/commands/documentUpdater.test.ts
yarn test server/policies/document.test.ts
yarn test server/presenters/document.test.ts
```

这些命令是可选的验证入口，根据实际改动选择需要的测试。仅修改Presenter时优先验证响应内容；修改权限时应覆盖允许和拒绝两类用户；修改持久化逻辑时需要检查数据库回读结果。

后端测试可以复用[数据工厂](../server/test/factories.ts)及[测试辅助函数](../server/test/support.ts)。测试文件放在相关代码旁边；服务器测试使用`vi.mock`或`vi.resetModules`时，按仓库约定在文件首行添加：

```ts
// @vitest-isolate true
```

提交前执行类型、代码规范和格式检查：

```bash
yarn tsc
yarn lint
yarn format:check
```

修正格式时，可以只格式化实际修改的文件，避免把其他模块的格式变化一起带入提交。例如修改了文档顶部组件时：

```bash
yarn oxfmt app/scenes/Document/components/Header.tsx
```

需要交付构建产物时，再执行`yarn build`验证完整构建。

### 常见问题与定位方向

| 现象 | 优先检查 |
| --- | --- |
| 修改页面后没有变化 | 确认访问的是开发应用，Vite正常运行，修改的是当前路由实际使用的组件 |
| 找不到编辑按钮 | 检查对象权限、是否已进入编辑状态、独立编辑模式及历史版本状态 |
| 页面显示了新字段，刷新后消失 | 沿前端字段序列化、请求Schema、更新命令、模型和迁移检查写入链 |
| 数据库已有值，页面没有显示 | 检查Presenter是否返回，以及前端模型和Store是否接收该字段 |
| 请求返回403 | 检查资源权限、团队或集合成员关系；页面隐藏按钮不能替代后端授权 |
| 请求提示CSRF错误 | 确认复用ApiClient，访问域名、协议和Cookie对应同一开发环境 |
| 修改JSON字段后没有落库 | 检查是否只原地修改了对象，尝试替换整个属性并回读验证 |
| 迁移提示字段不存在或重复 | 检查当前连接的数据库及迁移状态，确认脚本是否针对同一个环境执行 |
| 修改共享编辑器后服务端行为未更新 | 后端监听忽略了`shared/editor`目录，重启开发进程触发重新编译 |
| 邮件、导出等任务没有执行 | 检查worker、Redis及任务处理日志 |
| 另一位用户看不到变化 | 分别检查业务事件广播、协作服务和相应权限，而后确认保存事件是否触发 |

需要查看请求或数据库日志时，可以使用仓库现有的调试配置启动开发环境：

```bash
NODE_ENV=development DEBUG=http yarn dev:watch
```

```bash
NODE_ENV=development DEBUG=database LOG_LEVEL=debug yarn dev:watch
```

排查时先观察浏览器请求的地址、参数、响应和状态码，再对应服务端日志定位处理阶段，最后根据需要检查数据库及队列状态。

## 项目源码地址

- 上游项目：[outline/outline](https://github.com/outline/outline)
- 当前仓库远程地址：[wongdark2017/outline](https://github.com/wongdark2017/outline)
