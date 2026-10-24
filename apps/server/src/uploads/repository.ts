// Upload persistence (issue #50): one row per file a user sends in
// chunks, from create through complete (or a refusal at complete).

import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { uploads } from "../db/schema.js";
import type {
  AudioProbeFacts,
  ImageProbeFacts,
  VideoProbeFacts,
} from "./probe.js";

export type UploadStatus = "uploading" | "complete" | "failed";

export type UploadProbeFacts =
  | ImageProbeFacts
  | VideoProbeFacts
  | AudioProbeFacts;

export interface UploadRecord {
  id: string;
  userId: string;
  status: UploadStatus;
  originalName: string;
  declaredType: string;
  size: number;
  receivedBytes: number;
  modelId: string | null;
  inputId: string | null;
  storageKey: string;
  thumbnailKey: string | null;
  kind: string | null;
  extension: string | null;
  contentType: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
  probe: UploadProbeFacts | null;
  trimmedFromId: string | null;
  trimStartMs: number | null;
  trimEndMs: number | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

type UploadRow = typeof uploads.$inferSelect;

function toRecord(row: UploadRow): UploadRecord {
  return { ...row, probe: (row.probe as UploadProbeFacts | null) ?? null };
}

export interface CreateUploadInput {
  id: string;
  userId: string;
  originalName: string;
  declaredType: string;
  size: number;
  modelId: string | null;
  inputId: string | null;
  storageKey: string;
  createdAt: Date;
}

export interface CompleteUploadInput {
  kind: string;
  extension: string;
  contentType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
  probe: UploadProbeFacts;
  thumbnailKey: string | null;
  completedAt: Date;
}

/**
 * A new Upload made by trimming another one (issue #51): already
 * `complete`, with its own probe facts, inserted in one row rather than
 * created then completed.
 */
export interface CreateTrimmedUploadInput {
  id: string;
  userId: string;
  originalName: string;
  declaredType: string;
  size: number;
  modelId: string | null;
  inputId: string | null;
  storageKey: string;
  kind: string;
  extension: string;
  contentType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
  probe: UploadProbeFacts;
  thumbnailKey: string | null;
  trimmedFromId: string;
  trimStartMs: number;
  trimEndMs: number;
  createdAt: Date;
}

export class UploadsRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateUploadInput): Promise<UploadRecord> {
    const [row] = await this.db.insert(uploads).values(input).returning();
    if (!row) throw new Error("insert returned no row");
    return toRecord(row);
  }

  async get(id: string): Promise<UploadRecord | null> {
    const [row] = await this.db
      .select()
      .from(uploads)
      .where(eq(uploads.id, id));
    return row ? toRecord(row) : null;
  }

  async listByIds(ids: readonly string[]): Promise<UploadRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(uploads)
      .where(inArray(uploads.id, [...ids]));
    return rows.map(toRecord);
  }

  /**
   * Moves the offset from `expectedOffset` to `newOffset`, only while the
   * Upload is still `uploading` at that offset: a concurrent or replayed
   * chunk for the same range loses instead of double-counting.
   */
  async advance(
    id: string,
    expectedOffset: number,
    newOffset: number,
  ): Promise<boolean> {
    const rows = await this.db
      .update(uploads)
      .set({ receivedBytes: newOffset })
      .where(
        and(
          eq(uploads.id, id),
          eq(uploads.status, "uploading"),
          eq(uploads.receivedBytes, expectedOffset),
        ),
      )
      .returning({ id: uploads.id });
    return rows.length > 0;
  }

  async markComplete(
    id: string,
    input: CompleteUploadInput,
  ): Promise<UploadRecord> {
    const [row] = await this.db
      .update(uploads)
      .set({ status: "complete", error: null, ...input })
      .where(eq(uploads.id, id))
      .returning();
    if (!row) throw new Error("upload vanished");
    return toRecord(row);
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.db
      .update(uploads)
      .set({ status: "failed", error })
      .where(eq(uploads.id, id));
  }

  /**
   * Deletes every Upload this user has left, but not one in `inUseIds`
   * (issue #63's account delete, round 4 fix): unused, failed and still-
   * uploading ones go straight away — `finishDelete`'s own sweep only
   * catches an Upload a Tombstoned Generation referenced, so this is the
   * rest. Returns each deleted row's storage/thumbnail keys for the
   * caller to remove from `Storage`.
   */
  async deleteAllForUserExcept(
    userId: string,
    inUseIds: readonly string[],
  ): Promise<{ storageKey: string; thumbnailKey: string | null }[]> {
    return this.db
      .delete(uploads)
      .where(
        inUseIds.length === 0
          ? eq(uploads.userId, userId)
          : and(
              eq(uploads.userId, userId),
              notInArray(uploads.id, [...inUseIds]),
            ),
      )
      .returning({
        storageKey: uploads.storageKey,
        thumbnailKey: uploads.thumbnailKey,
      });
  }

  /** Inserts a trimmed Upload (issue #51), already `complete`. */
  async createTrimmed(input: CreateTrimmedUploadInput): Promise<UploadRecord> {
    const [row] = await this.db
      .insert(uploads)
      .values({
        ...input,
        status: "complete",
        receivedBytes: input.size,
        completedAt: input.createdAt,
      })
      .returning();
    if (!row) throw new Error("insert returned no row");
    return toRecord(row);
  }
}
