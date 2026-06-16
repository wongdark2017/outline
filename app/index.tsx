// oxlint-disable-next-line import/no-unresolved
// 导入 Vite 模块预加载 polyfill，确保旧浏览器兼容性
import "vite/modulepreload-polyfill";
// 导入动画库，使用懒加载优化性能
import { LazyMotion, domMax } from "framer-motion";
// 导入命令面板组件
import { KBarProvider } from "kbar";
// 导入 MobX 状态管理相关库
import { Provider } from "mobx-react";
import { configure as configureMobx } from "mobx";
// 导入 React 核心库
import { StrictMode } from "react";
import { render } from "react-dom";
// 导入 Helmet 用于管理文档头部
import { HelmetProvider } from "react-helmet-async";
// 导入路由
import { Router } from "react-router-dom";
// 导入全局状态存储
import stores from "~/stores";
// 导入核心组件
import Analytics from "~/components/Analytics";
import Dialogs from "~/components/Dialogs";
import Presentation from "~/components/Presentation";
import ErrorBoundary from "~/components/ErrorBoundary";
import PageTheme from "~/components/PageTheme";
import ScrollToTop from "~/components/ScrollToTop";
import Theme from "~/components/Theme";
import Toasts from "~/components/Toasts";
// 导入环境配置
import env from "~/env";
// 导入国际化工具
import { initI18n } from "~/utils/i18n";
// 导入桌面应用相关组件
import Desktop from "./components/DesktopEventHandler";
import LazyPolyfill from "./components/LazyPolyfills";
import PageScroll from "./components/PageScroll";
// 导入路由配置
import Routes from "./routes";
// 导入工具类
import Logger from "./utils/Logger";
import { PluginManager } from "./utils/PluginManager";
import history from "./utils/history";
import { initSentry } from "./utils/sentry";
import { ActionContextProvider } from "./hooks/useActionContext";

// 尽早加载插件系统
// Load plugins as soon as possible
void PluginManager.loadPlugins();

// 初始化国际化，使用默认语言
initI18n(env.DEFAULT_LANGUAGE);
// 获取根 DOM 元素
const element = window.document.getElementById("root");

// 如果配置了 Sentry DSN，初始化错误追踪
if (env.SENTRY_DSN) {
  initSentry(history);
}

// 配置 MobX 状态管理行为
configureMobx({
  // TODO: Enable these options and fix any resulting warnings
  // enforceActions: env.isDevelopment ? "always" : "never",
  // 要求计算属性必须在响应式上下文中使用
  computedRequiresReaction: true,
  // 隔离全局状态，避免多个 MobX 实例冲突
  isolateGlobalState: true,
});

// 命令面板动画配置
const commandBarOptions = {
  animations: {
    enterMs: 250, // 进入动画时长
    exitMs: 200, // 退出动画时长
  },
};

// 如果根元素存在，渲染应用
if (element) {
  // 定义应用主组件，使用多层 Provider 包裹
  const App = () => (
    <StrictMode>
      {/* 管理文档头部（title、meta 等） */}
      <HelmetProvider>
        {/* 提供 MobX 全局状态 */}
        <Provider rootStore={stores}>
          {/* 分析和追踪用户行为 */}
          <Analytics>
            {/* 路由管理 */}
            <Router history={history}>
              {/* 主题系统 */}
              <Theme>
                {/* 操作上下文提供者 */}
                <ActionContextProvider>
                  {/* 错误边界，捕获并显示错误 */}
                  <ErrorBoundary showTitle>
                    {/* 命令面板（快捷键触发） */}
                    <KBarProvider actions={[]} options={commandBarOptions}>
                      {/* 懒加载 polyfill */}
                      <LazyPolyfill>
                        {/* 动画系统，按需加载动画功能 */}
                        <LazyMotion features={domMax}>
                          {/* 页面滚动管理 */}
                          <PageScroll>
                            {/* 页面主题样式 */}
                            <PageTheme />
                            {/* 路由切换时滚动到顶部 */}
                            <ScrollToTop>
                              {/* 应用路由 */}
                              <Routes />
                            </ScrollToTop>
                            {/* 全局提示消息 */}
                            <Toasts />
                            {/* 全局对话框 */}
                            <Dialogs />
                            {/* 演示模式 */}
                            <Presentation />
                            {/* 桌面应用事件处理 */}
                            <Desktop />
                          </PageScroll>
                        </LazyMotion>
                      </LazyPolyfill>
                    </KBarProvider>
                  </ErrorBoundary>
                </ActionContextProvider>
              </Theme>
            </Router>
          </Analytics>
        </Provider>
      </HelmetProvider>
    </StrictMode>
  );

  // 将应用渲染到根元素
  render(<App />, element);
}

// 页面加载完成后初始化 Google Analytics
window.addEventListener("load", async () => {
  // installation does not use Google Analytics, or tracking is blocked on client
  // no point loading the rest of the analytics bundles
  // 如果未配置 GA ID 或 GA 被阻止，则跳过
  if (!env.GOOGLE_ANALYTICS_ID || !window.ga) {
    return;
  }
  // 动态导入 autotrack 插件
  await import("~/utils/autotrack");
  // 启用外链追踪
  window.ga("require", "outboundLinkTracker");
  // 启用 URL 变化追踪
  window.ga("require", "urlChangeTracker");
  // 启用事件追踪
  window.ga("require", "eventTracker", {
    attributePrefix: "data-",
  });
});

const developmentServiceWorkerReloadKey = "outline-development-sw-cleaned";

async function cleanupDevelopmentServiceWorker() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.map((registration) => registration.unregister())
  );
  let didCleanup = registrations.length > 0;

  if (!("caches" in window)) {
    return didCleanup;
  }

  const cacheNames = await caches.keys();
  const cacheNamesToDelete = cacheNames.filter(
    (cacheName) =>
      cacheName === "files-cache" || cacheName.startsWith("workbox-")
  );
  const cacheDeleted = await Promise.all(
    cacheNamesToDelete.map((cacheName) => caches.delete(cacheName))
  );
  didCleanup = didCleanup || cacheDeleted.some(Boolean);

  return didCleanup;
}

if ("serviceWorker" in navigator && env.ENVIRONMENT === "development") {
  window.addEventListener("load", () => {
    void cleanupDevelopmentServiceWorker()
      .then((didCleanup) => {
        if (!didCleanup) {
          sessionStorage.removeItem(developmentServiceWorkerReloadKey);
          return;
        }

        if (
          navigator.serviceWorker.controller &&
          !sessionStorage.getItem(developmentServiceWorkerReloadKey)
        ) {
          sessionStorage.setItem(developmentServiceWorkerReloadKey, "true");
          window.location.reload();
        }
      })
      .catch((error) => {
        Logger.debug(
          "lifecycle",
          "[ServiceWorker] Development cleanup failed.",
          error
        );
      });
  });
}

// 在非开发环境注册 Service Worker
if ("serviceWorker" in navigator && env.ENVIRONMENT !== "development") {
  window.addEventListener("load", () => {
    // see: https://bugs.chromium.org/p/chromium/issues/detail?id=1097616
    // In some rare (<0.1% of cases) this call can return `undefined`
    // 注册 Service Worker，极少数情况下可能返回 undefined
    const maybePromise = navigator.serviceWorker.register("/static/sw.js", {
      scope: "/",
    });

    // 检查返回值是否为 Promise
    if (maybePromise?.then) {
      maybePromise
        .then((registration) => {
          Logger.debug(
            "lifecycle",
            "[ServiceWorker] Registered.",
            registration
          );
        })
        .catch((registrationError) => {
          Logger.debug(
            "lifecycle",
            "[ServiceWorker] Registration failed.",
            registrationError
          );
        });
    }
  });
}
