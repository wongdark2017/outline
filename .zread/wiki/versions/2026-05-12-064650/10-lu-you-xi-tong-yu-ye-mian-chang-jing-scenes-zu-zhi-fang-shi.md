Outline 的前端路由系统不是一张平铺的 URL 表，而是一套把**登录态、分享态、权限、懒加载、页面布局和实时连接**一起组织起来的结构。`app/routes/` 只定义入口骨架，真正的页面职责则落在 `app/scenes/`。所以理解这一页时，关键不是“有哪些路径”，而是“为什么路由层只做分流，而页面场景（scene）才承载真正的页面组合逻辑”。

Sources: [app/routes/index.tsx](app/routes/index.tsx), [app/routes/authenticated.tsx](app/routes/authenticated.tsx), [app/routes/settings.tsx](app/routes/settings.tsx), [app/scenes](app/scenes)

## 先建立一个整体视角

可以先把前端导航分成四层：

| 层次 | 主要文件 | 负责什么 |
|---|---|---|
| 根路由层 | `app/routes/index.tsx` | 区分公开访问、分享访问、登录后访问 |
| 认证路由层 | `app/routes/authenticated.tsx` | 在登录后布局中挂载主业务页面 |
| 设置子路由层 | `app/routes/settings.tsx` | 把设置页按配置表展开 |
| 页面场景层 | `app/scenes/*` | 组装页面 UI、数据加载、局部子路由和交互行为 |

这四层从外到内，责任越来越具体。Outline 这样拆，是为了让顶层路由保持可读，而把复杂性留给真正需要它的页面。

## 根路由：先回答“你是谁、你从哪来”

`app/routes/index.tsx` 是整个 SPA 的总入口。它做的第一件事不是渲染首页，而是先决定当前访问属于哪种上下文。

### 根路由上的两个全局副作用

组件一进来就调用了：

- `useQueryNotices()`
- `useAutoRefresh()`

这说明根路由不仅是 URL 分流器，也是全局启动点。像 query 参数通知和会话自动刷新这类横切逻辑，放在这里最合适，因为无论用户在哪个页面都应该生效。

### `Suspense` 是第一层体验兜底

整套路由被一个顶层 `Suspense` 包住，fallback 是带 2 秒延迟的全屏 loading。WHY 加这个延迟？因为很多懒加载其实很快，立刻闪出 loading 反而更抖。延迟挂载能过滤掉短暂抖动，只在真正慢的时候再显示占位。

### 两种根模式：普通应用模式 vs Root Share 模式

最有意思的分支是：

- 如果 `env.ROOT_SHARE_ID` 存在，根路径直接进入分享场景
- 否则走正常的登录/分享/认证后路由体系

这说明 Outline 支持把一个分享链接提升成“根工作区”，而不必始终先经过登录页或普通应用壳。它不是简单加了几个 `/s/:shareId` 页面，而是允许整个应用入口切换到分享上下文。

Sources: [app/routes/index.tsx](app/routes/index.tsx)

## 公开路由和分享路由为什么单独放在根层

根路由里可以看到几类公开页面：

- `/`、`/create` -> `Login`
- `/logout` -> `Logout`
- `/desktop-redirect` -> 桌面端跳转页
- `/oauth/authorize` -> OAuth 授权页
- `/s/:shareId` 和 `/s/:shareId/doc/:documentSlug` -> 分享页

这里最值得注意的是分享页没有被包在 `Authenticated` 里。WHY？因为分享本身就是一条独立访问路径，它既可能匿名查看，也可能在登录后承接更多权限。把它放在根层，能避免“为了看公开分享还得先进登录态路由框架”。

此外，路由里还做了几组 canonical redirect：

- `/share/:shareId` -> `/s/:shareId`
- `/share/:shareId/doc/...` -> `/s/:shareId/doc/...`

这些看起来只是别名整理，但实际上是在持续收口 URL 规范，避免历史路径继续扩散。

Sources: [app/routes/index.tsx](app/routes/index.tsx)

## `Authenticated` 组件：不是路由，而是登录态守门员

登录后的所有主业务页面都被包在 `app/components/Authenticated.tsx` 里。它做的事很集中：

1. 读取 `auth.authenticated`
2. 如果已登录，直接放行子路由
3. 如果正在拉认证态，显示 loading
4. 如果未登录，则触发 `auth.logout()` 清理状态，再跳回首页或指定 logout 跳转地址

它还会在最早时机根据当前用户语言调用 `changeLanguage()`。WHY 这也放在这里？因为这是“最早能确定当前用户是谁”的位置，在路由刚放行时就切语言，能尽量减少错误语言闪屏。

所以 `Authenticated` 更像一扇门，而不是一页内容。

Sources: [app/components/Authenticated.tsx](app/components/Authenticated.tsx)

## 认证后路由：真正的应用主干

`app/routes/authenticated.tsx` 是登录后世界的总分发器。它本身也很克制，主要负责三件事：

1. 用 `WebsocketProvider` 建立实时连接
2. 用 `AuthenticatedLayout` 套上统一页面框架
3. 在内部用 `Switch` 把核心业务路径分发到 scenes

你可以把它理解成“已登录用户的操作系统桌面”，而不是某个具体页面。

### 为什么 WebSocket 放在这里，而不是更外层

因为只有认证后的业务页面真正需要完整的实时广播能力。把 `WebsocketProvider` 放在登录后总路由层，意味着：

- 登录页、公开分享页不会白白建立用户事件连接
- 已登录页面之间切换时，可以共享同一条实时连接

这让连接生命周期和会话生命周期更贴合。

### 为什么布局也放在这一层

`AuthenticatedLayout` 负责：

- 常规侧边栏与设置侧边栏切换
- 键盘快捷键注册，例如 `/` 搜索、`n` 新建文档
- `CommandBar`、通知徽标、右侧边栏上下文等全局 UI 外壳

这样做的 WHY 是：页面场景只管自己的页面内容，不必每个 scene 都重新拼一遍导航壳、快捷键和全局栏位。

Sources: [app/routes/authenticated.tsx](app/routes/authenticated.tsx), [app/components/AuthenticatedLayout.tsx](app/components/AuthenticatedLayout.tsx), [app/components/WebsocketProvider.tsx](app/components/WebsocketProvider.tsx)

## 认证后主路由的几个设计重点

### 1. 路由权限是前置裁剪的

像 `Drafts`、`Archive`、`Trash` 这些页面，并不是所有用户都能看到。路由层会先用：

```ts
const team = useCurrentTeam();
const can = usePolicy(team);
```

再按 `can.createDocument` 等能力决定是否挂载对应 route。WHY 这么做？因为没权限的页面最好连路径都不要注册，这比进页面后再弹“无权限”更干净。

### 2. 历史 URL 和别名 URL 会被主动收口

认证路由层做了不少 redirect：

- `/dashboard` -> `/home`
- `/starred` -> `/home`
- `/templates` -> `/settings/templates`
- `/collections/*` -> `/collection/*`
- `/d/:documentSlug` -> `/doc/:documentSlug`

这说明路由层还承担“历史兼容层”的职责。这样旧链接还能工作，但新代码只需要围绕标准路径继续演进。

### 3. 开发者路由只在开发环境开放

`/debug` 与 `/debug/changesets` 只有 `env.isDevelopment` 时才注册。WHY 直接在路由层裁掉？因为这类页面本来就是本地诊断工具，不应把它们当成普通应用路径的一部分。

Sources: [app/routes/authenticated.tsx](app/routes/authenticated.tsx)

## `scenes/` 为什么叫场景，而不叫 pages

`app/scenes/` 下面不只是普通页面组件，它更接近“一个完整页面场景的组合入口”。所谓场景，通常意味着：

- 有自己的标题、工具栏和 actions
- 有自己的数据加载和错误处理
- 常常还有自己的子路由或视图切换
- 由多个通用组件和局部组件拼出来

这也是为什么 `scenes` 目录里不仅有 `Home.tsx`、`Archive.tsx`，还会有：

- `Collection/index.tsx`
- `Document/index.tsx`
- `Shared/index.tsx`
- `Settings/*.tsx`

它们不是薄薄一层路由壳，而是页面编排中心。

## `Home` 场景：scene 可以继续拥有子路由

`Home.tsx` 就是个很典型的例子。顶层路由只把 `/home/:tab?` 交给它，真正的 tab 细分则在 scene 内部再用一个 `Switch` 做：

- `/home`
- `/home/popular`
- `/home/recent`
- `/home/created`

WHY 不把这些全都提到顶层？因为它们共享同一套页面框架、标题、搜索框、置顶文档和 tabs。把子视图留在 scene 内部，会让顶层路由更干净，也更符合页面的真实结构。

Sources: [app/scenes/Home.tsx](app/scenes/Home.tsx)

## `Collection` 场景：scene 不只是渲染页，还负责 URL 自愈

`Collection/index.tsx` 很能体现 scene 的职责上限。它会：

- 从 URL 中取出 `collectionSlug`
- 调用 `collections.fetch(id)` 拉数据
- 设置当前活跃 collection 到 `UiStore`
- 根据最新 collection 数据把旧 URL 替换成 canonical URL
- 管理自己的 tab 跳转和 overview/edit 模式
- 按集合是否为空、是否归档、是否可编辑来切换子视图

最有代表性的一点是 `updateCollectionPath()` 这类 canonical redirect 逻辑：scene 自己知道何时应该把旧 slug 替换成新 slug。WHY 不放在根路由？因为只有这个 scene 自己最懂“这个实体的标准 URL 现在应该长什么样”。

Sources: [app/scenes/Collection/index.tsx](app/scenes/Collection/index.tsx), [app/utils/routeHelpers.ts](app/utils/routeHelpers.ts)

## `Document` 场景：路由和页面状态深度耦合的样板

文档页的复杂度更高，因此它把一部分逻辑下沉到了 `DataLoader` 这样的组件里。这里你能看到几条很典型的路线：

- `/doc/:slug`
- `/doc/:slug/edit`
- `/doc/:slug/history/:revisionId?`

而页面内部会再根据当前匹配路径判断：

- 这是只读还是编辑
- 需要不要抓 revision
- 没权限编辑时是否要跳回 canonical 只读页
- 是否要拉评论、分享、阅读记录
- slug 改了时是否要 `Redirect` 到新 URL

这说明在 Outline 里，路由不是附着在页面上的小装饰，而是文档场景状态机的一部分。

Sources: [app/routes/authenticated.tsx](app/routes/authenticated.tsx), [app/scenes/Document/components/DataLoader.tsx](app/scenes/Document/components/DataLoader.tsx)

## 设置页路由：配置驱动，而不是手写巨型 Switch

`app/routes/settings.tsx` 本身很短，因为它大部分内容来自 `useSettingsConfig()`。

这个 hook 会把每一项设置页声明成一个 `ConfigItem`，里面包含：

- `name`
- `path`
- `icon`
- `component`
- `preload`
- `enabled`
- `group`

然后根据：

- 当前用户
- 当前团队
- `usePolicy(team)` 的能力
- 客户端插件 `Hook.Settings`

动态拼出一份最终配置表。

WHY 这是个好设计？因为设置页天生是一个“产品功能总汇”。如果把每一页都写死在路由表里，权限、分组、插件插入点和展示顺序都会很快变乱。配置驱动后：

- 核心设置项可以按组统一管理
- 插件可以把自己的设置页自然插进去
- 权限控制在配置阶段就完成了

Sources: [app/routes/settings.tsx](app/routes/settings.tsx), [app/hooks/useSettingsConfig.ts](app/hooks/useSettingsConfig.ts), [app/utils/PluginManager.ts](app/utils/PluginManager.ts)

## 路径辅助函数是隐藏的稳定器

`app/utils/routeHelpers.ts` 是这套路由系统里很容易被低估的文件。它统一维护了：

- 常用路径生成函数，如 `homePath()`、`settingsPath()`、`documentPath()`
- canonical URL 更新函数，如 `updateDocumentPath()`、`updateCollectionPath()`
- 路由匹配片段，如 `matchDocumentSlug`、`matchCollectionSlug`

WHY 这一层非常重要？因为 Outline 的 URL 不是随便拼字符串就行，它们经常带：

- slug + urlId 的混合标识
- 可选 revision
- share 路径与普通路径的双形态

集中管理路径规则，能避免不同页面用不同正则和字符串模板，最终把导航体系写散。

Sources: [app/utils/routeHelpers.ts](app/utils/routeHelpers.ts)

## `ProfiledRoute` 和懒加载说明这套路由很在乎可观测性

路由组件并没有直接用 `react-router-dom` 的 `Route`，而是统一走 `ProfiledRoute`。当 Sentry 启用时，它会自动用 `withSentryRouting(Route)` 包装。这说明路由层从一开始就在为性能与错误定位留观测点。

另一边，根路由、认证路由和设置页都大量使用：

- `lazyWithRetry`
- `createLazyComponent`

前者给动态 import 加自动重试，后者额外提供 `preload()` 能力。WHY？因为 Outline 的页面体量已经不适合一次性把所有 scene 打进主包，但如果懒加载失败又没有重试和预加载能力，用户体验会非常脆弱。

Sources: [app/components/ProfiledRoute.ts](app/components/ProfiledRoute.ts), [app/utils/lazyWithRetry.ts](app/utils/lazyWithRetry.ts), [app/components/LazyLoad.ts](app/components/LazyLoad.ts)

## 分享场景是一套独立的“半应用”

`app/scenes/Shared/index.tsx` 值得单独提一句，因为它证明分享不是普通文档页套个参数那么简单。这个 scene 会：

- 根据 `shareId` 调 `client.setShareId()`，让后续 API 自动带 share 上下文
- 在匿名访问时按检测语言切换 i18n
- 用单独的布局、侧边栏和 command bar
- 在 `AuthorizationError` 时把用户引导到登录流程

可以把它看成一套裁剪过的、以分享上下文为中心的小应用，而不是主应用里的一个普通页面。

Sources: [app/scenes/Shared/index.tsx](app/scenes/Shared/index.tsx), [app/utils/ApiClient.ts](app/utils/ApiClient.ts)

## 为什么这套路由 + scenes 组织方式对 Outline 特别合适

Outline 之所以不走“所有页面都是轻薄 page 组件”的路径，是因为它的页面往往同时具备这几类复杂度：

1. **有实体级数据加载和 URL 自愈**
2. **有权限驱动的界面分叉**
3. **有局部子路由或 tab**
4. **有实时连接、副边栏、历史版本、评论等横切状态**

把这些都塞回顶层路由，会让路由文件失控；把它们都散进通用组件，又会让页面编排失去中心。`scene` 恰好就是这个中间层。

## 继续往下读什么最自然

- 想看 scene 背后的状态组织：读 [状态管理：MobX Model、Store 与 RootStore 架构](9-zhuang-tai-guan-li-mobx-model-store-yu-rootstore-jia-gou)
- 想看页面数据是怎么请求回来的：读 [API 客户端：请求封装、错误处理与 CSRF 防护](11-api-ke-hu-duan-qing-qiu-feng-zhuang-cuo-wu-chu-li-yu-csrf-fang-hu)
- 想看设置页如何被插件扩展：读 [插件系统：客户端与服务端的扩展机制](8-cha-jian-xi-tong-ke-hu-duan-yu-fu-wu-duan-de-kuo-zhan-ji-zhi)
