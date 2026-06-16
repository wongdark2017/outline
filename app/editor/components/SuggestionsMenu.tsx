/**
 * 建议菜单组件
 *
 * 这是一个通用的建议菜单组件，用于在编辑器中显示各种类型的建议项。
 * 支持键盘导航、搜索过滤、子菜单、文件上传等功能。
 * 在移动端显示为抽屉（Drawer），在桌面端显示为弹出框（Popover）。
 *
 * 主要功能：
 * - 支持键盘导航（上下箭头、Tab、Enter、Escape）
 * - 支持搜索和过滤菜单项
 * - 支持嵌套子菜单
 * - 支持文件上传（图片、视频、附件）
 * - 支持嵌入链接输入
 * - 响应式设计（移动端和桌面端不同的 UI）
 */
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import commandScore from "command-score";
import { capitalize, orderBy } from "es-toolkit/compat";
import { TextSelection } from "prosemirror-state";
import * as React from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled, { keyframes } from "styled-components";
import insertFiles from "@shared/editor/commands/insertFiles";
import type { UploadFileResult } from "@shared/editor/commands/insertFiles";
import { EmbedDescriptor } from "@shared/editor/embeds";
import filterExcessSeparators from "@shared/editor/lib/filterExcessSeparators";
import { findParentNode } from "@shared/editor/queries/findParentNode";
import type { MenuItem } from "@shared/editor/types";
import { s } from "@shared/styles";
import { getEventFiles } from "@shared/utils/files";
import { AttachmentValidation } from "@shared/validations";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "~/components/primitives/Drawer";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "~/components/primitives/Popover";
import { MouseSafeArea } from "~/components/MouseSafeArea";
import Scrollable from "~/components/Scrollable";
import useMobile from "~/hooks/useMobile";
import Logger from "~/utils/Logger";
import { useEditor } from "./EditorContext";
import Input from "./Input";
import { MenuHeader } from "~/components/primitives/components/Menu";

/**
 * 建议菜单组件的属性类型
 *
 * @template T - 菜单项类型，必须继承自 MenuItem
 */
export type Props<T extends MenuItem = MenuItem> = {
  /** 是否为从右到左的文本方向 */
  rtl: boolean;
  /** 菜单是否处于激活状态 */
  isActive: boolean;
  /** 当前的搜索文本 */
  search: string;
  /** 触发菜单的字符（或字符列表） */
  trigger: string | string[];
  /** 文件上传函数，返回上传结果 */
  uploadFile?: (file: File) => Promise<UploadFileResult>;
  /** 文件上传开始时的回调 */
  onFileUploadStart?: () => void;
  /** 文件上传结束时的回调 */
  onFileUploadStop?: () => void;
  /** 文件上传进度回调 */
  onFileUploadProgress?: (id: string, fractionComplete: number) => void;
  /** 菜单关闭时的回调 */
  onClose: (insertNewLine?: boolean) => void;
  /** 选择建议项时的可选回调 */
  onSelect?: (item: MenuItem) => void;
  /** 可嵌入的服务描述符列表 */
  embeds?: EmbedDescriptor[];
  /** 渲染单个菜单项的函数 */
  renderMenuItem: (
    item: T,
    index: number,
    options: {
      selected: boolean;
      disclosure?: boolean;
      onClick: (event: React.SyntheticEvent) => void;
    }
  ) => React.ReactNode;
  /** 是否可以过滤菜单项 */
  filterable?: boolean;
  /** 菜单项列表 */
  items: T[];
};

/**
 * 建议菜单组件
 *
 * 渲染一个可搜索、可导航的建议菜单，支持嵌套子菜单和文件上传。
 *
 * @template T - 菜单项类型
 * @param props - 组件属性.
 * @returns 渲染的建议菜单组件.
 */
function SuggestionsMenu<T extends MenuItem>(props: Props<T>) {
  const { view, commands, props: editorProps } = useEditor();
  const { t } = useTranslation();
  const isMobile = useMobile();

  // 跟踪鼠标指针位置，用于检测真实的鼠标移动（避免 Safari 的虚假 pointermove 事件）
  const pointerRef = React.useRef<{ clientX: number; clientY: number }>({
    clientX: 0,
    clientY: 0,
  });

  // 文件输入元素的引用，用于触发文件选择器
  const inputRef = React.useRef<HTMLInputElement>(null);

  // 标记文件选择器是否已打开，防止重复触发
  const filePickerOpenRef = React.useRef(false);

  // 保存编辑器选择位置，用于在移动端恢复选择
  const selectionRef = React.useRef<{ from: number; to: number } | null>(null);

  // 当前要插入的项（用于嵌入链接输入）
  const [insertItem, setInsertItem] = React.useState<
    MenuItem | EmbedDescriptor
  >();

  // 当前选中的菜单项索引
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  // 子菜单状态：包含父项索引、子项列表和选中的子项索引
  const [submenu, setSubmenu] = React.useState<{
    index: number;
    items: MenuItem[];
    selectedIndex: number;
  } | null>(null);

  // 存储每个菜单项的 DOM 元素引用，用于定位子菜单
  const itemRefs = React.useRef<Map<number, HTMLElement>>(new Map());

  // 子菜单内容的引用
  const submenuContentRef = React.useRef<HTMLDivElement>(null);

  // 悬停定时器，用于延迟打开子菜单
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout>>();

  // 存储光标位置的矩形区域，在菜单打开时快照
  const caretRectRef = React.useRef(new DOMRect());

  // 稳定的虚拟元素，用于 Radix PopoverAnchor
  // 永不替换，避免 popper 触发不必要的锚点变化循环
  const caretRef = React.useRef({
    getBoundingClientRect: () => caretRectRef.current,
  });

  // 计算并存储光标矩形区域
  // 在渲染期间计算，以便在 Radix popper 效果首次运行之前可用
  const caretRect = React.useMemo(() => {
    if (!props.isActive) {
      return new DOMRect();
    }

    try {
      const { selection } = view.state;
      const fromPos = view.coordsAtPos(selection.from);
      const toPos = view.coordsAtPos(selection.to, -1);
      const top = Math.min(fromPos.top, toPos.top);
      const bottom = Math.max(fromPos.bottom, toPos.bottom);
      const left = Math.min(fromPos.left, toPos.left);
      const right = Math.max(fromPos.right, toPos.right);
      return new DOMRect(left, top, right - left, bottom - top);
    } catch (err) {
      Logger.warn("Unable to calculate caret position", err);
      return new DOMRect();
    }
  }, [props.isActive, view]);

  caretRectRef.current = caretRect;

  /**
   * 解析菜单项的子项
   *
   * 子项可以是数组或返回数组的函数，此函数统一处理这两种情况。
   *
   * @param children - 子项数组或返回子项数组的函数.
   * @returns 解析后的子项数组.
   */
  const resolveChildren = (
    children: MenuItem["children"]
  ): MenuItem[] | undefined =>
    typeof children === "function" ? children() : children;

  // 当菜单激活时，保存选择位置
  // 在移动端，点击菜单项时编辑器可能会失去焦点/选择，因此需要恢复
  // 位置必须随着搜索文本的增长保持最新，否则 handleClearSearch 中计算的删除范围会出错
  React.useEffect(() => {
    if (props.isActive) {
      requestAnimationFrame(() => {
        const { from, to } = view.state.selection;
        selectionRef.current = { from, to };
      });
    } else {
      selectionRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.isActive, props.search]);

  // 当菜单激活状态改变时，重置状态
  React.useEffect(() => {
    setSubmenu(null);

    if (!props.isActive) {
      return;
    }

    setSelectedIndex(0);
    setInsertItem(undefined);
  }, [props.isActive]);

  // 当搜索文本改变时，重置选中索引和子菜单
  React.useEffect(() => {
    setSelectedIndex(0);
    setSubmenu(null);
  }, [props.search]);

  /**
   * 清除搜索文本
   *
   * 从编辑器中删除触发字符和搜索文本。
   */
  const handleClearSearch = React.useCallback(() => {
    const { state, dispatch } = view;
    const selection =
      isMobile && selectionRef.current ? selectionRef.current : state.selection;
    const triggers = Array.isArray(props.trigger)
      ? props.trigger
      : [props.trigger];
    const triggerLength = triggers[0].length;
    const poss = state.doc.cut(
      selection.from - (props.search ?? "").length - triggerLength,
      selection.from
    );
    const trimTrigger = triggers.some((t) => poss.textContent.startsWith(t));

    if (!props.search && !trimTrigger) {
      return;
    }

    // 清除搜索输入
    dispatch(
      state.tr.insertText(
        "",
        Math.max(
          0,
          selection.from -
            (props.search ?? "").length -
            (trimTrigger ? triggerLength : 0)
        ),
        selection.to
      )
    );
  }, [props.search, props.trigger, view, isMobile]);

  /**
   * 恢复编辑器选择
   *
   * 在移动端，当抽屉打开或点击菜单项时，编辑器选择可能会丢失。
   * 此函数恢复保存的选择位置。
   */
  const restoreSelection = React.useCallback(() => {
    if (!isMobile) {
      return;
    }

    if (selectionRef.current) {
      const { from, to } = selectionRef.current;
      const { tr, doc } = view.state;
      const selection = TextSelection.create(doc, from, to);
      view.dispatch(tr.setSelection(selection));

      // 点击后重新聚焦编辑器
      requestAnimationFrame(() => view.focus());
    }
  }, [isMobile, view]);

  /**
   * 插入节点到编辑器
   *
   * 根据菜单项类型执行相应的命令，将内容插入到编辑器中。
   *
   * @param item - 要插入的菜单项或嵌入描述符.
   */
  const insertNode = React.useCallback(
    (item: MenuItem | EmbedDescriptor) => {
      restoreSelection();
      handleClearSearch();

      const command = item.name ? commands[item.name] : undefined;
      const attrs =
        typeof item.attrs === "function" ? item.attrs(view.state) : item.attrs;

      if (item.name === "noop") {
        if ("onClick" in item) {
          item.onClick?.();
        }
      } else if (command) {
        command(attrs);
      } else {
        commands[`create${capitalize(item.name)}`](attrs);
      }
      if ("appendSpace" in item) {
        const { dispatch } = view;
        dispatch(view.state.tr.insertText(" "));
      }

      props.onClose();
    },
    [commands, handleClearSearch, props, restoreSelection, view]
  );

  /**
   * 处理菜单项点击事件
   *
   * 根据菜单项类型执行不同的操作：
   * - link: 创建提及并触发链接创建
   * - image/video/attachment: 触发文件选择器
   * - embed: 触发链接输入
   * - 其他: 直接插入节点
   *
   * @param item - 被点击的菜单项.
   * @param event - 可选的事件对象.
   */
  const handleClickItem = React.useCallback(
    (item, event?: Event | React.SyntheticEvent) => {
      if (item.disabled) {
        return;
      }

      props.onSelect?.(item);

      switch (item.name) {
        case "link":
          insertNode({
            ...item,
            name: "mention",
          });
          void editorProps.onCreateLink?.(
            {
              title: item.attrs.label,
              id: item.attrs.modelId,
            },
            !!item.attrs.nested
          );
          return;
        case "image":
          event?.preventDefault();
          event?.stopPropagation();
          return triggerFilePick(
            AttachmentValidation.imageContentTypes.join(", "),
            item.attrs
          );
        case "video":
          event?.preventDefault();
          event?.stopPropagation();
          return triggerFilePick("video/*", item.attrs);
        case "attachment":
          event?.preventDefault();
          event?.stopPropagation();
          return triggerFilePick(item.attrs?.accept ?? "*", item.attrs);
        case "embed":
          return triggerLinkInput(item);
        default:
          insertNode(item);
      }
    },
    [editorProps, props, insertNode]
  );

  /**
   * 关闭菜单并重新聚焦编辑器
   */
  const close = React.useCallback(() => {
    props.onClose();
    view.focus();
  }, [props, view]);

  /**
   * 处理链接输入框的键盘事件
   *
   * - Enter: 验证并插入嵌入链接
   * - Escape: 关闭菜单
   *
   * @param event - 键盘事件.
   */
  const handleLinkInputKeydown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (!props.isActive) {
      return;
    }
    if (!insertItem) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();

      const href = event.currentTarget.value;
      const matches = "matcher" in insertItem && insertItem.matcher(href);

      if (!matches) {
        toast.error(t("Sorry, that link won’t work for this embed type"));
        return;
      }

      insertNode({
        name: "embed",
        attrs: {
          href,
        },
      });
    }

    if (event.key === "Escape") {
      props.onClose();
      view.focus();
    }
  };

  /**
   * 处理链接输入框的粘贴事件
   *
   * 如果粘贴的链接匹配嵌入类型，自动插入。
   *
   * @param event - 粘贴事件.
   */
  const handleLinkInputPaste = (
    event: React.ClipboardEvent<HTMLInputElement>
  ) => {
    if (!props.isActive) {
      return;
    }
    if (!insertItem) {
      return;
    }

    const href = event.clipboardData.getData("text/plain");
    const matches = "matcher" in insertItem && insertItem.matcher(href);

    if (matches) {
      event.preventDefault();
      event.stopPropagation();

      insertNode({
        name: "embed",
        attrs: {
          href,
        },
      });
    }
  };

  /**
   * 触发文件选择器
   *
   * 打开系统文件选择对话框，允许用户选择文件上传。
   *
   * @param accept - 接受的文件类型（MIME 类型）.
   * @param attrs - 附加到文件的属性.
   */
  const triggerFilePick = (accept: string, attrs?: Record<string, unknown>) => {
    if (filePickerOpenRef.current) {
      return;
    }

    if (inputRef.current) {
      window.addEventListener(
        "focus",
        () => {
          filePickerOpenRef.current = false;
        },
        { once: true }
      );

      filePickerOpenRef.current = true;
      inputRef.current.accept = accept || "*";
      inputRef.current.dataset.attrs = attrs ? JSON.stringify(attrs) : "";
      inputRef.current.click();
    }
  };

  /**
   * 触发链接输入模式
   *
   * 切换到链接输入界面，允许用户输入嵌入链接。
   *
   * @param item - 要插入的菜单项.
   */
  const triggerLinkInput = (item: MenuItem) => {
    setInsertItem(item);
  };

  /**
   * 处理文件选择事件
   *
   * 当用户通过文件选择器选择文件后，将文件上传并插入到编辑器中。
   *
   * @param event - 文件输入变化事件.
   */
  const handleFilesPicked = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    filePickerOpenRef.current = false;
    restoreSelection();

    const {
      uploadFile,
      onFileUploadStart,
      onFileUploadStop,
      onFileUploadProgress,
    } = props;
    const files = getEventFiles(event);
    if (!files.length) {
      if (inputRef.current) {
        inputRef.current.value = "";
        inputRef.current.dataset.attrs = "";
      }
      props.onClose();
      return;
    }

    const parent = findParentNode((node) => !!node)(view.state.selection);
    const attrs = event.currentTarget.dataset.attrs
      ? JSON.parse(event.currentTarget.dataset.attrs)
      : undefined;

    handleClearSearch();

    if (!uploadFile) {
      throw new Error("uploadFile prop is required to replace files");
    }

    if (parent) {
      await insertFiles(view, event, parent.pos, files, {
        uploadFile,
        onFileUploadStart,
        onFileUploadStop,
        onFileUploadProgress,
        isAttachment: inputRef.current?.accept === "*",
        attrs,
      });
    }

    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.dataset.attrs = "";
    }

    props.onClose();
  };

  /**
   * 过滤和排序菜单项
   *
   * 根据搜索文本过滤菜单项，并按优先级和匹配分数排序。
   * 处理嵌入项、子菜单展开、隐藏项等逻辑。
   *
   * @returns 过滤和排序后的菜单项列表.
   */
  const filtered = React.useMemo(() => {
    const { embeds = [], search = "", uploadFile, filterable = true } = props;
    let items: (EmbedDescriptor | MenuItem)[] = [...props.items];
    const embedItems: EmbedDescriptor[] = [];

    // 添加嵌入项到菜单
    for (const embed of embeds) {
      if (embed.title && embed.visible !== false && !embed.disabled) {
        embedItems.push(
          new EmbedDescriptor(Object.assign({}, embed, { name: "embed" }))
        );
      }
    }

    if (embedItems.length) {
      items = items.concat(
        {
          name: "separator",
        },
        embedItems
      );
    }

    const searchInput = search.toLowerCase();

    // 检查菜单项是否匹配搜索文本
    const matchesSearch = (item: MenuItem | EmbedDescriptor) =>
      (item.name || "").toLocaleLowerCase().includes(searchInput) ||
      (item.title || "").toLocaleLowerCase().includes(searchInput) ||
      (item.keywords || "").toLocaleLowerCase().includes(searchInput);

    // 搜索时，将匹配的子项展平到顶层列表，以便可以直接用键盘导航
    // 如果所有子项都匹配，则排除父项，因为它是冗余的
    const fullyFlattenedParents = new Set<MenuItem | EmbedDescriptor>();
    if (search && filterable) {
      const flattened: (EmbedDescriptor | MenuItem)[] = [];
      for (const item of items) {
        if ("children" in item && item.children) {
          const children = resolveChildren(item.children);
          if (children) {
            const matching = children.filter(matchesSearch);
            if (matching.length > 0) {
              for (const child of matching) {
                const { children: _, ...flat } = child;
                flattened.push(flat);
              }
              if (matching.length === children.length) {
                fullyFlattenedParents.add(item);
              }
            }
          }
        }
      }
      items = items.concat(flattened);
    }

    // 过滤菜单项
    const filtered = items.filter((item) => {
      if (item.name === "separator") {
        return true;
      }

      if (fullyFlattenedParents.has(item)) {
        return false;
      }

      if (item.visible === false) {
        return false;
      }

      // 某些扩展可能被禁用，移除相应的菜单项
      if (
        item.name &&
        !commands[item.name] &&
        !commands[`create${capitalize(item.name)}`] &&
        item.name !== "noop"
      ) {
        return false;
      }

      // 如果没有传递图片上传回调，过滤掉图片块
      if (!uploadFile && item.name === "image") {
        return false;
      }

      // 某些项（defaultHidden）在没有搜索查询时不可见
      if (!search) {
        return !item.defaultHidden;
      }

      if (!filterable) {
        return item;
      }

      return matchesSearch(item);
    });

    // 按分区、优先级和匹配分数排序，并移除多余的分隔符
    return filterExcessSeparators(
      orderBy(
        filtered.map((item) => ({
          item,
          section:
            "section" in item && item.section && "priority" in item.section
              ? ((item.section.priority as number) ?? 0)
              : 0,
          priority: "priority" in item ? item.priority : 0,
          score:
            searchInput && item.title
              ? commandScore(item.title, searchInput)
              : 0,
        })),
        ["section", "priority", "score"],
        ["desc", "desc", "desc"]
      ).map(({ item }) => item)
    );
  }, [commands, props]);

  /**
   * 打开子菜单
   *
   * 显示指定菜单项的子菜单，并选中第一个可选择的子项。
   *
   * @param index - 父菜单项的索引.
   */
  const openSubmenu = React.useCallback(
    (index: number) => {
      const item = filtered[index];
      if (!item) {
        return;
      }
      const children = resolveChildren(
        "children" in item ? item.children : undefined
      );
      if (!children?.length) {
        return;
      }

      // 过滤掉不可见的子项和多余的分隔符
      const normalized = filterExcessSeparators(
        children.filter((child) => child.visible !== false)
      );
      // 找到第一个可选择的子项（非分隔符且未禁用）
      const firstSelectable = normalized.findIndex(
        (child) =>
          child.name !== "separator" && !("disabled" in child && child.disabled)
      );
      if (firstSelectable === -1) {
        return;
      }

      setSubmenu({
        index,
        items: normalized,
        selectedIndex: firstSelectable,
      });
    },
    [filtered]
  );

  /**
   * 键盘导航事件处理
   *
   * 处理所有键盘快捷键：
   * - 上下箭头/Tab: 在菜单项之间导航
   * - Enter: 选择当前项或打开子菜单
   * - 左右箭头: 打开/关闭子菜单
   * - Escape: 关闭菜单或子菜单
   * - Ctrl+N/P: Emacs 风格的上下导航
   */
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) {
        return;
      }
      if (!props.isActive) {
        return;
      }

      // 让链接输入框自己的处理器管理导航键
      if (insertItem) {
        return;
      }

      // --- 子菜单打开时：将按键路由到子菜单 ---
      if (submenu) {
        if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
          event.preventDefault();
          event.stopPropagation();
          const total = submenu.items.length - 1;
          let next = submenu.selectedIndex + 1;
          // 跳过分隔符和禁用项
          while (next <= total) {
            const child = submenu.items[next];
            if (
              child?.name !== "separator" &&
              !("disabled" in child && child.disabled)
            ) {
              break;
            }
            next++;
          }
          if (next <= total) {
            setSubmenu((s) => (s ? { ...s, selectedIndex: next } : s));
          }
          return;
        }

        if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
          event.preventDefault();
          event.stopPropagation();
          let prev = submenu.selectedIndex - 1;
          // 跳过分隔符和禁用项
          while (prev >= 0) {
            const child = submenu.items[prev];
            if (
              child?.name !== "separator" &&
              !("disabled" in child && child.disabled)
            ) {
              break;
            }
            prev--;
          }
          if (prev >= 0) {
            setSubmenu((s) => (s ? { ...s, selectedIndex: prev } : s));
          }
          return;
        }

        if (event.key === "ArrowLeft" || event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setSubmenu(null);
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          const child = submenu.items[submenu.selectedIndex];
          if (child) {
            handleClickItem(child, event);
            setSubmenu(null);
          }
          return;
        }
        return;
      }

      // --- 正常模式（无子菜单） ---
      if (event.key === "Enter") {
        event.preventDefault();

        const item = filtered[selectedIndex];

        if (item) {
          const children = resolveChildren(
            "children" in item ? item.children : undefined
          );
          if (children?.length) {
            openSubmenu(selectedIndex);
          } else {
            handleClickItem(item, event);
          }
        } else {
          props.onClose(true);
        }
      }

      if (event.key === "ArrowRight") {
        const item = filtered[selectedIndex];
        if (item) {
          const children = resolveChildren(
            "children" in item ? item.children : undefined
          );
          if (children?.length) {
            event.preventDefault();
            event.stopPropagation();
            openSubmenu(selectedIndex);
            return;
          }
        }
      }

      if (
        event.key === "ArrowUp" ||
        (event.key === "Tab" && event.shiftKey) ||
        (event.ctrlKey && event.key === "p")
      ) {
        event.preventDefault();
        event.stopPropagation();

        if (filtered.length) {
          let prevIndex = selectedIndex - 1;
          // 跳过分隔符和禁用项
          while (prevIndex >= 0) {
            const item = filtered[prevIndex];
            if (
              item?.name !== "separator" &&
              !("disabled" in item && item.disabled)
            ) {
              break;
            }
            prevIndex--;
          }
          if (prevIndex >= 0) {
            setSelectedIndex(prevIndex);
          }
        } else {
          close();
        }
      }

      if (
        event.key === "ArrowDown" ||
        (event.key === "Tab" && !event.shiftKey) ||
        (event.ctrlKey && event.key === "n")
      ) {
        event.preventDefault();
        event.stopPropagation();

        if (filtered.length) {
          const total = filtered.length - 1;
          let nextIndex = selectedIndex + 1;
          // 跳过分隔符和禁用项
          while (nextIndex <= total) {
            const item = filtered[nextIndex];
            if (
              item?.name !== "separator" &&
              !("disabled" in item && item.disabled)
            ) {
              break;
            }
            nextIndex++;
          }
          if (nextIndex <= total) {
            setSelectedIndex(nextIndex);
          }
        } else {
          close();
        }
      }

      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };

    window.addEventListener("keydown", handleKeyDown, {
      capture: true,
    });

    return () => {
      window.removeEventListener("keydown", handleKeyDown, {
        capture: true,
      });
    };
  }, [
    close,
    filtered,
    handleClickItem,
    insertItem,
    openSubmenu,
    props,
    selectedIndex,
    submenu,
  ]);

  const { isActive, uploadFile } = props;
  const items = filtered;

  /**
   * 处理弹出框打开状态变化
   *
   * @param open - 是否打开.
   */
  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) {
        close();
      }
    },
    [close]
  );

  // 文件上传输入元素（视觉上隐藏）
  const fileInput = uploadFile && (
    <VisuallyHidden.Root>
      <label>
        <Trans>Upload file</Trans>
        <input
          type="file"
          ref={inputRef}
          onChange={handleFilesPicked}
          multiple
        />
      </label>
    </VisuallyHidden.Root>
  );

  // 当父选择移开触发器时关闭子菜单
  React.useEffect(() => {
    if (submenu && submenu.index !== selectedIndex) {
      setSubmenu(null);
    }
  }, [selectedIndex, submenu]);

  // 卸载时清理悬停定时器
  React.useEffect(
    () => () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
      filePickerOpenRef.current = false;
    },
    []
  );

  /**
   * 渲染菜单项列表
   *
   * 处理分隔符、分组标题、子菜单指示器和空状态。
   *
   * @returns 渲染的菜单项列表.
   */
  const renderItems = () => {
    let prevHeading: string | undefined;

    return (
      <>
        {items.map((item, index) => {
          // 渲染分隔符
          if (item.name === "separator") {
            return (
              <ListItem key={index}>
                <hr />
              </ListItem>
            );
          }

          if (!item.title) {
            return null;
          }

          const hasChildren = !!(
            "children" in item && resolveChildren(item.children)?.length
          );

          // 处理鼠标移动事件
          const handlePointerMove = (ev: React.PointerEvent) => {
            if (
              !("disabled" in item && item.disabled) &&
              selectedIndex !== index &&
              // Safari 在指针未移动时会触发相同坐标的 pointermove
              // 这会导致菜单选择在指针悬停但未移动时闪烁
              (pointerRef.current.clientX !== ev.clientX ||
                pointerRef.current.clientY !== ev.clientY)
            ) {
              setSelectedIndex(index);
            }
            pointerRef.current = {
              clientX: ev.clientX,
              clientY: ev.clientY,
            };

            // 悬停延迟打开子菜单
            if (hasChildren) {
              if (hoverTimerRef.current) {
                clearTimeout(hoverTimerRef.current);
              }
              hoverTimerRef.current = setTimeout(() => {
                openSubmenu(index);
              }, 150);
            } else {
              // 悬停普通项时关闭子菜单
              if (hoverTimerRef.current) {
                clearTimeout(hoverTimerRef.current);
              }
              setSubmenu(null);
            }
          };

          const handlePointerDown = () => {
            if (
              !("disabled" in item && item.disabled) &&
              selectedIndex !== index
            ) {
              setSelectedIndex(index);
            }
          };

          const handleOnClick = (ev: React.MouseEvent) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (hasChildren) {
              openSubmenu(index);
            } else {
              handleClickItem(item, ev);
            }
          };

          const currentHeading =
            "section" in item ? item.section?.({ t }) : undefined;

          const itemRef = (node: HTMLElement | null) => {
            if (node) {
              itemRefs.current.set(index, node);
            } else {
              itemRefs.current.delete(index);
            }
          };

          const response = (
            <React.Fragment key={`${index}-${item.name}`}>
              {/* 渲染分组标题 */}
              {currentHeading !== prevHeading && (
                <MenuHeader key={currentHeading}>{currentHeading}</MenuHeader>
              )}
              <ListItem
                ref={itemRef}
                onPointerMove={handlePointerMove}
                onPointerDown={handlePointerDown}
              >
                {props.renderMenuItem(item as unknown as T, index, {
                  selected: index === selectedIndex,
                  disclosure: hasChildren,
                  onClick: handleOnClick,
                })}
              </ListItem>
            </React.Fragment>
          );

          prevHeading = currentHeading;
          return response;
        })}
        {/* 空状态 */}
        {items.length === 0 && (
          <ListItem>
            <Empty>{t("No results")}</Empty>
          </ListItem>
        )}
      </>
    );
  };

  // 移动端渲染：使用抽屉（Drawer）
  if (isMobile) {
    return (
      <>
        <Drawer open={isActive} onOpenChange={handleOpenChange}>
          <DrawerContent aria-describedby={undefined}>
            <DrawerTitle hidden>
              {Array.isArray(props.trigger) ? props.trigger[0] : props.trigger}
            </DrawerTitle>
            <MobileScrollable hiddenScrollbars>
              {insertItem ? (
                // 链接输入模式
                <LinkInputWrapper>
                  <LinkInput
                    type="text"
                    placeholder={
                      "placeholder" in insertItem && !!insertItem.placeholder
                        ? insertItem.placeholder
                        : insertItem.title
                          ? t("Paste a {{service}} link…", {
                              service: insertItem.title,
                            })
                          : `${t("Paste a link")}…`
                    }
                    onKeyDown={handleLinkInputKeydown}
                    onPaste={handleLinkInputPaste}
                    autoFocus
                  />
                </LinkInputWrapper>
              ) : (
                // 菜单列表模式
                <List>{renderItems()}</List>
              )}
            </MobileScrollable>
          </DrawerContent>
        </Drawer>
        {fileInput}
      </>
    );
  }

  // 桌面端渲染：使用弹出框（Popover）
  return (
    <>
      <Popover open={isActive} onOpenChange={handleOpenChange} modal={false}>
        <PopoverAnchor virtualRef={caretRef} />
        <BouncyPopoverContent
          side="bottom"
          align="start"
          width={280}
          shrink
          style={{
            padding: 0,
            maxHeight:
              "min(324px, var(--radix-popover-content-available-height))",
          }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // 防止点击子菜单时关闭主菜单
            if (submenuContentRef.current?.contains(e.target as Node)) {
              e.preventDefault();
            }
          }}
        >
          {insertItem ? (
            // 链接输入模式
            <LinkInputWrapper>
              <LinkInput
                type="text"
                placeholder={
                  "placeholder" in insertItem && !!insertItem.placeholder
                    ? insertItem.placeholder
                    : insertItem.title
                      ? t("Paste a {{service}} link…", {
                          service: insertItem.title,
                        })
                      : `${t("Paste a link")}…`
                }
                onKeyDown={handleLinkInputKeydown}
                onPaste={handleLinkInputPaste}
                autoFocus
              />
            </LinkInputWrapper>
          ) : (
            // 菜单列表模式
            <List>{renderItems()}</List>
          )}
        </BouncyPopoverContent>
      </Popover>
      {fileInput}
      {/* 子菜单弹出框 */}
      {submenu && itemRefs.current.get(submenu.index) && (
        <Popover open modal={false}>
          <PopoverAnchor
            virtualRef={{
              current: {
                getBoundingClientRect: () =>
                  itemRefs.current.get(submenu.index)!.getBoundingClientRect(),
              },
            }}
          />
          <SubmenuPopoverContent
            ref={submenuContentRef}
            side="right"
            align="start"
            sideOffset={0}
            width={220}
            shrink
            style={{ padding: 0 }}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onPointerLeave={() => setSubmenu(null)}
          >
            {/* 鼠标安全区域：防止鼠标移动到子菜单时意外关闭 */}
            <MouseSafeArea parentRef={submenuContentRef} />
            <List>
              {submenu.items.map((child, childIndex) => {
                if (child.name === "separator") {
                  return (
                    <ListItem key={childIndex}>
                      <hr />
                    </ListItem>
                  );
                }
                if (!child.title) {
                  return null;
                }

                const handleChildPointerMove = (ev: React.PointerEvent) => {
                  if (
                    submenu.selectedIndex !== childIndex &&
                    (pointerRef.current.clientX !== ev.clientX ||
                      pointerRef.current.clientY !== ev.clientY)
                  ) {
                    setSubmenu((s) =>
                      s ? { ...s, selectedIndex: childIndex } : s
                    );
                  }
                  pointerRef.current = {
                    clientX: ev.clientX,
                    clientY: ev.clientY,
                  };
                };

                const handleChildClick = (ev: React.MouseEvent) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  handleClickItem(child, ev);
                  setSubmenu(null);
                };

                return (
                  <ListItem
                    key={`sub-${childIndex}-${child.name}`}
                    onPointerMove={handleChildPointerMove}
                  >
                    {props.renderMenuItem(child as unknown as T, childIndex, {
                      selected: childIndex === submenu.selectedIndex,
                      onClick: handleChildClick,
                    })}
                  </ListItem>
                );
              })}
            </List>
          </SubmenuPopoverContent>
        </Popover>
      )}
    </>
  );
}

/**
 * 弹跳淡入动画
 *
 * 菜单打开时的动画效果，从缩小状态弹跳到正常大小。
 */
const bouncyFadeIn = keyframes`
  from {
    opacity: 0;
    transform: scale(0.95);
  }
`;

/**
 * 带弹跳动画的弹出框内容
 *
 * 在打开时应用弹跳淡入动画。
 */
const BouncyPopoverContent = styled(PopoverContent)`
  &[data-state="open"] {
    animation: ${bouncyFadeIn} 150ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }
`;

/**
 * 子菜单弹出框内容
 *
 * 限制最大高度以适应可用空间。
 */
const SubmenuPopoverContent = styled(PopoverContent)`
  max-height: min(324px, var(--radix-popover-content-available-height));
`;

/**
 * 链接输入包装器
 *
 * 为链接输入框提供外边距。
 */
const LinkInputWrapper = styled.div`
  margin: 8px;
`;

/**
 * 链接输入框
 *
 * 用于输入嵌入链接的输入框。
 */
const LinkInput = styled(Input)`
  height: 32px;
  width: 100%;
  color: ${s("textSecondary")};
`;

/**
 * 菜单列表
 *
 * 无序列表样式，用于显示菜单项。
 */
const List = styled.ol`
  list-style: none;
  text-align: left;
  height: 100%;
  padding: 6px;
  margin: 0;
  white-space: nowrap;

  hr {
    border: 0;
    height: 0;
    border-top: 1px solid ${s("divider")};
  }
`;

/**
 * 列表项
 *
 * 单个菜单项的容器。
 */
const ListItem = styled.li`
  padding: 0;
  margin: 0;
`;

/**
 * 空状态
 *
 * 当没有匹配的菜单项时显示。
 */
const Empty = styled.div`
  display: flex;
  align-items: center;
  color: ${s("textSecondary")};
  font-weight: 500;
  font-size: 14px;
  height: 32px;
  padding: 0 16px;
`;

/**
 * 移动端可滚动容器
 *
 * 限制移动端菜单的最大高度。
 */
const MobileScrollable = styled(Scrollable)`
  max-height: 75vh;
`;

export default SuggestionsMenu;
