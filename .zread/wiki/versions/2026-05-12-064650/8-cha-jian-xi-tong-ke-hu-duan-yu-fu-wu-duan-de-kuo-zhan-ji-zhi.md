Outline 的插件系统不是“给设置页加几个入口”的浅层扩展，而是一套能同时插入前端 UI、后端路由、认证提供商、搜索实现、异步任务和内容展开器的机制。理解这套系统时，最容易犯的错误是把 `plugins/` 当成一个装第三方集成的文件夹。实际上，它更像一层**受主程序控制的可插拔能力总线**。

Sources: [app/utils/PluginManager.ts](app/utils/PluginManager.ts), [server/utils/PluginManager.ts](server/utils/PluginManager.ts), [plugins](plugins)

## 先看目录：插件不是一个统一模板，而是按能力裁剪

从仓库结构看，`plugins/` 下目前有 22 个顶层目录，但并不是每个目录都长得完全一样。最常见的形态是：

```text
plugins/<name>/
├── plugin.json
├── client/
├── server/
└── shared/
```

但真实情况更灵活：

- 有些插件只有 `client/`，例如分析或设置类扩展
- 有些插件只有 `server/`，例如搜索或存储提供者
- 有些插件既有 `client/` 又有 `server/`
- 也有少数目录更像基础设施扩展，比如 `iframely/`、`storage/`，它们直接注册后端钩子，不一定提供完整的元数据外壳

所以不要把 `plugin.json` 理解成“插件存在的唯一标志”。更准确地说，它是**用户可见、需要元数据描述的插件**常用的一层包装；而基础设施型扩展有时会直接走代码注册路径。

Sources: [plugins/google/plugin.json](plugins/google/plugin.json), [plugins/storage/server/index.ts](plugins/storage/server/index.ts), [plugins/iframely/server/index.ts](plugins/iframely/server/index.ts)

## 为什么要把插件系统分成前端和后端两套管理器

Outline 在客户端和服务端分别实现了各自的 `PluginManager`。这不是重复造轮子，而是因为两边处理的“插件价值”根本不同。

### 前端插件管理器关心的是 UI 可组合性

前端的 [app/utils/PluginManager.ts](app/utils/PluginManager.ts) 只定义了三类 Hook：

| Hook | 用途 |
|---|---|
| `Settings` | 给设置页注册一个入口和懒加载组件 |
| `Imports` | 给导入页面增加一种导入方式 |
| `Icon` | 给集成或认证提供一个可复用图标 |

它关心的是：

- 在什么部署形态下显示
- 在 UI 上排第几个
- 组件何时按需加载

### 后端插件管理器关心的是系统能力扩展

服务端的 [server/utils/PluginManager.ts](server/utils/PluginManager.ts) 定义的 Hook 则重很多：

| Hook | 作用 |
|---|---|
| `API` | 给 `/api` 挂额外路由 |
| `AuthProvider` | 注入新的认证提供商 |
| `EmailTemplate` | 增加邮件模板 |
| `IssueProvider` | 问题跟踪器集成 |
| `Processor` | 追加事件处理器 |
| `SearchProvider` | 更换搜索实现 |
| `Task` | 增加异步任务 |
| `UnfurlProvider` | 自定义链接展开逻辑 |
| `Uninstall` | 插件卸载清理 |
| `GroupSyncProvider` | 认证提供商对应的组同步实现 |

WHY 要分成两套？因为浏览器侧的扩展更像“可组合界面部件”，后端侧的扩展更像“系统能力插槽”。如果强行统一成一套模型，类型会很快失真，加载方式也会彼此牵制。

Sources: [app/utils/PluginManager.ts](app/utils/PluginManager.ts), [server/utils/PluginManager.ts](server/utils/PluginManager.ts)

## 前端插件是怎么被发现和加载的

前端入口 [app/index.tsx](app/index.tsx) 很早就调用了：

```ts
void PluginManager.loadPlugins();
```

而 `loadPlugins()` 内部并没有硬编码插件名单，而是用：

```ts
import.meta.glob("../../plugins/*/client/index.{ts,js,tsx,jsx}")
```

去扫描所有客户端插件入口，再统一执行。这个实现很聪明，原因有三点：

1. **新增插件时不用改中心注册表**  
   只要目录和入口文件符合约定，就能被自动发现。

2. **仍然保留 Vite 的静态分析能力**  
   它不是运行时去读文件系统，而是让构建器提前知道这些模块可能被加载。

3. **便于按插件目录组织代码**  
   UI、图标、设置表单和局部逻辑可以跟插件名天然聚在一起。

插件真正注册时，常见写法就是在 `client/index.tsx` 里调用 `PluginManager.add()`。例如：

- `plugins/google/client/index.tsx` 注册一个 `Icon`
- `plugins/diagrams/client/index.tsx` 注册一个 `Settings` 面板，并通过 `createLazyComponent()` 延迟加载设置页

Sources: [app/index.tsx](app/index.tsx), [app/utils/PluginManager.ts](app/utils/PluginManager.ts), [plugins/google/client/index.tsx](plugins/google/client/index.tsx), [plugins/diagrams/client/index.tsx](plugins/diagrams/client/index.tsx)

## 前端插件不是“都显示”，而是按部署与上下文过滤

前端 `PluginManager.register()` 在真正收下插件前，会先检查 `deployments` 条件：

- `cloud`
- `community`
- `enterprise`

这说明插件系统不仅是技术扩展点，还是**产品形态差异化**的承载层。同一份代码库可以通过部署形态控制哪些设置项、导入器或图标应该暴露给用户，而不必在组件里到处写条件分支。

另外，像 `diagrams` 这样的设置型插件，还能继续在 `enabled(team, user)` 里按团队或用户角色二次控制。这让“插件存在”与“当前用户是否看得见”成为两层独立判断。

Sources: [app/utils/PluginManager.ts](app/utils/PluginManager.ts), [plugins/diagrams/client/index.tsx](plugins/diagrams/client/index.tsx)

## 服务端插件是怎么进入系统的

服务端走的是另一条路。`server/index.ts` 启动早期会先调用 `PluginManager.loadPlugins()`。这个方法会扫描：

```text
build/plugins/*/server/!(*.test|schema).[jt]s
```

然后 `require()` 这些编译后的后端入口文件。注意两个关键词：

- **扫描的是 `build/plugins`，不是源码目录**
- **加载的是插件自己的 `server/index.ts` 或同层入口**

这说明服务端插件不是直接拿 TypeScript 源码运行，而是先被 `build.js` 编译，再在启动时挂进来。这样做的 WHY 很明确：

1. 生产运行时只依赖构建产物，部署模型更简单
2. 插件和主程序共享同一套 Babel 编译路径
3. 后端可以在启动时统一决定“这次实例启用了哪些插件能力”

Sources: [server/index.ts](server/index.ts), [server/utils/PluginManager.ts](server/utils/PluginManager.ts), [build.js](build.js)

## 插件钩子最后是怎么落到真实业务里的

`PluginManager` 本身只是注册表，真正有意思的是“谁消费这些 Hook”。下面这张表能帮你把抽象概念落到代码位置上：

| Hook | 消费位置 | 结果 |
|---|---|---|
| `API` | `server/routes/api/index.ts` | 插件路由在内建路由前挂入 `/api` |
| `AuthProvider` | `server/routes/auth/index.ts` | 动态注册登录提供商路由 |
| `Task` | `server/queues/tasks/index.ts` | 进入任务注册表，供 Worker 调度 |
| `Processor` | `server/queues/processors/index.ts` | 进入事件处理器注册表 |
| `EmailTemplate` | `server/emails/templates/index.ts` | 合并进邮件模板集合 |
| `SearchProvider` | `server/utils/SearchProviderManager.ts` | 按 `SEARCH_PROVIDER` 选择实际搜索实现 |

这也解释了 WHY 插件系统能影响这么多子系统：它不是某个“插件中心页面”的局部机制，而是把扩展能力嵌进了多个关键装配点。

Sources: [server/routes/api/index.ts](server/routes/api/index.ts), [server/routes/auth/index.ts](server/routes/auth/index.ts), [server/queues/tasks/index.ts](server/queues/tasks/index.ts), [server/queues/processors/index.ts](server/queues/processors/index.ts), [server/emails/templates/index.ts](server/emails/templates/index.ts), [server/utils/SearchProviderManager.ts](server/utils/SearchProviderManager.ts)

## 用几个真实例子把它看透

### 例子 1：Google 认证插件

`plugins/google/plugin.json` 提供基础元数据，客户端入口注册图标，服务端入口则在环境变量齐全时注册 `AuthProvider`。这说明一个完整插件可以前后端配合：

- 前端负责“长什么样”
- 后端负责“怎么接进认证流”

而且服务端不是无脑注册，而是先检查 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`。WHY 也很现实：没有配置就不暴露入口，避免用户点进去才发现半残。

Sources: [plugins/google/plugin.json](plugins/google/plugin.json), [plugins/google/client/index.tsx](plugins/google/client/index.tsx), [plugins/google/server/index.ts](plugins/google/server/index.ts)

### 例子 2：PostgreSQL 搜索提供者

`plugins/search-postgres/server/index.ts` 只做一件事：注册一个 `SearchProvider`。后续到底由谁来用，不在插件里决定，而在 `SearchProviderManager` 里通过 `SEARCH_PROVIDER` 统一选择。

这是一种很干净的策略模式：

- 插件只负责声明“我能提供什么”
- 主程序决定“当前用哪一个”

如果以后要接 Elasticsearch、Meilisearch 或别的搜索实现，这个扩展点就天然可复用。

Sources: [plugins/search-postgres/server/index.ts](plugins/search-postgres/server/index.ts), [server/utils/SearchProviderManager.ts](server/utils/SearchProviderManager.ts)

### 例子 3：Diagrams 设置插件

`plugins/diagrams/client/index.tsx` 注册的是 `Settings` Hook，指向一个懒加载设置组件，只对管理员开放。这种插件不改后端协议，却能自然长进系统设置页。

这类扩展证明了插件系统并不只服务“第三方登录”这种重功能。哪怕只是往现有产品里增加一块可配置面板，也值得通过统一扩展点来做，而不是把代码硬塞回核心设置页。

Sources: [plugins/diagrams/client/index.tsx](plugins/diagrams/client/index.tsx)

### 例子 4：本地存储和 Iframely 这种基础设施型插件

`plugins/storage/server/index.ts` 会在本地文件存储启用时注册一个 API Hook；`plugins/iframely/server/index.ts` 会在满足配置条件时注册一个低优先级 `UnfurlProvider`。这两类目录都说明了一点：

**插件系统并不要求每个扩展都拥有用户可见的品牌元数据。**

有些扩展更像后端能力提供者，重点不是“向用户展示一个插件卡片”，而是“在正确的装配点替系统补一块能力”。

Sources: [plugins/storage/server/index.ts](plugins/storage/server/index.ts), [plugins/iframely/server/index.ts](plugins/iframely/server/index.ts)

## 优先级机制解决的是“谁先执行、谁先显示”

服务端 `PluginManager` 定义了从 `VeryHigh` 到 `VeryLow` 的优先级常量。客户端也支持 `priority`。这不是装饰属性，而是在解决插件之间的顺序问题：

- 路由谁先拦截
- 搜索或链接展开谁先尝试
- 设置项谁先显示

例如 `iframely` 明确把自己放到 `VeryLow`，意思就是“让其他更专用的 unfurl 提供者先试，我做最后兜底”。这个细节很像经验丰富的工程师会做的事情：不是只关心“功能能不能工作”，还关心“多个功能并存时，顺序是不是合理”。

Sources: [server/utils/PluginManager.ts](server/utils/PluginManager.ts), [plugins/iframely/server/index.ts](plugins/iframely/server/index.ts), [app/utils/PluginManager.ts](app/utils/PluginManager.ts)

## 构建流程如何保证插件随主程序一起交付

`build.js` 会遍历 `plugins/` 目录，对每个插件做两类事情：

1. 如果存在 `server/`，编译到 `build/plugins/<name>/server`
2. 如果存在 `shared/`，编译到 `build/plugins/<name>/shared`
3. 尝试复制 `plugin.json` 到构建产物

这意味着插件不是“部署后再装”的附属物，而是**主构建的一部分**。它们和核心代码一起进入最终镜像或运行目录，只是在运行时按 Hook 决定自己接到哪条链路上。

WHY 这样更适合 Outline？因为它的大部分插件都不是完全第三方隔离的外部包，而是和核心产品深度耦合的官方扩展。既然如此，把它们纳入主构建比再维护一套独立发布体系更划算。

Sources: [build.js](build.js)

## 如果你要新增一个插件，应该先想清楚什么

在开始建目录之前，建议先回答下面几个问题：

1. **它影响的是 UI、服务端能力，还是两边都影响？**  
   这决定你要不要同时建 `client/` 和 `server/`。

2. **它属于“用户可见插件”还是“基础设施扩展”？**  
   前者通常应该有 `plugin.json`，后者未必需要。

3. **它应该挂在哪个 Hook 上？**  
   先找消费方，再决定注册点，避免为了“能插进去”而选错抽象层。

4. **它是否受环境变量控制？**  
   绝大多数后端插件都应该像 Google、Storage、Iframely 一样，在条件不满足时直接不注册。

5. **它和现有插件之间有没有顺序关系？**  
   如果有，就明确设置 `priority`，不要靠目录顺序赌运气。

这几个问题想清楚之后，插件实现会顺很多，因为 Outline 的扩展机制本身已经很完整，难点通常不是“技术上怎么接”，而是“应该接在哪一层”。

## 继续往下读什么最有帮助

- 想看插件接进后端请求链路：读 [API 路由设计：Schema 验证、中间件与错误处理](17-api-lu-you-she-ji-schema-yan-zheng-zhong-jian-jian-yu-cuo-wu-chu-li)
- 想看插件怎样参与认证：读 [认证集成：Google、OIDC、Azure、Slack 与 Passkeys](26-ren-zheng-ji-cheng-google-oidc-azure-slack-yu-passkeys)
- 想看插件怎样参与搜索与展开：读 [文件存储](24-wen-jian-cun-chu-s3-jian-rong-cun-chu-yu-fu-jian-guan-li) 和 [Redis 缓存策略与会话管理](25-redis-huan-cun-ce-lue-yu-hui-hua-guan-li)
- 想看插件与整体架构的关系：回看 [整体架构：前后端 Monorepo 与共享模块设计](6-zheng-ti-jia-gou-qian-hou-duan-monorepo-yu-gong-xiang-mo-kuai-she-ji)
