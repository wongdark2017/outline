import type { Node } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { sanitizeUrl } from "@shared/utils/urls";

/**
 * 独立 PDF 阅读态所需的最小文档信息。
 */
export interface ActivePdfDocument {
  attachmentId?: string;
  contentType: string;
  documentId?: string;
  pos: number;
  size: number;
  src: string;
  title: string;
  element: Element | null;
}

/**
 * 从编辑器节点位置创建可用于独立 PDF 阅读态的数据。
 *
 * @param view - 编辑器视图。
 * @param pos - PDF 附件节点位置。
 * @returns 可用于阅读态的数据；如果当前位置不是可打开的 PDF，则返回 null。
 */
export function createActivePdfDocument(
  view: EditorView,
  pos: number,
  documentId?: string
): ActivePdfDocument | null {
  const node = view.state.doc.nodeAt(pos);

  if (!node || !isPdfAttachment(node)) {
    return null;
  }

  const src = sanitizeUrl(node.attrs.href);

  if (!src) {
    return null;
  }

  const element = view.nodeDOM(pos);

  return {
    attachmentId:
      typeof node.attrs.id === "string" && node.attrs.id
        ? node.attrs.id
        : getAttachmentIdFromSrc(src),
    contentType: String(node.attrs.contentType ?? ""),
    documentId,
    pos,
    size:
      typeof node.attrs.size === "number"
        ? node.attrs.size
        : Number(node.attrs.size || 0),
    src,
    title: String(node.attrs.title ?? ""),
    element: element instanceof Element ? element : null,
  };
}

const isPdfAttachment = (node: Node) =>
  node.type.name === "attachment" &&
  node.attrs.contentType === "application/pdf";

function getAttachmentIdFromSrc(src: string) {
  try {
    const url = new URL(src, window.location.origin);

    if (
      url.origin === window.location.origin &&
      url.pathname === "/api/attachments.redirect"
    ) {
      return url.searchParams.get("id") ?? undefined;
    }
  } catch (_err) {
    return;
  }

  return;
}
