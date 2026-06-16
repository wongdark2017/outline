import type { LocationDescriptor } from "history";
import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { s, ellipsis } from "@shared/styles";
import type Document from "~/models/Document";
import type Revision from "~/models/Revision";
import DocumentBreadcrumb from "~/components/DocumentBreadcrumb";
import DocumentTasks from "~/components/DocumentTasks";
import Flex from "~/components/Flex";
import Time from "~/components/Time";
import useCurrentUser from "~/hooks/useCurrentUser";
import useStores from "~/hooks/useStores";

/**
 * 文档元数据组件的 Props 类型定义。
 */
type Props = {
  children?: React.ReactNode; // 子元素（如评论链接、查看者统计等）
  showCollection?: boolean; // 是否显示所属集合
  showPublished?: boolean; // 是否显示发布时间
  showLastViewed?: boolean; // 是否显示最后查看时间
  showParentDocuments?: boolean; // 是否显示嵌套文档数量
  document: Document; // 文档对象
  revision?: Revision; // 可选的历史版本
  replace?: boolean; // 链接是否使用 replace 模式
  to?: LocationDescriptor; // 可选的链接目标
};

/**
 * 文档元数据组件。
 * 显示文档的基础元信息，包括作者、时间、状态等。
 *
 * 核心功能：
 * - 根据文档状态显示不同的元信息（创建、更新、发布、归档、删除）
 * - 显示最后查看时间
 * - 显示所属集合
 * - 显示嵌套文档数量
 * - 显示任务进度条
 * - 支持 RTL 文本方向
 *
 * 显示优先级（从高到低）：
 * 1. 历史版本信息
 * 2. 删除信息
 * 3. 归档信息
 * 4. 导入信息
 * 5. 创建信息（创建时间 = 更新时间）
 * 6. 发布信息
 * 7. 更新信息（默认）
 */
const DocumentMeta: React.FC<Props> = ({
  showPublished,
  showCollection,
  showLastViewed,
  showParentDocuments,
  document,
  revision,
  children,
  replace,
  to,
  ...rest
}: Props) => {
  // 国际化翻译函数
  const { t } = useTranslation();
  // 获取集合 store
  const { collections } = useStores();
  // 当前用户
  const user = useCurrentUser();
  // 从文档对象中解构所需属性
  const {
    modifiedSinceViewed, // 自上次查看后是否被修改
    updatedAt, // 更新时间
    updatedBy, // 更新者
    createdAt, // 创建时间
    publishedAt, // 发布时间
    archivedAt, // 归档时间
    deletedAt, // 删除时间
    isDraft, // 是否为草稿
    lastViewedAt, // 最后查看时间
    isTasks, // 是否为任务文档
  } = document;

  // 如果没有更新者信息，不显示元数据
  // 这种情况通常发生在渲染共享链接时
  if (!updatedBy) {
    return null;
  }

  // 获取文档所属的集合
  const collection = document.collectionId
    ? collections.get(document.collectionId)
    : undefined;
  // 判断最后更新者是否为当前用户
  const lastUpdatedByCurrentUser = user.id === updatedBy.id;
  // 更新者的用户名
  const userName = updatedBy.name;
  // 元信息内容（根据文档状态动态生成）
  let content;

  // 优先级 1：显示历史版本信息
  if (revision) {
    content = (
      <span>
        {revision.createdBy?.id === user.id
          ? t("You updated") // 当前用户创建的版本
          : t("{{ userName }} updated", { userName })}{" "} {/* 其他用户创建的版本 */}
        <Time dateTime={revision.createdAt} addSuffix />
      </span>
    );
  }
  // 优先级 2：显示删除信息
  else if (deletedAt) {
    content = (
      <span>
        {lastUpdatedByCurrentUser
          ? t("You deleted") // 当前用户删除
          : t("{{ userName }} deleted", { userName })}{" "} {/* 其他用户删除 */}
        <Time dateTime={deletedAt} addSuffix />
      </span>
    );
  }
  // 优先级 3：显示归档信息
  else if (archivedAt) {
    content = (
      <span>
        {lastUpdatedByCurrentUser
          ? t("You archived") // 当前用户归档
          : t("{{ userName }} archived", { userName })}{" "} {/* 其他用户归档 */}
        <Time dateTime={archivedAt} addSuffix />
      </span>
    );
  }
  // 优先级 4：显示导入信息
  // 条件：有源元数据 && 导入时间晚于更新时间
  else if (
    document.sourceMetadata &&
    document.sourceMetadata?.importedAt &&
    document.sourceMetadata.importedAt >= updatedAt
  ) {
    content = (
      <span>
        {document.sourceMetadata.createdByName
          ? t("{{ userName }} updated", {
              userName: document.sourceMetadata.createdByName, // 显示原始创建者
            })
          : t("Imported")}{" "} {/* 无创建者信息时显示 "Imported" */}
        <Time dateTime={createdAt} addSuffix />
      </span>
    );
  }
  // 优先级 5：显示创建信息
  // 条件：创建时间 = 更新时间（文档从未被编辑过）
  else if (createdAt === updatedAt) {
    content = (
      <span>
        {lastUpdatedByCurrentUser
          ? t("You created") // 当前用户创建
          : t("{{ userName }} created", { userName })}{" "} {/* 其他用户创建 */}
        <Time dateTime={updatedAt} addSuffix />
      </span>
    );
  }
  // 优先级 6：显示发布信息
  // 条件：有发布时间 && (发布时间 = 更新时间 或 强制显示发布时间)
  else if (publishedAt && (publishedAt === updatedAt || showPublished)) {
    content = (
      <span>
        {lastUpdatedByCurrentUser
          ? t("You published") // 当前用户发布
          : t("{{ userName }} published", { userName })}{" "} {/* 其他用户发布 */}
        <Time dateTime={publishedAt} addSuffix />
      </span>
    );
  }
  // 优先级 7：显示更新信息（默认情况）
  else {
    content = (
      <Modified highlight={modifiedSinceViewed && !lastUpdatedByCurrentUser}>
        {/* 如果自上次查看后被其他用户修改，高亮显示 */}
        {lastUpdatedByCurrentUser
          ? t("You updated") // 当前用户更新
          : t("{{ userName }} updated", { userName })}{" "} {/* 其他用户更新 */}
        <Time dateTime={updatedAt} addSuffix />
      </Modified>
    );
  }

  // 计算嵌套文档数量
  const nestedDocumentsCount = collection
    ? collection.getChildrenForDocument(document.id).length
    : 0;
  // 判断是否显示任务进度条
  const canShowProgressBar = isTasks;

  /**
   * 生成最后查看时间的显示内容。
   * @returns 最后查看时间的 JSX 元素或 null
   */
  const timeSinceNow = () => {
    // 草稿或不显示最后查看时间时，返回 null
    if (isDraft || !showLastViewed) {
      return null;
    }

    // 从未查看过
    if (!lastViewedAt) {
      // 如果是当前用户最后更新的，不显示 "Never viewed"
      if (lastUpdatedByCurrentUser) {
        return null;
      }
      // 其他用户更新但当前用户从未查看，高亮显示 "Never viewed"
      return (
        <Viewed>
          <Separator />
          <Modified highlight>{t("Never viewed")}</Modified>
        </Viewed>
      );
    }

    // 显示最后查看时间
    return (
      <Viewed>
        <Separator />
        {t("Viewed")} <Time dateTime={lastViewedAt} addSuffix shorten />
      </Viewed>
    );
  };

  return (
    <Container align="center" $rtl={document.dir === "rtl"} {...rest} dir="ltr">
      {/* 如果有链接目标，将内容包裹在 Link 中 */}
      {to ? (
        <Link to={to} replace={replace}>
          {content}
        </Link>
      ) : (
        content
      )}

      {/* 显示所属集合 */}
      {showCollection && collection && (
        <span>
          &nbsp;{t("in")}&nbsp;
          <Strong>
            <DocumentBreadcrumb document={document} maxDepth={1} onlyText />
          </Strong>
        </span>
      )}

      {/* 显示嵌套文档数量 */}
      {showParentDocuments && nestedDocumentsCount > 0 && (
        <span>
          <Separator />
          {nestedDocumentsCount}{" "}
          {t("nested document", {
            count: nestedDocumentsCount, // 自动处理单复数
          })}
        </span>
      )}

      {/* 显示最后查看时间 */}
      {timeSinceNow()}

      {/* 显示任务进度条 */}
      {canShowProgressBar && (
        <>
          <Separator />
          <DocumentTasks document={document} />
        </>
      )}

      {/* 渲染子元素（如评论链接、查看者统计等） */}
      {children}
    </Container>
  );
};

/**
 * 分隔符组件。
 * 显示为圆点 "•"，用于分隔元信息的各个部分。
 */
export const Separator = styled.span`
  padding: 0 0.4em;

  &::after {
    content: "•";
  }
`;

/**
 * 加粗文本组件。
 * 用于强调集合名称等重要信息。
 */
const Strong = styled.strong`
  font-weight: 550;
`;

/**
 * 容器组件。
 * 使用 Flex 布局，支持 RTL 文本方向。
 */
const Container = styled(Flex)<{ $rtl?: boolean }>`
  justify-content: ${(props) => (props.$rtl ? "flex-end" : "flex-start")}; // RTL 支持
  color: ${s("textTertiary")}; // 使用主题的三级文本颜色（灰色）
  font-size: 13px;
  white-space: nowrap; // 不换行
  overflow: hidden; // 隐藏溢出内容
  min-width: 0; // 允许 flex 子元素收缩
`;

/**
 * 查看时间容器组件。
 * 使用省略号样式处理溢出文本。
 */
const Viewed = styled.span`
  ${ellipsis()} // 文本溢出时显示省略号
`;

/**
 * 修改状态文本组件。
 * 根据 highlight 属性决定是否加粗显示。
 */
const Modified = styled.span<{ highlight?: boolean }>`
  font-weight: ${(props) => (props.highlight ? "600" : "400")};
  // highlight = true: 加粗（文档被其他用户修改且未查看）
  // highlight = false: 正常字重
`;

// 使用 MobX observer 包裹组件，使其能够响应 store 中的状态变化
export default observer(DocumentMeta);
