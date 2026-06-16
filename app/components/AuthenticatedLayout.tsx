/**
 * 已认证用户的主布局组件
 *
 * 该组件为已登录用户提供完整的应用布局，包括：
 * - 侧边栏（主侧边栏和设置侧边栏）
 * - 键盘快捷键注册
 * - 命令栏
 * - 通知徽章
 * - 右侧边栏上下文
 * - 文档上下文
 */

// MobX 观察者装饰器，用于响应式更新
import { observer } from "mobx-react";
import * as React from "react";
// 路由定位钩子，用于获取当前路径
import { useLocation } from "react-router-dom";
// 账户被暂停时显示的错误页面
import ErrorSuspended from "~/scenes/Errors/ErrorSuspended";
// 基础布局组件
import Layout from "~/components/Layout";
// 键盘按键注册组件
import RegisterKeyDown from "~/components/RegisterKeyDown";
// 右侧边栏上下文提供者
import { RightSidebarProvider } from "~/components/RightSidebarContext";
// 主侧边栏组件
import Sidebar from "~/components/Sidebar";
// 获取当前团队的钩子
import useCurrentTeam from "~/hooks/useCurrentTeam";
// 键盘按键监听钩子
import useKeyDown from "~/hooks/useKeyDown";
// 登录后路径处理钩子
import { usePostLoginPath } from "~/hooks/useLastVisitedPath";
// 权限策略钩子
import usePolicy from "~/hooks/usePolicy";
// 全局状态存储钩子
import useStores from "~/hooks/useStores";
// 日志工具
import Logger from "~/utils/Logger";
// 历史记录工具，用于路由导航
import history from "~/utils/history";
// 判断是否按下修饰键（Cmd/Ctrl）
import { isModKey } from "@shared/utils/keyboard";
// 带重试机制的懒加载工具
import lazyWithRetry from "~/utils/lazyWithRetry";
// 路由路径辅助函数
import {
  searchPath,
  newDocumentPath,
  settingsPath,
  homePath,
} from "~/utils/routeHelpers";
// 文档上下文提供者
import { DocumentContextProvider } from "./DocumentContext";
// 淡入淡出动画组件
import Fade from "./Fade";
// 通知徽章组件
import NotificationBadge from "./NotificationBadge";
// Portal 上下文，用于渲染弹出层
import { PortalContext } from "./Portal";
// 命令栏组件
import CommandBar from "./CommandBar";

// 懒加载设置侧边栏组件，带重试机制
// 只有在访问设置页面时才会加载此组件，优化初始加载性能
const SettingsSidebar = lazyWithRetry(
  () => import("~/components/Sidebar/Settings")
);

/**
 * 组件属性类型定义
 */
type Props = {
  /** 子组件内容，通常是页面的主要内容区域 */
  children?: React.ReactNode;
};

/**
 * 已认证布局组件
 *
 * 为已登录用户提供完整的应用布局框架，包括侧边栏、快捷键、命令栏等功能。
 *
 * @param props - 组件属性
 * @returns 渲染的布局组件
 */
const AuthenticatedLayout: React.FC = ({ children }: Props) => {
  // 获取全局状态存储（UI 状态和认证状态）
  const { ui, auth } = useStores();
  // 获取当前路由位置信息
  const location = useLocation();
  // 布局容器的引用，用于 Portal 渲染
  const layoutRef = React.useRef<HTMLDivElement>(null);
  // 获取当前活动集合的权限策略
  const canCollection = usePolicy(ui.activeCollectionId);
  // 获取当前团队信息
  const team = useCurrentTeam();
  // 获取并消费登录后应跳转的路径
  const [spendPostLoginPath] = usePostLoginPath();

  // 注册快捷键：Cmd/Ctrl + . 切换侧边栏折叠状态
  useKeyDown(".", (event) => {
    if (isModKey(event)) {
      ui.toggleCollapsedSidebar();
    }
  });

  /**
   * 跳转到搜索页面的处理函数
   *
   * 当用户按下 't' 或 '/' 键时触发（不包括带修饰键的情况）
   *
   * @param ev - 键盘事件对象
   */
  const goToSearch = (ev: KeyboardEvent) => {
    // 如果没有按下 Cmd/Ctrl 键，则执行跳转
    if (!ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault();
      ev.stopPropagation();
      history.push(searchPath());
    }
  };

  /**
   * 创建新文档的处理函数
   *
   * 当用户按下 'n' 键时触发，会在当前活动的集合中创建新文档
   *
   * @param event - 键盘事件对象
   */
  const goToNewDocument = (event: KeyboardEvent) => {
    // 如果按下了 Cmd 或 Alt 键，则不执行操作
    if (event.metaKey || event.altKey) {
      return;
    }
    // 获取当前活动的集合 ID
    const { activeCollectionId } = ui;
    // 检查是否有活动集合且用户有创建文档的权限
    if (!activeCollectionId || !canCollection.createDocument) {
      return;
    }
    // 跳转到新文档创建页面
    history.push(newDocumentPath(activeCollectionId));
  };

  /**
   * 处理登录后的路径跳转
   *
   * 在组件挂载时，如果存在登录后应跳转的路径，则自动跳转到该路径
   * 如果跳转失败，则回退到首页
   */
  React.useEffect(() => {
    // 获取并消费登录后的目标路径
    const postLoginPath = spendPostLoginPath();
    if (postLoginPath) {
      try {
        // 使用 replace 而不是 push，避免在历史记录中留下中间状态
        history.replace(postLoginPath);
      } catch (err) {
        // 如果跳转失败，记录警告并回退到首页
        Logger.warn("Failed to navigate to post login path, falling back", {
          path: postLoginPath,
          error: err,
        });
        history.replace(homePath());
      }
    }
  }, [spendPostLoginPath]);

  // 如果用户账户被暂停，显示暂停错误页面
  if (auth.isSuspended) {
    return <ErrorSuspended />;
  }

  // 判断当前是否在设置页面
  // 判断当前是否在设置页面
  const isSettings = location.pathname.startsWith(settingsPath());

  /**
   * 侧边栏组件
   *
   * 根据当前页面类型显示不同的侧边栏：
   * - 设置页面：显示设置侧边栏
   * - 其他页面：显示主侧边栏
   */
  const sidebar = (
    <Fade>
      {/* 使用 Suspense 懒加载设置侧边栏，加载时不显示任何内容 */}
      <React.Suspense fallback={null}>
        {isSettings && <SettingsSidebar />}
      </React.Suspense>
      {/* 在设置页面时隐藏主侧边栏，但保留在 DOM 中以维持状态 */}
      <div style={isSettings ? { display: "none" } : undefined}>
        <Sidebar />
      </div>
    </Fade>
  );

  /**
   * 渲染完整的已认证布局
   *
   * 布局结构从外到内依次为：
   * 1. DocumentContextProvider - 提供文档上下文
   * 2. RightSidebarProvider - 提供右侧边栏上下文
   * 3. PortalContext.Provider - 提供 Portal 渲染容器
   * 4. Layout - 基础布局组件
   * 5. 键盘快捷键注册、子内容、命令栏、通知徽章
   */
  return (
    <DocumentContextProvider>
      <RightSidebarProvider>
        <PortalContext.Provider value={layoutRef.current}>
          <Layout title={team.name} sidebar={sidebar} ref={layoutRef}>
            {/* 注册快捷键：'n' 键创建新文档 */}
            <RegisterKeyDown trigger="n" handler={goToNewDocument} />
            {/* 注册快捷键：'t' 键跳转到搜索 */}
            <RegisterKeyDown trigger="t" handler={goToSearch} />
            {/* 注册快捷键：'/' 键跳转到搜索 */}
            <RegisterKeyDown trigger="/" handler={goToSearch} />
            {/* 渲染页面主要内容 */}
            {children}
            {/* 命令栏（Cmd+K 触发） */}
            <CommandBar />
            {/* 通知徽章，显示未读通知数量 */}
            <NotificationBadge />
          </Layout>
        </PortalContext.Provider>
      </RightSidebarProvider>
    </DocumentContextProvider>
  );
};

// 使用 MobX observer 包装组件，使其能够响应 observable 状态的变化
export default observer(AuthenticatedLayout);
