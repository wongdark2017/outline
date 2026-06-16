import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { mergeRefs } from "react-merge-refs";
import { useRouteMatch } from "react-router-dom";
import styled from "styled-components";
import Text from "@shared/components/Text";
import { richExtensions, withComments } from "@shared/editor/nodes";
import { TeamPreference } from "@shared/types";
import { colorPalette } from "@shared/utils/collections";
import Comment from "~/models/Comment";
import type Document from "~/models/Document";
import type Template from "~/models/Template";
import type { RefHandle } from "~/components/ContentEditable";
import { useDocumentContext } from "~/components/DocumentContext";
import type { Props as EditorProps } from "~/components/Editor";
import Editor from "~/components/Editor";
import type { Editor as SharedEditor } from "~/editor";
import Flex from "~/components/Flex";
import Time from "~/components/Time";
import { withUIExtensions } from "~/editor/extensions";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import useCurrentUser from "~/hooks/useCurrentUser";
import { useFocusedComment } from "~/hooks/useFocusedComment";
import { useLocationSidebarContext } from "~/hooks/useLocationSidebarContext";
import usePolicy from "~/hooks/usePolicy";
import useQuery from "~/hooks/useQuery";
import useStores from "~/hooks/useStores";
import {
  documentHistoryPath,
  documentPath,
  matchDocumentHistory,
} from "~/utils/routeHelpers";
import { decodeURIComponentSafe } from "~/utils/urls";
import MultiplayerEditor from "./AsyncMultiplayerEditor";
import DocumentMeta from "./DocumentMeta";
import DocumentTitle from "./DocumentTitle";
import { first } from "es-toolkit/compat";
import { getLangFor } from "~/utils/language";
import useShare from "@shared/hooks/useShare";

// 组合编辑器扩展：富文本扩展 + 评论功能 + UI 扩展
const extensions = withUIExtensions(withComments(richExtensions));

/**
 * 文档编辑器组件的 Props 类型定义。
 */
type Props = Omit<EditorProps, "editorStyle"> & {
  onChangeTitle: (title: string) => void; // 标题变化回调
  onChangeIcon: (icon: string | null, color: string | null) => void; // 图标变化回调
  id: string; // 文档 ID
  document: Document | Template; // 文档或模板对象
  isDraft: boolean; // 是否为草稿
  multiplayer?: boolean; // 是否启用多人协作
  onSave: (options: {
    done?: boolean; // 是否完成编辑
    autosave?: boolean; // 是否自动保存
    publish?: boolean; // 是否发布
  }) => void; // 保存回调
  children?: React.ReactNode; // 子元素（如 Footer）
};

/**
 * 文档编辑器组件。
 * 包含可编辑的标题、元数据和支持评论功能的富文本编辑器。
 *
 * 核心功能：
 * - 文档标题编辑（带图标和颜色）
 * - 富文本内容编辑（基于 ProseMirror）
 * - 评论功能（创建、删除、聚焦评论）
 * - 多人实时协作编辑
 * - 自动保存
 * - 文档元数据显示
 */
function DocumentEditor(props: Props, ref: React.ForwardedRef<SharedEditor>) {
  // 编辑器实例引用
  const editorRef = React.useRef<SharedEditor>(null);
  // 标题输入框引用
  const titleRef = React.useRef<RefHandle>(null);
  // 国际化翻译函数
  const { t } = useTranslation();
  // 当前路由匹配信息
  const match = useRouteMatch();
  // 文档上下文（用于管理编辑器状态）
  const { setFocusedCommentId } = useDocumentContext();
  // 当前聚焦的评论
  const focusedComment = useFocusedComment();
  // 全局 stores（UI 状态、评论数据）
  const { ui, comments } = useStores();
  // 当前用户（可能为空，如共享文档访问）
  const user = useCurrentUser({ rejectOnEmpty: false });
  // 当前团队（可能为空）
  const team = useCurrentTeam({ rejectOnEmpty: false });
  // 侧边栏上下文
  const sidebarContext = useLocationSidebarContext();
  // URL 查询参数
  const params = useQuery();
  // 共享文档相关信息
  const { shareId, showLastUpdated } = useShare();

  // 解构 props
  const {
    document,
    onChangeTitle,
    onChangeIcon,
    isDraft,
    readOnly,
    children,
    multiplayer,
    ...rest
  } = props;

  // 获取当前用户对文档的权限
  const can = usePolicy(document);
  // 判断团队是否启用评论功能
  const commentingEnabled = !!team?.getPreference(TeamPreference.Commenting);

  // 获取文档图标颜色（如果未设置，使用调色板的第一个颜色）
  const iconColor = document.color ?? (first(colorPalette) as string);
  // 子元素容器引用（用于计算高度）
  const childRef = React.useRef<HTMLDivElement>(null);

  /**
   * 将光标聚焦到编辑器开头。
   */
  const focusAtStart = React.useCallback(() => {
    if (editorRef.current) {
      editorRef.current.focusAtStart();
    }
  }, []);

  /**
   * 处理评论聚焦逻辑。
   * 当 URL 中有评论 ID 时，自动打开评论侧边栏并聚焦该评论。
   */
  React.useEffect(() => {
    if (focusedComment && focusedComment.documentId === document.id) {
      // 检查是否在查看已解决的评论
      const viewingResolved = params.get("resolved") === "";

      // 如果评论的解决状态与当前视图不匹配，重新设置聚焦
      if (
        (focusedComment.isResolved && !viewingResolved) ||
        (!focusedComment.isResolved && viewingResolved)
      ) {
        setFocusedCommentId(focusedComment.id);
      }

      // 打开评论侧边栏
      ui.set({ rightSidebar: "comments" });
    }
  }, [focusedComment, ui, document.id, params, setFocusedCommentId]);

  /**
   * 标题失焦时保存文档。
   * 延迟 250ms 执行，以便按钮点击事件能够先执行。
   */
  const handleBlur = React.useCallback(() => {
    setTimeout(() => props.onSave({ autosave: true }), 250);
  }, [props]);

  /**
   * 从标题跳转到编辑器的处理函数。
   * 当在标题中按下 Enter 或 Tab 键时触发。
   *
   * @param insertParagraph - 是否在编辑器开头插入新段落
   */
  const handleGoToNextInput = React.useCallback(
    (insertParagraph: boolean) => {
      if (insertParagraph && editorRef.current) {
        // 在编辑器开头插入一个空段落
        const { view } = editorRef.current;
        const { dispatch, state } = view;
        dispatch(state.tr.insert(0, state.schema.nodes.paragraph.create()));
      }

      // 聚焦到编辑器开头
      focusAtStart();
    },
    [focusAtStart]
  );

  /**
   * 创建评论草稿的处理函数。
   * 当用户在编辑器中创建评论标记时，在本地 store 中创建一个 Comment 模型作为草稿。
   *
   * @param commentId - 评论 ID
   * @param createdById - 创建者 ID
   * @param options - 可选配置（如是否自动聚焦）
   */
  const handleDraftComment = React.useCallback(
    (commentId: string, createdById: string, options?: { focus: boolean }) => {
      // 如果评论已存在或创建者不是当前用户，不执行
      if (comments.get(commentId) || createdById !== user?.id) {
        return;
      }

      // 创建本地评论草稿
      const comment = new Comment(
        {
          documentId: props.id,
          createdAt: new Date(),
          createdById,
          reactions: [],
        },
        comments
      );
      comment.id = commentId;
      comments.add(comment);

      // 如果需要，自动聚焦到新创建的评论
      if (options?.focus) {
        setFocusedCommentId(commentId);
      }
    },
    [comments, user?.id, props.id, setFocusedCommentId]
  );

  /**
   * 删除评论的处理函数。
   * 当评论标记从编辑器中完全移除时，软删除对应的 Comment 模型。
   *
   * @param commentId - 要删除的评论 ID
   */
  const handleRemoveComment = React.useCallback(
    async (commentId: string) => {
      const comment = comments.get(commentId);
      // 只删除未提交的新评论（草稿）
      if (comment?.isNew) {
        await comment?.delete();
      }
    },
    [comments]
  );

  // 从文档上下文获取编辑器管理函数
  const {
    setEditor,
    setEditorInitialized,
    updateState: updateDocState,
  } = useDocumentContext();
  const handleRefChanged = React.useCallback(setEditor, [setEditor]);

  // 根据是否启用多人协作选择编辑器组件
  const EditorComponent = multiplayer ? MultiplayerEditor : Editor;

  // 计算子元素高度（用于调整编辑器底部内边距）
  const childOffsetHeight = childRef.current?.offsetHeight || 0;

  /**
   * 编辑器样式配置。
   * 动态计算底部内边距，确保编辑器底部有足够的空间。
   */
  const editorStyle = React.useMemo(
    () => ({
      padding: "0 32px",
      margin: "0 -32px",
      paddingBottom: `calc(30vh - ${childOffsetHeight}px)`, // 底部留出 30vh 减去子元素高度
    }),
    [childOffsetHeight]
  );

  /**
   * 编辑器初始化完成的回调。
   */
  const handleInit = React.useCallback(
    () => setEditorInitialized(true),
    [setEditorInitialized]
  );

  /**
   * 编辑器销毁的回调。
   */
  const handleDestroy = React.useCallback(
    () => setEditorInitialized(false),
    [setEditorInitialized]
  );

  // 获取标题的文本方向（LTR 或 RTL）
  const direction = titleRef.current?.getComputedDirection();

  return (
    <Flex auto column>
      {/* 文档标题组件 */}
      <DocumentTitle
        ref={titleRef}
        readOnly={readOnly}
        documentId={document.id}
        title={
          // 只读模式下，如果标题为空则显示默认标题
          !document.title && readOnly
            ? document.titleWithDefault
            : document.title
        }
        icon={document.icon}
        color={iconColor}
        onChangeTitle={onChangeTitle}
        onChangeIcon={onChangeIcon}
        onGoToNextInput={handleGoToNextInput} // 按 Enter/Tab 跳转到编辑器
        onBlur={handleBlur} // 失焦时自动保存
        placeholder={t("Untitled")}
      />

      {/* 文档元数据 */}
      {shareId ? (
        // 共享文档：显示最后更新时间
        showLastUpdated && document.updatedAt ? (
          <SharedMeta type="tertiary">
            {t("Last updated")} <Time dateTime={document.updatedAt} addSuffix />
          </SharedMeta>
        ) : null
      ) : !rest.template ? (
        // 普通文档：显示完整元数据（作者、更新时间、查看历史链接等）
        <DocumentMeta
          document={document as Document}
          to={{
            pathname:
              // 如果当前在历史页面，链接到文档页面；否则链接到历史页面
              match.path === matchDocumentHistory
                ? documentPath(document as Document)
                : documentHistoryPath(document as Document),
            state: { sidebarContext },
          }}
          rtl={direction === "rtl"} // 支持从右到左的文本方向
        />
      ) : null}

      {/* 富文本编辑器 */}
      <EditorComponent
        ref={mergeRefs([ref, editorRef, handleRefChanged])} // 合并多个 ref
        lang={getLangFor(document.language)} // 设置编辑器语言
        autoFocus={!!document.title && !props.defaultValue} // 有标题且非新文档时自动聚焦
        placeholder={t("Type '/' to insert, or start writing…")}
        scrollTo={decodeURIComponentSafe(window.location.hash)} // 滚动到 URL hash 指定的位置
        readOnly={readOnly}
        userId={user?.id}
        focusedCommentId={focusedComment?.id} // 当前聚焦的评论 ID
        // 评论相关回调（仅在启用评论且有权限时提供）
        onClickCommentMark={
          commentingEnabled && can.comment ? setFocusedCommentId : undefined
        }
        onCreateCommentMark={
          commentingEnabled && can.comment ? handleDraftComment : undefined
        }
        onDeleteCommentMark={
          commentingEnabled && can.comment ? handleRemoveComment : undefined
        }
        onOpenCommentsSidebar={
          commentingEnabled
            ? () => ui.set({ rightSidebar: "comments" })
            : undefined
        }
        onInit={handleInit}
        onDestroy={handleDestroy}
        onChange={updateDocState} // 内容变化时更新文档状态
        extensions={extensions} // 编辑器扩展（富文本、评论、UI）
        editorStyle={editorStyle}
        {...rest}
      />

      {/* 子元素容器（如 Footer、References） */}
      <div ref={childRef}>{children}</div>
    </Flex>
  );
}

/**
 * 共享文档元数据样式组件。
 * 用于显示共享文档的最后更新时间。
 */
const SharedMeta = styled(Text)`
  margin: -12px 0 2em 0;
  font-size: 14px;
`;

// 使用 MobX observer 包裹组件，并转发 ref
export default observer(React.forwardRef(DocumentEditor));
