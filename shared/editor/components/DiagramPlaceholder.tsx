import { EditIcon } from "outline-icons";
import styled, { css } from "styled-components";
import type { ComponentProps } from "../types";
import { s } from "../../styles";
import { useTranslation } from "react-i18next";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";
import { ImageSource } from "../lib/FileHelper";
import Text from "../../components/Text";

type Props = ComponentProps & {
  /** Callback for double click event */
  onDoubleClick?: () => void;
};

export const DiagramPlaceholder = ({
  node,
  isSelected,
  isEditable,
  onDoubleClick,
}: Props) => {
  const { t } = useTranslation();
  const isExcalidraw = node.attrs.source === ImageSource.Excalidraw;
  const canEdit = !!onDoubleClick && (!isExcalidraw || isEditable);

  return (
    <Placeholder
      className={isSelected ? "ProseMirror-selectednode" : ""}
      onDoubleClick={canEdit ? onDoubleClick : undefined}
      $excalidraw={isExcalidraw}
      $editable={canEdit}
    >
      {isExcalidraw ? (
        <ExcalidrawLabel>
          {canEdit && <EditIcon size={20} aria-hidden />}
          {canEdit
            ? t("Double click to edit Excalidraw drawing")
            : t("Empty Excalidraw drawing")}
        </ExcalidrawLabel>
      ) : (
        <>
          <Text size="small" type="secondary" as="p">
            {t("Empty diagram")}
          </Text>{" "}
          <Text size="small" type="tertiary" italic>
            {t("Double click to edit")}
          </Text>
        </>
      )}
    </Placeholder>
  );
};

const Placeholder = styled.div<{ $excalidraw: boolean; $editable: boolean }>`
  border: 2px dashed ${s("inputBorder")};
  background: ${s("backgroundSecondary")};
  border-radius: ${EditorStyleHelper.blockRadius};
  padding: 16px;
  text-align: center;
  cursor: var(--pointer);

  ${(props) =>
    props.$excalidraw &&
    css`
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 80px;
      border-style: solid;
      cursor: ${props.$editable ? "var(--pointer)" : "default"};

      &.ProseMirror-selectednode {
        border-color: ${s("inputBorderFocused")};
      }
    `}
`;

const ExcalidrawLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: ${s("textSecondary")};
  font-size: 16px;
`;
