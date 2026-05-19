Outline 的前端是一个基于 **React 17** 的单页应用（SPA），采用 **MobX 4** 进行响应式状态管理，使用 **Styled Components 5** 实现 CSS-in-Js 样式方案，并通过 **Vite**（rolldown-vite）完成开发服务器与生产构建。整个前端代码位于 `app/` 目录下，与后端共享 `shared/` 模块。本文将从整体架构出发，逐一拆解这四大核心技术的集成方式与使用模式，帮助你在深入阅读后续章节之前建立清晰的技术心智模型。

Sources: [package.json](package.json#L212-L265), [app/index.tsx](app/index.tsx#L1-L93)

## 技术栈全景图

下面的架构图展示了前端四大核心技术在整个应用中的职责划分与数据流向。React 充当视图层，MobX 管理应用状态，Styled Components 负责视觉表现，Vite 则是贯穿开发与构建的工程化基础设施。

```mermaid
graph TB
    subgraph Vite["Vite 构建层"]
        VC[vite.config.ts] --> VD[开发服务器 :3001]
        VC --> VB[生产构建 → build/app]
        VC --> VP[VitePWA Service Worker]
    end

    subgraph React["React 视图层"]
        Entry["index.tsx 入口"] --> Providers["Provider 树"]
        Providers --> Routes["路由系统<br/>react-router-dom v5"]
        Routes --> Scenes["页面场景 Scenes"]
        Scenes --> Components["UI 组件"]
        Components --> Hooks["自定义 Hooks"]
    end

    subgraph MobX["MobX 状态层"]
        RS["RootStore"] --> AuthStore["auth"]
        RS --> UiStore["ui"]
        RS --> DocStore["documents"]
        RS --> ColStore["collections"]
        RS --> MoreStores["...30+ Stores"]
        DocStore --> DocModel["Document Model"]
        DocModel --> Decs["@observable<br/>@computed<br/>@action"]
    end

    subgraph Styled["Styled Components 样式层"]
        Theme["ThemeProvider"] --> Light["buildLightTheme()"]
        Theme --> Dark["buildDarkTheme()"]
        Theme --> Pitch["buildPitchBlackTheme()"]
        Globals["GlobalStyles"] --> SC["styled.div`...`"]
        SC --> Mixins["s() / hover / ellipsis"]
    end

    React -->|observer/inject| MobX
    React -->|styled()| Styled
    MobX -->|useStores() hook| React
    Vite -.->|HMR 热更新| React
```

Sources: [vite.config.ts](vite.config.ts#L1-L30), [app/index.tsx](app/index.tsx#L57-L90), [app/stores/RootStore.ts](app/stores/RootStore.ts#L40-L75)

## React：视图层的核心

### 版本与编译配置

Outline 使用 **React 17.0.2**，配合 `react-dom` 的传统 `render` API 挂载应用。TypeScript 配置中启用了 `jsx: "react-jsx"`（即 React 17 引入的自动 JSX 运行时），这意味着组件文件中无需手动 `import React from "react"`。Babel 侧同样配置了 `@babel/preset-react` 的 `runtime: "automatic"` 选项，确保测试环境（通过 Jest + Babel 转译）的行为一致。

Sources: [package.json](package.json#L212-L218), [tsconfig.json](tsconfig.json#L11), [.babelrc](.babelrc#L3-L8)

### 应用入口与 Provider 树

应用的入口文件 [app/index.tsx](app/index.tsx) 构建了一个多层级的 Provider 嵌套结构，每一层负责不同的横切关注点：

| Provider | 来源 | 职责 |
|---|---|---|
| `StrictMode` | React 内置 | 开发模式下的额外检查与警告 |
| `HelmetProvider` | react-helmet-async | 管理 `<head>` 中的页面标题和 meta 标签 |
| `Provider` | mobx-react | 将 MobX RootStore 注入组件树的 Context |
| `Router` | react-router-dom | 路由系统，基于自定义 `history` 对象 |
| `Theme` | 内置组件 | Styled Components 的 `ThemeProvider` 封装 |
| `ActionContextProvider` | 内置 Hook | 提供右键菜单等操作的上下文 |
| `KBarProvider` | kbar | 命令面板（Ctrl+K 快捷搜索） |

Sources: [app/index.tsx](app/index.tsx#L57-L90)

### 路由系统

路由使用 **react-router-dom v5**，采用 `<Switch>` + `<Route>` 的声明式路由模式。入口路由定义在 [app/routes/index.tsx](app/routes/index.tsx) 中，区分公开页面（登录、分享链接）和认证页面。认证后的路由在 [app/routes/authenticated.tsx](app/routes/authenticated.tsx) 中定义，使用了大量 `lazy()` 动态导入，实现路由级别的代码分割。路由实例基于 `createBrowserHistory()` 创建，并被同时传递给 React Router 和 MobX，使得 Store 层也能进行编程式导航。

Sources: [app/routes/index.tsx](app/routes/index.tsx#L1-L72), [app/routes/authenticated.tsx](app/routes/authenticated.tsx#L55-L80), [app/utils/history.ts](app/utils/history.ts#L1-L6)

### 组件组织模式

前端组件按职责分为以下几个层次：

- **Scenes（`app/scenes/`）**：页面级组件，每个对应一个路由，如 `Home.tsx`、`Search/`、`Document/`。
- **Components（`app/components/`）**：可复用的 UI 组件，包括基础组件（`Button.tsx`、`Input.tsx`）、布局组件（`Layout.tsx`、`Flex.tsx`）和复合组件（`Sidebar/`、`Menu/`）。
- **Hooks（`app/hooks/`）**：自定义 React Hooks，封装可复用的有状态逻辑，如 `useStores()`、`useCurrentUser()`、`useMediaQuery()` 等。
- **Models（`app/models/`）**：MobX 可观察数据模型（下文详述）。

Sources: [app/components/Scene.tsx](app/components/Scene.tsx#L26-L66), [app/hooks/useStores.ts](app/hooks/useStores.ts#L1-L13)

## MobX：响应式状态管理

### 版本与全局配置

Outline 使用 **MobX 4.15.7** 和 **mobx-react 6.3.1**。MobX 4 是一个较稳定的版本，支持装饰器语法。应用在入口处通过 `configureMobx()` 进行全局配置，启用了 `computedRequiresReaction` 和 `isolateGlobalState` 两个选项。

Sources: [package.json](package.json#L174-L176), [app/index.tsx](app/index.tsx#L42-L47)

### RootStore 架构

状态管理的核心是 **RootStore** 模式。`RootStore` 是一个单一的顶层 Store 容器，在应用启动时实例化，持有所有子 Store 的引用。每个子 Store（如 `DocumentsStore`、`AuthStore`）在构造时接收 `rootStore` 引用，从而可以跨 Store 访问数据。这种模式确保了 Store 之间的松耦合通信。

RootStore 在开发模式下会挂载到 `window.stores`，方便浏览器 DevTools 中直接调试。

Sources: [app/stores/index.ts](app/stores/index.ts#L1-L12), [app/stores/RootStore.ts](app/stores/RootStore.ts#L40-L116)

### Store 基类：数据管理的骨架

所有数据 Store 继承自 `Store<T>` 基类（位于 [app/stores/base/Store.ts](app/stores/base/Store.ts)），它提供了完整的 CRUD 操作模板：

| 能力 | 实现 |
|---|---|
| 数据存储 | `@observable data: Map<string, T>` — 使用 MobX observable Map |
| CRUD 操作 | `create()` / `update()` / `delete()` / `fetch()` — 自动调用 API 并更新 Store |
| 分页查询 | `fetchPage()` / `fetchAll()` — 支持分页参数和全量拉取 |
| 模糊搜索 | `findByQuery()` — 基于 command-score 的前端搜索 |
| 排序数据 | `@computed orderedData` — 按 `createdAt` 降序排列 |
| 请求去重 | `requests: Map<string, Promise>` — 避免重复的并发请求 |
| 生命周期钩子 | 通过 `LifecycleManager` 在增删改时触发回调 |

每个 Store 通过 `RPCAction` 枚举声明自己支持的操作类型（`Info`、`List`、`Create`、`Update`、`Delete`），不支持的操作会抛出异常。

Sources: [app/stores/base/Store.ts](app/stores/base/Store.ts#L49-L88)

### Model 基类：可观察的数据实体

每个 Store 管理一类 Model 实例。Model 基类（[app/models/base/Model.ts](app/models/base/Model.ts)）使用 MobX 装饰器定义可观察属性，并提供了以下核心能力：

```typescript
// 典型的 Model 装饰器用法（来自 Document model）
@observable
isSaving = false;

@observable.shallow
data: ProsemirrorData;

@computed
get searchContent(): string {
  return this.title;
}
```

- **`@observable`**：标记属性为可观察，任何读取该属性的组件都会自动响应变化。
- **`@computed`**：定义派生值，MobX 会自动缓存并在依赖变化时重新计算。
- **`@action`**：标记修改状态的方法，确保状态变更在事务中完成。

Sources: [app/models/base/Model.ts](app/models/base/Model.ts#L11-L36), [app/models/Document.ts](app/models/Document.ts#L54-L88)

### 装饰器体系：Field、Relation 与 Lifecycle

Model 层定义了三个关键的自定义装饰器：

| 装饰器 | 作用 | 示例 |
|---|---|---|
| `@Field` | 标记可序列化字段，用于 `toAPI()` 序列化 | `@Field title: string` |
| `@Relation` | 声明模型间关联关系，支持一对一和一对多 | `@Relation(() => User) createdBy` |
| `@Lifecycle` | 注册生命周期钩子（`BeforeCreate`、`AfterChange` 等） | `@AfterCreate onCreated() {}` |

`@Relation` 装饰器特别精巧——它通过 `Object.defineProperty` 在原型上定义 getter/setter，使得访问关联模型时自动从对应的 Store 中查找，无需手动管理关联 ID 的解析。

Sources: [app/models/decorators/Field.ts](app/models/decorators/Field.ts#L1-L20), [app/models/decorators/Relation.ts](app/models/decorators/Relation.ts#L84-L184), [app/models/decorators/Lifecycle.ts](app/models/decorators/Lifecycle.ts#L1-L79)

### 组件与 Store 的连接

组件通过两种方式访问 MobX Store：

1. **`useStores()` Hook**：封装了 `useContext(MobXProviderContext)`，返回完整的 RootStore 实例，是函数组件的推荐方式。
2. **`observer()` 高阶组件**：包裹组件使其能响应 MobX observable 的变化并自动重新渲染。例如 `Theme` 组件使用 `export default observer(Theme)` 确保主题切换时组件更新。

Sources: [app/hooks/useStores.ts](app/hooks/useStores.ts#L1-L13), [app/components/Theme.tsx](app/components/Theme.tsx#L16-L51)

## Styled Components：CSS-in-JS 样式方案

### 版本与插件配置

Outline 使用 **styled-components 5.3.11**，配合 **polished** 工具库进行颜色操作（`darken`、`lighten`、`transparentize`）。Babel 生产环境配置中启用了 `babel-plugin-styled-components`（关闭 `displayName` 以减小包体积）。

Sources: [package.json](package.json#L192-L194), [.babelrc](.babelrc#L29-L38)

### 主题系统

主题通过 Styled Components 的 `ThemeProvider` 向下传递。`Theme` 组件（[app/components/Theme.tsx](app/components/Theme.tsx)）是主题的统一入口，它使用 `useBuildTheme` Hook 根据用户偏好、设备类型（移动端使用纯黑主题）、打印模式等条件动态构建主题对象。

主题分为三种变体：

| 变体 | 构建函数 | 使用场景 |
|---|---|---|
| 浅色主题 | `buildLightTheme()` | 桌面端默认 |
| 深色主题 | `buildDarkTheme()` | 桌面端深色模式 |
| 纯黑主题 | `buildPitchBlackTheme()` | 移动端深色模式（OLED 友好） |

主题对象包含 100+ 设计 Token，涵盖颜色、字体、间距、阴影等。所有 Token 在 TypeScript 中通过 `DefaultTheme` 接口声明，确保类型安全。

Sources: [app/components/Theme.tsx](app/components/Theme.tsx#L16-L51), [shared/styles/theme.ts](shared/styles/theme.ts#L54-L111), [app/typings/styled-components.d.ts](app/typings/styled-components.d.ts#L125-L183)

### 样式编写模式

项目中的 Styled Components 使用模式可归纳为以下几种：

**1. 基础组件样式化**

最常见的方式是使用 `styled()` 包装 HTML 元素或自定义组件：

```typescript
const RealButton = styled(ActionButton)<RealProps>`
  background: ${s("accent")};
  color: ${s("accentText")};
  border-radius: 6px;
  
  &:hover:not(:disabled) {
    background: ${(props) => darken(0.05, props.theme.accent)};
  }
`;
```

**2. 主题值访问辅助函数 `s()`**

项目定义了一个便捷的样式辅助函数 `s()`，用于在模板字符串中访问主题值：

```typescript
export const s = (key: keyof DefaultTheme) => (props) => String(props.theme[key]);
// 使用: background: ${s("accent")}
```

**3. 全局样式**

通过 `createGlobalStyle` 定义全局 CSS 重置和基础样式，在 `Theme` 组件中注入。

**4. 响应式断点**

使用 `styled-components-breakpoint` 库配合预定义断点值（mobile: 0、tablet: 737、desktop: 1025、desktopLarge: 1600）。

Sources: [shared/styles/index.ts](shared/styles/index.ts#L31-L33), [app/components/Button.tsx](app/components/Button.tsx#L20-L121), [shared/styles/globals.ts](shared/styles/globals.ts#L1-L60), [shared/styles/breakpoints.ts](shared/styles/breakpoints.ts#L1-L12)

### Z-Index 深度管理

项目通过 `depths` 常量统一管理所有浮层组件的 z-index 层级，从目录（100）到提示框（50000），避免了 z-index 冲突：

```
toc: 100 → header: 800 → sidebar: 900 → overlay: 2000 → modal: 3000 → menu: 4000 → tooltip: 50000
```

Sources: [shared/styles/depths.ts](shared/styles/depths.ts#L1-L21)

## Vite：构建与开发服务器

### 版本与特殊说明

项目实际使用的是 **rolldown-vite@7.3.1**（在 package.json 中通过别名 `"vite": "npm:rolldown-vite@7.3.1"` 指定），这是基于 Rust 编写的 Rolldown 打包器的 Vite 兼容实现，旨在提供更快的构建性能。

Sources: [package.json](package.json#L265)

### 开发服务器配置

开发服务器运行在 **3001 端口**，支持 HTTPS（需要本地 SSL 证书），并允许访问项目根目录上一级的文件（用于开发中加载共享模块）。前端开发时使用 `yarn dev:watch` 命令，它会同时启动后端 nodemon 和前端 Vite 开发服务器。

Sources: [vite.config.ts](vite.config.ts#L28-L46), [package.json](package.json#L13-L15)

### 生产构建优化

生产构建输出到 `build/app/` 目录，采用了多项优化策略：

| 优化策略 | 实现方式 |
|---|---|
| 代码分割 | `advancedChunks` 配置，按依赖库拆分为独立 chunk |
| 禁止资源内联 | `assetsInlineLimit: 0` — 符合 CSP 安全策略 |
| OXC 压缩 | `minify: "oxc"` — 使用 Rust 实现的压缩器 |
| 浏览器兼容 | `target: browserslistToEsbuild()` — 根据 browserslist 配置确定目标 |
| PWA 支持 | `VitePWA` 插件生成 Service Worker，含 URL 预缓存和运行时缓存策略 |

Sources: [vite.config.ts](vite.config.ts#L163-L260)

### 依赖分组策略

Vite 配置中的 `advancedChunks.groups` 将第三方库分为 14 个独立的 vendor chunk，实现了细粒度的缓存控制：

| Chunk 名称 | 包含内容 | 优先级 |
|---|---|---|
| `vendor-react` | react、react-dom、scheduler、react-router | 20 |
| `vendor-prosemirror` | prosemirror 系列 | 20 |
| `vendor-collab` | yjs、hocuspocus、y-prosemirror | 20 |
| `vendor-styled` | styled-components | 20 |
| `vendor-framer-motion` | framer-motion | 20 |
| `vendor-mermaid` | mermaid 及其布局依赖 | 20 |
| `vendor-katex` | katex 数学公式渲染 | 20 |
| `vendor-shared` | uuid、vite preload-helper | 30（最高） |

Sources: [vite.config.ts](vite.config.ts#L187-L256)

### 路径别名

Vite 和 TypeScript 共享两套路径别名，确保开发时和编译时的模块解析一致：

| 别名 | 指向路径 | 用途 |
|---|---|---|
| `~` | `./app` | 前端应用代码 |
| `@shared` | `./shared` | 前后端共享模块 |

Sources: [vite.config.ts](vite.config.ts#L157-L162), [tsconfig.json](tsconfig.json#L27-L31)

## 关键辅助库一览

除了四大核心技术外，前端还依赖以下重要的辅助库：

| 库 | 版本 | 用途 |
|---|---|---|
| `react-router-dom` | 5.3.4 | 声明式路由 |
| `kbar` | 0.1.0-beta.48 | 命令面板（Ctrl+K） |
| `framer-motion` | 6.5.1 | 动画与过渡效果 |
| `i18next` + `react-i18next` | 22.5.1 / 12.3.1 | 国际化 |
| `react-helmet-async` | 2.0.5 | 页面标题和 meta 管理 |
| `@radix-ui/react-*` | 各组件 | 无障碍 UI 原语（Dialog、Popover、Tooltip 等） |
| `@dnd-kit/*` | 6.x / 7.x | 拖拽排序 |
| `@tanstack/react-table` | 8.21.3 | 表格虚拟化 |
| `sonner` | 1.7.4 | Toast 通知 |
| `vaul` | 1.1.2 | 移动端抽屉组件 |
| `outline-icons` | 4.3.0 | 自定义图标库 |

Sources: [package.json](package.json#L53-L276)

## 数据流总览

将以上四个维度串联起来，Outline 前端的核心数据流如下：

1. **用户交互**触发 React 事件处理函数。
2. 事件处理函数调用 **MobX Store** 的 `@action` 方法（如 `documents.fetch(id)`）。
3. Store 方法通过 **ApiClient** 向后端发起 HTTP 请求。
4. 响应数据通过 Store 的 `add()` 方法转化为 **MobX Model** 实例，存入 `@observable` Map。
5. 被 `observer()` 包裹的 React 组件自动感知 observable 变化并重新渲染。
6. 组件渲染时通过 **Styled Components** 的 `ThemeProvider` 获取当前主题，生成对应的 CSS。

这个单向数据流确保了状态变更的可预测性，而 MobX 的细粒度响应机制保证了只有真正受影响的组件才会重新渲染。

Sources: [app/stores/base/Store.ts](app/stores/base/Store.ts#L278-L400), [app/utils/ApiClient.ts](app/utils/ApiClient.ts#L44-L100), [app/components/Theme.tsx](app/components/Theme.tsx#L34-L48)

## 下一步阅读

本文建立了前端技术栈的全局视角。以下页面将深入各个子系统的实现细节：

- [状态管理：MobX Model、Store 与 RootStore 架构](9-zhuang-tai-guan-li-mobx-model-store-yu-rootstore-jia-gou) — 深入 Store 基类的 API 设计、Model 装饰器系统与跨 Store 通信模式
- [路由系统与页面场景（Scenes）组织方式](10-lu-you-xi-tong-yu-ye-mian-chang-jing-scenes-zu-zhi-fang-shi) — 路由守卫、懒加载策略与页面级组件结构
- [主题系统与全局样式设计](12-zhu-ti-xi-tong-yu-quan-ju-yang-shi-she-ji) — 主题 Token 体系、暗色模式切换与全局样式管理
- [React Hooks 工具库：常用自定义 Hooks 详解](13-react-hooks-gong-ju-ku-chang-yong-zi-ding-yi-hooks-xiang-jie) — 核心 Hooks 的实现原理与使用场景
- [整体架构：前后端 Monorepo 与共享模块设计](6-zheng-ti-jia-gou-qian-hou-duan-monorepo-yu-gong-xiang-mo-kuai-she-ji) — 前后端共享代码的组织与复用策略