import { OpenIcon } from "outline-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { ResizeBottomRight } from "./ResizeHandle";
import type { ComponentProps } from "../types";
import Flex from "../../components/Flex";
import { s } from "../../styles";
import { Preview, Subtitle, Title } from "./Widget";
import { EditorStyleHelper } from "../styles/EditorStyleHelper";

type Props = ComponentProps & {
  /** Icon to display on the left side of the widget */
  icon: React.ReactNode;
  /** Title of the widget */
  title: React.ReactNode;
  /** Context, displayed to right of title */
  context?: React.ReactNode;
  /** Callback triggered when the pdf is resized */
  onChangeSize?: (props: { width: number; height?: number }) => void;
  /** Callback triggered when opening the standalone reader */
  onOpen?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

interface Size {
  width: number;
  height: number;
}

interface DragStart {
  pointerX: number;
  pointerY: number;
  width: number;
  height: number;
  maxWidth: number;
}

const defaultWidth = 300;
const defaultHeight = 424;
const minWidth = 160;
const aspectRatio = defaultHeight / defaultWidth;

function readCssWidthInPixels(value: string, element: HTMLElement) {
  const width = value.trim();

  if (!width) {
    return NaN;
  }

  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.inlineSize = width;
  probe.style.blockSize = "0";
  probe.style.overflow = "hidden";
  element.appendChild(probe);

  const measuredWidth = probe.getBoundingClientRect().width;
  element.removeChild(probe);

  return measuredWidth;
}

function getMaxWidth(element: HTMLDivElement | null) {
  if (!element) {
    return Infinity;
  }

  const documentWidth = readCssWidthInPixels(
    getComputedStyle(element).getPropertyValue("--document-width"),
    element
  );
  const editorWidth =
    element.closest(".ProseMirror")?.getBoundingClientRect().width ?? NaN;
  const widths: number[] = [];

  if (Number.isFinite(documentWidth) && documentWidth > 0) {
    widths.push(documentWidth);
  }

  if (Number.isFinite(editorWidth) && editorWidth > 0) {
    widths.push(editorWidth);
  }

  if (!widths.length) {
    return Infinity;
  }

  return Math.max(minWidth, Math.min(...widths) - EditorStyleHelper.padding * 2);
}

function constrainWidth(width: number, maxWidth: number) {
  const resolvedMinWidth = Math.min(minWidth, maxWidth);

  return Math.round(Math.min(maxWidth, Math.max(width, resolvedMinWidth)));
}

export default function PdfViewer(props: Props) {
  const { node, isEditable, onChangeSize, isSelected, title } = props;
  const { t } = useTranslation();
  const { href } = node.attrs;
  const pdfSrc = typeof href === "string" && href ? href : undefined;
  const titleText = typeof title === "string" ? title : undefined;
  const ref = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<DragStart>();
  const [dragging, setDragging] = useState(false);
  const [size, setSizeState] = useState<Size>(() => {
    const width =
      typeof node.attrs.width === "number" ? node.attrs.width : defaultWidth;
    const height =
      typeof node.attrs.height === "number"
        ? node.attrs.height
        : Math.round(width * aspectRatio);

    return { width, height };
  });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const setSize = useCallback((nextSize: Size) => {
    sizeRef.current = nextSize;
    setSizeState(nextSize);
  }, []);

  useEffect(() => {
    if (typeof node.attrs.width !== "number") {
      return;
    }

    const nextSize = {
      width: node.attrs.width,
      height:
        typeof node.attrs.height === "number"
          ? node.attrs.height
          : Math.round(node.attrs.width * aspectRatio),
    };

    const currentSize = sizeRef.current;

    if (
      nextSize.width === currentSize.width &&
      nextSize.height === currentSize.height
    ) {
      return;
    }

    setSize(nextSize);
  }, [node.attrs.height, node.attrs.width, setSize]);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const maxWidth = getMaxWidth(ref.current);
      const currentSize = sizeRef.current;

      dragStartRef.current = {
        pointerX: event.pageX,
        pointerY: event.pageY,
        width: constrainWidth(currentSize.width, maxWidth),
        height: currentSize.height,
        maxWidth,
      };
      setDragging(true);
    },
    []
  );

  const handleResizePointerMove = useCallback(
    (event: PointerEvent) => {
      event.preventDefault();

      const dragStart = dragStartRef.current;

      if (!dragStart) {
        return;
      }

      const diffX = event.pageX - dragStart.pointerX;
      const diffY = event.pageY - dragStart.pointerY;
      const widthDeltaFromHeight = diffY / aspectRatio;
      const widthDelta =
        diffX > 0 || widthDeltaFromHeight > 0
          ? Math.max(diffX, widthDeltaFromHeight)
          : Math.min(diffX, widthDeltaFromHeight);
      const nextWidth = constrainWidth(
        dragStart.width + widthDelta,
        dragStart.maxWidth
      );
      const nextSize = {
        width: nextWidth,
        height: Math.round(nextWidth * aspectRatio),
      };

      setSize(nextSize);
    },
    [setSize]
  );

  const handleResizePointerUp = useCallback(
    (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();

      dragStartRef.current = undefined;
      setDragging(false);
      onChangeSize?.(sizeRef.current);
    },
    [onChangeSize]
  );

  const handleResizeKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const dragStart = dragStartRef.current;

      if (event.key !== "Escape" || !dragStart) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setSize({
        width: dragStart.width,
        height: dragStart.height,
      });
      dragStartRef.current = undefined;
      setDragging(false);
    },
    [setSize]
  );

  useEffect(() => {
    if (!dragging) {
      return;
    }

    document.body.style.cursor = "nwse-resize";
    document.addEventListener("keydown", handleResizeKeyDown);
    document.addEventListener("pointermove", handleResizePointerMove);
    document.addEventListener("pointerup", handleResizePointerUp);

    return () => {
      document.body.style.cursor = "initial";
      document.removeEventListener("keydown", handleResizeKeyDown);
      document.removeEventListener("pointermove", handleResizePointerMove);
      document.removeEventListener("pointerup", handleResizePointerUp);
    };
  }, [
    dragging,
    handleResizeKeyDown,
    handleResizePointerMove,
    handleResizePointerUp,
  ]);

  return (
    <PDFWrapper
      contentEditable={false}
      ref={ref}
      className={
        isSelected || dragging
          ? "pdf-wrapper ProseMirror-selectednode"
          : "pdf-wrapper"
      }
      style={{ width: size.width }}
      $dragging={dragging}
    >
      <Flex gap={6} align="center">
        {props.icon}
        <Preview>
          <Title>{title}</Title>
          <Subtitle>{props.context}</Subtitle>
        </Preview>
        {pdfSrc && props.onOpen && (
          <OpenButton
            type="button"
            aria-label={t("Open")}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={props.onOpen}
          >
            <OpenIcon size={18} />
          </OpenButton>
        )}
      </Flex>
      {pdfSrc && (
        <ViewerFrame
          key={pdfSrc}
          aria-label={titleText}
          style={{
            height: size.height,
            pointerEvents:
              !isEditable || (isSelected && !dragging) ? "auto" : "none",
          }}
        >
          <embed
            title={titleText}
            src={pdfSrc}
            type="application/pdf"
            style={{
              height: "100%",
              width: "100%",
              display: "block",
              pointerEvents:
                !isEditable || (isSelected && !dragging) ? "auto" : "none",
            }}
          />
        </ViewerFrame>
      )}
      {isEditable && !!props.onChangeSize && (
        <ResizeBottomRight
          onPointerDown={handleResizePointerDown}
          $dragging={isSelected || dragging}
        />
      )}
    </PDFWrapper>
  );
}

const ViewerFrame = styled.div`
  height: 100%;
  line-height: normal;
  margin-top: 6px;
  overflow: hidden;
  border-radius: ${EditorStyleHelper.blockRadius};
`;

const OpenButton = styled.button`
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: ${s("textSecondary")};
  cursor: var(--pointer);

  &:hover {
    background: ${s("backgroundSecondary")};
    color: ${s("text")};
  }
`;

const PDFWrapper = styled.div<{ $dragging: boolean }>`
  line-height: 0;
  position: relative;
  margin-left: 0;
  margin-right: auto;
  max-width: 100%;
  transition-property: width, height;
  transition-duration: 120ms;
  transition-timing-function: ease-in-out;
  overflow: visible;
  will-change: ${(props) => (props.$dragging ? "width, height" : "auto")};
  box-shadow: 0 0 0 1px ${s("divider")};
  border-radius: ${EditorStyleHelper.blockRadius};
  padding: ${EditorStyleHelper.blockRadius};

  ${ViewerFrame} {
    transition-property: width, height;
    transition-duration: 120ms;
    transition-timing-function: ease-in-out;
    will-change: ${(props) => (props.$dragging ? "width, height" : "auto")};
  }

  &:hover {
    ${ResizeBottomRight} {
      opacity: 1;
    }
  }
`;
