import path from "node:path";
import { randomUUID } from "node:crypto";
import httpErrors from "http-errors";
import mime from "mime-types";
import { AttachmentPreset } from "@shared/types";
import { replaceMarkdownLinks } from "@shared/utils/markdown";
import { AttachmentValidation, DocumentValidation } from "@shared/validations";
import { FileImportError } from "@server/errors";
import Logger from "@server/logging/Logger";
import AttachmentHelper from "@server/models/helpers/AttachmentHelper";
import { deserializeFilename } from "@server/utils/fs";
import { generateUrlId } from "@server/utils/url";
import type { ZipTreeNode } from "@server/utils/ZipHelper";
import ZipHelper from "@server/utils/ZipHelper";

/** A document represented by one Markdown file or a folder in the archive. */
export interface MarkdownZipDocument {
  /** Id assigned before the document is created, so others can be nested under it. */
  id: string;

  /** Url id assigned before the document is created, so others can link to it. */
  urlId: string;

  /** Title from the file or folder name, used when the markdown has no title of its own. */
  title: string;

  /** Path of the document's markdown file within the zip, if it has one. */
  pathInZip?: string;

  /** Documents nested beneath this one, in order. */
  children: MarkdownZipDocument[];
}

/** A document and its position in a parent-first archive traversal. */
export interface MarkdownZipEntry {
  /** The document to create. */
  document: MarkdownZipDocument;

  /** The document this one is nested under; undefined for the root. */
  parent?: MarkdownZipDocument;

  /** Position among the parent's children; undefined for the root. */
  index?: number;
}

/** The document tree and source files read from an archive. */
export interface MarkdownZipArchive {
  /** The single document all others are nested beneath. */
  root: MarkdownZipDocument;

  /** Markdown text keyed by path within the zip. */
  markdown: Map<string, string>;

  /** Entry name as written in the zip, keyed by lowercased path within the zip. */
  files: Map<string, string>;

  /** Documents keyed by the lowercased path of their markdown file. */
  documents: Map<string, MarkdownZipDocument>;

  /** Lowercased path of each file whose name is unique in the zip, keyed by lowercased name. */
  uniqueNames: Map<string, string>;
}

/** One referenced image read from the archive for upload. */
export interface MarkdownZipImage {
  /** Lowercased path within the zip, as returned by `referencedImages`. */
  key: string;

  /** File name of the image. */
  name: string;

  /** Mime type derived from the file extension. */
  mimeType: string;

  /** The image content. */
  buffer: Buffer;
}

/**
 * Converts a zip archive of markdown files and images into a tree of
 * documents. Folders become parent documents, images referenced from the
 * markdown are read for upload as attachments, and links between markdown
 * files are pointed at the documents they become.
 */
export class MarkdownZipConverter {
  /**
   * Whether an uploaded file is a zip archive.
   *
   * @param fileName the name of the file, including extension.
   * @param mimeType the mime type of the file, which may be empty.
   * @returns true if the file should be imported as a zip of markdown.
   */
  public static isZip(fileName: string, mimeType: string): boolean {
    return (
      ZIP_MIME_TYPES.includes(mimeType) ||
      path.extname(fileName).toLowerCase() === ".zip"
    );
  }

  /**
   * Read a zip archive into a tree of documents. When the archive holds more
   * than one top-level document they are nested beneath a document named
   * after the zip file, so that an import always has a single root.
   *
   * @param content the zip file content.
   * @param fileName the name of the zip file, used to title a wrapper document.
   * @returns the document tree and the content needed to convert it.
   * @throws {FileImportError} if the archive is unreadable, too large, or
   *   holds no markdown files.
   */
  public static async toArchive(
    content: Buffer,
    fileName: string
  ): Promise<MarkdownZipArchive> {
    const markdown = new Map<string, string>();
    const files = new Map<string, string>();

    // A name seen more than once maps to null: it cannot be resolved without its path.
    const names = new Map<string, string | null>();
    let entries = 0;
    let totalTextBytes = 0;

    let tree: ZipTreeNode;
    try {
      tree = await ZipHelper.toFileTree(content, async (node, entry) => {
        entries++;
        if (entries > MAX_ENTRIES) {
          throw FileImportError("Zip file contains too many files");
        }

        const key = node.pathInZip.toLowerCase();
        files.set(key, entry.fileName);

        const name = node.name.toLowerCase();
        names.set(name, names.has(name) ? null : key);

        if (!this.isMarkdown(node.name)) {
          return;
        }

        const buffer = await entry.readBuffer(MAX_TEXT_SIZE);
        totalTextBytes += buffer.length;
        if (totalTextBytes > MAX_TOTAL_TEXT_SIZE) {
          throw FileImportError(
            "Markdown files in the zip exceed the maximum combined size"
          );
        }

        markdown.set(
          node.pathInZip,
          this.normalizeText(buffer.toString("utf8"))
        );
      });
    } catch (err) {
      // Errors raised above, and size limits enforced while reading, are
      // already suitable to show; anything else means the zip is unreadable.
      if (httpErrors.isHttpError(err)) {
        throw err;
      }
      throw FileImportError("The zip file could not be read");
    }

    const uniqueNames = new Map<string, string>();
    for (const [name, key] of names) {
      if (key) {
        uniqueNames.set(name, key);
      }
    }

    const documents = new Map<string, MarkdownZipDocument>();
    const topLevel = this.buildDocuments(tree.children, markdown, documents);

    if (documents.size === 0) {
      throw FileImportError("Zip file does not contain any Markdown documents");
    }

    const root =
      topLevel.length === 1
        ? topLevel[0]
        : this.newDocument(
            deserializeFilename(path.parse(fileName).name),
            undefined,
            topLevel
          );

    if (this.flatten(root).length > MAX_DOCUMENTS) {
      throw FileImportError(
        `Zip file contains more than ${MAX_DOCUMENTS} documents`
      );
    }

    return { root, markdown, files, documents, uniqueNames };
  }

  /**
   * List every document in the tree, each parent before its children.
   *
   * @param root the root of the tree.
   * @returns the documents with their parent and position among its children.
   */
  public static flatten(root: MarkdownZipDocument): MarkdownZipEntry[] {
    const entries: MarkdownZipEntry[] = [{ document: root }];

    const visit = (parent: MarkdownZipDocument) => {
      parent.children.forEach((document, index) => {
        entries.push({ document, parent, index });
        visit(document);
      });
    };
    visit(root);

    return entries;
  }

  /**
   * Find the images in the zip that a document references, from regular
   * markdown images and links as well as wiki style embeds.
   *
   * @param archive the archive returned from `toArchive`.
   * @param document the document to inspect.
   * @returns lowercased paths within the zip of the referenced images.
   */
  public static referencedImages(
    archive: MarkdownZipArchive,
    document: MarkdownZipDocument
  ): Set<string> {
    const keys = new Set<string>();
    this.rewrite(archive, document, (key) => {
      keys.add(key);
      return undefined;
    });
    return keys;
  }

  /**
   * Read images from the zip one at a time, so that only one is held in
   * memory while it is uploaded. Images over the size limit are skipped and
   * keep their original reference in the markdown.
   *
   * @param content the zip file content.
   * @param archive the archive returned from `toArchive`.
   * @param keys lowercased paths of the images to read.
   * @param onImage called with each image, awaited before the next is read.
   * @returns a promise that resolves after all requested images are processed.
   * @throws {FileImportError} if the images exceed the combined size limit.
   */
  public static async readImages(
    content: Buffer,
    archive: MarkdownZipArchive,
    keys: Set<string>,
    onImage: (image: MarkdownZipImage) => Promise<void>
  ): Promise<void> {
    // The walk reports names as written in the zip, which may differ from
    // the normalized paths the keys are derived from (e.g. a leading "./").
    const wanted = new Map<string, string>();
    for (const key of keys) {
      const entryName = archive.files.get(key);
      if (entryName) {
        wanted.set(entryName, key);
      }
    }

    if (wanted.size === 0) {
      return;
    }

    const maxImageSize = Math.min(
      MAX_IMAGE_SIZE,
      AttachmentHelper.presetToMaxUploadSize(
        AttachmentPreset.DocumentAttachment
      )
    );
    let totalBytes = 0;

    await ZipHelper.walk(content, async (entry) => {
      const key = wanted.get(entry.fileName);
      if (!key || entry.isDirectory) {
        return;
      }

      if (entry.uncompressedSize > maxImageSize) {
        Logger.info(
          "utils",
          `Skipping zip import image larger than ${maxImageSize} bytes: ${entry.fileName}`
        );
        return;
      }

      // Bounded again while reading, as the declared size cannot be trusted.
      const buffer = await entry.readBuffer(maxImageSize);
      totalBytes += buffer.length;
      if (totalBytes > MAX_TOTAL_IMAGES_SIZE) {
        throw FileImportError(
          "Images in the zip file exceed the maximum combined size"
        );
      }

      await onImage({
        key,
        name: path.posix.basename(entry.fileName),
        mimeType: mime.lookup(entry.fileName) || "application/octet-stream",
        buffer,
      });
    });
  }

  /**
   * Produce the markdown for a document, with images pointed at their
   * uploaded attachments and links to other markdown files in the zip pointed
   * at the documents they become. Anything unresolved is left as written.
   *
   * @param archive the archive returned from `toArchive`.
   * @param document the document to produce markdown for.
   * @param imageUrls attachment url keyed by the lowercased image path.
   * @returns the markdown, empty for a folder without its own file.
   */
  public static toMarkdown(
    archive: MarkdownZipArchive,
    document: MarkdownZipDocument,
    imageUrls: Map<string, string>
  ): string {
    return this.rewrite(archive, document, (key) => imageUrls.get(key));
  }

  /**
   * Rewrite the link and image destinations of a document's markdown.
   *
   * @param archive the archive the document belongs to.
   * @param document the document to rewrite.
   * @param imageUrl returns the url for an image in the zip, or undefined to
   *   leave its reference as written.
   * @returns the rewritten markdown.
   */
  private static rewrite(
    archive: MarkdownZipArchive,
    document: MarkdownZipDocument,
    imageUrl: (key: string) => string | undefined
  ): string {
    if (!document.pathInZip) {
      return "";
    }

    const directory = path.posix.dirname(document.pathInZip);
    const urlFor = (key: string | undefined) => {
      if (!key) {
        return undefined;
      }
      if (this.isImage(key)) {
        return imageUrl(key);
      }
      const linked = archive.documents.get(key);
      return linked ? `/doc/${linked.urlId}` : undefined;
    };

    const text = replaceMarkdownLinks(
      archive.markdown.get(document.pathInZip) ?? "",
      (href) => {
        if (EXTERNAL_LINK_REGEX.test(href) || href.startsWith("#")) {
          return undefined;
        }
        const target = this.cleanHref(href);
        return target
          ? urlFor(this.resolvePath(archive, directory, target))
          : undefined;
      }
    );

    // Wiki links are rewritten after regular links, so that their output is
    // not resolved a second time.
    return text.replace(
      WIKI_LINK_REGEX,
      (match: string, embed: string, name: string, alias?: string) => {
        const target = name.trim();
        const key =
          this.resolvePath(archive, directory, target) ??
          (this.isMarkdown(target)
            ? undefined
            : this.resolvePath(archive, directory, `${target}.md`));
        const url = urlFor(key);

        if (!key || !url) {
          return match;
        }
        if (embed) {
          // Embedding another note's content is not supported, only images.
          return this.isImage(key) ? `![](${url})` : match;
        }
        return `[${alias?.trim() || target}](${url})`;
      }
    );
  }

  /**
   * Resolve a link destination to a file in the zip.
   *
   * @param archive the archive the link appears in.
   * @param directory directory of the markdown file holding the link.
   * @param target the decoded destination, without fragment or query.
   * @returns the lowercased path within the zip, or undefined if not found.
   */
  private static resolvePath(
    archive: MarkdownZipArchive,
    directory: string,
    target: string
  ): string | undefined {
    const candidates = target.startsWith("/")
      ? // Rooted at the zip, or at the single folder wrapping its contents.
        [
          target.slice(1),
          ...(directory === "." ? [] : [`${directory.split("/")[0]}${target}`]),
        ]
      : [path.posix.join(directory, target)];

    for (const candidate of candidates) {
      const key = path.posix.normalize(candidate).toLowerCase();
      if (archive.files.has(key)) {
        return key;
      }
    }

    // Fall back to a file name that is unique in the zip, as tools such as
    // Obsidian resolve links by name rather than by path.
    return archive.uniqueNames.get(path.posix.basename(target).toLowerCase());
  }

  /** Strip any fragment or query from a link destination and decode it into a path. */
  private static cleanHref(href: string): string {
    let target = href.replace(/[#?].*$/, "");
    try {
      target = decodeURIComponent(target);
    } catch {
      // Leave as-is if not validly percent-encoded.
    }
    return target.replace(/\\/g, "/");
  }

  /**
   * Build the documents for the entries of one folder.
   *
   * @param nodes the entries of the folder.
   * @param markdown markdown text keyed by path within the zip.
   * @param documents collects every document with a markdown file, keyed by
   *   its lowercased path.
   * @returns the folder's documents, in natural name order.
   */
  private static buildDocuments(
    nodes: ZipTreeNode[],
    markdown: Map<string, string>,
    documents: Map<string, MarkdownZipDocument>
  ): MarkdownZipDocument[] {
    const sorted = [...nodes].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
    const isMarkdownFile = (node: ZipTreeNode) => markdown.has(node.pathInZip);
    const isFolder = (node: ZipTreeNode) =>
      !isMarkdownFile(node) && node.children.length > 0;

    // A markdown file beside a folder of the same name holds the folder's
    // content, as written by Outline's own Markdown export.
    const siblings = new Map<ZipTreeNode, ZipTreeNode>();
    for (const folder of sorted.filter(isFolder)) {
      const sibling = sorted.find(
        (node) =>
          isMarkdownFile(node) &&
          path.parse(node.name).name.toLowerCase() === folder.name.toLowerCase()
      );
      if (sibling) {
        siblings.set(folder, sibling);
      }
    }
    const consumed = new Set(siblings.values());

    const result: MarkdownZipDocument[] = [];

    for (const node of sorted) {
      if (isMarkdownFile(node)) {
        if (!consumed.has(node)) {
          result.push(this.addDocument(documents, node.title, node.pathInZip));
        }
        continue;
      }

      if (!isFolder(node)) {
        continue;
      }

      const source =
        siblings.get(node) ??
        node.children.find(
          (child) =>
            isMarkdownFile(child) &&
            FOLDER_INDEX_NAMES.includes(
              path.parse(child.name).name.toLowerCase()
            )
        );
      const children = this.buildDocuments(
        node.children.filter((child) => child !== source),
        markdown,
        documents
      );

      // A folder holding no markdown, such as one of images, is not a document.
      if (!source && children.length === 0) {
        continue;
      }

      // node.title has an "extension" stripped, which a folder name lacks:
      // "v1.2" would become "v1".
      result.push(
        this.addDocument(
          documents,
          deserializeFilename(node.name),
          source?.pathInZip,
          children
        )
      );
    }

    return result;
  }

  private static addDocument(
    documents: Map<string, MarkdownZipDocument>,
    title: string,
    pathInZip?: string,
    children: MarkdownZipDocument[] = []
  ): MarkdownZipDocument {
    const document = this.newDocument(title, pathInZip, children);
    if (pathInZip) {
      documents.set(pathInZip.toLowerCase(), document);
    }
    return document;
  }

  private static newDocument(
    title: string,
    pathInZip?: string,
    children: MarkdownZipDocument[] = []
  ): MarkdownZipDocument {
    return {
      id: randomUUID(),
      urlId: generateUrlId(),
      title,
      pathInZip,
      children,
    };
  }

  /** Remove a byte order mark and use `\n` line endings, as front matter detection expects. */
  private static normalizeText(text: string): string {
    return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  }

  private static isMarkdown(fileName: string): boolean {
    return MARKDOWN_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
  }

  private static isImage(fileName: string): boolean {
    const mimeType = mime.lookup(fileName);
    return (
      !this.isMarkdown(fileName) &&
      !!mimeType &&
      AttachmentValidation.imageContentTypes.includes(mimeType)
    );
  }
}

/** Extensions of zip entries that are imported as documents. */
const MARKDOWN_EXTENSIONS = [".md", ".markdown"];

/** Mime types that browsers and operating systems report for a zip archive. */
const ZIP_MIME_TYPES = [
  "application/zip",
  "application/x-zip",
  "application/x-zip-compressed",
];

/**
 * Names of a markdown file inside a folder that holds the folder's own
 * content, used when there is no markdown file of the same name beside it.
 */
const FOLDER_INDEX_NAMES = ["index", "readme"];

/** Maximum number of files a zip archive may contain. */
const MAX_ENTRIES = 5000;

/** Maximum number of documents created from one zip archive. */
const MAX_DOCUMENTS = 500;

/** Maximum size of a single markdown file, in bytes. */
const MAX_TEXT_SIZE = DocumentValidation.maxStateLength;

/** Maximum combined size of all markdown files, in bytes. */
const MAX_TOTAL_TEXT_SIZE = 50 * 1024 * 1024;

/**
 * Ceiling on the size of a single image, in bytes. The attachment upload
 * limit applies too; this keeps a high configured limit from holding very
 * large images in memory.
 */
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;

/** Maximum combined size of all imported images, in bytes. */
const MAX_TOTAL_IMAGES_SIZE = 100 * 1024 * 1024;

/** Matches a wiki style link or embed, e.g. `[[Note|alias]]` or `![[image.png|300]]`. */
const WIKI_LINK_REGEX =
  /(!?)\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g;

/** Matches a link destination with a scheme, e.g. `https:`, or a protocol relative one. */
const EXTERNAL_LINK_REGEX = /^([a-z][a-z0-9+.-]*:|\/\/)/i;
