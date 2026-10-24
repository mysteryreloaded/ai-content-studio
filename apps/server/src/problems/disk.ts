import { statfs } from "node:fs/promises";

/** Bytes available to an unprivileged process on the disk holding `dir`. */
export async function freeDiskBytes(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}
