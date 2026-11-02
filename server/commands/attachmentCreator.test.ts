import { randomUUID } from "node:crypto";
import { addHours } from "date-fns";
import { UniqueConstraintError } from "sequelize";
import { afterEach, describe, expect, it, vi } from "vitest";
import Logger from "@server/logging/Logger";
import { Attachment } from "@server/models";
import FileStorage from "@server/storage/files";
import { AttachmentPreset } from "@shared/types";
import { createContext } from "@server/context";
import { buildTeam, buildUser } from "@server/test/factories";
import attachmentCreator from "./attachmentCreator";

describe("attachmentCreator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the existing attachment without re-uploading when the id was already used", async () => {
    const user = await buildUser();
    const id = randomUUID();
    const store = vi.spyOn(FileStorage, "store").mockResolvedValue(undefined);

    const first = await attachmentCreator({
      id,
      name: "image.png",
      type: "image/png",
      buffer: Buffer.from("one"),
      preset: AttachmentPreset.DocumentAttachment,
      user,
      ctx: createContext({ user }),
    });

    const second = await attachmentCreator({
      id,
      name: "image.png",
      type: "image/png",
      buffer: Buffer.from("one"),
      preset: AttachmentPreset.DocumentAttachment,
      user,
      ctx: createContext({ user }),
    });

    expect(first?.id).toBe(id);
    expect(second?.id).toBe(id);
    expect(second?.key).toBe(first?.key);
    expect(store).toHaveBeenCalledTimes(1);
    expect(await Attachment.count({ where: { id } })).toBe(1);
  });

  it("derives the storage key from the supplied id so a retry reuses it", async () => {
    const user = await buildUser();
    const id = randomUUID();
    vi.spyOn(FileStorage, "store").mockResolvedValue(undefined);

    const attachment = await attachmentCreator({
      id,
      name: "image.png",
      type: "image/png",
      buffer: Buffer.from("one"),
      preset: AttachmentPreset.DocumentAttachment,
      user,
      ctx: createContext({ user }),
    });

    expect(attachment?.key).toContain(id);
  });

  it("does not resolve an id belonging to another team", async () => {
    const otherTeam = await buildTeam();
    const otherUser = await buildUser({ teamId: otherTeam.id });
    const user = await buildUser();
    const id = randomUUID();
    vi.spyOn(FileStorage, "store").mockResolvedValue(undefined);

    await attachmentCreator({
      id,
      name: "secret.png",
      type: "image/png",
      buffer: Buffer.from("one"),
      preset: AttachmentPreset.DocumentAttachment,
      user: otherUser,
      ctx: createContext({ user: otherUser }),
    });

    await expect(
      attachmentCreator({
        id,
        name: "image.png",
        type: "image/png",
        buffer: Buffer.from("two"),
        preset: AttachmentPreset.DocumentAttachment,
        user,
        ctx: createContext({ user }),
      })
    ).rejects.toThrow();

    const attachment = await Attachment.findByPk(id);
    expect(attachment?.teamId).toBe(otherTeam.id);
  });

  it("persists an optional expiry while ordinary attachments remain permanent", async () => {
    const user = await buildUser();
    vi.spyOn(FileStorage, "store").mockResolvedValue("http://localhost/stored");
    const expiresAt = addHours(new Date(), 24);
    const attachment = await attachmentCreator({
      name: "temporary.png",
      type: "image/png",
      buffer: Buffer.from("one"),
      preset: AttachmentPreset.DocumentAttachment,
      expiresAt,
      user,
      ctx: createContext({ user }),
    });
    if (!attachment) {
      throw new Error("Expected an uploaded attachment");
    }

    await attachment.reload();
    expect(attachment.expiresAt?.getTime()).toBe(expiresAt.getTime());

    const permanent = await attachmentCreator({
      name: "permanent.png",
      type: "image/png",
      buffer: Buffer.from("two"),
      preset: AttachmentPreset.DocumentAttachment,
      user,
      ctx: createContext({ user }),
    });
    if (!permanent) {
      throw new Error("Expected an uploaded attachment");
    }

    await permanent.reload();
    expect(permanent.expiresAt).toBeNull();
  });

  it("deletes the stored file when the buffer attachment record cannot be created", async () => {
    const user = await buildUser();
    const store = vi
      .spyOn(FileStorage, "store")
      .mockResolvedValue("http://localhost/stored");
    const deleteFile = vi
      .spyOn(FileStorage, "deleteFile")
      .mockResolvedValue(undefined);
    const originalError = new Error("database unavailable");
    vi.spyOn(Attachment, "createWithCtx").mockRejectedValueOnce(originalError);

    await expect(
      attachmentCreator({
        name: "image.png",
        type: "image/png",
        buffer: Buffer.from("one"),
        preset: AttachmentPreset.DocumentAttachment,
        user,
        ctx: createContext({ user }),
      })
    ).rejects.toBe(originalError);

    expect(store).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledExactlyOnceWith(
      store.mock.calls[0][0].key
    );
    expect(await Attachment.count({ where: { teamId: user.teamId } })).toBe(0);
  });

  it("deletes a data image uploaded through storeFromUrl when its record cannot be created", async () => {
    const user = await buildUser();
    const store = vi
      .spyOn(FileStorage, "store")
      .mockResolvedValue("http://localhost/stored");
    const deleteFile = vi
      .spyOn(FileStorage, "deleteFile")
      .mockResolvedValue(undefined);
    const originalError = new Error("database unavailable");
    const create = vi
      .spyOn(Attachment, "createWithCtx")
      .mockRejectedValueOnce(originalError);
    const content = Buffer.from("image data");

    await expect(
      attachmentCreator({
        name: "inline.png",
        url: `data:image/png;base64,${content.toString("base64")}`,
        preset: AttachmentPreset.DocumentAttachment,
        user,
        ctx: createContext({ user }),
      })
    ).rejects.toBe(originalError);

    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0][0].body).toEqual(content);
    expect(create).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledExactlyOnceWith(
      store.mock.calls[0][0].key
    );
  });

  it("logs a failed compensating deletion and rethrows the original record error", async () => {
    const user = await buildUser();
    const store = vi
      .spyOn(FileStorage, "store")
      .mockResolvedValue("http://localhost/stored");
    vi.spyOn(FileStorage, "deleteFile").mockRejectedValue(
      new Error("storage unavailable")
    );
    const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined);
    const originalError = new Error("database unavailable");
    vi.spyOn(Attachment, "createWithCtx").mockRejectedValueOnce(originalError);

    await expect(
      attachmentCreator({
        name: "image.png",
        type: "image/png",
        buffer: Buffer.from("one"),
        preset: AttachmentPreset.DocumentAttachment,
        user,
        ctx: createContext({ user }),
      })
    ).rejects.toBe(originalError);

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Failed to delete attachment file after its record could not be created",
      { key: store.mock.calls[0][0].key, error: "storage unavailable" }
    );
  });

  it("keeps the shared storage key when concurrent calls create the same supplied id", async () => {
    const user = await buildUser();
    const id = randomUUID();
    const uploads: ((url: string) => void)[] = [];
    const store = vi.spyOn(FileStorage, "store").mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          uploads.push(resolve);
          if (uploads.length === 2) {
            uploads.forEach((complete) => complete("http://localhost/stored"));
          }
        })
    );
    const deleteFile = vi
      .spyOn(FileStorage, "deleteFile")
      .mockResolvedValue(undefined);
    const props = {
      id,
      name: "image.png",
      type: "image/png",
      buffer: Buffer.from("same content"),
      preset: AttachmentPreset.DocumentAttachment,
      user,
      ctx: createContext({ user }),
    };

    const results = await Promise.allSettled([
      attachmentCreator(props),
      attachmentCreator(props),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(UniqueConstraintError);
      }
    }

    const winner = await Attachment.findByPk(id, { rejectOnEmpty: true });
    expect(winner.userId).toBe(user.id);
    expect(await Attachment.count({ where: { id } })).toBe(1);
    expect(store).toHaveBeenCalledTimes(2);
    expect(store.mock.calls.map(([upload]) => upload.key)).toEqual([
      winner.key,
      winner.key,
    ]);
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
