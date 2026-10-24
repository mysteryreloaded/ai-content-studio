import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StorageStat {
  size: number;
}

/** Local-disk file storage, rooted at one directory (normally `/data`). */
export interface Storage {
  write(key: string, data: Uint8Array): Promise<void>;
  read(key: string): Promise<Buffer>;
  stat(key: string): Promise<StorageStat | null>;
  delete(key: string): Promise<void>;
  /**
   * Streams `response`'s body straight to a temp file, then renames it
   * into place (issue #44: saving a Generation's Asset from a Backend's
   * `/view`), so a reader never sees a partially-written file. Returns
   * the bytes written.
   */
  writeResponseBody(key: string, response: Response): Promise<number>;
  /** The absolute path for `key` (issue #44: Range-serving an Asset needs a real file, not just its bytes). */
  absolutePath(key: string): string;
}

function resolveKeyPath(root: string, key: string): string {
  if (key.includes("..") || path.isAbsolute(key)) {
    throw new Error(`invalid storage key: ${key}`);
  }
  return path.join(root, key);
}

/** A `Storage` backed by the filesystem under `root`, created on first write. */
export function createLocalStorage(root: string): Storage {
  return {
    async write(key, data) {
      const filePath = resolveKeyPath(root, key);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, data);
    },

    async read(key) {
      return readFile(resolveKeyPath(root, key));
    },

    async stat(key) {
      try {
        const info = await stat(resolveKeyPath(root, key));
        return { size: info.size };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },

    async delete(key) {
      await rm(resolveKeyPath(root, key), { force: true });
    },

    async writeResponseBody(key, response) {
      const filePath = resolveKeyPath(root, key);
      await mkdir(path.dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.tmp-${crypto.randomUUID()}`;
      const bytesWritten = await Bun.write(tmpPath, response);
      await rename(tmpPath, filePath);
      return bytesWritten;
    },

    absolutePath(key) {
      return resolveKeyPath(root, key);
    },
  };
}
