# Outline 架构与 API 清单

Outline 是一个团队知识库。
前端和后端使用 TypeScript。
两者在同一个仓库中共享代码。

当前 `/api` 包含 **217 个接口路径**。
按 HTTP 方法区分，共有 **224 个接口操作**。
完整记录见 [API 清单](./api-inventory.csv)。

## 文档范围

- 日期：2026-10-30。
- 分支：`dev/trellis-explore`。
- 提交：`e14b6481c`。
- 已验证：路由声明、挂载关系和静态数量。
- 未验证：部署环境实际开放的接口。

接口数量来自当前源码。
配置控制的接口也计入源码总数。
本文没有发送业务请求。

## 术语

| 术语      | 含义                                   |
| --------- | -------------------------------------- |
| API 路径  | 一个 HTTP 接口的完整路径模板。         |
| 接口操作  | 一个 HTTP 方法与一个 API 路径的组合。  |
| 路由      | 将请求交给指定代码的服务端规则。       |
| Store     | 保存客户端实体集合或全局状态的对象。   |
| Model     | 表示业务实体的模型。两端各有实现。     |
| Command   | 协调跨模型业务动作的函数。             |
| Policy    | 判断用户能否操作实体的规则。           |
| Presenter | 将服务端模型转换为 API 响应的函数。    |
| Processor | 根据业务事件执行动作的处理器。         |
| Task      | 由后台队列执行的任务。                 |
| MCP       | 供外部客户端调用工具和读取资源的协议。 |

## 前端

React 负责页面显示。
Vite 负责浏览器代码构建。
MobX 负责客户端状态。
styled-components 负责组件样式。

入口文件是 [app/index.tsx](../app/index.tsx)。
React Router 负责页面路由。
页面通过懒加载拆分代码。
Suspense 显示加载期间的内容。

```text
app/
├── actions/       可复用的业务动作
├── components/    跨页面使用的组件
├── editor/        编辑器视图、状态与交互
├── hooks/         React hooks
├── menus/         业务菜单
├── models/        客户端实体模型
├── routes/        路由与页面懒加载
├── scenes/        完整页面与页面专属组件
├── stores/        实体集合、请求与全局状态
├── types.ts       应用类型
├── typings/       第三方类型声明
└── utils/         客户端工具
```

页面通过 Store 获取数据。
Store 调用 [ApiClient](../app/utils/ApiClient.ts) 发送请求。
响应中的实体进入相应 Store。
响应中的权限进入 PoliciesStore。
订阅状态的组件随后更新。

```text
页面或 action
  → Model / Store
  → ApiClient
  → /api/<资源>.<操作>
  → 实体数据与权限
  → Store
  → 页面
```

前端权限控制按钮和页面状态。
服务端仍负责每次数据访问的授权。

## 后端

Koa 负责 HTTP 请求。
Sequelize 负责数据库模型和事务。
PostgreSQL 保存业务数据。
Bull 使用 Redis 保存队列工作。

入口文件是 [server/index.ts](../server/index.ts)。
[server/main.ts](../server/main.ts) 创建子进程内的 Koa 应用。
[services](../server/services/index.ts) 注册运行服务。

```text
server/
├── routes/           核心路由与插件路由装配
│   ├── api/          业务 API
│   ├── auth/         登录与身份回调
│   ├── oauth/        OAuth 授权与令牌
│   └── mcp/          MCP HTTP 入口
├── collaboration/    文档协作扩展
├── commands/         跨模型业务动作
├── config/           数据库配置
├── emails/           邮件模板与发送入口
├── mcp/              MCP 工具与资源
├── middlewares/      请求中间件
├── migrations/       数据库迁移
├── models/           服务端实体模型
├── onboarding/       新用户文档模板
├── policies/         服务端授权规则
├── presenters/       API 响应转换
├── queues/           队列定义
│   ├── processors/   根据事件执行动作
│   └── tasks/        后台任务
├── services/         运行服务
├── static/           页面壳与静态输入
├── storage/          数据库、Redis 与文件存储
├── test/             测试设施与固定测试数据
└── utils/            服务端工具
```

### 运行服务

| 服务            | 职责                         |
| --------------- | ---------------------------- |
| `web`           | 提供网页和 HTTP 接口。       |
| `websockets`    | 推送业务实体和权限变化。     |
| `collaboration` | 同步文档正文。               |
| `worker`        | 执行后台任务和事件处理器。   |
| `cron`          | 安排周期任务。               |
| `admin`         | 提供开发环境的队列管理页面。 |

API 属于 `web` 服务。
服务注册表没有独立的 `api` 服务。
默认服务列表不包含 `cron`。
周期任务依赖 `cron` 服务或外部调度器。

### 请求与业务逻辑

核心业务接口使用 RPC 命名。
例如：`POST /api/documents.create`。
路由入口是 [server/routes/api/index.ts](../server/routes/api/index.ts)。

```text
请求
  → 认证与参数校验
  → Policy
  → Command / Model
  → 数据库
  → Presenter
  → 响应
```

路由声明请求中间件。
`schema.ts` 定义请求约束。
Policy 判断实体权限。
Command 协调跨模型操作。
Presenter 控制响应字段。

权限基础实现在 [cancan.ts](../server/policies/cancan.ts)。
该实现提供 cancan 风格的能力检查。

数据库事务提交后，事件可以进入队列。
Processor 也可以安排 Task。
因此，Task 的来源包含事件处理器。

### 实时通信

| 通道             | 技术            | 数据                   |
| ---------------- | --------------- | ---------------------- |
| `/realtime`      | Socket.IO       | 业务实体与权限变化     |
| `/collaboration` | Yjs、Hocuspocus | 文档正文与在线协作状态 |

两条通道承担不同职责。
Socket.IO 通知客户端更新 Store。
Yjs 合并协作编辑产生的正文变化。

## 共享代码

`shared/` 保存前后端共同使用的代码。
共享编辑器代码定义正文结构和转换规则。
浏览器编辑器使用这些规则编辑内容。
服务端使用同一组规则解析内容。

```text
shared/
├── components/       共享 React 组件
├── editor/           富文本内容结构与转换规则
│   ├── nodes/        内容节点
│   ├── marks/        文本标记
│   └── lib/          扩展管理与 Markdown 转换
├── i18n/             国际化配置
│   └── locales/      翻译资源
├── styles/           共享样式
├── types/            共享类型
└── utils/            共享工具
```

编辑器主体位于 [app/editor](../app/editor/index.tsx)。
服务端适配位于 [server/editor](../server/editor/index.ts)。
新增内容节点时，必须检查两端兼容性。

## 插件

插件位于 `plugins/`。
插件入口负责注册扩展。
前后端分别使用自己的 PluginManager。

| 目录      | 职责                 |
| --------- | -------------------- |
| `client/` | 设置页面与客户端入口 |
| `server/` | 路由、认证与后台工作 |
| `shared/` | 插件两端共享的代码   |

插件 API 先于核心 API 挂载。
注册条件见各插件的 `server/index.ts`。
配置满足注册条件后，接口仍需执行自身校验。

## API 数量与清单

### 统计口径

同一路径支持 GET 和 POST 时，计一个路径。
这两个方法计两个接口操作。
参数化路径按一个模板计算。
例如，`cron.:period` 只计一个路径。

本清单包含实际声明的接口。
本清单也包含兼容别名和条件接口。
以下项目不计入数量：

- 测试文件中的路由。
- 只返回 404 或 405 的占位入口。
- 框架自动提供的 HEAD 和 OPTIONS。
- 普通网页和静态文件。
- 站点文件 `/robots.txt` 和 `/opensearch.xml`。
- WebSocket 握手和消息名称。

统计没有按 handler 数量计算。
一个 handler 可以对应多个路径。
一个路径也可以对应多个 HTTP 方法。

OAuth/MCP 发现元数据属于协议接口。
这些接口单列在扩展 HTTP 总计中。

### 总量

| 范围                   |  路径数 |  操作数 |
| ---------------------- | ------: | ------: |
| 核心 `/api`            |     197 |     204 |
| 插件 `/api`            |      20 |      20 |
| **`/api` 小计**        | **217** | **224** |
| 内建与插件 `/auth`     |      20 |      22 |
| `/oauth`               |       5 |       7 |
| MCP HTTP 入口          |       1 |       1 |
| **业务与协议入口小计** | **243** | **254** |
| OAuth/MCP 发现元数据   |       4 |       4 |
| 健康检查               |       1 |       1 |
| **扩展 HTTP 总计**     | **248** | **259** |

`/api` 包含 206 个 POST 操作。
`/api` 另有 18 个 GET 操作。
MCP 另提供 19 个工具。
这些工具共用 `POST /mcp`。
工具数不加入 HTTP 路径数。

### 核心 API 模块

模块链接指向路由定义。
逐项方法和路径见 [API 清单](./api-inventory.csv)。

| 模块                                                                                               | 用途               |  路径数 |  操作数 |
| -------------------------------------------------------------------------------------------------- | ------------------ | ------: | ------: |
| [accessRequests](../server/routes/api/accessRequests/accessRequests.ts)                            | 访问申请           |       4 |       4 |
| [apiKeys](../server/routes/api/apiKeys/apiKeys.ts)                                                 | API 密钥           |       3 |       3 |
| [attachments](../server/routes/api/attachments/attachments.ts)                                     | 附件               |       5 |       6 |
| [auth](../server/routes/api/auth/auth.ts)                                                          | 会话与登录配置     |       3 |       3 |
| [authenticationProviders](../server/routes/api/authenticationProviders/authenticationProviders.ts) | 身份提供方         |       5 |       5 |
| [batch](../server/routes/api/batch/batch.ts)                                                       | 批量请求           |       1 |       1 |
| [collections](../server/routes/api/collections/collections.ts)                                     | 集合与集合权限     |      19 |      19 |
| [comments](../server/routes/api/comments/comments.ts)                                              | 评论               |       9 |       9 |
| [cron](../server/routes/api/cron/cron.ts)                                                          | 周期调度与兼容入口 |       2 |       4 |
| [developer](../server/routes/api/developer/developer.ts)                                           | 开发测试数据       |       2 |       2 |
| [documents](../server/routes/api/documents/documents.ts)                                           | 文档与文档权限     |      29 |      29 |
| [emojis](../server/routes/api/emojis/emojis.ts)                                                    | 自定义表情         |       6 |       6 |
| [events](../server/routes/api/events/events.ts)                                                    | 操作记录           |       1 |       1 |
| [fileOperations](../server/routes/api/fileOperations/fileOperations.ts)                            | 文件操作记录       |       4 |       5 |
| [groupMemberships](../server/routes/api/groupMemberships/groupMemberships.ts)                      | 组授权查询         |       1 |       1 |
| [groups](../server/routes/api/groups/groups.ts)                                                    | 用户组与组成员     |      10 |      10 |
| [imports](../server/routes/api/imports/imports.ts)                                                 | 导入任务           |       5 |       5 |
| [installation](../server/routes/api/installation/installation.ts)                                  | 安装初始化         |       2 |       2 |
| [integrations](../server/routes/api/integrations/integrations.ts)                                  | 集成配置           |       5 |       5 |
| [notifications](../server/routes/api/notifications/notifications.ts)                               | 通知与退订         |       5 |       6 |
| [oauthAuthentications](../server/routes/api/oauthAuthentications/oauthAuthentications.ts)          | OAuth 授权记录     |       2 |       2 |
| [oauthClients](../server/routes/api/oauthClients/oauthClients.ts)                                  | OAuth 客户端       |       6 |       6 |
| [pins](../server/routes/api/pins/pins.ts)                                                          | 固定条目           |       5 |       5 |
| [reactions](../server/routes/api/reactions/reactions.ts)                                           | 回应查询           |       1 |       1 |
| [relationships](../server/routes/api/relationships/relationships.ts)                               | 关联关系查询       |       2 |       2 |
| [revisions](../server/routes/api/revisions/revisions.ts)                                           | 文档历史版本       |       5 |       5 |
| [searches](../server/routes/api/searches/searches.ts)                                              | 搜索记录           |       3 |       3 |
| [shares](../server/routes/api/shares/shares.ts)                                                    | 公开分享           |       9 |       9 |
| [stars](../server/routes/api/stars/stars.ts)                                                       | 收藏               |       4 |       4 |
| [subscriptions](../server/routes/api/subscriptions/subscriptions.ts)                               | 订阅               |       4 |       5 |
| [suggestions](../server/routes/api/suggestions/suggestions.ts)                                     | 提及建议           |       1 |       1 |
| [teams](../server/routes/api/teams/teams.ts)                                                       | 工作空间           |       5 |       5 |
| [templates](../server/routes/api/templates/templates.ts)                                           | 文档模板           |       7 |       7 |
| [urls](../server/routes/api/urls/urls.ts)                                                          | 链接与域名校验     |       3 |       3 |
| [userMemberships](../server/routes/api/userMemberships/userMemberships.ts)                         | 用户授权           |       2 |       2 |
| [users](../server/routes/api/users/users.ts)                                                       | 用户与角色         |      15 |      16 |
| [views](../server/routes/api/views/views.ts)                                                       | 访问记录           |       2 |       2 |
| **合计**                                                                                           | **37 个模块**      | **197** | **204** |

核心 API 包含 7 个双方法路径。
这些路径都支持 GET 和 POST：

- `/api/attachments.redirect`
- `/api/fileOperations.redirect`
- `/api/cron.:period`
- `/api/utils.gc`
- `/api/notifications.unsubscribe`
- `/api/subscriptions.delete`
- `/api/users.updateEmail`

`team.update` 和 `teams.update` 分别计数。
`/api/batch` 也计入总数。
当前分支没有提醒接口模块。

### 条件挂载

`installation` 只在非云托管环境挂载。
`developer` 只在开发环境挂载。
两者各提供两个路径和两个操作。

| 核心 API 范围        | 路径数 | 操作数 |
| -------------------- | -----: | -----: |
| 不含上述两个条件模块 |    193 |    200 |
| 自托管非开发环境     |    195 |    202 |
| 云托管开发环境       |    195 |    202 |
| 自托管开发环境       |    197 |    204 |

插件数量取决于注册条件。
配置值不在本次静态盘点范围内。
因此，源码总数不代表某个部署的开放数量。

### 插件 API

下表省略 `/api/` 前缀。

| 模块                                                               | 路径数 | 操作数 | 接口                                                                                                                                         |
| ------------------------------------------------------------------ | -----: | -----: | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [figma](../plugins/figma/server/api/figma.ts)                      |      1 |      1 | `GET figma.callback`                                                                                                                         |
| [github](../plugins/github/server/api/github.ts)                   |      2 |      2 | `GET github.callback`；`POST github.webhooks`                                                                                                |
| [gitlab](../plugins/gitlab/server/api/gitlab.ts)                   |      3 |      3 | `GET gitlab.callback`；`POST gitlab.connect`；`POST gitlab.webhooks`                                                                         |
| [linear](../plugins/linear/server/api/linear.ts)                   |      1 |      1 | `GET linear.callback`                                                                                                                        |
| [notion](../plugins/notion/server/api/notion.ts)                   |      1 |      1 | `GET notion.callback`                                                                                                                        |
| [passkeys](../plugins/passkeys/server/api/passkeys.ts)             |      3 |      3 | `POST passkeys.delete`；`POST passkeys.list`；`POST passkeys.update`                                                                         |
| [slack](../plugins/slack/server/api/hooks.ts)                      |      3 |      3 | `POST hooks.interactive`；`POST hooks.slack`；`POST hooks.unfurl`                                                                            |
| [storage](../plugins/storage/server/api/files.ts)                  |      2 |      2 | `POST files.create`；`GET files.get`                                                                                                         |
| [webhooks](../plugins/webhooks/server/api/webhookSubscriptions.ts) |      4 |      4 | `POST webhookSubscriptions.create`；`POST webhookSubscriptions.delete`；`POST webhookSubscriptions.list`；`POST webhookSubscriptions.update` |

集成的 OAuth 回调也包含在上表中。
这些回调不是 `/auth` 登录入口。

### 登录与认证接口

下表省略 `/auth/` 前缀。

| 模块                                                    | 路径数 | 操作数 | 接口                                                                                                                                                                                |
| ------------------------------------------------------- | -----: | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [azure](../plugins/azure/server/auth/azure.ts)          |      2 |      2 | `GET azure`；`GET azure.callback`                                                                                                                                                   |
| [discord](../plugins/discord/server/auth/discord.ts)    |      2 |      2 | `GET discord`；`GET discord.callback`                                                                                                                                               |
| [email](../plugins/email/server/auth/email.ts)          |      2 |      3 | `POST email`；`GET/POST email.callback`                                                                                                                                             |
| [google](../plugins/google/server/auth/google.ts)       |      2 |      2 | `GET google`；`GET google.callback`                                                                                                                                                 |
| [oidc](../plugins/oidc/server/auth/oidcRouter.ts)       |      3 |      4 | `GET oidc`；`GET/POST oidc.callback`；`GET oidc.logout`                                                                                                                             |
| [passkeys](../plugins/passkeys/server/auth/passkeys.ts) |      5 |      5 | `GET passkey`；`POST passkeys.generateAuthenticationOptions`；`POST passkeys.generateRegistrationOptions`；`POST passkeys.verifyAuthentication`；`POST passkeys.verifyRegistration` |
| [slack](../plugins/slack/server/auth/slack.ts)          |      3 |      3 | `GET slack`；`GET slack.callback`；`GET slack.post`                                                                                                                                 |

内建认证另有 `GET /auth/redirect`。
该入口将 transfer token 转换为应用会话。

邮件和 OIDC 回调都支持 GET 与 POST。
Passkeys 的跳转路径是单数 `passkey`。
CSV 的 `availability` 列记录注册条件。
具体身份校验由路由代码决定。

### OAuth 与协议入口

| 方法   | 路径                        | 用途                          |
| ------ | --------------------------- | ----------------------------- |
| POST   | `/oauth/authorize`          | 提交授权同意                  |
| POST   | `/oauth/token`              | 获取或刷新令牌                |
| POST   | `/oauth/revoke`             | 撤销令牌                      |
| POST   | `/oauth/register`           | 注册客户端                    |
| GET    | `/oauth/register/:clientId` | 读取注册信息                  |
| PUT    | `/oauth/register/:clientId` | 更新注册信息                  |
| DELETE | `/oauth/register/:clientId` | 删除注册信息                  |
| POST   | `/mcp`                      | 接收 MCP 请求                 |
| GET    | `/_health`                  | 检查 PostgreSQL 与 Redis 连接 |

发现元数据包含以下四个 GET 路径：

- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-authorization-server/mcp`
- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp`

`GET /mcp` 和 `DELETE /mcp` 返回 405。
`GET /sse` 返回 404。
这三个入口不计入有效接口。

### MCP 工具

| 领域     |   数量 | 工具名称                                                                                                                                    |
| -------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档     |      7 | `list_documents`、`list_collection_documents`、`create_document`、`move_document`、`update_document`、`delete_document`、`restore_document` |
| 集合     |      4 | `list_collections`、`create_collection`、`update_collection`、`delete_collection`                                                           |
| 评论     |      4 | `list_comments`、`create_comment`、`update_comment`、`delete_comment`                                                                       |
| 附件     |      1 | `create_attachment`                                                                                                                         |
| 模板     |      1 | `list_templates`                                                                                                                            |
| 用户     |      1 | `list_users`                                                                                                                                |
| 读取资源 |      1 | `fetch`                                                                                                                                     |
| **合计** | **19** | 按令牌权限选择工具                                                                                                                          |

工具定义位于 [server/mcp/tools](../server/mcp/tools)。
资源和 skills 扩展方法不计入工具数。

### 清单字段与维护

[api-inventory.csv](./api-inventory.csv) 包含 259 条操作记录。
每条记录对应一个方法与路径组合。

| 字段           | 含义                               |
| -------------- | ---------------------------------- |
| `category`     | 核心、插件、认证或协议分类         |
| `module`       | 所属模块或插件                     |
| `method`       | HTTP 方法                          |
| `path`         | 完整路径模板                       |
| `availability` | 挂载条件或调用条件说明             |
| `source`       | 路由源文件                         |
| `line`         | 路由注册代码的行号                 |
| `schema_file`  | 同目录的请求约束文件；不存在时留空 |

新增或删除路由后，必须重新统计数量。
移动代码后，必须更新 CSV 行号。
参数和权限规则以源码为准。
同目录存在 schema 文件，不代表所有路由都调用它。

## 开发检查

Oxlint 检查代码规则。
TypeScript 检查类型。
oxfmt 统一文件格式。
Vitest 执行测试。

测试文件与被测代码放在同一目录。
测试设施放在相应的 `test/` 目录。
具体约定见 [AGENTS.md](../AGENTS.md)。
CI 步骤见 [ci.yml](../.github/workflows/ci.yml)。
当前 CI 没有单独的 oxfmt 检查步骤。
