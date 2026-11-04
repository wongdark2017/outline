// @vitest-isolate true
import { vi } from "vitest";
import { Week, Day } from "@shared/utils/time";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import BaseStorage from "./BaseStorage";
import S3Storage from "./S3Storage";

const { uploadParams } = vi.hoisted(() => ({ uploadParams: vi.fn() }));

vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: class {
    constructor(options: { params: { ACL?: string } }) {
      uploadParams(options.params);
    }

    done() {
      return Promise.resolve({});
    }
  },
}));

describe("S3Storage", () => {
  describe("store", () => {
    const previousAcl = env.AWS_S3_ACL;
    const previousBucket = env.AWS_S3_UPLOAD_BUCKET_NAME;

    beforeEach(() => {
      env.AWS_S3_ACL = "public-read";
      env.AWS_S3_UPLOAD_BUCKET_NAME = "customization-images";
      uploadParams.mockClear();
    });

    afterEach(() => {
      env.AWS_S3_ACL = previousAcl;
      env.AWS_S3_UPLOAD_BUCKET_NAME = previousBucket;
      vi.restoreAllMocks();
    });

    it.each([
      { acl: "private", expected: "private" },
      { acl: undefined, expected: "public-read" },
    ])(
      "uses $expected ACL when the explicit ACL is $acl",
      async ({ acl, expected }) => {
        const storage = new S3Storage();

        await storage.store({
          body: Buffer.from("private image"),
          key: "customizations/workspace/image.png",
          contentType: "image/png",
          acl,
        });

        expect(uploadParams).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ ACL: expected })
        );
      }
    );
  });

  describe("getFileStream", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns null and does not report an error when the object is missing (masked 403)", async () => {
      // S3 returns AccessDenied for s3:ListBucket instead of 404 when the IAM
      // identity lacks ListBucket permission and the key does not exist.
      const error = Object.assign(
        new Error(
          "User: arn:aws:iam::123:user/attachments is not authorized to perform: s3:ListBucket on resource"
        ),
        {
          name: "AccessDenied",
          $metadata: { httpStatusCode: 403 },
        }
      );
      const storage = new S3Storage();
      const { client } = await Reflect.get(storage, "getS3").call(storage);
      vi.spyOn(client, "send").mockRejectedValue(error);
      const errorSpy = vi.spyOn(Logger, "error");
      const infoSpy = vi.spyOn(Logger, "info");

      const stream = await storage.getFileStream("missing/key");

      expect(stream).toBeNull();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalled();
    });

    it("reports a real error for unexpected failures", async () => {
      const error = Object.assign(new Error("boom"), {
        name: "InternalError",
        $metadata: { httpStatusCode: 500 },
      });
      const storage = new S3Storage();
      const { client } = await Reflect.get(storage, "getS3").call(storage);
      vi.spyOn(client, "send").mockRejectedValue(error);
      const errorSpy = vi.spyOn(Logger, "error");

      const stream = await storage.getFileStream("some/key");

      expect(stream).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe("getSignedUrl expiration limits", () => {
    it("should define maximum expiration as 7 days for AWS S3 Signature V4", () => {
      // AWS S3 Signature V4 presigned URLs have a maximum expiration of 7 days
      const maxExpiration = Week.seconds;

      // Verify our constant matches AWS limit
      expect(BaseStorage.maxSignedUrlExpires).toBe(maxExpiration);
      expect(BaseStorage.maxSignedUrlExpires).toBe(604800); // 7 days in seconds
    });

    it("should have Week.seconds equal to 7 days", () => {
      expect(Week.seconds).toBe(7 * 24 * 60 * 60);
      expect(Week.seconds).toBe(604800);
    });

    it("should ensure 30 days exceeds the limit", () => {
      const thirtyDays = 30 * Day.seconds;
      expect(thirtyDays).toBeGreaterThan(BaseStorage.maxSignedUrlExpires);
      expect(thirtyDays).toBe(2592000); // 30 days in seconds
    });

    it("should ensure 4 days is within the limit", () => {
      const fourDays = 4 * Day.seconds;
      expect(fourDays).toBeLessThan(BaseStorage.maxSignedUrlExpires);
      expect(fourDays).toBe(345600); // 4 days in seconds
    });

    it("should clamp values that exceed the limit", () => {
      const thirtyDays = 30 * Day.seconds;
      const clampedValue = Math.min(
        thirtyDays,
        BaseStorage.maxSignedUrlExpires
      );

      expect(clampedValue).toBe(BaseStorage.maxSignedUrlExpires);
      expect(clampedValue).toBe(Week.seconds);
    });
  });
});
