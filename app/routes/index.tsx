import { Suspense } from "react";
import { Switch, Redirect } from "react-router-dom";
import DesktopRedirect from "~/scenes/DesktopRedirect";
import DelayedMount from "~/components/DelayedMount";
import FullscreenLoading from "~/components/FullscreenLoading";
import Route from "~/components/ProfiledRoute";
import env from "~/env";
import useQueryNotices from "~/hooks/useQueryNotices";
import lazy from "~/utils/lazyWithRetry";
import { matchDocumentSlug as documentSlug } from "~/utils/routeHelpers";
import useAutoRefresh from "~/hooks/useAutoRefresh";

// 懒加载路由组件以优化初始加载性能
const Authenticated = lazy(() => import("~/components/Authenticated"));
const AuthenticatedRoutes = lazy(() => import("./authenticated"));
const Shared = lazy(() => import("~/scenes/Shared"));
const Login = lazy(() => import("~/scenes/Login"));
const Logout = lazy(() => import("~/scenes/Logout"));
const OAuthAuthorize = lazy(() => import("~/scenes/Login/OAuthAuthorize"));
const ResetPassword = lazy(() => import("~/scenes/Login/ResetPassword"));

/**
 * 应用程序的根路由组件。
 * 根据环境配置提供两种路由模式：
 * 1. 共享模式（ROOT_SHARE_ID 存在时）：仅显示共享内容，无需登录
 * 2. 完整模式（默认）：包含登录、认证和所有应用功能
 */
export default function Routes() {
  // 处理 URL 查询参数中的通知消息
  useQueryNotices();
  // 自动刷新应用状态以保持数据同步
  useAutoRefresh();

  return (
    <Suspense
      fallback={
        // 延迟 2 秒显示加载动画，避免快速加载时的闪烁
        <DelayedMount delay={2000}>
          <FullscreenLoading />
        </DelayedMount>
      }
    >
      {env.ROOT_SHARE_ID ? (
        // 共享模式：应用配置为单个共享文档或集合的只读视图
        <Switch>
          <Route exact path="/" component={Shared} />
          <Route exact path={`/doc/${documentSlug}`} component={Shared} />
          {/* 将旧的共享 URL 格式重定向到简化路径 */}
          <Redirect exact from="/s/:shareId" to="/" />
          <Redirect
            exact
            from={`/s/:shareId/doc/${documentSlug}`}
            to={`/doc/${documentSlug}`}
          />
        </Switch>
      ) : (
        // 完整模式：包含认证和所有应用功能
        <Switch>
          {/* 公开路由：无需认证即可访问 */}
          /*
          ✅ 互斥选择：根据 URL，选择其中一个执行
          ✅ 独立平行：每个路由处理不同的页面
          ✅ 优先级顺序：写在前面的先检查（但这里都是 exact，所以顺序影响不大）
          */
          <Route exact path="/" component={Login} />
          <Route exact path="/create" component={Login} />
          <Route exact path="/reset-password" component={ResetPassword} />
          <Route exact path="/logout" component={Logout} />
          <Route exact path="/desktop-redirect" component={DesktopRedirect} />
          <Route exact path="/oauth/authorize" component={OAuthAuthorize} />

          {/* 共享文档路由：支持匿名访问共享内容 */}
          {/* 将旧的 /share/ 路径重定向到新的 /s/ 格式 */}
          <Redirect exact from="/share/:shareId" to="/s/:shareId" />
          <Route exact path="/s/:shareId" component={Shared} />

          <Redirect
            exact
            from={`/share/:shareId/doc/${documentSlug}`}
            to={`/s/:shareId/doc/${documentSlug}`}
          />
          <Route
            exact
            path={`/s/:shareId/doc/${documentSlug}`}
            component={Shared}
          />

          {/* 认证路由：需要用户登录才能访问的所有应用功能 */}
          <Authenticated>
            <AuthenticatedRoutes />
          </Authenticated>
        </Switch>
      )}
    </Suspense>
  );
}
