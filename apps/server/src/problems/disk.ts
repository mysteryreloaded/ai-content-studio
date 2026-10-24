import { statfs } from "node:fs/promises";

const BYTES_PER_GB = 1024 * 1024 * 1024;

/** Bytes available to an unprivileged process on the disk holding `dir`. */
export async function freeDiskBytes(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}

/**
 * Whether `dir`'s disk still has at least `minFreeGb` free (issue #50:
 * checked before Upload chunks and Submissions, never before saving).
 * A disk that can't be read (e.g. `dir` not created yet) doesn't block.
 */
export async function hasFreeDisk(
  dir: string,
  minFreeGb: number,
): Promise<boolean> {
  try {
    return (await freeDiskBytes(dir)) >= minFreeGb * BYTES_PER_GB;
  } catch {
    return true;
  }
}
