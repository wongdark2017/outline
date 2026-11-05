import FileHelper, { ImageSource } from "./FileHelper";

describe("FileHelper", () => {
  it("isImage", () => {
    expect(FileHelper.isImage("image/png")).toBe(true);
    expect(FileHelper.isImage("image/jpeg")).toBe(true);
    expect(FileHelper.isImage("image/webp")).toBe(true);
    expect(FileHelper.isImage("image/gif")).toBe(true);
    expect(FileHelper.isImage("image/bmp")).toBe(true);
    expect(FileHelper.isImage("image/avif")).toBe(true);
    expect(FileHelper.isImage("image/heif-sequence")).toBe(true);
    expect(FileHelper.isImage("image/svg+xml")).toBe(true);
    expect(FileHelper.isImage("text/plain")).toBe(false);
    expect(FileHelper.isImage("application/json")).toBe(false);
  });

  it("isVideo", () => {
    expect(FileHelper.isVideo("video/mp4")).toBe(true);
    expect(FileHelper.isVideo("video/webm")).toBe(true);
    expect(FileHelper.isVideo("video/x-msvideo")).toBe(true);
    expect(FileHelper.isVideo("video/vnd.dlna.mpeg-tts")).toBe(true);
    expect(FileHelper.isVideo("text/plain")).toBe(false);
    expect(FileHelper.isVideo("application/json")).toBe(false);
  });

  it("isAudio", () => {
    expect(FileHelper.isAudio("audio/mpeg")).toBe(true);
    expect(FileHelper.isAudio("audio/wav")).toBe(true);
    expect(FileHelper.isAudio("audio/vnd.dolby.heaac.1")).toBe(true);
    expect(FileHelper.isAudio("audio/vnd.lucent.voice")).toBe(true);
    expect(FileHelper.isAudio("text/plain")).toBe(false);
    expect(FileHelper.isAudio("application/json")).toBe(false);
  });

  it("withContentType", () => {
    const mov = FileHelper.withContentType(new File(["x"], "Clip.MOV"));
    expect(mov.type).toBe("video/quicktime");
    expect(mov.name).toBe("Clip.MOV");

    const typed = new File(["x"], "clip.mov", { type: "video/mp4" });
    expect(FileHelper.withContentType(typed)).toBe(typed);

    const unknown = new File(["x"], "notes.txt");
    expect(FileHelper.withContentType(unknown)).toBe(unknown);
  });

  describe("getImageSourceAttr", () => {
    const svgFile = (content: string) => {
      const file = new File([content], "diagram.svg", {
        type: "image/svg+xml",
      });

      // jsdom does not implement Blob.text(). Keep the fixture identical in both
      // shared test environments without changing browser behavior.
      file.text = vi.fn(async () => content);
      return file;
    };

    it.each([
      '<script type="text/x-tikz">\\node {x};</script>',
      "<script id='source' type = 'text/x-tikz' >\\node {x};</script>",
      '<script\n type="text/x-tikz"\n>\\node {x};</script>',
      '<script type="text/x-tikz"><![CDATA[\\node {$a<b$};]]></script>',
    ])("recognizes editable TikZ metadata (%s)", async (script) => {
      const file = svgFile(
        `<svg xmlns="http://www.w3.org/2000/svg"><metadata>${script}</metadata></svg>`
      );
      expect(await FileHelper.getImageSourceAttr(file)).toBe(ImageSource.Tikz);
    });

    it.each([
      '<script type="text/x-tikz">x</script>',
      '<metadata><script data-type="text/x-tikz">x</script></metadata>',
      '<metadata><script type="application/javascript">x</script></metadata>',
      '<!-- <metadata><script type="text/x-tikz">x</script></metadata> -->',
      '<desc><![CDATA[<metadata><script type="text/x-tikz">x</script></metadata>]]></desc>',
    ])("ignores non-TikZ SVG content (%s)", async (content) => {
      const file = svgFile(
        `<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`
      );
      expect(await FileHelper.getImageSourceAttr(file)).toBeUndefined();
    });

    it("requires an SVG file rather than a metadata marker alone", async () => {
      const content =
        '<metadata><script type="text/x-tikz">x</script></metadata>';
      expect(
        await FileHelper.getImageSourceAttr(svgFile(content))
      ).toBeUndefined();
      expect(
        await FileHelper.getImageSourceAttr(
          new File([`<svg>${content}</svg>`], "source.txt", {
            type: "text/plain",
          })
        )
      ).toBeUndefined();
    });

    it("keeps diagrams.net detection ahead of other metadata", async () => {
      const file = svgFile(
        '<svg content="%3Cmxfile"><metadata><script type="text/x-tikz">x</script></metadata></svg>'
      );
      expect(await FileHelper.getImageSourceAttr(file)).toBe(
        ImageSource.DiagramsNet
      );
    });

    it("ignores an unreadable SVG", async () => {
      const file = svgFile("<svg/>");
      vi.spyOn(file, "text").mockRejectedValue(new Error("Read failed"));
      expect(await FileHelper.getImageSourceAttr(file)).toBeUndefined();
    });
  });
});
