import { observer } from "mobx-react";
import { ArchiveIcon, EditIcon, TrashIcon } from "outline-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import type { ProsemirrorData } from "@shared/types";
import Attachment from "@shared/editor/nodes/Attachment";
import Image from "@shared/editor/nodes/Image";
import MemoTag from "@shared/editor/nodes/MemoTag";
import SimpleImage from "@shared/editor/nodes/SimpleImage";
import { basicExtensions } from "@shared/editor/nodes";
import { ProsemirrorHelper } from "@shared/utils/ProsemirrorHelper";
import Button from "~/components/Button";
import Editor from "~/components/Editor";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import NudeButton from "~/components/NudeButton";
import Scene from "~/components/Scene";
import Time from "~/components/Time";
import MemoTagMenuExtension from "~/editor/extensions/MemoTagMenu";
import useStores from "~/hooks/useStores";

const emptyDoc: ProsemirrorData = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

type ViewMode = "active" | "archived";

const memoExtensions = [
  ...basicExtensions.filter((extension) => extension !== SimpleImage),
  Image,
  Attachment,
  MemoTag,
  MemoTagMenuExtension,
];

function Memos() {
  const { memos } = useStores();
  const { t } = useTranslation();
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("active");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const draftRef = useRef<ProsemirrorData>(emptyDoc);
  const editingDraftRef = useRef<ProsemirrorData>(emptyDoc);

  useEffect(() => {
    void memos.fetchMemos();
  }, [memos]);

  const handleFetch = useCallback(
    async (params?: { archived?: boolean; tag?: string }) => {
      await memos.fetchMemos(params);
      setViewMode(params?.archived ? "archived" : "active");
    },
    [memos]
  );

  const handleCreate = useCallback(async () => {
    setIsSaving(true);
    try {
      if (ProsemirrorHelper.isEmptyData(draftRef.current)) {
        return;
      }

      await memos.createMemo(draftRef.current);
      draftRef.current = emptyDoc;
      setComposerKey((value) => value + 1);
      setViewMode("active");
    } finally {
      setIsSaving(false);
    }
  }, [draftRef, memos]);

  const handleShowActive = useCallback(() => {
    void handleFetch(memos.activeTag ? { tag: memos.activeTag } : undefined);
  }, [handleFetch, memos.activeTag]);

  const handleShowArchived = useCallback(() => {
    void handleFetch({
      archived: true,
      ...(memos.activeTag ? { tag: memos.activeTag } : undefined),
    });
  }, [handleFetch, memos.activeTag]);

  const handleTagClick = useCallback(
    (tag: string) => {
      void handleFetch({
        ...(viewMode === "archived" ? { archived: true } : undefined),
        tag,
      });
    },
    [handleFetch, viewMode]
  );

  const handleClearTag = useCallback(() => {
    void handleFetch(viewMode === "archived" ? { archived: true } : undefined);
  }, [handleFetch, viewMode]);

  const handleArchive = useCallback(
    async (id: string) => {
      await memos.archiveMemo(id);
    },
    [memos]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await memos.deleteMemo(id);
    },
    [memos]
  );

  const handleLoadMore = useCallback(() => {
    void memos.fetchMore();
  }, [memos]);

  const handleStartEdit = useCallback((id: string, content: ProsemirrorData) => {
    setEditingId(id);
    editingDraftRef.current = content;
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    editingDraftRef.current = emptyDoc;
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || ProsemirrorHelper.isEmptyData(editingDraftRef.current)) {
      return;
    }

    await memos.updateMemo(editingId, editingDraftRef.current);
    handleCancelEdit();
  }, [editingId, handleCancelEdit, memos]);

  const items = useMemo(
    () => (viewMode === "archived" ? memos.archivedMemos : memos.activeMemos),
    [memos.activeMemos, memos.archivedMemos, viewMode]
  );

  return (
    <Scene icon={<EditIcon />} title={t("Memos")}>
      <Heading>{t("Memos")}</Heading>
      <Composer>
        <Editor
          key={composerKey}
          extensions={memoExtensions}
          defaultValue={emptyDoc}
          placeholder={t("Capture a thought…")}
          onChange={(getValue) => {
            const value = getValue(false) as ProsemirrorData;
            draftRef.current = value;
          }}
          onClickLink={() => undefined}
          embeds={[]}
        />
        <ComposerActions>
          <Button onClick={handleCreate} disabled={isSaving}>
            {t("Save")}
          </Button>
        </ComposerActions>
      </Composer>

      <Toolbar align="center" gap={8} justify="space-between">
        <Flex gap={8}>
          <Button
            onClick={handleShowActive}
            neutral={viewMode !== "active" ? true : undefined}
            aria-pressed={viewMode === "active"}
          >
            {t("Timeline")}
          </Button>
          <Button
            onClick={handleShowArchived}
            neutral={viewMode !== "archived" ? true : undefined}
            aria-pressed={viewMode === "archived"}
          >
            {t("Archived")}
          </Button>
        </Flex>
        {memos.activeTag && (
          <Button onClick={handleClearTag} neutral>
            #{memos.activeTag}
          </Button>
        )}
      </Toolbar>

      <Timeline>
        {items.map((memo) => (
          <MemoCard key={memo.id}>
            <MemoMeta align="center" justify="space-between" gap={12}>
              <Time dateTime={memo.updatedAt} addSuffix shorten />
              <Flex gap={8}>
                {!memo.archivedAt && (
                  <NudeButton
                    aria-label={t("Edit memo")}
                    onClick={() => handleStartEdit(memo.id, memo.content)}
                  >
                    <EditIcon />
                  </NudeButton>
                )}
                {!memo.archivedAt && (
                  <NudeButton
                    aria-label={t("Archive memo")}
                    onClick={() => void handleArchive(memo.id)}
                  >
                    <ArchiveIcon />
                  </NudeButton>
                )}
                <NudeButton
                  aria-label={t("Delete memo")}
                  onClick={() => void handleDelete(memo.id)}
                >
                  <TrashIcon />
                </NudeButton>
              </Flex>
            </MemoMeta>
            {editingId === memo.id ? (
              <>
                <Editor
                  key={memo.id}
                  extensions={memoExtensions}
                  defaultValue={editingDraftRef.current}
                  placeholder={t("Capture a thought…")}
                  onChange={(getValue) => {
                    const value = getValue(false) as ProsemirrorData;
                    editingDraftRef.current = value;
                  }}
                  onClickLink={() => undefined}
                  embeds={[]}
                />
                <ComposerActions>
                  <Button onClick={handleCancelEdit} neutral>
                    {t("Cancel")}
                  </Button>
                  <Button onClick={() => void handleSaveEdit()}>
                    {t("Update")}
                  </Button>
                </ComposerActions>
              </>
            ) : (
              <Editor
                extensions={memoExtensions}
                defaultValue={memo.content}
                readOnly
                onClickLink={() => undefined}
                embeds={[]}
              />
            )}
            {memo.tags.length > 0 && (
              <Tags>
                {memo.tags.map((tag) => (
                  <Button key={tag} onClick={() => handleTagClick(tag)} neutral>
                    #{tag}
                  </Button>
                ))}
              </Tags>
            )}
          </MemoCard>
        ))}
      </Timeline>

      {memos.canLoadMore && (
        <LoadMore>
          <Button onClick={handleLoadMore} neutral>
            {t("Load more")}
          </Button>
        </LoadMore>
      )}
    </Scene>
  );
}

const Composer = styled.div`
  margin-bottom: 24px;
`;

const ComposerActions = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
`;

const Toolbar = styled(Flex)`
  margin-bottom: 16px;
`;

const Timeline = styled.div`
  display: grid;
  gap: 16px;
`;

const LoadMore = styled.div`
  display: flex;
  justify-content: center;
  margin-top: 20px;
`;

const MemoCard = styled.div`
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 8px;
  padding: 16px;
`;

const MemoMeta = styled(Flex)`
  margin-bottom: 12px;
`;

const Tags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
`;

export default observer(Memos);
