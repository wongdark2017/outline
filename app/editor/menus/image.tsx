import {
  TrashIcon,
  DownloadIcon,
  ReplaceIcon,
  AlignImageLeftIcon,
  AlignImageRightIcon,
  AlignImageCenterIcon,
  AlignFullWidthIcon,
  EditIcon,
  CommentIcon,
  LinkIcon,
} from "outline-icons";
import { NodeSelection } from "prosemirror-state";
import { isNodeActive } from "@shared/editor/queries/isNodeActive";
import { isInlineImageIcon } from "@shared/editor/components/Image";
import type { MenuItem, SelectionContext } from "@shared/editor/types";
import { metaDisplay } from "@shared/utils/keyboard";
import { ImageSource } from "@shared/editor/lib/FileHelper";
import Desktop from "~/utils/Desktop";
import { isMarkActive } from "@shared/editor/queries/isMarkActive";
import { t } from "i18next";

/**
 * Returns menu items for the image selection toolbar.
 *
 * @param ctx - the current selection context.
 * @param canComment - whether the user has permission to comment on the document.
 * @returns an array of menu items.
 */
export default function imageMenuItems(
  ctx: SelectionContext,
  canComment: boolean
): MenuItem[] {
  if (ctx.readOnly) {
    if (!canComment) {
      return [];
    }
    return [
      {
        name: "comment",
        tooltip: t("Comment"),
        label: t("Comment"),
        shortcut: `${metaDisplay}+⌥+M`,
        icon: <CommentIcon />,
      },
    ];
  }
  const { schema, state } = ctx;
  const isLeftAligned = isNodeActive(schema.nodes.image, {
    layoutClass: "left-50",
  });
  const isRightAligned = isNodeActive(schema.nodes.image, {
    layoutClass: "right-50",
  });
  const isFullWidthAligned = isNodeActive(schema.nodes.image, {
    layoutClass: "full-width",
  });
  const isDiagram = isNodeActive(schema.nodes.image, {
    source: ImageSource.DiagramsNet,
  });
  const isTikz = isNodeActive(schema.nodes.image, {
    source: ImageSource.Tikz,
  });
  const isExcalidraw = isNodeActive(schema.nodes.image, {
    source: ImageSource.Excalidraw,
  });
  const isEmptyDiagram = isNodeActive(schema.nodes.image, {
    source: ImageSource.DiagramsNet,
    src: "",
  });
  const isEmptyExcalidraw = isNodeActive(schema.nodes.image, {
    source: ImageSource.Excalidraw,
    src: "",
  });
  const isEmptyDrawing = (state: typeof ctx.state) =>
    isEmptyDiagram(state) || isEmptyExcalidraw(state);

  // Ordinary small images render as inline icons without alignment controls.
  const selectedNode =
    state.selection instanceof NodeSelection ? state.selection.node : undefined;
  const isInlineIcon =
    selectedNode?.type === schema.nodes.image &&
    isInlineImageIcon({
      layoutClass: selectedNode.attrs.layoutClass,
      width: selectedNode.attrs.width,
      source: selectedNode.attrs.source,
    });

  return [
    {
      name: "alignLeft",
      tooltip: t("Align left"),
      icon: <AlignImageLeftIcon />,
      active: isLeftAligned,
      visible: !isEmptyDrawing(state) && !isInlineIcon,
    },
    {
      name: "alignCenter",
      tooltip: t("Align center"),
      icon: <AlignImageCenterIcon />,
      active: (state) =>
        isNodeActive(schema.nodes.image)(state) &&
        !isLeftAligned(state) &&
        !isRightAligned(state) &&
        !isFullWidthAligned(state),
      visible: !isEmptyDrawing(state) && !isInlineIcon,
    },
    {
      name: "alignRight",
      tooltip: t("Align right"),
      icon: <AlignImageRightIcon />,
      active: isRightAligned,
      visible: !isEmptyDrawing(state) && !isInlineIcon,
    },
    {
      name: "alignFullWidth",
      tooltip: t("Full width"),
      icon: <AlignFullWidthIcon />,
      active: isFullWidthAligned,
      visible: !isEmptyDrawing(state) && !isInlineIcon,
    },
    {
      name: "separator",
      visible: !isInlineIcon,
    },
    {
      name: "dimensions",
      tooltip: `${t("Width")} × ${t("Height")}`,
      visible: !isFullWidthAligned(state) && !isEmptyDrawing(state),
      skipIcon: true,
    },
    {
      name: "separator",
    },
    {
      name: "editDiagram",
      tooltip: t("Edit diagram"),
      icon: <EditIcon />,
      visible: isDiagram(state) && !Desktop.isElectron(),
    },
    {
      name: "editTikz",
      tooltip: t("Edit TikZ"),
      icon: <EditIcon />,
      visible: isTikz(state),
    },
    {
      name: "editExcalidraw",
      tooltip: t("Edit drawing"),
      icon: <EditIcon />,
      visible: isExcalidraw(state),
    },
    {
      name: "downloadImage",
      tooltip: t("Download image"),
      icon: <DownloadIcon />,
      visible: !!fetch && !isEmptyDrawing(state),
    },
    {
      tooltip: t("Replace image"),
      icon: <ReplaceIcon />,
      visible: !isDiagram(state) && !isTikz(state) && !isExcalidraw(state),
      children: [
        {
          name: "replaceImage",
          label: t("Upload an image"),
        },
        {
          name: "editImageUrl",
          label: t("Edit image URL"),
        },
      ],
    },
    {
      name: "deleteImage",
      tooltip: t("Delete image"),
      icon: <TrashIcon />,
    },
    {
      name: "separator",
    },
    {
      name: "linkOnImage",
      tooltip: t("Create link"),
      shortcut: `${metaDisplay}+K`,
      active: isMarkActive(schema.marks.link),
      icon: <LinkIcon />,
    },
    {
      name: "commentOnImage",
      tooltip: t("Comment"),
      shortcut: `${metaDisplay}+⌥+M`,
      icon: <CommentIcon />,
    },
  ];
}
