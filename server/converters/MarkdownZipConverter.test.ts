import path from "node:path";
import fs from "fs-extra";
import { DocumentValidation } from "@shared/validations";
import AttachmentHelper from "@server/models/helpers/AttachmentHelper";
import { buildZip } from "@server/test/support";
import type {
  MarkdownZipArchive,
  MarkdownZipDocument,
} from "./MarkdownZipConverter";
import { MarkdownZipConverter } from "./MarkdownZipConverter";

/** A 1x1 transparent PNG, small enough to embed in a test archive. */
const PNG_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

interface DocumentShape {
  title: string;
  pathInZip?: string;
  children: DocumentShape[];
}

/** Reduce a document tree to titles and paths, for comparing its shape. */
const shape = (document: MarkdownZipDocument): DocumentShape => ({
  title: document.title,
  pathInZip: document.pathInZip,
  children: document.children.map(shape),
});

const find = (archive: MarkdownZipArchive, pathInZip: string) => {
  const document = archive.documents.get(pathInZip.toLowerCase());
  if (!document) {
    throw new Error(`No document for ${pathInZip}`);
  }
  return document;
};

describe("MarkdownZipConverter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isZip", () => {
    it("recognizes a zip by extension or mime type", () => {
      expect(MarkdownZipConverter.isZip("notes.ZIP", "")).toBe(true);
      expect(
        MarkdownZipConverter.isZip("notes", "application/x-zip-compressed")
      ).toBe(true);
      expect(MarkdownZipConverter.isZip("notes.md", "text/markdown")).toBe(
        false
      );
    });
  });

  describe("toArchive", () => {
    it("nests folders as parent documents beneath a wrapper root", async () => {
      const content = await buildZip({
        "Welcome.md": "# Welcome",
        "Guides.md": "Guides overview",
        "Guides/Setup.md": "Setup",
        "Guides/10 Advanced.md": "Advanced",
        "Guides/2 Basics.md": "Basics",
        "Reference/README.md": "Reference overview",
        "Reference/API.md": "API",
        "Drafts/Untitled.md": "Draft",
        "v1.2/Notes.md": "Notes",
        "images/photo.png": PNG_PIXEL,
        "__MACOSX/._Welcome.md": "junk",
      });

      const archive = await MarkdownZipConverter.toArchive(
        content,
        "My Notes.zip"
      );

      expect(shape(archive.root)).toEqual({
        title: "My Notes",
        pathInZip: undefined,
        children: [
          {
            title: "Drafts",
            pathInZip: undefined,
            children: [
              {
                title: "Untitled",
                pathInZip: "Drafts/Untitled.md",
                children: [],
              },
            ],
          },
          {
            title: "Guides",
            pathInZip: "Guides.md",
            children: [
              {
                title: "2 Basics",
                pathInZip: "Guides/2 Basics.md",
                children: [],
              },
              {
                title: "10 Advanced",
                pathInZip: "Guides/10 Advanced.md",
                children: [],
              },
              { title: "Setup", pathInZip: "Guides/Setup.md", children: [] },
            ],
          },
          {
            title: "Reference",
            pathInZip: "Reference/README.md",
            children: [
              { title: "API", pathInZip: "Reference/API.md", children: [] },
            ],
          },
          {
            title: "v1.2",
            pathInZip: undefined,
            children: [
              { title: "Notes", pathInZip: "v1.2/Notes.md", children: [] },
            ],
          },
          { title: "Welcome", pathInZip: "Welcome.md", children: [] },
        ],
      });
    });

    it("uses a single top-level folder as the root", async () => {
      const content = await buildZip({
        "export/Page one.md": "One",
        "export/Page two.md": "Two",
      });

      const archive = await MarkdownZipConverter.toArchive(content, "x.zip");

      expect(archive.root.title).toEqual("export");
      expect(archive.root.children.map((child) => child.title)).toEqual([
        "Page one",
        "Page two",
      ]);
    });

    it("normalizes byte order marks and Windows line endings", async () => {
      const content = await buildZip({
        "Windows.md": "\uFEFF---\r\ntitle: Hello\r\n---\r\n\r\nBody",
      });

      const archive = await MarkdownZipConverter.toArchive(content, "x.zip");

      expect(
        MarkdownZipConverter.toMarkdown(archive, archive.root, new Map())
      ).toEqual("---\ntitle: Hello\n---\n\nBody");
    });

    it("throws if the zip contains no markdown", async () => {
      const content = await buildZip({ "images/photo.png": PNG_PIXEL });

      await expect(
        MarkdownZipConverter.toArchive(content, "images.zip")
      ).rejects.toThrow("Zip file does not contain any Markdown documents");
    });

    it("throws if the zip contains too many documents", async () => {
      const files = Object.fromEntries(
        Array.from({ length: 501 }, (_, i) => [`Doc ${i}.md`, "text"])
      );

      await expect(
        MarkdownZipConverter.toArchive(await buildZip(files), "big.zip")
      ).rejects.toThrow("more than 500 documents");
    });

    it("throws a readable error for a corrupt zip", async () => {
      const content = await fs.readFile(
        path.resolve(__dirname, "..", "test", "fixtures", "corrupt.zip")
      );

      await expect(
        MarkdownZipConverter.toArchive(content, "corrupt.zip")
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("images", () => {
    it("reads normalized paths using their original dot-prefixed entry names", async () => {
      const content = await buildZip({
        "./Notes/Trip.md": "![photo](../images/photo.png)",
        "./images/photo.png": PNG_PIXEL,
      });
      const archive = await MarkdownZipConverter.toArchive(content, "x.zip");
      const onImage = vi.fn().mockResolvedValue(undefined);

      await MarkdownZipConverter.readImages(
        content,
        archive,
        MarkdownZipConverter.referencedImages(
          archive,
          find(archive, "Notes/Trip.md")
        ),
        onImage
      );

      expect(onImage).toHaveBeenCalledExactlyOnceWith({
        key: "images/photo.png",
        name: "photo.png",
        mimeType: "image/png",
        buffer: PNG_PIXEL,
      });
    });

    it("skips images above the configured upload limit and keeps their references", async () => {
      vi.spyOn(AttachmentHelper, "presetToMaxUploadSize").mockReturnValue(
        PNG_PIXEL.length
      );
      const content = await buildZip({
        "Note.md": "![small](small.png) ![large](large.png)",
        "small.png": PNG_PIXEL,
        "large.png": Buffer.concat([PNG_PIXEL, Buffer.from("x")]),
      });
      const archive = await MarkdownZipConverter.toArchive(content, "x.zip");
      const imageUrls = new Map<string, string>();

      await MarkdownZipConverter.readImages(
        content,
        archive,
        MarkdownZipConverter.referencedImages(archive, archive.root),
        async (image) => {
          imageUrls.set(image.key, "/small");
        }
      );

      expect([...imageUrls.keys()]).toEqual(["small.png"]);
      expect(
        MarkdownZipConverter.toMarkdown(archive, archive.root, imageUrls)
      ).toEqual("![small](/small) ![large](large.png)");
    });

    it("enforces the 15 MiB image ceiling even with a larger configured limit", async () => {
      vi.spyOn(AttachmentHelper, "presetToMaxUploadSize").mockReturnValue(
        100 * 1024 * 1024
      );
      const content = await buildZip({
        "Note.md": "![large](large.png)",
        "large.png": Buffer.alloc(15 * 1024 * 1024 + 1),
      });
      const archive = await MarkdownZipConverter.toArchive(content, "x.zip");
      const onImage = vi.fn().mockResolvedValue(undefined);

      await MarkdownZipConverter.readImages(
        content,
        archive,
        MarkdownZipConverter.referencedImages(archive, archive.root),
        onImage
      );

      expect(onImage).not.toHaveBeenCalled();
    });

    it("rejects referenced images above the combined size limit", async () => {
      vi.spyOn(AttachmentHelper, "presetToMaxUploadSize").mockReturnValue(
        20 * 1024 * 1024
      );
      const image = Buffer.alloc(15 * 1024 * 1024);
      const files = Object.fromEntries(
        Array.from({ length: 7 }, (_, index) => [`${index}.png`, image])
      );
      const content = await buildZip({
        "Note.md": Object.keys(files)
          .map((name) => `![](${name})`)
          .join("\n\n"),
        ...files,
      });
      const archive = await MarkdownZipConverter.toArchive(content, "x.zip");
      const onImage = vi.fn().mockResolvedValue(undefined);

      await expect(
        MarkdownZipConverter.readImages(
          content,
          archive,
          MarkdownZipConverter.referencedImages(archive, archive.root),
          onImage
        )
      ).rejects.toThrow(
        "Images in the zip file exceed the maximum combined size"
      );
      expect(onImage).toHaveBeenCalledTimes(6);
    }, 15000);

    it("resolves images by relative, encoded, angle bracket, rooted and unique name references", async () => {
      const content = await buildZip({
        "Notes/Trip.md": [
          "![relative](../images/photo.png)",
          "![dot](./assets/my%20pic.png)",
          '![angle](<assets/my pic.png> "Title")',
          "![rooted](/images/photo.png)",
          "![by name](photo.png)",
          "![missing](assets/missing.png)",
          "![remote](https://example.com/photo.png)",
        ].join("\n\n"),
        "Notes/assets/my pic.png": PNG_PIXEL,
        "images/photo.png": PNG_PIXEL,
      });

      const archive = await MarkdownZipConverter.toArchive(content, "x.zip");
      const trip = find(archive, "Notes/Trip.md");

      expect(
        [...MarkdownZipConverter.referencedImages(archive, trip)].sort()
      ).toEqual(["images/photo.png", "notes/assets/my pic.png"]);

      expect(
        MarkdownZipConverter.toMarkdown(
          archive,
          trip,
          new Map([
            ["images/photo.png", "/photo"],
            ["notes/assets/my pic.png", "/pic"],
          ])
        )
      ).toEqual(
        [
          "![relative](/photo)",
          "![dot](/pic)",
          '![angle](/pic "Title")',
          "![rooted](/photo)",
          "![by name](/photo)",
          "![missing](assets/missing.png)",
          "![remote](https://example.com/photo.png)",
        ].join("\n\n")
      );
    });

    it("reads only the requested images", async () => {
      const content = await buildZip({
        "Note.md": "![a](a.png)",
        "a.png": PNG_PIXEL,
        "b.png": PNG_PIXEL,
      });
      const archive = await MarkdownZipConverter.toArchive(content, "x.zip");
      const names: string[] = [];

      await MarkdownZipConverter.readImages(
        content,
        archive,
        MarkdownZipConverter.referencedImages(archive, archive.root),
        async (image) => {
          names.push(image.name);
          expect(image.mimeType).toEqual("image/png");
          expect(image.buffer.equals(PNG_PIXEL)).toBe(true);
        }
      );

      expect(names).toEqual(["a.png"]);
    });
  });

  describe("links", () => {
    it("preserves unsupported files, ambiguous names, external URLs and note embeds", async () => {
      const text = [
        "![ambiguous](photo.png)",
        "[file](manual.pdf)",
        "[site](//example.com/Note.md)",
        "![[Other]]",
      ].join("\n\n");
      const content = await buildZip({
        "Note.md": text,
        "Other.markdown": "Other",
        "a/photo.png": PNG_PIXEL,
        "b/photo.png": PNG_PIXEL,
        "manual.pdf": "file",
      });
      const archive = await MarkdownZipConverter.toArchive(content, "x.zip");
      const note = find(archive, "Note.md");

      expect(MarkdownZipConverter.referencedImages(archive, note)).toEqual(
        new Set()
      );
      expect(MarkdownZipConverter.toMarkdown(archive, note, new Map())).toEqual(
        text
      );
    });

    it("resolves case-insensitive and encoded Chinese paths inside a wrapper", async () => {
      const content = await buildZip({
        "笔记/首页.md":
          "[设置](%E8%AE%BE%E7%BD%AE.MARKDOWN?view=edit#install) ![图](/图片/示意.png)",
        "笔记/设置.markdown": "设置",
        "笔记/图片/示意.png": PNG_PIXEL,
      });
      const archive = await MarkdownZipConverter.toArchive(content, "x.zip");
      const settings = find(archive, "笔记/设置.markdown");

      expect(
        MarkdownZipConverter.toMarkdown(
          archive,
          find(archive, "笔记/首页.md"),
          new Map([["笔记/图片/示意.png", "/image"]])
        )
      ).toEqual(`[设置](/doc/${settings.urlId}) ![图](/image)`);
    });

    it("points links to other markdown files at their documents", async () => {
      const content = await buildZip({
        "Home.md":
          "[setup](Guides/Setup.md#install) [site](https://example.com) [top](#top) [mail](mailto:a@example.com)",
        "Guides/Setup.md": "[home](../Home.md) [missing](Missing.md)",
      });

      const archive = await MarkdownZipConverter.toArchive(content, "x.zip");
      const home = find(archive, "Home.md");
      const setup = find(archive, "Guides/Setup.md");

      expect(MarkdownZipConverter.toMarkdown(archive, home, new Map())).toEqual(
        `[setup](/doc/${setup.urlId}) [site](https://example.com) [top](#top) [mail](mailto:a@example.com)`
      );
      expect(
        MarkdownZipConverter.toMarkdown(archive, setup, new Map())
      ).toEqual(`[home](/doc/${home.urlId}) [missing](Missing.md)`);
    });

    it("resolves wiki style embeds and links, leaving unknown ones as written", async () => {
      const content = await buildZip({
        "Daily/Today.md":
          "![[photo.png|300]]\n\nSee [[Project|the project]] and [[Unknown]]",
        "Projects/Project.md": "Project",
        "attachments/photo.png": PNG_PIXEL,
      });

      const archive = await MarkdownZipConverter.toArchive(content, "x.zip");
      const project = find(archive, "Projects/Project.md");

      expect(
        MarkdownZipConverter.toMarkdown(
          archive,
          find(archive, "Daily/Today.md"),
          new Map([["attachments/photo.png", "/photo"]])
        )
      ).toEqual(
        `![](/photo)\n\nSee [the project](/doc/${project.urlId}) and [[Unknown]]`
      );
    });
  });

  describe("limits", () => {
    it("counts the generated wrapper toward the document limit", async () => {
      const files = Object.fromEntries(
        Array.from({ length: 500 }, (_, index) => [`${index}.md`, "text"])
      );

      await expect(
        MarkdownZipConverter.toArchive(await buildZip(files), "x.zip")
      ).rejects.toThrow("more than 500 documents");
    });

    it("accepts exactly 500 documents including the wrapper", async () => {
      const files = Object.fromEntries(
        Array.from({ length: 499 }, (_, index) => [`${index}.md`, "text"])
      );
      const archive = await MarkdownZipConverter.toArchive(
        await buildZip(files),
        "x.zip"
      );

      expect(MarkdownZipConverter.flatten(archive.root)).toHaveLength(500);
    });

    it("rejects more than 5000 files including unused non-Markdown entries", async () => {
      const files = Object.fromEntries(
        Array.from({ length: 5000 }, (_, index) => [`${index}.bin`, ""])
      );

      await expect(
        MarkdownZipConverter.toArchive(
          await buildZip({ "Note.md": "Note", ...files }),
          "x.zip"
        )
      ).rejects.toThrow("Zip file contains too many files");
    });

    it("rejects a Markdown file above the per-file byte limit", async () => {
      const content = await buildZip({
        "Note.md": Buffer.alloc(DocumentValidation.maxStateLength + 1),
      });

      await expect(
        MarkdownZipConverter.toArchive(content, "x.zip")
      ).rejects.toThrow("Note.md is too large");
    });

    it("rejects Markdown files above the combined byte limit", async () => {
      const text = Buffer.alloc(DocumentValidation.maxStateLength, 0x61);
      const files = Object.fromEntries(
        Array.from({ length: 35 }, (_, index) => [`${index}.md`, text])
      );

      await expect(
        MarkdownZipConverter.toArchive(await buildZip(files), "x.zip")
      ).rejects.toThrow(
        "Markdown files in the zip exceed the maximum combined size"
      );
    }, 15000);
  });
});
