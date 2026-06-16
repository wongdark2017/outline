import { DirectionProvider } from "@radix-ui/react-direction";
import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ThemeProvider } from "styled-components";
import GlobalStyles from "@shared/styles/globals";
import { TeamPreference, UserPreference } from "@shared/types";
import { isRTLLanguage } from "@shared/utils/rtl";
import useBuildTheme from "~/hooks/useBuildTheme";
import useStores from "~/hooks/useStores";

type Props = {
  children?: React.ReactNode;
};

/**
 * 主题提供者组件，负责管理应用的主题、文本方向和全局样式。
 *
 * 该组件会：
 * - 根据团队或系统配置构建主题
 * - 根据语言设置文本方向（RTL/LTR）
 * - 在主题变化时触发自定义事件，供编辑器元素（如 Mermaid 图表）使用
 * - 处理打印时的主题切换，确保打印输出使用浅色主题
 *
 * @param props - 组件属性。
 * @returns 包裹了主题和方向上下文的子组件。
 */
const Theme: React.FC = ({ children }: Props) => {
  const { auth, ui } = useStores();
  const { i18n } = useTranslation();
  const theme = useBuildTheme(
    auth.team?.getPreference(TeamPreference.CustomTheme) ||
      auth.config?.customTheme ||
      undefined
  );
  const direction = isRTLLanguage(i18n.language) ? "rtl" : "ltr";

  // 触发 theme-changed 事件，通知编辑器元素（如 Mermaid 图表）主题已变化。
  // 这些元素需要根据主题重新渲染以显示正确的颜色。
  React.useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("theme-changed", {
        detail: { isDark: ui.resolvedTheme === "dark" },
      })
    );
  }, [ui.resolvedTheme]);

  // 监听打印媒体查询，在打印对话框或打印预览时强制使用浅色主题。
  // 这是因为打印输出通常在白纸上，深色主题会浪费墨水且可读性差。
  React.useEffect(() => {
    const mediaQuery = window.matchMedia("print");
    const handleChange = (event: MediaQueryListEvent) => {
      window.dispatchEvent(
        new CustomEvent("theme-changed", {
          detail: {
            isDark: event.matches ? false : ui.resolvedTheme === "dark",
          },
        })
      );
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [ui.resolvedTheme]);

  return (
    <DirectionProvider dir={direction}>
      <ThemeProvider theme={theme}>
        <>
          <GlobalStyles
            useCursorPointer={
              // 未登录用户（公开分享）默认显示光标指针
              auth.user?.getPreference(UserPreference.UseCursorPointer) ?? true
            }
          />
          {children}
        </>
      </ThemeProvider>
    </DirectionProvider>
  );
};

export default observer(Theme);
