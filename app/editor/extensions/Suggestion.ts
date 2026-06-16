/**
 * 建议扩展模块
 *
 * 提供了一个基础的建议菜单扩展类，用于实现各种自动完成功能。
 * 例如：块菜单（/命令）、表情符号菜单（:emoji）、提及菜单（@mention）等。
 *
 * 该扩展通过监听特定的触发字符，在用户输入时打开建议菜单，
 * 并使用正则表达式匹配搜索词，支持多语言字符（包括中日韩文字）。
 */
import { escapeRegExp } from "es-toolkit/compat";
import { action, observable } from "mobx";
import { InputRule } from "prosemirror-inputrules";
import type { NodeType, Schema } from "prosemirror-model";
import type { EditorState, Plugin } from "prosemirror-state";
import Extension from "@shared/editor/lib/Extension";
import { SuggestionsMenuPlugin } from "@shared/editor/plugins/SuggestionsMenuPlugin";
import { isInCode } from "@shared/editor/queries/isInCode";

/**
 * 建议扩展的配置选项
 *
 * 所有建议类型的扩展（块菜单、表情符号菜单、提及菜单等）共享的配置。
 */
export type SuggestionOptions = {
  /** 是否允许在代码块或行内代码中打开建议菜单 */
  enabledInCode: boolean;
  /** 触发建议菜单的字符（或字符列表），例如 "/" 或 "@" */
  trigger: string | string[];
  /** 是否允许搜索词中包含空格 */
  allowSpaces: boolean;
  /** 是否要求在触发字符后至少输入一个字符才打开菜单 */
  requireSearchTerm: boolean;
};

/**
 * 建议扩展基类
 *
 * 提供建议菜单的核心功能，包括触发检测、状态管理和输入规则。
 * 子类可以继承此类来实现特定类型的建议菜单（如命令、表情、提及等）。
 *
 * @template TOptions - 扩展选项类型，必须继承自 SuggestionOptions.
 */
export default class Suggestion<
  TOptions extends SuggestionOptions = SuggestionOptions,
> extends Extension<TOptions> {
  /**
   * 构造函数
   *
   * 初始化建议扩展，构建用于匹配触发字符和搜索词的正则表达式。
   * 该正则表达式支持多种语言字符，包括拉丁字母、中文、日文、韩文等。
   *
   * @param options - 扩展配置选项.
   */
  constructor(options: TOptions) {
    super(options);

    // 将触发字符标准化为数组格式
    const triggers = Array.isArray(this.options.trigger)
      ? this.options.trigger
      : [this.options.trigger];

    // 构建触发字符的正则模式
    // 单个触发字符：直接转义
    // 多个触发字符：使用非捕获组和或运算符 (?:a|b|c)
    const triggerPattern =
      triggers.length === 1
        ? escapeRegExp(triggers[0])
        : `(?:${triggers.map(escapeRegExp).join("|")})`;

    // 构建完整的匹配正则表达式
    // 匹配模式：[前置字符][触发字符][搜索词]
    // 前置字符：行首、空格、左括号或中日韩文字
    // 搜索词：字母、数字、标点符号，可选空格（根据配置）
    // 使用 Unicode 属性转义支持多语言字符
    this.openRegex = new RegExp(
      `(?:^|\\s|\\(|[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}])${triggerPattern}(${`[\\p{L}/\\p{M}\\d${
        this.options.allowSpaces ? "\\s{1}" : ""
      }\\.\\-–_]+`})${this.options.requireSearchTerm ? "" : "?"}$`,
      "u"
    );
  }

  /**
   * 获取 ProseMirror 插件列表
   *
   * 返回建议菜单插件，该插件负责监听编辑器状态并显示建议菜单。
   *
   * @returns ProseMirror 插件数组.
   */
  get plugins(): Plugin[] {
    return [new SuggestionsMenuPlugin(this.state, this.openRegex)];
  }

  /**
   * 键盘快捷键配置
   *
   * 定义空格键的行为：当建议菜单打开且不允许空格时，按空格键会关闭菜单。
   *
   * @returns 键盘快捷键映射对象.
   */
  keys() {
    return {
      Space: action(() => {
        // 如果菜单已打开且配置不允许空格，则关闭菜单
        if (this.state.open && !this.options.allowSpaces) {
          this.state.open = false;
        }
        // 返回 false 表示不阻止默认行为（仍然插入空格）
        return false;
      }),
    };
  }

  /**
   * 输入规则配置
   *
   * 定义当用户输入匹配触发模式时的行为。
   * 当检测到触发字符和搜索词时，会打开建议菜单并更新查询状态。
   *
   * @param _options - 节点类型和 schema 配置（未使用）.
   * @returns InputRule 数组.
   */
  inputRules = (_options: { type: NodeType; schema: Schema }) => [
    new InputRule(
      this.openRegex,
      action((state: EditorState, match: RegExpMatchArray) => {
        // 获取当前光标位置的父节点
        const { parent } = state.selection.$from;
        if (
          match &&
          // 只在段落或标题节点中触发
          (parent.type.name === "paragraph" ||
            parent.type.name === "heading") &&
          // 检查是否在代码中，以及是否允许在代码中使用
          (!isInCode(state) || this.options.enabledInCode)
        ) {
          // 如果匹配的字符串长度小于等于 2（触发字符 + 最多 1 个字符），打开菜单
          // 这样可以在用户刚输入触发字符时就显示菜单
          if (match[0].length <= 2) {
            this.state.open = true;
          }
          // 更新搜索查询词（正则表达式的第一个捕获组）
          this.state.query = match[1];
        }
        // 返回 null 表示不修改文档内容
        return null;
      })
    ),
  ];

  /** 用于匹配触发字符和搜索词的正则表达式 */
  protected openRegex: RegExp;

  /**
   * 建议菜单的状态
   *
   * 使用 MobX observable 使状态可观察，当状态变化时会自动触发 UI 更新。
   */
  protected state: {
    /** 建议菜单是否打开 */
    open: boolean;
    /** 当前的搜索查询词 */
    query: string;
  } = observable({
    open: false,
    query: "",
  });

  /**
   * 获取建议菜单是否打开
   *
   * @returns 菜单打开状态.
   */
  get isOpen(): boolean {
    return this.state.open;
  }
}
