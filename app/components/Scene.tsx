import * as React from "react";
import styled from "styled-components";
import CenteredContent from "~/components/CenteredContent";
import Header from "~/components/Header";
import PageTitle from "~/components/PageTitle";

type Props = {
  /** 当内容滚动超过标题时在页头显示的图标 */
  icon?: React.ReactNode;
  /** 场景的标题 */
  title?: React.ReactNode;
  /** 场景的标题（纯文本形式）– 仅当 title 属性不是纯文本时才需要 */
  textTitle?: string;
  /** 在页头左侧显示的组件 */
  left?: React.ReactNode;
  /** 在页头右侧显示的操作按钮组件 */
  actions?: React.ReactNode;
  /** 是否将内容水平居中并使用标准最大宽度（默认值：true） */
  centered?: boolean;
  /** 是否使用屏幕的全部宽度（默认值：false） */
  wide?: boolean;
  /** 场景的内容 */
  children?: React.ReactNode;
};

/**
 * Scene 是一个布局组件，提供一致的页面结构，包括粘性页头、可选标题、操作按钮和居中的内容区域。
 * 它被用作应用程序中大多数页面的顶层包装器，以确保视觉一致性。
 *
 * 该组件自动处理：
 * - 通过 PageTitle 组件设置浏览器标签页标题和 SEO
 * - 具有侧边栏感知能力的粘性页头
 * - 可配置最大宽度的可选内容居中
 * - 在页头中显示图标和标题
 * - 在页头中显示操作按钮和左侧组件
 *
 * @param props - 组件属性。
 * @returns 带有页头和内容区域的全宽场景布局。
 */
const Scene: React.FC<Props> = ({
  title,
  icon,
  textTitle,
  actions,
  left,
  children,
  centered,
  wide,
}: Props) => (
  <FillWidth>
    <PageTitle title={textTitle ?? (typeof title === "string" ? title : "")} />
    <Header
      hasSidebar
      title={
        icon ? (
          <>
            {icon}&nbsp;{title}
          </>
        ) : (
          title
        )
      }
      actions={actions}
      left={left}
    />
    {centered !== false ? (
      <CenteredContent maxWidth={wide ? "100vw" : undefined} withStickyHeader>
        {children}
      </CenteredContent>
    ) : (
      children
    )}
  </FillWidth>
);

const FillWidth = styled.div`
  width: 100%;
`;

export default Scene;
