Outline 里的 hooks 不是一堆零散“小工具”，而是一层非常明确的**前端编排层**。它们一头连着 MobX store、路由、编辑器、插件系统，另一头连着组件渲染和浏览器事件。你如果想快速理解某个页面“数据从哪里来、状态怎么拼、为什么副作用放这里”，直接去看 `app/hooks/` 往往比先翻某个 scene 组件更高效。

Sources: [app/hooks/useStores.ts](app/hooks/useStores.ts), [app/hooks/useRequest.ts](app/hooks/useRequest.ts), [app/hooks/usePaginatedRequest.ts](app/hooks/usePaginatedRequest.ts), [app/hooks/useTableRequest.ts](app/hooks/useTableRequest.ts), [app/hooks/useActionContext.tsx](app/hooks/useActionContext.tsx), [app/hooks/useSettingsConfig.ts](app/hooks/useSettingsConfig.ts), [shared/hooks/useShare.ts](shared/hooks/useShare.ts)

## 先把这些 hooks 分成几类

如果只从文件名看，`app/hooks/` 会显得很杂；但按职责拆开后，其实结构很清楚：

| 类别 | 代表 hook | 主要职责 |
|---|---|---|
| Store / 上下文访问 | `useStores`、`useCurrentUser`、`useCurrentTeam`、`usePolicy` | 把全局状态安全地接入组件 |
| 请求编排 | `useRequest`、`usePaginatedRequest`、`useTableRequest` | 管理列表/请求过程中的临时状态 |
| 路由与生命周期 | `useQuery`、`useQueryNotices`、`useAutoRefresh` | 把 URL 与应用生命周期副作用收口 |
| 浏览器与 DOM | `useEventListener`、`useOnClickOutside`、`useMediaQuery`、`usePersistedState`、`useThrottledCallback` | 封装底层浏览器交互 |
| 组合与配置 | `useComputed`、`useBuildTheme`、`useMenuAction`、`useActionContext`、`useSettingsConfig` | 把多个来源的数据拼成页面可直接消费的结果 |
| 共享与编辑器场景 | `useShare`、`useDictionary`、`useEmbeds` | 给分享页和编辑器提供领域化输入 |

这说明 hooks 在 Outline 里的定位并不是“替代组件代码”，而是把**组件不该自己重复写的编排逻辑**抽出来。

## Store 与上下文访问：先解决“我到底在什么语境里”

### `useStores()` 是最基础的一层

`useStores()` 直接从 `MobXProviderContext` 里取出根 store，并把它标注成 `RootStore` 类型。对使用者来说，体验就是：

```ts
const { auth, documents, ui } = useStores();
```

它很薄，但价值很大：

- 统一了全局状态入口
- 避免组件直接 import 单例 store
- 让测试和 Provider 注入保持一致

### `useCurrentUser()` / `useCurrentTeam()` 体现了 fail-fast 风格

这两个 hook 都提供了重载：

- 默认 `rejectOnEmpty: true`
- 可选 `rejectOnEmpty: false`

默认情况下，如果上下文中没有 user/team，会直接 `invariant(...)` 抛错。WHY 这样设计合理？因为很多页面本来就建立在“必须已登录、必须已进入团队上下文”这个前提上。越早失败，越容易定位问题。

### `usePolicy()` 不是纯读取，它还会补关系

`usePolicy(entity)` 会：

1. 从 `policies` store 里取当前实体 policy
2. 如果实体存在、不是新建态、也不在保存中
3. 且当前已登录但本地又没拿到 policy
4. 就触发 `entity.loadRelations()`

这很关键。它说明在 Outline 里，hook 不只是“读状态”，有时还承担“把当前上下文补完整”的责任。WHY 不把这段逻辑塞进组件？因为“按实体读取 policy，并在缺失时补拉关系”本身就是一个可复用语义。

Sources: [app/hooks/useStores.ts](app/hooks/useStores.ts), [app/hooks/useCurrentUser.ts](app/hooks/useCurrentUser.ts), [app/hooks/useCurrentTeam.ts](app/hooks/useCurrentTeam.ts), [app/hooks/usePolicy.ts](app/hooks/usePolicy.ts)

## 请求编排：`useRequest()` 是很多异步 hook 的母体

`useRequest()` 是一个非常典型的“组件级请求状态机”。

### 它统一暴露四种最常见状态

返回值固定包含：

- `data`
- `error`
- `loading`
- `loaded`
- `request()`

其中 `loaded` 和 `loading` 是分开的，这一点很实用。很多页面需要区分：

- “正在第一次加载”
- “已经加载过一次，现在再次刷新”

如果只有一个 `loading`，这两种状态很容易混在一起。

### 它主动防止卸载后 setState

`useRequest()` 内部用 `useIsMounted()` 包住状态更新。WHY 这很重要？因为 Outline 页面里有不少：

- 弹窗
- 懒加载 scene
- 快速路由跳转
- 编辑器相关异步流程

这些场景都很容易遇到“请求回来时组件已经卸载”的问题。

### 它解决的是组件瞬时状态，不是全局缓存

这里要注意一个分工边界：`useRequest()` 适合处理的是组件自己的加载状态；而真正的实体缓存、列表缓存、关系同步，更多还是交给 Store 层。换句话说：

- **长期数据** -> Store / Model
- **一次渲染过程里的异步状态** -> hook

这个边界让职责比较清楚。

Sources: [app/hooks/useRequest.ts](app/hooks/useRequest.ts), [shared/hooks/useIsMounted.ts](shared/hooks/useIsMounted.ts)

## 分页 hooks 把“列表还没到底”这件事也抽象了

Outline 不少页面都有“滚动加载下一页”的交互，所以这里单独做了两类分页 hook。

### `usePaginatedRequest()` 走的是通用列表模式

这个 hook 的几个关键设计点：

1. 会在真实 `limit` 上多取一条数据  
   也就是 `fetchLimit = displayLimit + 1`

2. 用“是否拿到第 `limit + 1` 条”判断有没有更多

3. 把新旧数据按 `id` 做 `uniqBy`

4. 当 `requestFn` 改变时，主动重置：
   - `data`
   - `page`
   - `offset`
   - `end`

WHY 多取一条很值？因为这样不用额外让后端告诉前端“还有没有下一页”，前端只靠返回长度就能判断。

### `useTableRequest()` 更贴近数据表场景

它额外处理了：

- `@tanstack/react-table` 的排序状态
- 服务端分页返回的 `total`
- 下一页按钮是否还应该出现

最值得注意的细节是 `sortRef.current = sort` 的更新时机。源码里特意把它放在请求成功之后，WHY？为了避免用户切换排序后，界面先按新排序闪一下，但数据还是旧结果，造成视觉抖动。

这说明 Outline 的 hooks 不只是封装 API 调用，也在管 UI 稳定性。

Sources: [app/hooks/usePaginatedRequest.ts](app/hooks/usePaginatedRequest.ts), [app/hooks/useTableRequest.ts](app/hooks/useTableRequest.ts), [app/stores/base/Store.ts](app/stores/base/Store.ts)

## 路由与生命周期 hooks：把全局副作用从页面里拿出去

### `useQuery()`：最轻的一层 URL 适配

`useQuery()` 只做一件事：基于 `location.search` 构造一个稳定的 `URLSearchParams`。

它很简单，但之所以值得存在，是因为 URL query 在 Outline 里被广泛使用：

- 分享页参数
- notice 提示
- 主题覆盖
- 登录回跳

统一到 hook 层后，调用方不用每次都自己 new 一遍。

### `useQueryNotices()`：把一次性提示和 URL 清理绑在一起

这个 hook 会从 query 参数里读取 `notice`，映射成对应 toast 文案，然后立刻把 `notice` 从 URL 里删掉。WHY 这是一条 hook，而不是散在多个页面里的 `useEffect`？

因为它天然是一种“读 URL -> 触发副作用 -> 清理 URL”的固定模式，重复度很高，而且非常适合放在根路由层。

### `useAutoRefresh()`：应用生命周期也被抽成了 hook

这个 hook 组合了：

- `useIdle()`
- `useInterval()`

逻辑是：应用大约跑够一天后，如果用户正处于 idle 状态，就自动刷新页面以避免长期运行旧 bundle。WHY 值得专门做？

- Outline 是长时间停留型应用
- 富文本编辑器和协作逻辑对前后端版本比较敏感
- 页面“永不刷新”未必是好事

这类全局生命周期逻辑，如果写在根组件里，后面很容易和其他副作用搅在一起；抽成 hook 后可读性更强。

Sources: [app/hooks/useQuery.ts](app/hooks/useQuery.ts), [app/hooks/useQueryNotices.ts](app/hooks/useQueryNotices.ts), [app/hooks/useAutoRefresh.ts](app/hooks/useAutoRefresh.ts)

## 浏览器与 DOM hooks：把底层样板代码关进笼子里

### `useEventListener()` 是很多交互 hook 的底座

它做的几个动作都很标准：

- 用 `savedHandler` ref 保存最新回调
- 在 effect 中统一注册/注销监听器
- 支持传入目标 element 和 options

这避免了组件自己每次都手写：

- `addEventListener`
- `removeEventListener`
- 闭包陈旧值处理

### `useOnClickOutside()` 是一个很典型的“在底座上组合”

它本身不直接操作 DOM API，而是建立在 `useEventListener()` 之上，同时监听：

- `pointerdown`
- `touchstart`

然后统一判断“当前点击是否发生在 ref 外部”。这说明 Outline 的 hook 风格很明确：**先做低层积木，再做领域一点的组合 hook**。

### `useMediaQuery()` 把设备判断收口

它通过 `window.matchMedia()` 暴露布尔值，并在变化时同步 `matches`。这类逻辑如果分散在组件里，很容易出现：

- 监听器清理不一致
- 某些组件用 `matchMedia`，某些组件又用 resize

统一后，像 `useBuildTheme()` 这类组合 hook 就能更自然地复用它。

### `usePersistedState()` 解决的是“局部状态也想跨标签页同步”

这个 hook 的特点很鲜明：

- API 长得像 `useState`
- 值会写进本地存储
- 可选监听其他标签页里的同 key 变化
- 还提供了 `setPersistedState()` 主动派发 `storage` 事件

它适合的就是那些“不值得进全局 store，但又不想每次刷新丢掉”的状态。

### `useThrottledCallback()` 说明交互性能也被纳入 hook 设计

它内部用 `lodash/throttle` 包住回调，并在组件卸载时自动 `cancel()`。WHY 这很实用？因为像：

- 滚动
- resize
- 拖拽
- 选区变化

这类高频事件如果不统一处理，性能问题会很难查。

Sources: [app/hooks/useEventListener.ts](app/hooks/useEventListener.ts), [app/hooks/useOnClickOutside.ts](app/hooks/useOnClickOutside.ts), [app/hooks/useMediaQuery.ts](app/hooks/useMediaQuery.ts), [app/hooks/usePersistedState.ts](app/hooks/usePersistedState.ts), [app/hooks/useThrottledCallback.ts](app/hooks/useThrottledCallback.ts)

## 组合型 hooks：把多个来源揉成“页面真的想要的结果”

Outline 里很有价值的一类 hook，不是某个 API 的薄包，而是“读取多个来源后输出一个成熟结果”。

### `useComputed()`：给 React 一个安全消费 MobX `computed` 的入口

`useComputed()` 会在 `useMemo` 里创建 MobX `computed(callback)`，然后调用 `.get()` 读取结果。

这带来的好处是：当某个页面组合逻辑既依赖 React 依赖数组，又依赖 observable 时，不一定非要把它提升回 store，也不必在组件 render 里写一大片手工推导。

### `useBuildTheme()`：主题组合就是一个标准样本

这个 hook 同时组合了：

- `useStores()`
- `useQuery()`
- `useMediaQuery()`
- 外部传入 `customTheme`

最后直接产出可喂给 `ThemeProvider` 的对象。它展示了 Outline hooks 的一个核心习惯：

**输入可以来自多个层级，但输出最好是一份调用方可以直接消费的结果。**

Sources: [app/hooks/useComputed.ts](app/hooks/useComputed.ts), [app/hooks/useBuildTheme.ts](app/hooks/useBuildTheme.ts)

## 配置与动作组合：这里的 hook 往往最接近产品结构

### `useActionContext()` 把“当前操作语境”抽成一层上下文

`ActionContextProvider` 会把这些信息合成上下文：

- 当前 active models
- 当前用户与团队 id
- 当前 location
- stores
- i18n 的 `t`
- 菜单/命令栏/按钮语境标记

更重要的是，它支持层层嵌套覆盖。WHY 要这样设计？因为在 Outline 里，同一个 action 可以出现在：

- 页面按钮
- 右键菜单
- 命令栏
- 侧边栏节点

这些地方虽然复用同一批 action 定义，但上下文未必一样。

### `useMenuAction()` 保证菜单动作对象的稳定性

它会比较前后 `actions` 是否真的变化，只有变了才重新生成 root menu action。WHY 不能每 render 都重建？因为菜单、弹层、命令栏这类系统对对象 identity 很敏感，频繁替换会增加不必要重渲染和状态抖动。

### `useSettingsConfig()` 展示了“产品配置表就是 hook 计算结果”

这个 hook 会综合：

- 当前用户
- 当前团队
- `usePolicy(team)` 权限
- 当前翻译函数
- 已加载的集成列表
- `PluginManager.getHooks(Hook.Settings)` 插件注入项

最后生成设置页侧边栏配置表。WHY 这一步放在 hook 层最合理？因为它明显是：

- 面向 UI 的
- 依赖多个运行时来源
- 需要响应权限与插件变化

但它又不适合作为某个组件私有逻辑散在那里。

Sources: [app/hooks/useActionContext.tsx](app/hooks/useActionContext.tsx), [app/hooks/useMenuAction.ts](app/hooks/useMenuAction.ts), [app/hooks/useSettingsConfig.ts](app/hooks/useSettingsConfig.ts), [app/utils/PluginManager.ts](app/utils/PluginManager.ts)

## 共享与编辑器场景：hook 直接对接业务域

### `useShare()`：分享上下文被做成共享 hook

`shared/hooks/useShare.ts` 很小，但很说明问题。它返回：

- `shareId`
- `sharedTree`
- `allowSubscriptions`
- `showLastUpdated`
- 以及一个派生布尔值 `isShare`

这意味着分享页的“访问语境”被显式封装成了一份可复用上下文，而不是让页面到处自己判断“当前是不是分享场景”。

### `useDictionary()`：编辑器文案集中注入

编辑器相关 UI 需要大量文案：

- 插入表格
- 创建链接
- 数学公式
- 上传进度
- notice 类型

`useDictionary()` 把这些文案统一整理成一个对象交给编辑器。WHY 这样做值？因为编辑器大部分实现并不想直接依赖 `react-i18next`，但又必须消费当前语言下的文案。

### `useEmbeds()`：把集成配置和静态 embed 注册表拼起来

这个 hook 会：

1. 拿到共享的 embed 描述列表
2. 视情况拉取团队的 embed integration 设置
3. 根据 integration settings 覆盖对应 embed 配置
4. 再结合团队偏好里的 `DisabledEmbeds` 打上禁用标记

这就是非常典型的领域编排 hook：调用者不关心细节，只拿“当前团队可用的 embeds 列表”。

Sources: [shared/hooks/useShare.ts](shared/hooks/useShare.ts), [app/hooks/useDictionary.ts](app/hooks/useDictionary.ts), [app/hooks/useEmbeds.ts](app/hooks/useEmbeds.ts)

## 从这些实现里能看出什么统一风格

Outline 的 hooks 大致有这几个共同点：

1. **优先做薄而明确的抽象**  
   很多 hook 文件并不长，但边界都很清楚。

2. **组合优于堆砌**  
   `useAutoRefresh()` 组合 `useIdle` 和 `useInterval`，`useBuildTheme()` 组合 store、query、media query。

3. **尽量把调用方真正要的结果算好再返回**  
   不是只还原底层 API，而是往往直接返回“可消费状态”。

4. **全局业务状态与组件瞬时状态分层**  
   store 管长期状态，hook 管页面编排和短生命周期副作用。

5. **对缺失上下文尽早失败**  
   `useCurrentUser()` / `useCurrentTeam()` 默认直接抛错，就是典型体现。

如果你在某个页面看到逻辑开始变复杂，一个很好的阅读顺序通常是：

1. 先看它用了哪些 hook
2. 再判断这些 hook 读了哪些 store / URL / 浏览器状态
3. 最后才回到组件 JSX

这样理解速度通常更快。

## 建议继续阅读

- 想看这些 hooks 最终服务于哪些页面场景：读 [路由系统与页面场景（Scenes）组织方式](10-lu-you-xi-tong-yu-ye-mian-chang-jing-scenes-zu-zhi-fang-shi)
- 想看很多 hooks 背后的状态来源：读 [状态管理：MobX Model、Store 与 RootStore 架构](9-zhuang-tai-guan-li-mobx-model-store-yu-rootstore-jia-gou)
- 想看组合型 hook 在主题系统里的完整样本：读 [主题系统与全局样式设计](12-zhu-ti-xi-tong-yu-quan-ju-yang-shi-she-ji)
- 想看 `useDictionary`、`useEmbeds` 这些 hook 最终怎样喂给富文本编辑器：读 [编辑器架构：基于 Prosemirror 的节点、标记与扩展体系](14-bian-ji-qi-jia-gou-ji-yu-prosemirror-de-jie-dian-biao-ji-yu-kuo-zhan-ti-xi)
