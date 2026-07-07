import { observer } from "mobx-react";
import { HashtagIcon } from "outline-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MenuItem } from "@shared/editor/types";
import SuggestionsMenu from "./SuggestionsMenu";
import SuggestionsMenuItem from "./SuggestionsMenuItem";
import useStores from "~/hooks/useStores";

type MemoTagItem = MenuItem & {
  title: string;
  subtitle?: string;
  attrs: {
    text: string;
  };
};

type Props = {
  rtl: boolean;
  isActive: boolean;
  search: string;
  trigger: string | string[];
  onClose: (insertNewLine?: boolean) => void;
};

function MemoTagMenu(props: Props) {
  const { memos } = useStores();
  const [tags, setTags] = useState<string[]>([]);
  const search = props.search ?? "";

  useEffect(() => {
    if (!props.isActive) {
      return;
    }

    void memos.fetchTags(search).then(setTags);
  }, [memos, props.isActive, search]);

  const normalizedSearch = search.trim().replace(/^#/, "");

  const items = useMemo(() => {
    const exactTag = normalizedSearch ? `#${normalizedSearch}` : undefined;
    const existing = new Set(tags.map((tag) => tag.toLowerCase()));
    const options: MemoTagItem[] = tags.map((tag) => ({
      name: "insertText",
      title: `#${tag}`,
      subtitle: "Use existing tag",
      icon: <HashtagIcon />,
      appendSpace: true,
      attrs: {
        text: `#${tag}`,
      },
    }));

    if (exactTag && !existing.has(normalizedSearch.toLowerCase())) {
      options.unshift({
        name: "insertText",
        title: exactTag,
        subtitle: "Create tag",
        icon: <HashtagIcon />,
        appendSpace: true,
        attrs: {
          text: exactTag,
        },
      });
    }

    return options.slice(0, 15);
  }, [normalizedSearch, tags]);

  const renderMenuItem = useCallback(
    (item: MemoTagItem, _index: number, options: Parameters<typeof SuggestionsMenuItem>[0]) => (
      <SuggestionsMenuItem
        {...options}
        title={item.title}
        subtitle={item.subtitle}
        icon={item.icon}
      />
    ),
    []
  );

  if (!items.length) {
    return null;
  }

  return (
    <SuggestionsMenu
      {...props}
      filterable={false}
      renderMenuItem={renderMenuItem}
      items={items}
    />
  );
}

export default observer(MemoTagMenu);
