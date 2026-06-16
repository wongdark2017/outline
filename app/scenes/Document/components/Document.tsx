import { observer } from "mobx-react";
import { AllSelection } from "prosemirror-state";
import { useRef, useCallback } from "react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Prompt, useHistory, useLocation } from "react-router-dom";
import { toast } from "sonner";
import styled from "styled-components";
import breakpoint from "styled-components-breakpoint";
import { EditorStyleHelper } from "@shared/editor/styles/EditorStyleHelper";
import { s } from "@shared/styles";
import type { NavigationNode } from "@shared/types";
import { IconType, TOCPosition, TeamPreference } from "@shared/types";
import { determineIconType } from "@shared/utils/icon";
import { isModKey } from "@shared/utils/keyboard";
import type Document from "~/models/Document";
import type Revision from "~/models/Revision";
import DocumentMove from "~/components/DocumentExplorer/DocumentMove";
import DocumentPublish from "~/scenes/DocumentPublish";
import ErrorBoundary from "~/components/ErrorBoundary";
import LoadingIndicator from "~/components/LoadingIndicator";
import PageTitle from "~/components/PageTitle";
import PlaceholderDocument from "~/components/PlaceholderDocument";
import RegisterKeyDown from "~/components/RegisterKeyDown";
import { MeasuredContainer } from "~/components/MeasuredContainer";
import type { Editor as TEditor } from "~/editor";
import type { Properties } from "~/types";
import { useLocationSidebarContext } from "~/hooks/useLocationSidebarContext";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import { emojiToUrl } from "~/utils/emoji";
import { documentHistoryPath, documentEditPath } from "~/utils/routeHelpers";
import { useDocumentSave } from "../hooks/useDocumentSave";
import Container from "./Container";
import Contents from "./Contents";
import Editor from "./Editor";
import Header from "./Header";
import Notices from "./Notices";
import References from "./References";
import RevisionViewer from "./RevisionViewer";
import SharedHeader from "./SharedHeader";

/**
 * 路由 location.state 类型定义。
 */
type LocationState = {
  title?: string; // 文档标题
  restore?: boolean; // 是否从历史版本恢复
  revisionId?: string; // 历史版本 ID
};

/**
 * 文档场景组件的 Props 类型定义。
 */
interface Props {
  sharedTree?: NavigationNode; // 共享文档的导航树结构
  abilities: Record<string, boolean>; // 用户权限映射表（如 update、delete、comment 等）
  document: Document; // 当前文档模型
  revision?: Revision; // 可选的历史版本（用于查看文档历史）
  readOnly: boolean; // 是否为只读模式
  shareId?: string; // 公开共享文档的共享 ID
  tocPosition?: TOCPosition | false; // 目录位置覆盖设置，或 false 隐藏目录
  onCreateLink?: (
    params: Properties<Document>,
    nested?: boolean
  ) => Promise<string>; // 从编辑器创建链接文档的回调
  children?: React.ReactNode; // 在文档内容后渲染的可选子元素
}

/**
 * 文档场景组件。
 * 负责渲染和交互单个文档，包括查看、编辑和历史记录模式。
 *
 * 核心功能：
 * - 渲染文档编辑器或历史版本查看器
 * - 处理文档保存、发布、移动等操作
 * - 管理键盘快捷键（撤销/重做、编辑、历史记录等）
 * - 控制目录（TOC）显示和位置
 * - 支持多人实时协作编辑
 * - 处理文件上传和嵌入内容
 */
function DocumentScene({
  document,
  revision,
  readOnly,
  abilities,
  shareId,
  tocPosition,
  onCreateLink,
  children,
}: Props) {
  // 获取全局 stores（认证、UI、对话框）
  const { auth, ui, dialogs } = useStores();
  // 国际化翻译函数
  const { t } = useTranslation();
  // 路由历史对象，用于编程式导航
  const history = useHistory();
  // 当前路由位置信息
  const location = useLocation<LocationState>();
  // 侧边栏上下文（决定显示哪个侧边栏视图）
  const sidebarContext = useLocationSidebarContext();
  // 当前团队和用户信息
  const { team, user } = auth;

  // 编辑器实例的引用，用于直接调用编辑器方法
  const editorRef = useRef<TEditor>(null);

  // 文档保存相关的状态和方法
  const {
    isUploading, // 是否正在上传文件
    isSaving, // 是否正在保存
    isPublishing, // 是否正在发布
    isEditorDirty, // 编辑器内容是否有未保存的更改
    isEmpty, // 文档是否为空
    onSave, // 保存文档的方法
    replaceSelection, // 替换编辑器选中内容的方法
    handleSelectTemplate, // 选择模板的处理函数
    handleChangeTitle, // 修改标题的处理函数
    handleChangeIcon, // 修改图标的处理函数
    onFileUploadStart, // 文件上传开始的回调
    onFileUploadStop, // 文件上传结束的回调
  } = useDocumentSave({ document, editorRef, readOnly });

  /**
   * 文档同步完成后的回调。
   * 处理以下场景：
   * 1. 从搜索结果导航时高亮搜索词
   * 2. 从历史版本恢复文档内容
   */
  const onSynced = useCallback(async () => {
    const restore = location.state?.restore;
    const revisionId = location.state?.revisionId;
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    // 从搜索结果导航时，高亮显示搜索词
    const params = new URLSearchParams(location.search);
    const searchTerm = params.get("q");
    if (searchTerm) {
      editor.commands.find({ text: searchTerm });
    }

    // 如果不是恢复操作，直接返回
    if (!restore) {
      return;
    }

    // 从历史版本恢复文档内容
    const response = await client.post("/revisions.info", {
      id: revisionId,
    });

    if (response) {
      // 替换整个文档内容为历史版本的内容
      await replaceSelection(
        response.data,
        new AllSelection(editor.view.state.doc)
      );
      toast.success(t("Document restored"));
      // 清除 restore 状态，避免重复恢复
      history.replace(document.url, history.location.state);
    }
  }, [location, replaceSelection, t, history, document.url]);

  /**
   * 撤销/重做快捷键处理函数。
   * Cmd/Ctrl + Z: 撤销
   * Cmd/Ctrl + Shift + Z: 重做
   */
  const onUndoRedo = useCallback(
    (event: KeyboardEvent) => {
      if (isModKey(event)) {
        event.preventDefault();

        if (event.shiftKey) {
          // Shift + Cmd/Ctrl + Z: 重做
          if (!readOnly) {
            editorRef.current?.commands.redo();
          }
        } else {
          // Cmd/Ctrl + Z: 撤销
          if (!readOnly) {
            editorRef.current?.commands.undo();
          }
        }
      }
    },
    [readOnly]
  );

  /**
   * 移动文档快捷键处理函数（M 键）。
   * 打开移动文档对话框，允许用户将文档移动到其他集合。
   */
  const onMove = useCallback(
    (ev: React.MouseEvent | KeyboardEvent) => {
      ev.preventDefault();
      if (abilities.move) {
        dialogs.openModal({
          title: t("Move document"),
          content: <DocumentMove document={document} />,
        });
      }
    },
    [document, dialogs, t, abilities.move]
  );

  /**
   * 进入编辑模式快捷键处理函数（E 键）。
   * 在只读模式下：跳转到编辑页面
   * 在编辑模式下：聚焦编辑器
   */
  const goToEdit = useCallback(
    (ev: KeyboardEvent) => {
      if (readOnly) {
        // 只读模式：跳转到编辑页面
        ev.preventDefault();
        if (abilities.update) {
          history.push({
            pathname: documentEditPath(document),
            state: { sidebarContext },
          });
        }
      } else if (editorRef.current?.isBlurred) {
        // 编辑模式但编辑器失焦：重新聚焦编辑器
        ev.preventDefault();
        editorRef.current?.focus();
      }
    },
    [readOnly, abilities.update, history, document, sidebarContext]
  );

  /**
   * 查看历史记录快捷键处理函数（H 键）。
   * 在只读模式下切换历史记录页面和文档页面。
   */
  const goToHistory = useCallback(
    (ev: KeyboardEvent) => {
      // 只在只读模式下工作
      if (!readOnly) {
        return;
      }
      // 忽略 Ctrl+H（浏览器历史记录）
      if (ev.ctrlKey) {
        return;
      }
      ev.preventDefault();

      if (location.pathname.endsWith("history")) {
        // 当前在历史页面：返回文档页面
        history.push({
          pathname: document.path,
          state: { sidebarContext },
        });
      } else {
        // 当前在文档页面：跳转到历史页面
        history.push({
          pathname: documentHistoryPath(document),
          state: { sidebarContext },
        });
      }
    },
    [readOnly, location.pathname, history, document, sidebarContext]
  );

  /**
   * 发布文档的处理函数。
   * 如果文档已在集合中：直接发布
   * 如果文档不在集合中：打开发布对话框选择集合
   */
  const onPublish = useCallback(
    (ev: React.MouseEvent | KeyboardEvent) => {
      ev.preventDefault();
      ev.stopPropagation();

      // 文档已发布，不执行任何操作
      if (document.publishedAt) {
        return;
      }

      if (document?.collectionId) {
        // 文档已在集合中，直接发布
        void onSave({
          publish: true,
          done: true,
        });
      } else {
        // 文档不在集合中，打开对话框选择集合
        dialogs.openModal({
          title: t("Publish document"),
          content: <DocumentPublish document={document} />,
        });
      }
    },
    [document, dialogs, t, onSave]
  );

  /**
   * 发布快捷键处理函数（Cmd/Ctrl + Shift + P）。
   */
  const handlePublishShortcut = useCallback(
    (event: KeyboardEvent) => {
      if (isModKey(event) && event.shiftKey) {
        onPublish(event);
      }
    },
    [onPublish]
  );

  /**
   * 返回快捷键处理函数（Escape 键）。
   * 在编辑模式下按 Escape 返回查看模式。
   */
  const goBack = useCallback(() => {
    if (!readOnly) {
      history.push({
        pathname: document.url,
        state: { sidebarContext },
      });
    }
  }, [readOnly, history, document, sidebarContext]);

  // ========== 渲染逻辑 ==========

  // 判断是否为共享文档
  const isShare = !!shareId;
  // 判断是否禁用嵌入内容（团队设置或文档设置）
  const embedsDisabled =
    (team && team.documentEmbeds === false) || document.embedsDisabled;

  // 获取目录（TOC）位置配置
  const tocPos =
    tocPosition ?? // 优先使用传入的 tocPosition
    ((team?.getPreference(TeamPreference.TocPosition) as TOCPosition) || // 其次使用团队偏好设置
      TOCPosition.Left); // 默认左侧

  // 判断是否显示目录
  // 共享文档：根据 ui.tocVisible 状态（默认显示）
  // 普通文档：只有用户主动开启时才显示
  const showContents =
    tocPos && (isShare ? ui.tocVisible !== false : ui.tocVisible === true);

  // 计算目录偏移量（用于全宽文档的居中对齐）
  const tocOffset =
    tocPos === TOCPosition.Left
      ? EditorStyleHelper.tocWidth / -2 // 左侧目录：负偏移
      : EditorStyleHelper.tocWidth / 2; // 右侧目录：正偏移

  // 判断是否启用多人协作编辑
  // 条件：文档未归档 && 未删除 && 非历史版本 && 非共享文档
  const multiplayerEditor =
    !document.isArchived && !document.isDeleted && !revision && !isShare;

  // 处理文档标题中的 emoji 图标
  const hasEmojiInTitle = determineIconType(document.icon) === IconType.Emoji;
  const pageTitle = hasEmojiInTitle
    ? document.titleWithDefault.replace(document.icon!, "") // 移除标题中的 emoji
    : document.titleWithDefault;
  const favicon = hasEmojiInTitle ? emojiToUrl(document.icon!) : undefined; // 将 emoji 转换为 favicon URL

  // 全宽文档的变换偏移样式（用于 CSS 变量）
  const fullWidthTransformOffsetStyle = {
    ["--full-width-transform-offset"]: `${document.fullWidth && showContents ? tocOffset : 0}px`,
  } as React.CSSProperties;

  return (
    <ErrorBoundary showTitle>
      {/* 注册全局键盘快捷键 */}
      <RegisterKeyDown trigger="m" handler={onMove} /> {/* M: 移动文档 */}
      <RegisterKeyDown trigger="z" handler={onUndoRedo} /> {/* Z: 撤销/重做 */}
      <RegisterKeyDown trigger="e" handler={goToEdit} /> {/* E: 编辑 */}
      <RegisterKeyDown trigger="Escape" handler={goBack} /> {/* Escape: 返回 */}
      <RegisterKeyDown trigger="h" handler={goToHistory} /> {/* H: 历史记录 */}
      <RegisterKeyDown
        trigger="p"
        options={{
          allowInInput: true, // 允许在输入框中触发
        }}
        handler={handlePublishShortcut} // Cmd/Ctrl+Shift+P: 发布
      />
      <MeasuredContainer
        as={Background}
        name="container"
        key={revision ? revision.id : document.id} // 切换文档或版本时重新挂载
        column
        auto
      >
        {/* 设置页面标题和 favicon */}
        <PageTitle title={pageTitle} favicon={favicon} />

        {/* 上传或保存时显示加载指示器 */}
        {(isUploading || isSaving) && <LoadingIndicator />}

        <Container column>
          {/* 文件上传中离开页面的警告提示 */}
          {!readOnly && (
            <Prompt
              when={isUploading && !isEditorDirty}
              message={t(
                `Images are still uploading.\nAre you sure you want to discard them?`
              )}
            />
          )}

          {/* 根据是否为共享文档显示不同的头部 */}
          {isShare ? (
            <SharedHeader document={document} /> // 共享文档头部（简化版）
          ) : (
            <Header // 普通文档头部（包含编辑工具栏）
              editorRef={editorRef}
              document={document}
              revision={revision}
              isDraft={document.isDraft}
              isEditing={!readOnly && !!user?.separateEditMode} // 是否显示"编辑"按钮
              isSaving={isSaving}
              isPublishing={isPublishing}
              publishingIsDisabled={
                document.isSaving || isPublishing || isEmpty
              }
              savingIsDisabled={document.isSaving || isEmpty}
              onSelectTemplate={handleSelectTemplate}
              onSave={onSave}
            />
          )}

          <Main
            fullWidth={document.fullWidth}
            tocPosition={tocPos}
            style={fullWidthTransformOffsetStyle}
          >
            {/* Suspense 处理编辑器懒加载 */}
            <React.Suspense
              fallback={
                <EditorContainer
                  docFullWidth={document.fullWidth}
                  showContents={showContents}
                  tocPosition={tocPos}
                >
                  <PlaceholderDocument /> {/* 加载占位符 */}
                </EditorContainer>
              }
            >
              <MeasuredContainer
                name="document"
                as={EditorContainer}
                docFullWidth={document.fullWidth}
                showContents={showContents}
                tocPosition={tocPos}
              >
                {/* 根据是否为历史版本选择渲染组件 */}
                {revision ? (
                  // 历史版本：使用只读查看器
                  <RevisionViewer
                    ref={editorRef}
                    document={document}
                    revision={revision}
                    id={revision.id}
                  />
                ) : (
                  // 正常文档：使用完整编辑器
                  <>
                    {/* 文档通知（如模板提示、归档提示等） */}
                    <Notices document={document} readOnly={readOnly} />

                    {/* 打印时显示的目录 */}
                    {showContents && (
                      <PrintContentsContainer>
                        <Contents />
                      </PrintContentsContainer>
                    )}

                    {/* 核心编辑器组件 */}
                    <Editor
                      id={document.id}
                      key={embedsDisabled ? "disabled" : "enabled"} // 嵌入设置变化时重新挂载
                      ref={editorRef}
                      multiplayer={multiplayerEditor} // 是否启用多人协作
                      isDraft={document.isDraft}
                      document={document}
                      value={readOnly ? document.data : undefined} // 只读模式：传入固定值
                      defaultValue={document.data} // 编辑模式：传入默认值
                      embedsDisabled={embedsDisabled}
                      onSynced={onSynced}
                      onFileUploadStart={onFileUploadStart}
                      onFileUploadStop={onFileUploadStop}
                      onCreateLink={onCreateLink}
                      onChangeTitle={handleChangeTitle}
                      onChangeIcon={handleChangeIcon}
                      onSave={onSave}
                      onPublish={onPublish}
                      onCancel={goBack}
                      readOnly={readOnly} // 关键属性：控制是否可编辑
                      canUpdate={abilities.update}
                      canComment={abilities.comment}
                      autoFocus={document.createdAt === document.updatedAt} // 新文档自动聚焦
                    >
                      {/* 文档引用（反向链接） */}
                      <ReferencesWrapper>
                        <References document={document} />
                      </ReferencesWrapper>
                    </Editor>
                  </>
                )}
              </MeasuredContainer>

              {/* 屏幕侧边显示的目录 */}
              {showContents && (
                <ContentsContainer
                  docFullWidth={document.fullWidth}
                  position={tocPos}
                >
                  <Contents />
                </ContentsContainer>
              )}
            </React.Suspense>
          </Main>

          {/* 渲染传入的子元素（如 Footer） */}
          {children}
        </Container>
      </MeasuredContainer>
    </ErrorBoundary>
  );
}

/**
 * Main 组件的 Props 类型。
 */
type MainProps = {
  fullWidth: boolean; // 是否全宽显示
  tocPosition: TOCPosition | false; // 目录位置
};

/**
 * 主内容区域容器。
 * 使用 CSS Grid 布局，根据文档宽度和目录位置动态调整列布局。
 */
const Main = styled.div<MainProps>`
  margin-top: 4px;

  ${breakpoint("tablet")`
    display: grid;
    grid-template-columns: ${({ fullWidth, tocPosition }: MainProps) =>
      fullWidth
        ? tocPosition === TOCPosition.Left
          ? `${EditorStyleHelper.tocWidth}px minmax(0, 1fr)` // 全宽 + 左侧目录
          : `minmax(0, 1fr) ${EditorStyleHelper.tocWidth}px` // 全宽 + 右侧目录
        : `1fr minmax(0, ${`calc(46em + ${EditorStyleHelper.documentGutter})`}) 1fr`}; // 固定宽度 + 居中
  `};

  ${breakpoint("desktopLarge")`
    grid-template-columns: ${({ fullWidth, tocPosition }: MainProps) =>
      fullWidth
        ? tocPosition === TOCPosition.Left
          ? `${EditorStyleHelper.tocWidth}px minmax(0, 1fr)`
          : `minmax(0, 1fr) ${EditorStyleHelper.tocWidth}px`
        : `1fr minmax(0, ${`calc(${EditorStyleHelper.documentWidth} + ${EditorStyleHelper.documentGutter})`}) 1fr`};
  `};

  @media print {
    display: block;
    max-width: ${({ fullWidth }: MainProps) =>
      fullWidth
        ? `100%`
        : `calc(${EditorStyleHelper.documentWidth} + ${EditorStyleHelper.documentGutter})`};
  }
`;

/**
 * 目录容器的 Props 类型。
 */
type ContentsContainerProps = {
  docFullWidth: boolean; // 文档是否全宽
  position: TOCPosition | false; // 目录位置
};

/**
 * 屏幕侧边显示的目录容器。
 * 根据目录位置和文档宽度调整 Grid 列位置。
 */
const ContentsContainer = styled.div<ContentsContainerProps>`
  ${breakpoint("tablet")`
    margin-top: calc(44px + 6vh);

    grid-row: 1;
    grid-column: ${({ docFullWidth, position }: ContentsContainerProps) =>
      position === TOCPosition.Left ? 1 : docFullWidth ? 2 : 3}; // 左侧目录：第1列，右侧目录：第2或3列
    justify-self: ${({ position }: ContentsContainerProps) =>
      position === TOCPosition.Left ? "end" : "start"}; // 左侧目录右对齐，右侧目录左对齐
  `};

  @media print {
    display: none; // 打印时隐藏侧边目录
  }
`;

/**
 * 打印时显示的目录容器。
 * 仅在打印时显示，屏幕上隐藏。
 */
const PrintContentsContainer = styled.div`
  display: none;
  margin: 0 -12px;

  @media print {
    display: block;
  }
`;

/**
 * 编辑器容器的 Props 类型。
 */
type EditorContainerProps = {
  docFullWidth: boolean; // 文档是否全宽
  showContents: boolean; // 是否显示目录
  tocPosition: TOCPosition | false; // 目录位置
};

/**
 * 编辑器容器。
 * 为图标和标题注释添加左右内边距，并根据布局调整 Grid 列位置。
 */
const EditorContainer = styled.div<EditorContainerProps>`
  // 为图标和标题注释留出空间
  padding: 0 44px;

  ${breakpoint("tablet")`
    grid-row: 1;

    // 决定编辑器的列位置和跨度
    grid-column: ${({
      docFullWidth,
      showContents,
      tocPosition,
    }: EditorContainerProps) =>
      docFullWidth
        ? showContents
          ? tocPosition === TOCPosition.Left
            ? 2 // 全宽 + 左侧目录：编辑器在第2列
            : 1 // 全宽 + 右侧目录：编辑器在第1列
          : "1 / -1" // 全宽无目录：编辑器占满所有列
        : 2}; // 固定宽度：编辑器在第2列（居中）
  `};
`;

/**
 * 背景容器。
 * 使用主题背景色。
 */
const Background = styled(Container)`
  position: relative;
  background: ${s("background")};
`;

/**
 * 文档引用（反向链接）的包装容器。
 */
const ReferencesWrapper = styled.div`
  margin: 12px 0 60px;

  ${breakpoint("tablet")`
    margin-bottom: 12px;
  `}

  @media print {
    display: none; // 打印时隐藏引用
  }
`;

// 使用 MobX observer 包裹组件，使其能够响应 store 中的状态变化
export default observer(DocumentScene);
