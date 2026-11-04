import JWT from "jsonwebtoken";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hour } from "@shared/utils/time";
import env from "@server/env";
import LocalStorage from "./LocalStorage";

describe("LocalStorage", () => {
  describe("deleteFile", () => {
    let rootDirectory: string;
    const previousRoot = env.FILE_STORAGE_LOCAL_ROOT_DIR;

    beforeEach(async () => {
      rootDirectory = await mkdtemp(
        path.join(os.tmpdir(), "outline-storage-delete-")
      );
      env.FILE_STORAGE_LOCAL_ROOT_DIR = rootDirectory;
    });

    afterEach(async () => {
      env.FILE_STORAGE_LOCAL_ROOT_DIR = previousRoot;
      await rm(rootDirectory, { recursive: true, force: true });
    });

    it("deletes a stored object and tolerates an already missing object", async () => {
      const storage = new LocalStorage();
      await storage.store({
        key: "uploads/test.txt",
        body: Buffer.from("example"),
      });
      await storage.deleteFile("uploads/test.txt");
      await expect(
        stat(path.join(rootDirectory, "uploads/test.txt"))
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        storage.deleteFile("uploads/test.txt")
      ).resolves.toBeUndefined();
    });

    it("propagates deletion failures so callers can retain retry metadata", async () => {
      const storage = new LocalStorage();
      const target = path.join(rootDirectory, "uploads/preserved-directory");
      await mkdir(target, { recursive: true });
      await expect(
        storage.deleteFile("uploads/preserved-directory")
      ).rejects.toThrow();
      expect((await stat(target)).isDirectory()).toBe(true);
    });
  });

  describe("getSignedUrl", () => {
    // A time deliberately offset from a window boundary, so that rounding is
    // exercised and two calls cannot straddle a boundary.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-16T12:07:31.500Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should return an identical url for repeated calls", async () => {
      const storage = new LocalStorage();
      const first = await storage.getSignedUrl(
        "uploads/test.png",
        Hour.seconds
      );

      // Move on within the same window, which is what separates the server
      // rendered page from the API request that follows it.
      vi.setSystemTime(new Date("2026-04-16T12:08:01.500Z"));
      const second = await storage.getSignedUrl(
        "uploads/test.png",
        Hour.seconds
      );

      expect(second).toBe(first);
    });

    it("should return a different url for a different key", async () => {
      const storage = new LocalStorage();
      const first = await storage.getSignedUrl("uploads/one.png", Hour.seconds);
      const second = await storage.getSignedUrl(
        "uploads/two.png",
        Hour.seconds
      );

      expect(second).not.toBe(first);
    });

    it("should return a different url once the window has passed", async () => {
      const storage = new LocalStorage();
      const first = await storage.getSignedUrl(
        "uploads/test.png",
        Hour.seconds
      );

      vi.setSystemTime(new Date("2026-04-16T12:22:31.500Z"));
      const second = await storage.getSignedUrl(
        "uploads/test.png",
        Hour.seconds
      );

      expect(second).not.toBe(first);
    });

    it("should remain valid for at least half of the requested lifetime", async () => {
      const storage = new LocalStorage();
      const url = await storage.getSignedUrl("uploads/test.png", Hour.seconds);
      const sig = new URL(url).searchParams.get("sig");

      const payload = JWT.verify(sig!, env.SECRET_KEY) as { exp: number };
      const remaining = payload.exp - Math.floor(Date.now() / 1000);

      expect(remaining).toBeGreaterThanOrEqual(Hour.seconds / 2);
      expect(remaining).toBeLessThanOrEqual(Hour.seconds);
    });
  });
});
