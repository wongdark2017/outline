import env from "@server/env";
import FileStorage, { resetFileStorage } from ".";

describe("FileStorage", () => {
  const originalFileStorage = env.FILE_STORAGE;

  afterEach(() => {
    env.FILE_STORAGE = originalFileStorage;
    resetFileStorage();
  });

  it("should keep the default export stable when storage is reset", () => {
    env.FILE_STORAGE = "local";

    expect(resetFileStorage()).toBe(FileStorage);
  });

  it("should delegate to local storage when FILE_STORAGE is local", () => {
    env.FILE_STORAGE = "local";
    resetFileStorage();

    expect(FileStorage.getUploadUrl()).toBe("/api/files.create");
  });
});
