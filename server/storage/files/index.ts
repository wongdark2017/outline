import env from "@server/env";
import LocalStorage from "./LocalStorage";
import S3Storage from "./S3Storage";
import BaseStorage from "./BaseStorage";

function createStorage(): BaseStorage {
  return env.FILE_STORAGE === "local" ? new LocalStorage() : new S3Storage();
}

let currentStorage = createStorage();

class FileStorage extends BaseStorage {
  public getPresignedPost(...args: Parameters<BaseStorage["getPresignedPost"]>) {
    return currentStorage.getPresignedPost(...args);
  }

  public getFileStream(...args: Parameters<BaseStorage["getFileStream"]>) {
    return currentStorage.getFileStream(...args);
  }

  public getUploadUrl(...args: Parameters<BaseStorage["getUploadUrl"]>) {
    return currentStorage.getUploadUrl(...args);
  }

  public getUrlForKey(...args: Parameters<BaseStorage["getUrlForKey"]>) {
    return currentStorage.getUrlForKey(...args);
  }

  public getSignedUrl(...args: Parameters<BaseStorage["getSignedUrl"]>) {
    return currentStorage.getSignedUrl(...args);
  }

  public store(...args: Parameters<BaseStorage["store"]>) {
    return currentStorage.store(...args);
  }

  public getFileHandle(...args: Parameters<BaseStorage["getFileHandle"]>) {
    return currentStorage.getFileHandle(...args);
  }

  public getFileExists(...args: Parameters<BaseStorage["getFileExists"]>) {
    return currentStorage.getFileExists(...args);
  }

  public moveFile(...args: Parameters<BaseStorage["moveFile"]>) {
    return currentStorage.moveFile(...args);
  }

  public deleteFile(...args: Parameters<BaseStorage["deleteFile"]>) {
    return currentStorage.deleteFile(...args);
  }
}

const storage = new FileStorage();

/**
 * Rebuilds the active file storage implementation from the current env.
 *
 * @returns the storage delegate used by existing imports.
 */
export function resetFileStorage() {
  currentStorage = createStorage();
  return storage;
}

export default storage;
