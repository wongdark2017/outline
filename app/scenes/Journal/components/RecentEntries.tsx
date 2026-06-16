import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import Subheading from "~/components/Subheading";
import type JournalEntry from "~/models/JournalEntry";

type Props = {
  entries: JournalEntry[];
};

/**
 * Lists recent Journal entries with links to their backing documents.
 *
 * @param props - recent Journal entries to render.
 * @returns a compact list of recent entries.
 */
function RecentEntries({ entries }: Props) {
  const { t } = useTranslation();

  if (entries.length === 0) {
    return null;
  }

  return (
    <section>
      <Subheading>{t("Recent entries")}</Subheading>
      <List>
        {entries.map((entry) =>
          entry.document ? (
            <Item key={entry.id}>
              <EntryLink to={entry.document.url}>
                <DateText>{entry.date}</DateText>
                <Title>{entry.document.title || t("Untitled")}</Title>
              </EntryLink>
            </Item>
          ) : null
        )}
      </List>
    </section>
  );
}

const List = styled.ul`
  display: grid;
  gap: 4px;
  list-style: none;
  margin: 0;
  padding: 0;
`;

const Item = styled.li`
  min-width: 0;
`;

const EntryLink = styled(Link)`
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 36px;
  border-radius: 6px;
  color: ${s("text")};
  padding: 4px 8px;
  text-decoration: none;

  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const DateText = styled.span`
  color: ${s("textTertiary")};
  font-size: 12px;
  line-height: 1.4;
`;

const Title = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export default RecentEntries;
