# 架构

Outline 在这个 monorepo 中由后端和前端代码库组成。由于两者都使用 TypeScript 编写，因此会尽可能共享部分代码。我们使用最新的 ES6 语言特性，包括 `async`/`await` 和类型。CI 会强制执行 Prettier 格式化和 Oxlint 检查。

## 前端

Outline 的前端是一个使用 [Vite](https://vitejs.dev/) 编译的 React 应用。它使用 [MobX](https://mobx.js.org/) 进行状态管理，并使用 [Styled Components](https://www.styled-components.com/) 编写组件样式。除全局状态和样式外，状态逻辑和样式始终与 React 组件及其子组件放在一起，以便更轻松地管理组件树。

```
app
├── actions     - 可复用的操作，例如导航、打开、创建实体
├── components  - 可在多个场景中复用的 React 组件
├── editor      - 编辑器专用的 React 组件
├── hooks       - 可复用的 React hooks
├── menus       - 上下文菜单，通常会出现在 UI 的多个位置
├── models      - 使用 MobX observables 的状态模型
├── routes      - 路由定义，请注意代码块会通过 suspense 异步加载
├── scenes      - 场景表示包含多个组件的整页视图
├── stores      - 模型集合及其相关的数据获取逻辑
├── types       - TypeScript 类型
└── utils       - 前端专用的工具方法
```

## 后端

API 服务器由 [Koa](http://koajs.com/) 驱动，使用 [Sequelize](http://docs.sequelizejs.com/) 作为 ORM，并结合 Redis 与 [Bull](https://github.com/OptimalBits/bull) 处理队列和异步事件管理。授权逻辑包含在 "policies" 目录下的 [cancan](https://www.npmjs.com/package/cancan) policies 中。

想了解更多 API 路由文档？请查看 [API 文档](https://getoutline.com/developers)。

```
server
├── routes            - 所有 API 路由都包含在这里
│   ├── api           - API 路由
│   └── auth          - 认证路由
├── commands          - 跨多个模型执行操作的复杂命令
├── config            - 数据库配置
├── emails            - 事务性邮件模板
│   └── templates     - 定义每一种可能邮件模板的类
├── middlewares       - 共享的 Koa middlewares
├── migrations        - 数据库迁移
├── models            - Sequelize 模型
├── onboarding        - 入门文档的 Markdown 模板
├── policies          - 基于 cancan 的授权逻辑
├── presenters        - 数据库模型的 JSON presenters，是后端到前端之间的接口
├── queues            - 异步队列定义
│   └── processors    - Processors 会根据事件总线中的事件执行任务
│   └── tasks         - Tasks 是不来自事件总线的任意异步任务
├── services          - Services 会启动应用的不同部分，例如 api、worker
├── static            - 静态资源
├── test              - 测试辅助工具和 fixtures，测试本身与代码放在一起
└── utils             - 后端专用的工具方法
```

## 共享

客户端和服务器之间共享的逻辑会放在这个目录中。这里通常是一些小型工具方法。

```
shared
├── components        - 前端和后端都会使用的共享 React 组件
├── editor            - 基于 Prosemirror 的文本编辑器
├── i18n              - 国际化配置
│   └── locales       - 特定语言的翻译文件
├── styles            - 样式、颜色和其他全局视觉配置
└── utils             - 共享工具方法
```
