import { Command } from "cmdk";
import {
  CheckmarkIcon,
  CloseIcon,
  ExpandedIcon,
  SearchIcon,
} from "outline-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { closeHistory } from "@shared/editor/lib/closeHistory";
import {
  codeLanguages,
  getFrequentCodeLanguages,
  getLabelForLanguage,
  searchCodeLanguages,
  type CodeLanguageMatch,
} from "@shared/editor/lib/code";
import { s } from "@shared/styles";
import { NativeInput } from "~/components/Input";
import NudeButton from "~/components/NudeButton";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "~/components/primitives/Drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/primitives/Popover";
import useMobile from "~/hooks/useMobile";
import { useEditor } from "./EditorContext";
import ToolbarButton from "./ToolbarButton";

interface CodeLanguagePickerProps {
  /** The language of the code block being edited. */
  language: string;
}

/**
 * Renders a searchable language selector for the active code block.
 *
 * @param props the current code block language.
 * @return the language trigger and its popover or mobile drawer.
 */
export function CodeLanguagePicker({ language }: CodeLanguagePickerProps) {
  const { commands, view } = useEditor();
  const { t } = useTranslation();
  const isMobile = useMobile();
  const currentLanguage = language === "mermaidjs" ? "mermaid" : language;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(currentLanguage);
  const inputRef = useRef<HTMLInputElement>(null);
  const frequent = useMemo(
    () => (open ? getFrequentCodeLanguages() : []),
    [open]
  );
  const results = useMemo(
    () => searchCodeLanguages(query, frequent),
    [query, frequent]
  );
  const frequentLanguages = frequent.filter(
    (value) => codeLanguages[value] && !codeLanguages[value].alias
  );
  const remainingLanguages = Object.entries(codeLanguages).filter(
    ([value, item]) => !item.alias && !frequentLanguages.includes(value)
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      setQuery("");
      setHighlighted(currentLanguage);
    },
    [currentLanguage]
  );

  const handleSelect = useCallback(
    (value: string) => {
      setOpen(false);
      if (value === currentLanguage) {
        return;
      }

      closeHistory(view);
      commands.code_block({ language: value });
      closeHistory(view);
    },
    [commands, currentLanguage, view]
  );

  const handleClear = useCallback(() => {
    setQuery("");
    inputRef.current?.focus();
  }, []);

  const handleCloseAutoFocus = useCallback(
    (event: Event) => {
      event.preventDefault();
      view.focus();
    },
    [view]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) {
        return;
      }

      // Capture before either overlay handles Escape so clearing keeps it open.
      event.preventDefault();
      event.stopPropagation();
      if (query) {
        setQuery("");
      } else {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [open, query]);

  const renderLanguage = ({
    value,
    label,
    labelMatch,
    keyword,
  }: CodeLanguageMatch) => (
    <Command.Item key={value} value={value} onSelect={handleSelect}>
      <OptionLabel>
        {labelMatch ? (
          <>
            {label.slice(0, labelMatch[0])}
            <strong>{label.slice(...labelMatch)}</strong>
            {label.slice(labelMatch[1])}
          </>
        ) : (
          label
        )}
      </OptionLabel>
      {keyword && <Keyword>{keyword}</Keyword>}
      <SelectionIndicator aria-hidden>
        {value === currentLanguage && <CheckmarkIcon size={18} />}
      </SelectionIndicator>
    </Command.Item>
  );

  const trigger = (
    <TriggerButton aria-label={t("Code language")}>
      <Label>{getLabelForLanguage(language)}</Label>
      <ExpandedIcon />
    </TriggerButton>
  );

  const list = (
    <StyledCommand
      $mobile={isMobile}
      data-code-language-picker
      shouldFilter={false}
      loop
      value={highlighted}
      onValueChange={setHighlighted}
      label={t("Code language")}
    >
      <SearchRow>
        <SearchIcon size={20} aria-hidden />
        <Command.Input
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          autoFocus={!isMobile}
          asChild
        >
          <NativeInput placeholder={t("Search language or extension")} />
        </Command.Input>
        {query && (
          <NudeButton
            aria-label={t("Clear search")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={handleClear}
          >
            <CloseIcon size={18} />
          </NudeButton>
        )}
      </SearchRow>
      <Command.List
        label={t("Code language")}
        onMouseDown={(event) => event.preventDefault()}
      >
        {query.trim() ? (
          results.length ? (
            results.map(renderLanguage)
          ) : (
            <EmptyState role="status">
              <div>
                {t("No languages match “{{ query }}”", { query: query.trim() })}
              </div>
              <EmptyHint>
                {t("Try a file extension, like py, yml or sh")}
              </EmptyHint>
            </EmptyState>
          )
        ) : (
          <>
            {frequentLanguages.length > 0 && (
              <Command.Group heading={t("Recently used")}>
                {frequentLanguages.map((value) =>
                  renderLanguage({ value, label: getLabelForLanguage(value) })
                )}
              </Command.Group>
            )}
            <Command.Group heading={t("All languages")}>
              {remainingLanguages.map(([value, item]) =>
                renderLanguage({ value, label: item.label })
              )}
            </Command.Group>
          </>
        )}
      </Command.List>
    </StyledCommand>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} autoFocus={false}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent
          data-code-language-picker
          aria-describedby={undefined}
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <DrawerTitle>{t("Code language")}</DrawerTitle>
          {list}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger>{trigger}</PopoverTrigger>
      <PopoverContent
        width={280}
        shrink
        scrollable={false}
        align="end"
        aria-label={t("Code language")}
        onCloseAutoFocus={handleCloseAutoFocus}
      >
        {list}
      </PopoverContent>
    </Popover>
  );
}

const TriggerButton = styled(ToolbarButton)`
  flex: 0 0 auto;
  white-space: nowrap;
`;

const Label = styled.span`
  font-size: 15px;
  font-weight: 500;
  color: ${s("text")};
`;

const Keyword = styled.span`
  color: ${s("textSecondary")};
  font-family: ${s("fontFamilyMono")};
  font-size: 12px;
`;

const StyledCommand = styled(Command)<{ $mobile: boolean }>`
  color: ${s("text")};
  outline: none;

  [cmdk-list] {
    max-height: ${({ $mobile }) =>
      $mobile
        ? "60dvh"
        : "min(360px, calc(var(--radix-popover-content-available-height, 480px) - 64px))"};
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px 6px;
    scroll-padding: 4px;
  }

  [cmdk-group-heading] {
    color: ${s("textSecondary")};
    font-size: 12px;
    padding: 8px;
  }

  [cmdk-group] + [cmdk-group] {
    margin-top: 4px;
    border-top: 1px solid ${s("divider")};
  }

  [cmdk-item] {
    display: flex;
    align-items: center;
    gap: 8px;
    height: ${({ $mobile }) => ($mobile ? 48 : 32)}px;
    padding: 0 8px;
    border-radius: 4px;
    cursor: var(--pointer);
    font-size: 14px;
  }

  [cmdk-item][data-selected="true"] {
    color: ${s("accentText")};
    background: ${s("accent")};

    ${Keyword} {
      color: inherit;
    }
  }

  [cmdk-input] {
    font-size: ${({ $mobile }) => ($mobile ? 16 : 14)}px;
    padding-inline: 0;
  }
`;

const SearchRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 8px;
  border-bottom: 1px solid ${s("divider")};
  color: ${s("textSecondary")};

  > svg,
  > button {
    flex-shrink: 0;
  }
`;

const OptionLabel = styled.span`
  flex: 1;
  min-width: 0;
`;

const SelectionIndicator = styled.span`
  display: inline-flex;
  width: 18px;
  flex-shrink: 0;
`;

const EmptyState = styled.div`
  padding: 20px 8px;
  font-size: 14px;
  overflow-wrap: anywhere;
`;

const EmptyHint = styled.div`
  margin-top: 6px;
  font-size: 12px;
  color: ${s("textSecondary")};
`;
