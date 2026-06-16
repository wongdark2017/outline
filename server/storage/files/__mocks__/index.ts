import { vi } from "vitest";
import { createReadStream } from "node:fs";
import path from "node:path";

const mockFilePath = path.join(__dirname, "../../../test/fixtures/markdown.md");

export default {
  upload: vi.fn().mockReturnValue("/endpoint/key"),

  getUploadUrl: vi.fn().mockReturnValue("http://mock/create"),

  getUrlForKey: vi.fn().mockReturnValue("http://mock/get"),

  getSignedUrl: vi.fn().mockReturnValue("http://s3mock"),

  getPresignedPost: vi.fn().mockReturnValue({}),

  getFileStream: vi
    .fn()
    .mockImplementation(() => Promise.resolve(createReadStream(mockFilePath))),

  getContentDisposition: vi.fn().mockReturnValue("inline"),
};
