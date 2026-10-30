# 架构

Outline 由这个 monorepo 中的后端和前端代码组成。由于两者都用 TypeScript 编写，因此在可能的情况下会共享部分代码。我们使用最新的 ES6 语言特性，包括 `async`/`await` 和类型系统。CI 会强制执行 oxfmt 格式化和 Oxlint 检查。

## 前端

Outline 的前端是一个用 [Vite](https://vitejs.dev/) 编译的 React 应用。它使用 [MobX](https://mobx.js.org/) 做状态管理，使用 [Styled Components](https://www.styled-components.com/) 做组件样式。除非是全局逻辑，否则状态逻辑和样式总是与 React 组件及其子组件放在一起，这样能让组件树更易于管理。

```
app
├── actions     - 可复用的动作，例如导航、打开、创建实体
├── components  - 可跨场景复用的 React 组件
├── editor      - 专属于编辑器的 React 组件
├── hooks       - 可复用的 React hooks
├── menus       - 上下文菜单，通常会在 UI 的多个位置出现
├── models      - 基于 MobX observable 的状态模型
├── routes      - 路由定义，注意各 chunk 通过 suspense 异步加载
├── scenes      - 一个 scene 表示一个包含多个组件的完整页面视图
├── stores      - 模型集合及与之关联的 fetch 逻辑
├── types       - TypeScript 类型
└── utils       - 前端专属的工具方法
```

## 后端

API 服务器由 [Koa](http://koajs.com/) 驱动，使用 [Sequelize](http://docs.sequelizejs.com/) 作为 ORM，并使用 Redis 与 [Bull](https://github.com/OptimalBits/bull) 做队列和异步事件管理。授权逻辑集中在 "policies" 目录下基于 [cancan](https://www.npmjs.com/package/cancan) 的策略中。

想看更多关于 API 路由的文档？请查阅 [API 文档](https://getoutline.com/developers)。

```
server
├── routes            - 所有 API 路由都在这里
│   ├── api           - API 路由
│   └── auth          - 认证路由
├── commands          - 跨多个模型执行动作的复杂命令
├── config            - 数据库配置
├── emails            - 事务性邮件模板
│   └── templates     - 定义每种邮件模板的类
├── middlewares       - 共享的 Koa 中间件
├── migrations        - 数据库迁移
├── models            - Sequelize 模型
├── onboarding        - 新用户引导文档的 Markdown 模板
├── policies          - 基于 cancan 的授权逻辑
├── presenters        - 数据库模型的 JSON 呈现层，是后端 → 前端的接口
├── queues            - 异步队列定义
│   └── processors    - processor 处理来自事件总线的事件任务
│   └── tasks         - task 是不来自事件总线的任意异步任务
├── services          - service 启动应用的不同部分，例如 api、worker
├── static            - 静态资源
├── test              - 测试辅助工具和 fixture，测试本身与被测代码放在一起
└── utils             - 后端专属的工具方法
```

## 共享代码

凡是客户端与服务端之间共享的逻辑都放在这个目录，通常是一些小型工具函数。

```
shared
├── components        - 前端和后端都会用到的共享 React 组件
├── editor            - 基于 Prosemirror 的文本编辑器
├── i18n              - 国际化配置
│   └── locales       - 各语言的翻译文件
├── styles            - 样式、颜色及其他全局视觉
└── utils             - 共享的工具方法
```
