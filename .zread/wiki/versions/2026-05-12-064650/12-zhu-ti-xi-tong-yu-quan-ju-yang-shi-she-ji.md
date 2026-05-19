Outline 的主题系统并不是“浅色/深色切一下 className”那么简单。它是一条从 **颜色语义建模**、到 **MobX 中的主题状态**、再到 **styled-components 注入、全局样式落地、页面外壳同步、编辑器主题联动** 的完整链路。只有把这条链路看通，你才会知道为什么这个项目里很多组件几乎不关心“当前是不是暗色模式”，却依然能稳定拿到正确的外观。

Sources: [shared/styles/theme.ts](shared/styles/theme.ts), [shared/styles/globals.ts](shared/styles/globals.ts), [app/components/Theme.tsx](app/components/Theme.tsx), [app/components/PageTheme.ts](app/components/PageTheme.ts), [app/hooks/useBuildTheme.ts](app/hooks/useBuildTheme.ts), [app/stores/UiStore.ts](app/stores/UiStore.ts)

## 先建立一张主题系统地图

可以先把 Outline 的主题链路拆成六层：

| 层次 | 主要文件 | 负责什么 |
|---|---|---|
| 语义 token 层 | `shared/styles/theme.ts` | 把基础色板变成可消费的主题对象 |
| 样式辅助层 | `shared/styles/index.ts`、`shared/styles/breakpoints.ts`、`shared/styles/depths.ts` | 提供 `s()`、断点、z-index、hover 适配等工具 |
| 主题状态层 | `app/stores/UiStore.ts` | 保存用户偏好、系统主题、会话级 override |
| 主题组合层 | `app/hooks/useBuildTheme.ts` | 把“偏好 + 设备 + 打印 + query 参数 + 自定义品牌色”合成最终 theme |
| 全局注入层 | `app/components/Theme.tsx`、`shared/styles/globals.ts` | 注入 `ThemeProvider`、方向、全局 CSS、主题切换事件 |
| 页面外壳层 | `app/components/PageTheme.ts`、`app/scenes/Settings/Details.tsx`、`app/scenes/Shared/index.tsx` | 同步 body/meta，支持局部预览与公开分享场景覆盖 |

这张图里最关键的判断是：**Outline 的主题不是一组 CSS 文件，而是一份运行时状态驱动的语义对象。**

## `shared/styles/theme.ts`：先把“颜色”提升成“语义”

### 基础色板不是最终主题

`defaultColors` 只是一组原始颜色定义，例如：

- 黑白与灰阶
- `accent`
- `danger` / `warning` / `success`
- `brand.red` / `brand.blue` / `brand.green`

但组件平时并不会直接消费这些“原始名字”，真正被大量使用的是：

- `text`
- `textSecondary`
- `background`
- `sidebarBackground`
- `codeBackground`
- `modalBackground`
- `tooltipBackground`
- `scrollbarThumb`

也就是说，这里做的第一件事不是“列颜色”，而是“把颜色分配到界面语义上”。

### `buildBaseTheme()` 负责做通用骨架

`buildBaseTheme()` 会把输入颜色和默认颜色合并，然后补上一批全站公用能力：

- 字体族
- 字重
- 代码高亮 token 颜色
- notice/info/warning/success 配色
- `tableSelectedBackground`
- `breakpoints`
- 侧边栏宽度等 spacing 配置

这说明 theme 对象并不只装颜色，它还顺手承担了：

- 一部分排版常量
- 一部分布局常量
- 一部分编辑器视觉 token

WHY 这样做合理？因为这些值同样会被样式层广泛消费，而且它们和“当前主题长什么样”天然有关。

### 浅色、深色、Pitch Black 只是三种派生方案

在这个基础上，项目再分别构造：

- `buildLightTheme()`
- `buildDarkTheme()`
- `buildPitchBlackTheme()`

其中最值得注意的是 `buildPitchBlackTheme()`。它不是另一套独立主题，只是在深色主题基础上进一步把：

- `background`
- `codeBackground`

压到更纯的黑色。这也解释了后面 `useBuildTheme()` 为什么会在移动端深色模式下优先使用 Pitch Black，而不是桌面深色那套。

Sources: [shared/styles/theme.ts](shared/styles/theme.ts)

## 类型系统保证 theme 不是“随便塞属性的对象”

如果只看运行时，`ThemeProvider` 接收的是普通对象；但在 Outline 里，这个对象的形状被显式扩展到了 `styled-components` 的 `DefaultTheme` 上。

### `DefaultTheme` 被拆成多块能力

`app/typings/styled-components.d.ts` 把主题拆成几组接口再合并：

| 接口 | 作用 |
|---|---|
| `Colors` | 原始色板与品牌色 |
| `EditorTheme` | 编辑器、代码块、表格、字体等富文本相关 token |
| `Breakpoints` | 响应式断点 |
| `Spacing` | 侧边栏宽度、最小/最大尺寸等布局常量 |
| `DefaultTheme` | 汇总成组件最终可消费的完整主题 |

这意味着组件里写 `props.theme.xxx` 时，不是“想起什么就取什么”，而是被静态约束过的。

### 样式辅助函数把主题消费方式统一了

`shared/styles/index.ts` 里最常见的几个工具：

- `s(key)`：按 key 读取 theme 值
- `hover`：在触屏设备上退化为 `active`
- `ellipsis()` / `truncateMultiline()`：统一文本截断
- `hideScrollbars()`：统一滚动条隐藏

同时 `shared/styles/breakpoints.ts` 和 `shared/styles/depths.ts` 又把：

- 响应式断点
- 全局 z-index 层级

也做成集中定义。WHY 这很重要？因为主题系统如果只管颜色，不管断点和层级，组件最终还是会回到“到处手写常量”的状态，外观一致性会很快变差。

Sources: [app/typings/styled-components.d.ts](app/typings/styled-components.d.ts), [shared/styles/index.ts](shared/styles/index.ts), [shared/styles/breakpoints.ts](shared/styles/breakpoints.ts), [shared/styles/depths.ts](shared/styles/depths.ts)

## 主题状态不藏在组件里，而是集中放进 `UiStore`

真正决定“现在该渲染什么主题”的，不在某个页面组件里，而在 `UiStore`。

### `UiStore` 里有三种主题概念

可以先把这三个字段区分清楚：

| 字段 | 含义 |
|---|---|
| `theme` | 用户显式选择的偏好：`light` / `dark` / `system` |
| `themeOverride` | 当前会话中的临时覆盖，通常来自 query 参数 |
| `systemTheme` | 操作系统当前的颜色方案 |

最终对组件真正生效的是 `resolvedTheme`，它的规则很明确：

1. 如果有 `themeOverride`，优先用 override
2. 否则如果 `theme === system`，跟随 `systemTheme`
3. 否则使用用户显式选择的 `theme`

这套优先级把“长期偏好”和“临时调试/分享覆盖”拆得很清楚。

### `UiStore` 负责持久化和跨标签页同步

`UiStore` 初始化时会从 `UI_STORE` 里恢复：

- `theme`
- `sidebarCollapsed`
- `sidebarWidth`
- `rightSidebar`
- `tocVisible`

此外它还监听浏览器 `storage` 事件，把主题和部分 UI 偏好同步到其他标签页。这说明 theme 在 Outline 里不是一次性计算值，而是**可持久化、可跨窗口传播的 UI 状态**。

### 系统主题由 `matchMedia` 驱动

构造函数里会监听 `(prefers-color-scheme: dark)`，并把结果写入 `systemTheme`。这也是为什么用户把主题设置成 `system` 后，系统外观切换时 Outline 可以跟着切。

### `setTheme()` 不是直接赋值，而是包在 View Transition 里

`UiStore.setTheme()` 使用了：

- `startViewTransition()`
- `flushSync()`

这意味着主题切换被当成一次显式的界面过渡，而不是简单的响应式重渲染。WHY 值得这样做？因为暗色/浅色切换会影响全页面大量颜色，如果没有过渡封装，很容易显得生硬。

Sources: [app/stores/UiStore.ts](app/stores/UiStore.ts)

## `useBuildTheme()`：把多个输入拼成最终主题

如果说 `UiStore` 负责“主题状态”，那 `useBuildTheme()` 负责“主题求值”。

### 这个 hook 同时读了四类信息

它会同时组合：

- `ui.resolvedTheme`
- `useQuery()` 拿到的 `?theme=...`
- `useMediaQuery()` 判断当前是否移动端
- `useMediaQuery("print")` 判断是否打印
- 调用方传进来的 `customTheme`

这就是一个很典型的 Outline hook 风格：**把多个来源的信息拼成“组件真正需要的结果”**。

### query 参数覆盖只影响当前会话

如果 URL 上带了：

- `?theme=light`
- `?theme=dark`

hook 会调用 `ui.setThemeOverride(queryTheme)`。注释里写得很清楚，这个 override：

- 会在本次会话中持续生效
- 但不会写回 localStorage

WHY 不持久化？因为 query 参数通常意味着临时访问语境，例如分享页、调试、预览，而不是用户想永久改掉自己的默认主题。

### 打印和移动端是两个特殊分支

当前 hook 的分支逻辑是：

- 打印时：永远强制浅色主题
- 移动端深色：使用 `buildPitchBlackTheme()`
- 桌面深色：使用 `buildDarkTheme()`
- 其他情况：使用 `buildLightTheme()`

这几个判断都很务实：

- 打印版如果沿用深色主题，纸面可读性通常会更差
- 移动端纯黑背景更省电，也更接近原生 app 的深色观感

### 自定义品牌主题目前只开放了两项

`CustomTheme` 在共享类型里只有：

- `accent`
- `accentText`

这说明 Outline 现在的品牌化策略是“允许团队定制关键强调色”，而不是放开整套设计 token 任意修改。这样的约束能保住整体可读性和组件兼容性。

Sources: [app/hooks/useBuildTheme.ts](app/hooks/useBuildTheme.ts), [shared/types.ts](shared/types.ts)

## `Theme` 组件是全局注入点，不只是套个 `ThemeProvider`

`app/components/Theme.tsx` 很短，但职责非常集中。

### 它决定了根应用用哪份品牌主题

`Theme` 优先取：

1. `auth.team?.getPreference(TeamPreference.CustomTheme)`
2. 否则 `auth.config?.customTheme`

再交给 `useBuildTheme()` 合成最终主题。

这说明主应用外观默认跟随：

- 当前团队的自定义主题
- 或登录配置里下发的默认品牌主题

### 它同时处理了文本方向

通过 `isRTLLanguage(i18n.language)`，根组件会用 `DirectionProvider` 设置：

- `rtl`
- `ltr`

这一步跟颜色系统看似无关，但本质上都属于“全局视觉语境”。Outline 把它们放在同一层处理，是很合理的。

### 它还会向编辑器广播 `theme-changed`

当 `ui.resolvedTheme` 改变时，`Theme` 会派发一个全局 `CustomEvent("theme-changed")`。这个事件后面会被编辑器监听，用来把主题变化同步给 ProseMirror 生态里的插件和 node view。

WHY 不只靠 React 重新 render？因为编辑器内部有一部分状态和插件不完全受 React 管辖，显式事件桥接更稳。

### `GlobalStyles` 的一些细节说明它很在乎访问场景

根主题组件还会给 `GlobalStyles` 传一个 `useCursorPointer`：

- 已登录用户跟随 `UserPreference.UseCursorPointer`
- 公开分享页如果没有登录用户，默认显示 pointer

这个细节说明全局样式也会受“当前访问语境”影响，不是完全静态。

Sources: [app/components/Theme.tsx](app/components/Theme.tsx)

## `GlobalStyles` 和 `PageTheme` 负责 React 树外的世界

styled-components 只能很好地控制 React 树内的组件，但浏览器外壳还有不少地方需要额外同步。

### `GlobalStyles` 在做哪些基础工作

`shared/styles/globals.ts` 主要做了这些事：

- 注入 `styled-normalize`
- 统一 `box-sizing`
- 定义全局 CSS 变量，如 `--line-height-body`
- 设置 `safe-area` 相关变量
- 控制默认字体族来自 theme
- 处理 reduced motion
- 修正 Mermaid 注入的离屏节点
- 在表格拖拽时全局切换 `cursor: grabbing`

也就是说，主题系统不只是改变配色，还承担了**全局排版、可访问性、第三方样式收口**。

### `PageTheme` 负责同步浏览器壳层

`PageTheme` 每次主题变化时会主动更新：

- `document.body.style.background`
- `<meta name="theme-color">`
- `<meta name="color-scheme">`

这三者分别影响：

- React 根节点以外的背景色
- 桌面 PWA 标题栏颜色
- 浏览器原生控件和滚动条的外观倾向

如果缺少这一步，组件本身可能已经是深色了，但浏览器外壳仍然保留浅色痕迹，体验会显得割裂。

### 根应用在最外层就装好了这两层

`app/index.tsx` 中，`Theme` 把整个应用包起来，而 `PageTheme` 又被挂在根布局内层。这样主题相关副作用不依赖具体 scene，登录页、分享页、主应用都能吃到同一套机制。

Sources: [shared/styles/globals.ts](shared/styles/globals.ts), [app/components/PageTheme.ts](app/components/PageTheme.ts), [app/index.tsx](app/index.tsx)

## 主题可以被局部覆盖，这对预览和分享都很关键

Outline 并没有把主题锁死成“全站只有一份”。

### 设置页会先本地预览，再决定是否保存

`app/scenes/Settings/Details.tsx` 在用户编辑工作区品牌色时，会先根据当前输入的 `accent` / `accentText` 构造 `customTheme`，再用局部 `ThemeProvider` 包一层页面。

这样做的效果是：

- 用户一边选色，一边看到即时预览
- 但在点击保存前，不会污染全局已生效主题

这是一种非常实用的局部主题覆盖策略。

### 公开分享页也有自己的主题上下文

`app/scenes/Shared/index.tsx` 会根据分享对象对应团队的 `customTheme` 单独调用 `useBuildTheme(team?.customTheme)`，并用自己的 `ThemeProvider` 包住分享布局。

这意味着：

- 匿名访问分享页时，也能看到对应工作区的品牌色
- 分享场景不必完全继承登录态应用那一份主题对象

它更像一套“带同品牌视觉的半独立应用”。

Sources: [app/scenes/Settings/Details.tsx](app/scenes/Settings/Details.tsx), [app/scenes/Shared/index.tsx](app/scenes/Shared/index.tsx), [shared/types.ts](shared/types.ts)

## 为什么这套主题设计很适合 Outline

Outline 的界面有几个现实约束：

1. **既有完整登录态应用，也有公开分享页**
2. **既要支持桌面、移动端，也要考虑打印输出**
3. **富文本编辑器和普通 React 组件必须共用一套视觉语义**
4. **工作区品牌化需要可控，但不能把系统 UI 改得面目全非**

在这些约束下，这套设计的优点很明显：

- 主题 token 语义化，组件不依赖硬编码颜色
- 状态集中在 `UiStore`，偏好、系统主题、临时 override 不会打架
- `useBuildTheme()` 把设备和场景差异收口到一个地方
- `Theme` / `PageTheme` / `GlobalStyles` 把 React 内外的外观同步打通
- 局部 `ThemeProvider` 又保留了预览和分享覆盖能力

它不是最轻量的主题实现，但对 Outline 这种“编辑器 + 协作 + 多入口”的产品形态来说，足够稳。

## 建议继续阅读

- 想看 `useBuildTheme()` 这类组合型 hook 在项目里是怎样普遍出现的：读 [React Hooks 工具库：常用自定义 Hooks 详解](13-react-hooks-gong-ju-ku-chang-yong-zi-ding-yi-hooks-xiang-jie)
- 想看主题变化为什么还要向编辑器派发事件：读 [编辑器架构：基于 Prosemirror 的节点、标记与扩展体系](14-bian-ji-qi-jia-gou-ji-yu-prosemirror-de-jie-dian-biao-ji-yu-kuo-zhan-ti-xi)
- 想从更高层回看前端技术选型：读 [前端技术栈：React、MobX、Styled Components 与 Vite](4-qian-duan-ji-zhu-zhan-react-mobx-styled-components-yu-vite)
