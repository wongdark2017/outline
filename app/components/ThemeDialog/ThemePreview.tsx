import * as React from "react";
import styled, { ThemeProvider } from "styled-components";
import { buildDarkTheme, buildLightTheme } from "@shared/styles/theme";
import type { ThemeTokens } from "@shared/styles/themeTokens";
import {
  applyThemeTokens,
  sanitizeThemeTokens,
} from "@shared/styles/themeTokens";

interface Props {
  /** Which appearance to preview. */
  mode: "light" | "dark";
  /** The colors being edited, invalid values are ignored. */
  tokens: ThemeTokens;
}

/**
 * A miniature, non-interactive app layout rendered with the given colors, so
 * the editor can show a theme without applying it to the whole interface.
 */
export function ThemePreview({ mode, tokens }: Props) {
  const theme = React.useMemo(() => {
    const safe = sanitizeThemeTokens(tokens);
    const input = safe.accent ? { accent: safe.accent } : {};
    const base =
      mode === "dark" ? buildDarkTheme(input) : buildLightTheme(input);

    return applyThemeTokens(base, safe);
  }, [mode, tokens]);

  return (
    <ThemeProvider theme={theme}>
      <Frame aria-hidden>
        <Sidebar>
          <SidebarItem>Home</SidebarItem>
          <SidebarItem $active>Engineering</SidebarItem>
          <SidebarItem>Product</SidebarItem>
        </Sidebar>
        <Main>
          <Title>Release notes</Title>
          <Body>
            Secondary text with a <Link>link</Link> and a{" "}
            <Mention>@mention</Mention>.
          </Body>
          <Code>const answer = 42;</Code>
          <Notice>Tip: notices use their own background.</Notice>
          <Buttons>
            <PrimaryButton>Publish</PrimaryButton>
            <NeutralButton>Cancel</NeutralButton>
          </Buttons>
        </Main>
      </Frame>
    </ThemeProvider>
  );
}

const Frame = styled.div`
  display: flex;
  height: 280px;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 8px;
  overflow: hidden;
  background: ${(props) => props.theme.background};
  font-size: 13px;
`;

const Sidebar = styled.div`
  width: 140px;
  padding: 12px 8px;
  background: ${(props) => props.theme.sidebarBackground};
`;

const SidebarItem = styled.div<{ $active?: boolean }>`
  padding: 4px 8px;
  border-radius: 4px;
  color: ${(props) => props.theme.sidebarText};
  background: ${(props) =>
    props.$active ? props.theme.sidebarActiveBackground : "transparent"};
`;

const Main = styled.div`
  flex: 1;
  padding: 16px 20px;
  color: ${(props) => props.theme.text};
`;

const Title = styled.div`
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
`;

const Body = styled.p`
  color: ${(props) => props.theme.textSecondary};
  margin: 0 0 8px;
`;

const Link = styled.span`
  color: ${(props) => props.theme.link};
  text-decoration: underline;
`;

const Mention = styled.span`
  padding: 0 4px;
  border-radius: 4px;
  background: ${(props) => props.theme.mentionBackground};
`;

const Code = styled.div`
  font-family: ${(props) => props.theme.fontFamilyMono};
  padding: 6px 8px;
  margin-bottom: 8px;
  border-radius: 4px;
  color: ${(props) => props.theme.code};
  background: ${(props) => props.theme.codeBackground};
  border: 1px solid ${(props) => props.theme.codeBorder};
`;

const Notice = styled.div`
  padding: 6px 8px;
  margin-bottom: 12px;
  border-radius: 4px;
  color: ${(props) => props.theme.noticeTipText};
  background: ${(props) => props.theme.noticeTipBackground};
`;

const Buttons = styled.div`
  display: flex;
  gap: 8px;
`;

const PrimaryButton = styled.div`
  padding: 4px 12px;
  border-radius: 4px;
  color: ${(props) => props.theme.accentText};
  background: ${(props) => props.theme.accent};
`;

const NeutralButton = styled.div`
  padding: 4px 12px;
  border-radius: 4px;
  color: ${(props) => props.theme.buttonNeutralText};
  background: ${(props) => props.theme.buttonNeutralBackground};
  border: 1px solid ${(props) => props.theme.buttonNeutralBorder};
`;
