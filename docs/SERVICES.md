# 后端服务

Outline 的后端被拆分为多个独立的 [service](../server/services)，它们共同组成完整的应用。运行官方 Docker 容器时，默认会启动所有生产环境所需的 service。

你可以通过逗号分隔的 CLI 参数 `--services`，或通过 `SERVICES` 环境变量来选择要启动哪些 service。例如：

```bash
yarn start --services=web,worker
```

## Admin

目前这个 service 仅用于开发环境，用来查看和调试队列。启用后可以通过 `/admin` 访问。

## Web

Web 服务器承载应用本体和 API，因此它是最核心的 service，至少要有一个进程在运行。

## Websockets

WebSocket 服务器用于与前端通信，它可以与 Web 服务器部署在同一台机器上，也可以独立部署。

## Worker

至少需要一个 worker 进程来处理[队列](../server/queues)。

## Collaboration

Collaboration 服务器负责协调所有文档的实时编辑与更新，它可以与 Web 服务器部署在同一台机器上，也可以独立部署。

```bash
yarn start --services=collaboration
```

如果 collaboration service 托管在独立的域名下，那么必须把 `COLLABORATION_URL` 环境变量设置为可公开访问的 URL。例如，如果应用托管在 `https://docs.example.com`，可以使用类似这样的配置：
`COLLABORATION_URL=wss://docs-collaboration.example.com`。
