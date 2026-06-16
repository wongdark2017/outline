import { observer } from "mobx-react";
import { Suspense } from "react";
import type { RouteComponentProps } from "react-router-dom";
import { Switch, Redirect } from "react-router-dom";
import DocumentNew from "~/scenes/DocumentNew";
import Error404 from "~/scenes/Errors/Error404";
import AuthenticatedLayout from "~/components/AuthenticatedLayout";
import CenteredContent from "~/components/CenteredContent";
import PlaceholderDocument from "~/components/PlaceholderDocument";
import Route from "~/components/ProfiledRoute";
import WebsocketProvider from "~/components/WebsocketProvider";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import usePolicy from "~/hooks/usePolicy";
import lazy from "~/utils/lazyWithRetry";
import {
  archivePath,
  draftsPath,
  homePath,
  searchPath,
  settingsPath,
  matchDocumentSlug as documentSlug,
  matchCollectionSlug as collectionSlug,
  trashPath,
  debugPath,
} from "~/utils/routeHelpers";
import env from "~/env";

// 懒加载场景组件以优化性能，减少初始包体积
const SettingsRoutes = lazy(() => import("./settings"));
const Archive = lazy(() => import("~/scenes/Archive"));
const Collection = lazy(() => import("~/scenes/Collection"));
const Document = lazy(() => import("~/scenes/Document"));
const Drafts = lazy(() => import("~/scenes/Drafts"));
const Home = lazy(() => import("~/scenes/Home"));
const Journal = lazy(() => import("~/scenes/Journal"));
const Search = lazy(() => import("~/scenes/Search"));
const Trash = lazy(() => import("~/scenes/Trash"));
const Debug = lazy(() => import("~/scenes/Developer/Debug"));
const Changesets = lazy(() => import("~/scenes/Developer/Changesets"));

/**
 * 文档重定向组件。
 * 将旧的 /d/:slug 格式重定向到新的 /doc/:slug 格式，保持向后兼容。
 */
const RedirectDocument = ({
  match,
}: RouteComponentProps<{ documentSlug: string }>) => (
  <Redirect
    to={
      match.params.documentSlug
        ? `/doc/${match.params.documentSlug}`
        : homePath()
    }
  />
);

/**
 * 认证路由组件。
 * 包含所有需要用户登录后才能访问的应用路由。
 *
 * 功能特性：
 * - 基于用户权限动态显示路由（通过 can 策略控制）
 * - 提供 WebSocket 连接以支持实时协作
 * - 使用统一的认证布局包裹所有页面
 * - 懒加载组件以优化性能
 */
function AuthenticatedRoutes() {
  // 获取当前用户所属团队
  const team = useCurrentTeam();
  // 获取当前用户的权限策略（用于控制路由访问）
  const can = usePolicy(team);

  return (
    // WebSocket 提供者：为所有子组件提供实时通信能力
    <WebsocketProvider>
      {/* 认证布局：包含侧边栏、顶部导航等通用 UI 结构 */}
      <AuthenticatedLayout>
        {/* Suspense 处理懒加载组件的加载状态 */}
        <Suspense
          fallback={
            // 加载时显示文档占位符，提供更好的用户体验
            <CenteredContent>
              <PlaceholderDocument />
            </CenteredContent>
          }
        >
          <Switch>
            {/* 草稿箱路由：仅当用户有创建文档权限时显示 */}
            {can.createDocument && (
              <Route exact path={draftsPath()} component={Drafts} />
            )}
            {/* 归档路由：仅当用户有创建文档权限时显示 */}
            {can.createDocument && (
              <Route exact path={archivePath()} component={Archive} />
            )}
            {/* 回收站路由：仅当用户有创建文档权限时显示 */}
            {can.createDocument && (
              <Route exact path={trashPath()} component={Trash} />
            )}

            {/* 首页路由：支持可选的 tab 参数用于切换不同视图 */}
            <Route path={`${homePath()}/:tab?`} component={Home} />

            <Route exact path="/journal" component={Journal} />
            <Route exact path="/journal/:date" component={Journal} />

            {/* 旧路径重定向：保持向后兼容 */}
            <Redirect from="/dashboard" to={homePath()} />
            <Redirect exact from="/starred" to={homePath()} />
            <Redirect exact from="/templates" to={settingsPath("templates")} />
            {/* 将复数形式的 collections 重定向到单数形式 collection */}
            <Redirect exact from="/collections/*" to="/collection/*" />

            {/* 集合相关路由 */}
            {/* 在集合中创建新文档 */}
            <Route
              exact
              path={`/collection/${collectionSlug}/new`}
              component={DocumentNew}
            />
            {/* 编辑集合概览页面 */}
            <Route
              exact
              path={`/collection/${collectionSlug}/overview/edit`}
              component={Collection}
            />
            {/* 集合详情页：支持可选的 tab 参数 */}
            <Route
              exact
              path={`/collection/${collectionSlug}/:tab?`}
              component={Collection}
            />

            {/* 文档相关路由 */}
            {/* 创建新文档（不在特定集合中） */}
            <Route exact path="/doc/new" component={DocumentNew} />
            {/* 旧的文档路径格式 /d/:slug 重定向到新格式 /doc/:slug */}
            <Route
              exact
              path={`/d/${documentSlug}`}
              component={RedirectDocument}
            />
            {/* 文档历史记录：可选的 revisionId 参数用于查看特定版本 */}
            <Route
              exact
              path={`/doc/${documentSlug}/history/:revisionId?`}
              component={Document}
            />

            {/* 文档编辑模式 */}
            <Route
              exact
              path={`/doc/${documentSlug}/edit`}
              component={Document}
            />
            {/* 文档查看模式（默认路由，无 exact，匹配所有 /doc/:slug 开头的路径） */}
            <Route path={`/doc/${documentSlug}`} component={Document} />

            {/* 搜索路由：可选的 query 参数用于预填充搜索关键词 */}
            <Route exact path={`${searchPath()}/:query?`} component={Search} />

            {/* 开发者工具路由：仅在开发环境中可用 */}
            {env.isDevelopment && (
              <Route exact path={debugPath()} component={Debug} />
            )}
            {/* 变更集查看器：用于调试数据同步 */}
            {env.isDevelopment && (
              <Route
                exact
                path={`${debugPath()}/changesets`}
                component={Changesets}
              />
            )}

            {/* 404 错误页面 */}
            <Route exact path="/404" component={Error404} />

            {/* 设置相关的所有子路由（在单独的文件中定义） */}
            <SettingsRoutes />

            {/* 兜底路由：匹配所有未定义的路径，显示 404 页面 */}
            <Route component={Error404} />
          </Switch>
        </Suspense>
      </AuthenticatedLayout>
    </WebsocketProvider>
  );
}

// 使用 MobX observer 包裹组件，使其能够响应 store 中的状态变化
export default observer(AuthenticatedRoutes);
