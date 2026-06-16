import * as Dialog from "@radix-ui/react-dialog";
import { observer } from "mobx-react";
import { CloseIcon, OpenIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import type { ActivePdfDocument } from "@shared/editor/lib/PdfDocument";
import { depths, s } from "@shared/styles";
import NudeButton from "~/components/NudeButton";
import { PdfJsViewer } from "./PdfViewer/PdfJsViewer";

export interface Props {
  document: ActivePdfDocument;
  onRequestClose: () => void;
  readOnly?: boolean;
  userId?: string;
}

function getViewerSrc(src: string) {
  try {
    const url = new URL(src, window.location.origin);

    if (
      url.origin === window.location.origin &&
      url.pathname === "/api/attachments.redirect"
    ) {
      const id = url.searchParams.get("id");

      if (id) {
        return `/api/attachments.file?id=${id}`;
      }
    }
  } catch (_err) {
    return src;
  }

  return src;
}

/**
 * PDF fullscreen reader backed by PDF.js in display-only mode.
 *
 * @param props - component props.
 * @returns PDF reader dialog.
 */
export const PdfViewerDialog = observer(
  ({ document, onRequestClose }: Props) => {
    const { t } = useTranslation();
    const viewerSrc = React.useMemo(
      () => getViewerSrc(document.src),
      [document.src]
    );
    const title = document.title || t("Untitled");

    return (
      <Dialog.Root open onOpenChange={(open) => !open && onRequestClose()}>
        <Dialog.Portal>
          <Overlay />
          <Content aria-describedby={undefined}>
            <ReaderSurface>
              <Header>
                <Dialog.Title asChild>
                  <Title title={title}>{title}</Title>
                </Dialog.Title>
                <Actions>
                  <ActionLink
                    href={document.src}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("Open")}
                  >
                    <OpenIcon />
                  </ActionLink>
                  <ActionButton
                    type="button"
                    onClick={onRequestClose}
                    aria-label={t("Close")}
                  >
                    <CloseIcon />
                  </ActionButton>
                </Actions>
              </Header>
              <ViewerContainer>
                <PdfJsViewer src={viewerSrc} title={title} />
              </ViewerContainer>
            </ReaderSurface>
          </Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
);

export default PdfViewerDialog;

const Overlay = styled(Dialog.Overlay)`
  position: fixed;
  inset: 0;
  background: ${(props) => props.theme.modalBackdrop};
  z-index: ${depths.overlay};
`;

const Content = styled(Dialog.Content)`
  position: fixed;
  inset: 0;
  z-index: ${depths.modal};
  outline: none;
`;

const ReaderSurface = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: ${s("background")};
`;

const Header = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid ${s("divider")};
  flex-shrink: 0;
`;

const Title = styled.div`
  min-width: 0;
  color: ${s("text")};
  font-size: 15px;
  font-weight: 600;
  line-height: 24px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
`;

const ActionButton = styled(NudeButton)`
  color: ${s("textSecondary")};

  &:hover {
    background: ${s("sidebarControlHoverBackground")};
    color: ${s("text")};
  }
`;

const ActionLink = styled.a`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  color: ${s("textSecondary")} !important;

  &:hover {
    background: ${s("sidebarControlHoverBackground")};
    color: ${s("text")} !important;
  }
`;

const ViewerContainer = styled.div`
  flex: 1;
  min-height: 0;
`;
