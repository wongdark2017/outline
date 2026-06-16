import type { LocationDescriptor } from "history";
import { observer, useObserver } from "mobx-react";
import { CommentIcon } from "outline-icons";
import { useRef, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { TeamPreference } from "@shared/types";
import type Document from "~/models/Document";
import type Revision from "~/models/Revision";
import type Template from "~/models/Template";
import { openDocumentInsights } from "~/actions/definitions/documents";
import DocumentMeta, { Separator } from "~/components/DocumentMeta";
import Fade from "~/components/Fade";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import { useLocationSidebarContext } from "~/hooks/useLocationSidebarContext";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import breakpoint from "styled-components-breakpoint";
import { documentPath } from "~/utils/routeHelpers";
import NudeButton from "~/components/NudeButton";

/**
 * 文档元数据组件的 Props 类型定义。
 */
type Props = {
  document: Document | Template; // 要显示元数据的文档或模板
  revision?: Revision; // 可选的历史版本
  to?: LocationDescriptor; // 可选的链接目标（用于跳转到历史页面等）
  rtl?: boolean; // 是否为从右到左的文本方向
};

/**
 * 标题文档元数据组件。
 * 显示文档的元信息，包括：
 * - 作者和创建时间
 * - 最后编辑时间
 * - 评论数量（带链接）
 * - 查看者统计（带链接到洞察页面）
 *
 * 核心功能：
 * - 显示未解决的评论数量，点击可打开评论侧边栏
 * - 显示文档查看者数量，点击可查看详细洞察
 * - 支持 RTL（从右到左）文本方向
 * - 响应式布局（移动端垂直排列）
 */
function TitleDocumentMeta({ to, document, revision, rtl, ...rest }: Props) {
  // 获取全局 stores
  const { views, comments, ui } = useStores();
  // 国际化翻译函数
  const { t } = useTranslation();
  // 侧边栏上下文
  const sidebarContext = useLocationSidebarContext();
  // 当前团队
  const team = useCurrentTeam();
  // 获取当前文档的所有查看记录（响应式，数据变化时自动更新）
  const documentViews = useObserver(() => views.inDocument(document.id));
  // 查看者总数
  const totalViewers = documentViews.length;
  // 判断是否只有当前用户查看过（1个查看者且是当前用户）
  const onlyYou = totalViewers === 1 && documentViews[0].userId;
  // 记录组件挂载时是否已加载查看数据（用于控制淡入动画）
  const viewsLoadedOnMount = useRef(totalViewers > 0);
  // 获取当前用户对文档的权限
  const can = usePolicy(document);

  // 如果挂载时已有数据，不使用淡入动画；否则使用淡入动画
  // 这样可以避免已有数据时的闪烁效果
  const Wrapper = viewsLoadedOnMount.current ? Fragment : Fade;

  // 获取未解决的评论数量
  const commentsCount = comments.unresolvedCommentsInDocumentCount(document.id);
  // 判断团队是否启用评论功能
  const commentingEnabled = !!team.getPreference(TeamPreference.Commenting);

  return (
    <Meta
      document={document as Document}
      revision={revision}
      to={to}
      replace // 使用 replace 而不是 push，避免在历史记录中堆积
      $rtl={rtl}
      {...rest}
    >
      {/* 评论链接：仅在启用评论且有权限时显示 */}
      {commentingEnabled && can.comment && (
        <>
          <Separator /> {/* 分隔符（通常是 "·"） */}
          <CommentLink
            to={{
              pathname: documentPath(document as Document),
              state: { sidebarContext }, // 保持侧边栏上下文
            }}
            onClick={() =>
              // 切换评论侧边栏的显示/隐藏
              ui.set({
                rightSidebar:
                  ui.rightSidebar === "comments" ? null : "comments",
              })
            }
          >
            <CommentIcon size={18} />
            {commentsCount
              ? t("{{ count }} comment", { count: commentsCount }) // 有未解决评论：显示数量（如 "3 comments"）
              : t("Comment")} {/* 无未解决评论：显示 "Comment" */}
          </CommentLink>
        </>
      )}

      {/* 查看者统计：仅在有查看者、有权限且非草稿时显示 */}
      {totalViewers && can.listViews && !(document as Document).isDraft ? (
        <Wrapper>
          <Separator />
          <InsightsButton action={openDocumentInsights}>
            {t("Viewed by")}{" "}
            {onlyYou
              ? t("only you") // 只有当前用户查看过
              : `${totalViewers} ${
                  totalViewers === 1 ? t("person") : t("people")
                }`} {/* 多人查看：显示人数（如 "5 people"） */}
          </InsightsButton>
        </Wrapper>
      ) : null}
    </Meta>
  );
}

/**
 * 评论链接样式组件。
 * 使用 inline-flex 布局，图标和文字水平排列。
 */
const CommentLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 2px; // 图标和文字之间的间距
`;

/**
 * 洞察按钮样式组件。
 * 移除所有默认按钮样式，使其看起来像普通文本链接。
 */
const InsightsButton = styled(NudeButton)`
  background: none;
  border: none;
  padding: 0;
  width: auto;
  height: auto;
  color: inherit; // 继承父元素颜色
  font: inherit; // 继承父元素字体
  text-decoration: none;
  cursor: var(--pointer); // 使用 CSS 变量定义的指针样式

  &:hover {
    text-decoration: underline; // 悬停时显示下划线
  }
`;

/**
 * 元数据容器样式组件。
 * 扩展基础 DocumentMeta 组件，添加自定义样式。
 */
export const Meta = styled(DocumentMeta)<{ $rtl?: boolean }>`
  // RTL 支持：从右到左的文本方向时右对齐
  justify-content: ${(props) => (props.$rtl ? "flex-end" : "flex-start")};
  margin: -12px 0 2em 0; // 负上边距用于调整与标题的间距
  font-size: 14px;
  position: relative;
  user-select: none; // 禁止选中文本
  z-index: 1;

  // 移动端和平板：垂直排列
  ${breakpoint("mobile", "tablet")`
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.6;

    ${Separator} {
      display: none; // 隐藏分隔符（垂直排列时不需要）
    }
  `}

  // 链接样式
  a {
    color: inherit; // 继承父元素颜色
    cursor: var(--pointer);

    &:hover {
      text-decoration: underline; // 悬停时显示下划线
    }
  }

  // 打印时隐藏元数据
  @media print {
    display: none;
  }
`;

// 使用 MobX observer 包裹组件，使其能够响应 store 中的状态变化
export default observer(TitleDocumentMeta);
