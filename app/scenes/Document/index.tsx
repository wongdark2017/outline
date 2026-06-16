import { useEffect } from "react";
import type { StaticContext } from "react-router";
import { useHistory } from "react-router";
import type { RouteComponentProps } from "react-router-dom";
import type { SidebarContextType } from "~/components/Sidebar/components/SidebarContext";
import { useTrackLastVisitedPath } from "~/hooks/useLastVisitedPath";
import useStores from "~/hooks/useStores";
import DataLoader from "./components/DataLoader";
import Document from "./components/Document";
import { Footer } from "./components/Footer";

/**
 * URL 路径参数类型定义。
 */
type Params = {
  documentSlug: string; // 文档 slug（包含标题和 ID，格式如 "my-document-abc123"）
  revisionId?: string; // 可选的历史版本 ID，用于查看文档的特定版本
};

/**
 * 路由 location.state 类型定义。
 * 用于在路由跳转时传递额外的状态信息。
 */
type LocationState = {
  title?: string; // 文档标题（用于优化显示，避免等待数据加载）
  restore?: boolean; // 是否从回收站恢复文档
  revisionId?: string; // 历史版本 ID
  sidebarContext?: SidebarContextType; // 侧边栏上下文（决定显示哪个侧边栏视图）
};

/**
 * 组件 Props 类型定义。
 */
type Props = RouteComponentProps<Params, StaticContext, LocationState>;

/**
 * 文档场景组件。
 * 负责渲染单个文档的查看、编辑和历史记录页面。
 *
 * 核心功能：
 * - 从 URL 中提取文档 ID 和版本 ID
 * - 跟踪用户最后访问的路径（用于返回导航）
 * - 管理侧边栏上下文状态
 * - 通过稳定的 key 优化组件重新挂载行为
 * - 在组件卸载时清理活动文档状态
 */
export default function DocumentScene(props: Props) {
  // 获取 UI store，用于管理全局 UI 状态
  const { ui } = useStores();
  // 获取路由历史对象，用于编程式导航
  const history = useHistory();
  // 从 URL 参数中提取文档 slug 和版本 ID
  const { documentSlug, revisionId } = props.match.params;
  // 获取当前完整路径
  const currentPath = props.location.pathname;
  // 跟踪最后访问的路径，用于"返回"功能
  useTrackLastVisitedPath(currentPath);

  // 组件卸载时清理活动文档状态，避免内存泄漏和状态污染
  useEffect(() => () => ui.clearActiveDocument(), [ui]);

  // 确保侧边栏上下文始终存在
  useEffect(() => {
    // 当用户直接通过 URL 打开文档时（如刷新页面或分享链接），location.state 为空
    // 此时需要设置默认的侧边栏上下文，否则侧边栏可能不显示或显示错误
    if (!props.location.state?.sidebarContext) {
      history.replace({
        ...props.location,
        // 乐观地设置为 "collections"，这是最常用的侧边栏视图
        state: { ...props.location.state, sidebarContext: "collections" },
      });
    }
  }, [props.location, history]);

  // 从 documentSlug 中提取纯 ID 部分
  // documentSlug 格式："{标题}-{ID}"，例如 "my-document-abc123"
  // 我们只需要最后的 ID 部分（"abc123"），因为标题可能会变化
  // 这样可以避免标题更新时触发不必要的组件重新挂载
  const urlParts = documentSlug ? documentSlug.split("-") : [];
  const urlId = urlParts.length ? urlParts[urlParts.length - 1] : undefined;

  // 生成稳定的 React key，用于控制组件的挂载/卸载行为
  // 关键优化：确保 key 在渲染之间保持稳定，避免不必要的重新挂载
  //
  // 问题场景：
  // - 初始渲染时 revisionId 可能是 undefined
  // - React 会将 undefined 字符串化为 "undefined"
  // - 如果直接使用 `${urlId}/${revisionId}`，key 会从 "abc123/undefined" 变为 "abc123/"
  // - 这会导致完整的卸载/挂载循环，触发额外的网络请求并丢失编辑器状态
  //
  // 解决方案：
  // - 使用三元运算符确保 key 格式一致
  // - 有 revisionId 时：`${urlId}/${revisionId}`（如 "abc123/rev456"）
  // - 无 revisionId 时：直接使用 `urlId`（如 "abc123"）
  // - 这样 key 在整个生命周期中保持不变，避免不必要的重新挂载
  const key = revisionId ? `${urlId}/${revisionId}` : urlId;

  return (
    // DataLoader 负责加载文档数据
    // key 属性确保当切换到不同文档或版本时，组件会完全重新挂载
    <DataLoader
      key={key}
      match={props.match}
      history={props.history}
      location={props.location}
    >
      {/* render props 模式：DataLoader 加载完成后，将数据传递给子组件 */}
      {(rest) => (
        <Document {...rest}>
          {/* 文档底部显示元数据和操作按钮 */}
          <Footer document={rest.document} />
        </Document>
      )}
    </DataLoader>
  );
}
