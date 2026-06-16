/* global File Promise */
import type { PluginSimple } from "markdown-it";
import { observable } from "mobx";
import { Observer } from "mobx-react";
import { darken, transparentize } from "polished";
import { baseKeymap } from "prosemirror-commands";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import type { InputRule } from "prosemirror-inputrules";
import { inputRules } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { NodeSpec, MarkSpec } from "prosemirror-model";
import { Schema, Node as ProsemirrorNode } from "prosemirror-model";
import type { Plugin, Transaction } from "prosemirror-state";
import {
  EditorState,
  NodeSelection,
  Selection,
  TextSelection,
} from "prosemirror-state";
import type { MarkdownParser } from "prosemirror-markdown";
import {
  AddMarkStep,
  RemoveMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
} from "prosemirror-transform";
import type { Decoration, NodeViewConstructor } from "prosemirror-view";
import { EditorView } from "prosemirror-view";
import * as React from "react";
import type { DefaultTheme, ThemeProps } from "styled-components";
import styled, { css } from "styled-components";
import insertFiles from "@shared/editor/commands/insertFiles";
import type { UploadFileResult } from "@shared/editor/commands/insertFiles";
import Styles from "@shared/editor/components/Styles";
import type { EmbedDescriptor } from "@shared/editor/embeds";
import type { CommandFactory, WidgetProps } from "@shared/editor/lib/Extension";
import type { AnyExtension, AnyExtensionClass } from "@shared/editor/lib/types";
import ExtensionManager from "@shared/editor/lib/ExtensionManager";
import type { MarkdownSerializer } from "@shared/editor/lib/markdown/serializer";
import textBetween from "@shared/editor/lib/textBetween";
import { basicExtensions as extensions } from "@shared/editor/nodes";
import type ReactNode from "@shared/editor/nodes/ReactNode";
import type { ComponentProps } from "@shared/editor/types";
import type {
  ProsemirrorData,
  ProsemirrorMark,
  UserPreferences,
} from "@shared/types";
import { ProsemirrorHelper } from "@shared/utils/ProsemirrorHelper";
import EventEmitter from "@shared/utils/events";
import type Document from "~/models/Document";
import Flex from "~/components/Flex";
import { PortalContext } from "~/components/Portal";
import type { Properties } from "~/types";
import Logger from "~/utils/Logger";
import ComponentView from "./components/ComponentView";
import EditorContext from "./components/EditorContext";
import type { NodeViewRenderer } from "./components/NodeViewRenderer";

import WithTheme from "./components/WithTheme";
import { isArray, isNull, map } from "es-toolkit/compat";
import type { LightboxImage } from "@shared/editor/lib/Lightbox";
import { LightboxImageFactory } from "@shared/editor/lib/Lightbox";
import type { ActivePdfDocument } from "@shared/editor/lib/PdfDocument";
import Lightbox from "~/components/Lightbox";
import { anchorPlugin } from "@shared/editor/plugins/AnchorPlugin";

const PdfViewerDialog = React.lazy(() => import("~/components/PdfViewerDialog"));

export type Props = {
  /** 编辑器上下文的可选标识符，用于持久化本地设置 */
  id?: string;
  /** 当前用户的用户 ID */
  userId?: string;
  /** 编辑器内容，仅在需要重置内容时更改 */
  value?: string | ProsemirrorData | ProsemirrorNode;
  /** 初始编辑器内容，可以是 Markdown 字符串、JSON 对象或 ProsemirrorNode */
  defaultValue: string | ProsemirrorData | ProsemirrorNode;
  /** 编辑器为空时显示的占位符 */
  placeholder: string;
  /** 要加载到编辑器中的扩展 */
  extensions?: (AnyExtensionClass | AnyExtension)[];
  /** 编辑器是否应在挂载时自动聚焦 */
  autoFocus?: boolean;
  /** 当前聚焦的评论 ID（如果有） */
  focusedCommentId?: string;
  /** 编辑器是否不允许编辑 */
  readOnly?: boolean;
  /**
   * 是否正在渲染文档的缓存版本（在多人协作加载时）。
   * 用于禁用某些编辑器功能
   */
  cacheOnly?: boolean;
  /** 在只读模式下是否仍允许编辑复选框 */
  canUpdate?: boolean;
  /** 在只读模式下是否仍允许评论 */
  canComment?: boolean;
  /** 文本内容的阅读方向（如果已知） */
  dir?: "rtl" | "ltr";
  /** 编辑器是否应垂直增长以填充可用空间 */
  grow?: boolean;
  /** 编辑器是否应显示模板选项（如插入占位符） */
  template?: boolean;
  /** 强制的最大内容长度 */
  maxLength?: number;
  /** 编辑器加载后要滚动到的标题 ID */
  scrollTo?: string;
  /** 处理上传图片的回调，应返回上传文件的 URL */
  uploadFile?: (
    file: File | string,
    options?: { id?: string; onProgress?: (fractionComplete: number) => void }
  ) => Promise<UploadFileResult>;
  /** 文档挂载时 ProseMirror 节点初始化的回调 */
  onInit?: () => void;
  /** 文档卸载时 ProseMirror 节点销毁的回调 */
  onDestroy?: () => void;
  /** 编辑器失去焦点时的回调，类似原生 input */
  onBlur?: () => void;
  /** 编辑器获得焦点时的回调，类似原生 input */
  onFocus?: () => void;
  /** 用户使用保存快捷键时的回调 */
  onSave?: (options: { done: boolean }) => void;
  /** 用户使用取消快捷键时的回调 */
  onCancel?: () => void;
  /** 用户更改编辑器内容时的回调 */
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  onChange?: (value: (asString?: boolean, trim?: boolean) => any) => void;
  /** 点击评论标记时的回调 */
  onClickCommentMark?: (commentId: string) => void;
  /**
   * 创建评论标记时的回调。
   *
   * @param commentId - 评论标记的 ID。
   * @param userId - 创建标记的用户 ID。
   * @param options - 评论标记创建的选项。
   */
  onCreateCommentMark?: (
    commentId: string,
    userId: string,
    options?: { focus: boolean }
  ) => void;
  /** 删除评论标记时的回调 */
  onDeleteCommentMark?: (commentId: string) => void;
  /** 应打开评论侧边栏时的回调 */
  onOpenCommentsSidebar?: () => void;
  /** 文件上传开始时的回调 */
  onFileUploadStart?: () => void;
  /** 文件上传结束时的回调 */
  onFileUploadStop?: () => void;
  /** 文件上传进度变化时的回调 */
  onFileUploadProgress?: (id: string, fractionComplete: number) => void;
  /** 创建链接时的回调，应返回创建文档的 URL */
  onCreateLink?: (
    params: Properties<Document>,
    nested?: boolean
  ) => Promise<string>;
  /** 用户点击文档中任何链接时的回调 */
  onClickLink: (
    href: string,
    event?: MouseEvent | React.MouseEvent<HTMLButtonElement>
  ) => void;
  /** 文档聚焦时用户按下任何键的回调 */
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  /** 要在文档中渲染的嵌入类型集合 */
  embeds: EmbedDescriptor[];
  /** 已登录用户的显示偏好设置（如果有） */
  userPreferences?: UserPreferences | null;
  /** 嵌入内容是否应在没有 iframe 的情况下渲染 */
  embedsDisabled?: boolean;
  className?: string;
  /** 容器的可选样式覆盖 */
  style?: React.CSSProperties;
  /** contenteditable 的可选样式覆盖 */
  editorStyle?: React.CSSProperties;
  lang?: string;
};

type State = {
  /** 文档文本是否被检测为使用 RTL 脚本 */
  isRTL: boolean;
  /** 编辑器当前是否聚焦 */
  isEditorFocused: boolean;
  /** 当前在灯箱中查看的图片 */
  activeLightboxImage: LightboxImage | null;
  /** 当前在独立阅读态中查看的 PDF */
  activePdfDocument: ActivePdfDocument | null;
};

/**
 * Outline 中所有富文本可编辑内容的共享编辑器根组件。
 * 不要直接使用此组件，应该通过懒加载使用。请使用 ~/components/Editor。
 */
export class Editor extends React.PureComponent<
  Props & ThemeProps<DefaultTheme>,
  State
> {
  static defaultProps = {
    defaultValue: "",
    dir: "auto",
    placeholder: "Write something nice…",
    readOnly: false,
    onFileUploadStart: () => {
      // 无默认行为
    },
    onFileUploadStop: () => {
      // 无默认行为
    },
    embeds: [],
    extensions,
  };

  state: State = {
    isRTL: false,
    isEditorFocused: false,
    activeLightboxImage: null,
    activePdfDocument: null,
  };

  /** 编辑器是否已初始化 */
  isInitialized = false;
  /** 编辑器是否失去焦点 */
  isBlurred = true;
  /** 扩展管理器实例 */
  extensions: ExtensionManager;
  /** 编辑器 DOM 元素的引用 */
  elementRef = React.createRef<HTMLDivElement>();
  /** 包装器 DOM 元素的引用 */
  wrapperRef = React.createRef<HTMLDivElement>();
  /** ProseMirror 编辑器视图实例 */
  view: EditorView;
  /** ProseMirror 文档模式 */
  schema: Schema;
  /** Markdown 序列化器 */
  serializer: MarkdownSerializer;
  /** Markdown 解析器 */
  parser: MarkdownParser;
  /** 粘贴内容的 Markdown 解析器 */
  pasteParser: MarkdownParser;
  /** ProseMirror 插件列表 */
  plugins: Plugin[];
  /** 键盘映射插件列表 */
  keymaps: Plugin[];
  /** 输入规则列表 */
  inputRules: InputRule[];
  /** 节点视图构造器映射 */
  nodeViews: {
    [name: string]: NodeViewConstructor;
  };

  /** 小部件组件映射 */
  widgets: { [name: string]: React.FC<WidgetProps> };
  /** 可观察的节点视图渲染器集合 */
  renderers = observable.set<NodeViewRenderer<ComponentProps>>();
  /** 节点规范映射 */
  nodes: { [name: string]: NodeSpec };
  /** 标记规范映射 */
  marks: { [name: string]: MarkSpec };
  /** 命令工厂映射 */
  commands: Record<string, CommandFactory>;
  /** Markdown 规则插件列表 */
  rulePlugins: PluginSimple[];
  /** 事件发射器 */
  events = new EventEmitter();
  /** DOM 变化观察器 */
  mutationObserver?: MutationObserver;

  /**
   * 组件挂载后初始化编辑器。使用 componentDidMount 而不是 constructor，
   * 因为 init 方法需要 DOM 已经挂载完成。
   */
  public componentDidMount() {
    this.init();
    window.addEventListener("theme-changed", this.dispatchThemeChanged);

    if (this.props.scrollTo) {
      void this.scrollToAnchor(this.props.scrollTo);
    }

    this.calculateDir();

    if (this.props.readOnly) {
      return;
    }
    

    if (this.props.autoFocus) {
      this.focusAtEnd();
    }
  }

  /**
   * 组件更新时处理属性变化，包括 value 变化、readOnly 切换、滚动到锚点等。
   *
   * @param prevProps - 更新前的属性。
   */
  public componentDidUpdate(prevProps: Props) {
    // 允许从外部通过 'value' 属性更新编辑器内容
    if (this.props.value && prevProps.value !== this.props.value) {
      const newState = this.createState(this.props.value);
      this.view.updateState(newState);
    }

    // 从只读模式切换到可编辑模式时，重新初始化以创建
    // 之前跳过的编辑扩展、键映射、输入规则和命令。
    if (prevProps.readOnly && !this.props.readOnly) {
      const docJSON = this.view.state.doc.toJSON();
      this.view.destroy();
      this.init();
      const newState = this.createState(docJSON);
      this.view.updateState(newState);
    } else if (!prevProps.readOnly && this.props.readOnly) {
      // 将 readOnly 变化传递给底层编辑器实例
      this.view.update({
        ...this.view.props,
        editable: () => false,
      });

      // 当 editable 改变时，NodeView 不会自动重新渲染，因此必须手动触发更新
      // 参见：https://discuss.prosemirror.net/t/re-render-custom-nodeview-when-view-editable-changes/6441
      Array.from(this.renderers).forEach((view) =>
        view.setProp("isEditable", false)
      );
    }

    if (this.props.scrollTo && this.props.scrollTo !== prevProps.scrollTo) {
      void this.scrollToAnchor(this.props.scrollTo);
    }

    // 如果从只读模式切换且 autoFocus 为 true，则聚焦到文档末尾
    if (prevProps.readOnly && !this.props.readOnly && this.props.autoFocus) {
      this.focusAtEnd();
    }

    if (prevProps.dir !== this.props.dir) {
      this.calculateDir();
    }

    if (!this.isBlurred && !this.state.isEditorFocused) {
      this.isBlurred = true;
      this.props.onBlur?.();
    }

    if (this.isBlurred && this.state.isEditorFocused) {
      this.isBlurred = false;
      this.props.onFocus?.();
    }
  }

  /**
   * 组件卸载时清理资源，包括事件监听器、视图和观察器。
   */
  public componentWillUnmount(): void {
    window.removeEventListener("theme-changed", this.dispatchThemeChanged);
    this.view?.destroy();
    this.mutationObserver?.disconnect();
    this.handleEditorDestroy();
  }

  /**
   * 初始化编辑器的所有核心组件，包括扩展、节点、标记、模式、插件等。
   */
  private init() {
    this.extensions = this.createExtensions();
    this.nodes = this.createNodes();
    this.marks = this.createMarks();
    this.schema = this.createSchema();
    this.plugins = this.createPlugins();
    this.rulePlugins = this.createRulePlugins();
    this.serializer = this.createSerializer();
    this.parser = this.createParser();
    this.nodeViews = this.createNodeViews();

    this.widgets = this.createWidgets();

    // 只读模式下不需要键盘映射和输入规则
    if (this.props.readOnly) {
      this.keymaps = [];
      this.inputRules = [];
      this.pasteParser = this.parser;
    } else {
      this.keymaps = this.createKeymaps();
      this.inputRules = this.createInputRules();
      this.pasteParser = this.createPasteParser();
    }

    this.view = this.createView();
    this.commands = this.createCommands();
  }

  /**
   * 创建扩展管理器，负责管理所有编辑器扩展。
   *
   * @returns 扩展管理器实例。
   */
  private createExtensions() {
    return new ExtensionManager(this.props.extensions, this);
  }

  /**
   * 从扩展管理器中获取所有插件。
   *
   * @returns 插件数组。
   */
  private createPlugins() {
    return this.extensions.plugins;
  }

  /**
   * 从扩展管理器中获取所有规则插件（用于 Markdown 解析）。
   *
   * @returns 规则插件数组。
   */
  private createRulePlugins() {
    return this.extensions.rulePlugins;
  }

  /**
   * 创建键盘映射，定义编辑器的快捷键行为。
   *
   * @returns 键盘映射插件数组。
   */
  private createKeymaps() {
    return this.extensions.keymaps({
      schema: this.schema,
    });
  }

  /**
   * 创建输入规则，用于自动格式化（如自动转换 Markdown 语法）。
   *
   * @returns 输入规则数组。
   */
  private createInputRules() {
    return this.extensions.inputRules({
      schema: this.schema,
    });
  }

  /**
   * 创建节点视图构造器，用于渲染自定义 React 组件节点。
   *
   * @returns 节点视图构造器映射对象。
   */
  private createNodeViews(): { [name: string]: NodeViewConstructor } {
    return Object.fromEntries(
      this.extensions.extensions
        .filter((extension: ReactNode) => extension.component)
        .map((extension: ReactNode) => [
          extension.name,
          (
            node: ProsemirrorNode,
            view: EditorView,
            getPos: () => number,
            decorations: Decoration[]
          ) =>
            new ComponentView(extension.component, {
              editor: this,
              extension,
              node,
              view,
              getPos,
              decorations,
            }),
        ])
    ) as { [name: string]: NodeViewConstructor };
  }

  /**
   * 创建编辑器命令集合，用于执行各种编辑操作。
   *
   * @returns 命令映射对象。
   */
  private createCommands() {
    return this.extensions.commands({
      schema: this.schema,
      view: this.view,
    });
  }

  /**
   * 创建小部件集合，用于渲染浮动工具栏等 UI 组件。
   *
   * @returns 小部件映射对象。
   */
  private createWidgets() {
    return this.extensions.widgets;
  }

  /**
   * 从扩展管理器中获取所有节点定义。
   *
   * @returns 节点规范映射对象。
   */
  private createNodes() {
    return this.extensions.nodes;
  }

  /**
   * 从扩展管理器中获取所有标记定义。
   *
   * @returns 标记规范映射对象。
   */
  private createMarks() {
    return this.extensions.marks;
  }

  /**
   * 创建 ProseMirror 模式，定义文档结构和允许的节点/标记。
   *
   * @returns ProseMirror 模式实例。
   */
  private createSchema() {
    return new Schema({
      nodes: this.nodes,
      marks: this.marks,
    });
  }

  /**
   * 创建 Markdown 序列化器，用于将 ProseMirror 文档转换为 Markdown。
   *
   * @returns Markdown 序列化器实例。
   */
  private createSerializer() {
    return this.extensions.serializer();
  }

  /**
   * 创建 Markdown 解析器，用于将 Markdown 转换为 ProseMirror 文档。
   *
   * @returns Markdown 解析器实例。
   */
  private createParser() {
    return this.extensions.parser({
      schema: this.schema,
      plugins: this.rulePlugins,
    });
  }

  /**
   * 创建粘贴解析器，用于处理粘贴的 Markdown 内容，启用链接自动识别。
   *
   * @returns Markdown 解析器实例。
   */
  private createPasteParser() {
    return this.extensions.parser({
      schema: this.schema,
      rules: { linkify: true },
      plugins: this.rulePlugins,
    });
  }

  /**
   * 创建编辑器状态，包含文档内容和所有插件。
   *
   * @param value - 可选的初始内容。
   * @returns ProseMirror 编辑器状态实例。
   */
  private createState(value?: string | ProsemirrorData | ProsemirrorNode) {
    const doc = this.createDocument(value || this.props.defaultValue);

    // 只读模式下只加载基础插件
    if (this.props.readOnly) {
      return EditorState.create({
        schema: this.schema,
        doc,
        plugins: [...this.plugins, anchorPlugin()],
      });
    }

    // 可编辑模式下加载完整的插件集合
    return EditorState.create({
      schema: this.schema,
      doc,
      plugins: [
        ...this.plugins,
        ...this.keymaps,
        anchorPlugin(),
        dropCursor({
          color: this.props.theme.cursor,
        }),
        gapCursor(),
        inputRules({
          rules: this.inputRules,
        }),
        keymap(baseKeymap),
      ],
    });
  }

  /**
   * 创建 ProseMirror 文档实例。
   *
   * @param content - 文档内容，可以是字符串（Markdown）、JSON 对象或 ProsemirrorNode。
   * @returns ProseMirror 文档节点。
   */
  private createDocument(content: string | object | ProsemirrorNode) {
    // 已经是 ProsemirrorNode
    if (content instanceof ProsemirrorNode) {
      return content;
    }

    // 看起来像 Markdown
    if (typeof content === "string") {
      return this.parser.parse(content) || undefined;
    }

    return ProsemirrorNode.fromJSON(this.schema, content);
  }

  /**
   * 创建 ProseMirror EditorView 实例，配置事件处理器和事务分发逻辑。
   *
   * @returns EditorView 实例。
   */
  private createView() {
    if (!this.elementRef.current) {
      throw new Error("createView called before ref available");
    }

    // 检查事务是否正在编辑复选框
    const isEditingCheckbox = (tr: Transaction) =>
      tr.steps.some(
        (step) =>
          (step instanceof ReplaceAroundStep || step instanceof ReplaceStep) &&
          step.slice.content?.firstChild?.type.name ===
            this.schema.nodes.checkbox_item.name
      );

    // 检查事务是否正在编辑评论
    const isEditingComment = (tr: Transaction) =>
      tr.steps.some(
        (step) =>
          (step instanceof AddMarkStep || step instanceof RemoveMarkStep) &&
          step.mark.type.name === this.schema.marks.comment.name
      );

    const self = this; // oxlint-disable-line - 在 dispatchTransaction 中需要访问外部 this
    const view = new EditorView(this.elementRef.current, {
      handleDOMEvents: {
        blur: this.handleEditorBlur,
        focus: this.handleEditorFocus,
      },
      attributes: {
        translate: this.props.readOnly ? "yes" : "no",
      },
      state: this.createState(this.props.value),
      editable: () => !this.props.readOnly,
      nodeViews: this.nodeViews,
      dispatchTransaction(this: EditorView, transaction) {
        if (this.isDestroyed) {
          return;
        }

        // 回调绑定到视图实例作为其 this
        const { state, transactions } =
          this.state.applyTransaction(transaction);

        this.updateState(state);

        // 如果任何被分发的事务导致文档发生变化，则调用我们自己的
        // 变化处理器来通知外部世界
        if (
          transactions.some((tr) => tr.docChanged) &&
          (!self.props.readOnly ||
            (self.props.canUpdate && transactions.some(isEditingCheckbox)) ||
            (self.props.canComment && transactions.some(isEditingComment)))
        ) {
          self.handleChange();
        }

        self.handleEditorInit();

        self.calculateDir();

        // 因为 Prosemirror 和 React 没有关联，所以每当 Prosemirror 状态
        // 改变时，我们必须告诉 React 需要重新渲染。
        self.forceUpdate();
      },
    });

    // 告诉第三方库和屏幕阅读器这是一个输入框
    view.dom.setAttribute("role", "textbox");
    view.dom.setAttribute("aria-label", "Editor content");

    return view;
  }

  /**
   * 滚动到指定的锚点元素。使用 MutationObserver 等待元素出现在 DOM 中。
   *
   * @param hash - 要滚动到的锚点标识符。
   */
  public async scrollToAnchor(hash: string) {
    if (!hash) {
      return;
    }

    // 检查元素是否可见（未被 display:none 或 opacity:0 隐藏）
    function isVisible(element: HTMLElement | null) {
      for (let e = element; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === "none" || s.opacity === "0") {
          return false;
        }
      }
      return true;
    }

    try {
      this.mutationObserver?.disconnect();
      this.mutationObserver = observe(
        hash,
        (element) => {
          const pos = this.view.posAtDOM(element, 0, 1);
          this.view.dispatch(
            this.view.state.tr.setSelection(
              TextSelection.near(this.view.state.doc.resolve(pos), 1)
            )
          );

          if (isVisible(element)) {
            element.scrollIntoView();
          }
        },
        this.elementRef.current || undefined
      );
    } catch (_err) {
      // querySelector 在哈希以数字开头或包含句点时会抛出错误。
      // 现在通过 safeSlugify 进行了保护，但之前的链接可能仍然存在。
      Logger.debug("editor", `Attempted to scroll to invalid hash: ${hash}`);
    }
  }

  /**
   * 获取编辑器的内容值。
   *
   * @param asString - 是否以字符串形式返回（默认为 true），否则返回 JSON 对象。
   * @param trim - 是否修剪内容的前后空白。
   * @returns 编辑器内容的字符串或 JSON 表示。
   */
  public value = (asString = true, trim?: boolean) => {
    if (asString) {
      const content = this.serializer.serialize(this.view.state.doc);
      return trim ? content.trim() : content;
    }

    return (
      trim ? ProsemirrorHelper.trim(this.view.state.doc) : this.view.state.doc
    ).toJSON();
  };

  /**
   * 计算并更新文本方向（RTL 或 LTR）。
   */
  private calculateDir = () => {
    if (!this.elementRef.current) {
      return;
    }

    const isRTL =
      this.props.dir === "rtl" ||
      getComputedStyle(this.elementRef.current).direction === "rtl";

    if (this.state.isRTL !== isRTL) {
      this.setState({ isRTL });
    }
  };

  /**
   * 将编辑器光标聚焦到内容的开头。
   */
  public focusAtStart = () => {
    const selection = Selection.atStart(this.view.state.doc);
    const transaction = this.view.state.tr.setSelection(selection);
    this.view.dispatch(transaction);
    this.view.focus();
  };

  /**
   * 将编辑器光标聚焦到内容的末尾。
   */
  public focusAtEnd = () => {
    const selection = Selection.atEnd(this.view.state.doc);
    const transaction = this.view.state.tr.setSelection(selection);
    this.view.dispatch(transaction);
    this.view.focus();
  };

  /**
   * 聚焦编辑器并滚动到当前选区。
   */
  public focus = () => {
    this.view.focus();
    this.view.dispatch(this.view.state.tr.scrollIntoView());
  };

  /**
   * 使编辑器失去焦点。
   */
  public blur = () => {
    (this.view.dom as HTMLElement).blur();

    // Safari 需要手动移除光标
    window?.getSelection()?.removeAllRanges();
  };

  /**
   * 在编辑器中插入内容，替换当前选区所在的块。
   *
   * @param content - 要插入的 ProseMirror 数据。
   */
  public insertContent = (content: ProsemirrorData) => {
    const doc = ProsemirrorNode.fromJSON(this.schema, content);
    const { $from } = this.view.state.selection;
    const start = $from.before($from.depth);
    const end = $from.after($from.depth);
    this.view.dispatch(this.view.state.tr.replaceWith(start, end, doc.content));
  };

  /**
   * 在当前选区插入文件。
   *
   * @param event - 源事件。
   * @param files - 要插入的文件列表。
   * @returns 如果文件被插入则返回 true。
   */
  public insertFiles = (
    event: React.ChangeEvent<HTMLInputElement>,
    files: File[]
  ) =>
    insertFiles(
      this.view,
      event,
      this.view.state.selection.to,
      files,
      this.props
    );

  /**
   * 如果编辑器的修剪内容为空字符串，则返回 true。
   *
   * @returns 如果编辑器为空则返回 true。
   */
  public isEmpty = () => ProsemirrorHelper.isEmpty(this.view.state.doc);

  /**
   * 返回当前编辑器中的标题列表。
   *
   * @returns 文档中的标题列表。
   */
  public getHeadings = () => ProsemirrorHelper.getHeadings(this.view.state.doc);

  /**
   * 返回当前编辑器中的图片列表。
   *
   * @returns 文档中的图片列表。
   */
  public getImages = () => ProsemirrorHelper.getImages(this.view.state.doc);

  /**
   * 获取当前编辑器中可用于灯箱显示的图片列表。
   *
   * @returns 灯箱图片对象数组。
   */
  public getLightboxImages = (): LightboxImage[] => {
    const lightboxNodes = ProsemirrorHelper.getLightboxNodes(
      this.view.state.doc
    );

    return map(lightboxNodes, (node) =>
      LightboxImageFactory.createLightboxImage(this.view, node.pos)
    );
  };

  /**
   * 返回当前编辑器中的任务/复选框列表。
   *
   * @returns 文档中的任务列表。
   */
  public getTasks = () => ProsemirrorHelper.getTasks(this.view.state.doc);

  /**
   * 返回当前编辑器中的评论列表。
   *
   * @returns 文档中的评论列表。
   */
  public getComments = () => ProsemirrorHelper.getComments(this.view.state.doc);

  /**
   * 从文档中删除与特定评论相关的所有标记。
   *
   * @param commentId - 要删除的评论 ID。
   */
  public removeComment = (commentId: string) => {
    const { state, dispatch } = this.view;
    const tr = state.tr;

    state.doc.descendants((node, pos) => {
      const mark = node.marks.find(
        (m) => m.type === state.schema.marks.comment && m.attrs.id === commentId
      );

      if (mark) {
        tr.removeMark(pos, pos + node.nodeSize, mark);
        return;
      }

      if (isArray(node.attrs?.marks)) {
        const existingMarks = node.attrs.marks as ProsemirrorMark[];
        const updatedMarks = existingMarks.filter(
          (mark) => mark.attrs?.id !== commentId
        );
        const attrs = {
          ...node.attrs,
          marks: updatedMarks,
        };
        tr.setNodeMarkup(pos, undefined, attrs);
      }
    });

    dispatch(tr);
  };

  /**
   * 更新文档中与特定评论相关的所有标记。
   *
   * @param commentId - 要更新的评论 ID。
   * @param attrs - 要更新的属性。
   */
  public updateComment = (
    commentId: string,
    attrs: { resolved?: boolean; draft?: boolean }
  ) => {
    const { state, dispatch } = this.view;
    const tr = state.tr;

    state.doc.descendants((node, pos) => {
      const mark = node.marks.find(
        (m) => m.type === state.schema.marks.comment && m.attrs.id === commentId
      );

      if (mark) {
        const from = pos;
        const to = pos + node.nodeSize;
        const newMark = state.schema.marks.comment.create({
          ...mark.attrs,
          ...attrs,
        });
        tr.removeMark(from, to, mark).addMark(from, to, newMark);
        return;
      }

      if (isArray(node.attrs?.marks)) {
        const existingMarks = node.attrs.marks as ProsemirrorMark[];
        const updatedMarks = existingMarks.map((mark) =>
          mark.type === "comment" && mark.attrs?.id === commentId
            ? { ...mark, attrs: { ...mark.attrs, ...attrs } }
            : mark
        );
        const newAttrs = {
          ...node.attrs,
          marks: updatedMarks,
        };
        tr.setNodeMarkup(pos, undefined, newAttrs);
      }
    });

    dispatch(tr);
  };

  /**
   * 更新当前在灯箱中显示的图片。
   *
   * @param activeImage - 要显示的图片对象，或 null 表示关闭灯箱。
   */
  public updateActiveLightboxImage = (activeImage: LightboxImage | null) => {
    this.setState((state) => ({
      ...state,
      activeLightboxImage: activeImage,
    }));
  };

  /**
   * 更新当前独立阅读态中显示的 PDF。
   *
   * @param activePdfDocument - 要显示的 PDF，或 null 表示关闭。
   */
  public updateActivePdfDocument = (
    activePdfDocument: ActivePdfDocument | null
  ) => {
    this.setState((state) => ({
      ...state,
      activePdfDocument,
    }));
  };

  /**
   * 返回当前编辑器的纯文本内容。
   *
   * @returns 文本字符串。
   */
  public getPlainText = () => {
    const { doc } = this.view.state;

    return textBetween(doc, 0, doc.content.size);
  };

  /**
   * 当主题发生变化时分发事件到编辑器。
   *
   * @param event - 包含主题详情的自定义事件。
   */
  private dispatchThemeChanged = (event: CustomEvent) => {
    this.view.dispatch(this.view.state.tr.setMeta("theme", event.detail));
  };

  /**
   * 处理编辑器内容变化，调用 onChange 回调。
   */
  private handleChange = () => {
    if (!this.props.onChange) {
      return;
    }

    this.props.onChange((asString = true, trim = false) =>
      this.view ? this.value(asString, trim) : undefined
    );
  };

  /**
   * 处理编辑器初始化完成，确保 onInit 回调只被调用一次。
   */
  private handleEditorInit = () => {
    if (!this.props.onInit || this.isInitialized) {
      return;
    }

    this.props.onInit();
    this.isInitialized = true;
  };

  /**
   * 处理编辑器销毁，调用 onDestroy 回调。
   */
  private handleEditorDestroy = () => {
    if (!this.props.onDestroy) {
      return;
    }
    this.props.onDestroy();
  };

  /**
   * 处理编辑器失去焦点事件。
   *
   * @returns false 表示不阻止默认行为。
   */
  private handleEditorBlur = () => {
    this.setState({ isEditorFocused: false });
    return false;
  };

  /**
   * 处理编辑器获得焦点事件。
   *
   * @returns false 表示不阻止默认行为。
   */
  private handleEditorFocus = () => {
    this.setState({ isEditorFocused: true });
    return false;
  };

  /**
   * 关闭 PDF 阅读态并尽量将焦点恢复到原始附件节点。
   */
  private handlePdfViewerClose = () => {
    const { activePdfDocument } = this.state;
    this.updateActivePdfDocument(null);

    if (!activePdfDocument) {
      this.view.focus();
      return;
    }

    const node = this.view.state.doc.nodeAt(activePdfDocument.pos);

    if (node && NodeSelection.isSelectable(node)) {
      const transaction = this.view.state.tr
        .setSelection(NodeSelection.create(this.view.state.doc, activePdfDocument.pos))
        .scrollIntoView();
      this.view.dispatch(transaction);
    }

    this.view.focus();
  };

  /**
   * 渲染编辑器组件，包括编辑器容器、小部件和灯箱。
   *
   * @returns 编辑器的 React 元素。
   */
  public render() {
    const { readOnly, canUpdate, grow, style, className, onKeyDown } =
      this.props;
    const { isRTL } = this.state;

    return (
      <PortalContext.Provider value={this.wrapperRef.current}>
        <EditorContext.Provider value={this}>
          <Flex
            ref={this.wrapperRef}
            onKeyDown={onKeyDown}
            style={style}
            className={className}
            align="flex-start"
            justify="center"
            column
          >
            <EditorContainer
              $rtl={isRTL}
              grow={grow}
              readOnly={readOnly}
              readOnlyWriteCheckboxes={canUpdate}
              focusedCommentId={this.props.focusedCommentId}
              userId={this.props.userId}
              editorStyle={this.props.editorStyle}
              commenting={!!this.props.onClickCommentMark}
              ref={this.elementRef}
              lang={this.props.lang ?? ""}
            />

            {this.widgets &&
              !this.props.cacheOnly &&
              Object.values(this.widgets).map((Widget, index) => (
                <Widget
                  key={String(index)}
                  rtl={isRTL}
                  readOnly={readOnly}
                  selection={this.view.state.selection}
                />
              ))}
            <Observer>
              {() => (
                <>{Array.from(this.renderers).map((view) => view.content)}</>
              )}
            </Observer>
          </Flex>
          {!isNull(this.state.activeLightboxImage) && (
            <Lightbox
              readOnly={readOnly}
              images={this.getLightboxImages()}
              activeImage={this.state.activeLightboxImage}
              onUpdate={this.updateActiveLightboxImage}
              onClose={this.view.focus.bind(this.view)}
            />
          )}
          {!isNull(this.state.activePdfDocument) && (
            <React.Suspense fallback={null}>
              <PdfViewerDialog
                document={this.state.activePdfDocument}
                onRequestClose={this.handlePdfViewerClose}
                readOnly={readOnly || canUpdate === false}
                userId={this.props.userId}
              />
            </React.Suspense>
          )}
        </EditorContext.Provider>
      </PortalContext.Provider>
    );
  }
}

const EditorContainer = styled(Styles)<{
  userId?: string;
  focusedCommentId?: string;
}>`
  ${(props) =>
    props.focusedCommentId &&
    css`
      span#comment-${props.focusedCommentId} {
        background: ${transparentize(0.5, props.theme.brand.marine)};
        text-decoration: underline 2px ${props.theme.commentMarkBackground};

        * {
          background: transparent !important;
        }
      }
      a#comment-${props.focusedCommentId}
        ~ span.component-image
        div.image-wrapper {
        outline: ${props.theme.commentedImageOutlineDark} solid 2px;
      }
    `}

  ${(props) =>
    props.userId &&
    css`
      .mention[data-id="${props.userId}"] {
        color: ${props.theme.textHighlightForeground};
        background: ${props.theme.textHighlight};

        &.ProseMirror-selectednode {
          outline-color: ${props.readOnly
            ? "transparent"
            : darken(0.2, props.theme.textHighlight)};
        }
      }
    `}
`;

/**
 * 懒加载的编辑器组件，包装了主题提供者。
 */
const LazyLoadedEditor = React.forwardRef<Editor, Props>(
  function LazyLoadedEditor_(props: Props, ref) {
    return (
      <WithTheme>
        {(theme) => <Editor theme={theme} {...props} ref={ref} />}
      </WithTheme>
    );
  }
);

/**
 * 观察 DOM 变化，当匹配选择器的元素出现时执行回调。
 *
 * @param selector - CSS 选择器。
 * @param callback - 当元素出现时执行的回调函数。
 * @param targetNode - 要观察的目标节点，默认为 document.body。
 * @returns MutationObserver 实例。
 */
const observe = (
  selector: string,
  callback: (element: HTMLElement) => void,
  targetNode = document.body
) => {
  const observer = new MutationObserver((mutations) => {
    // 查找匹配选择器的新增节点
    const match = [...mutations]
      .flatMap((mutation) => [...mutation.addedNodes])
      .find((node: HTMLElement) => node.matches?.(selector));
    if (match) {
      callback(match as HTMLElement);
    }
  });

  // 如果元素已经存在，立即执行回调
  if (targetNode.querySelector(selector)) {
    callback(targetNode.querySelector(selector) as HTMLElement);
  } else {
    // 否则开始观察 DOM 变化
    observer.observe(targetNode, { childList: true, subtree: true });
  }

  return observer;
};

export default LazyLoadedEditor;
