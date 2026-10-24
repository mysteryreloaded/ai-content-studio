// Upload persistence (issue #50): one row per file a user sends in
// chunks, from create through complete (or a refusal at complete).

import type { Clock } from "@ai-content-studio/shared";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type AuditActor, recordAuditEntry } from "../audit/audit.js";
import type { Database } from "../db/client.js";
import { generations, uploads } from "../db/schema.js";
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
  /** Issue #68: set once an Admin removed this Upload for breaking the rules — its file is gone. */
  removedAt: Date | null;
  removedReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
  lastUsedAt: Date | null;
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
    const [row] = await this.db
      .insert(uploads)
      .values({ ...input, lastUsedAt: input.createdAt })
      .returning();
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
   * chunk for the same range loses instead of double-counting. `now`
   * (issue #69) is also written as `lastUsedAt`, so retention's "24 h
   * after the last chunk" compares an incomplete Upload's own activity,
   * not its original `createdAt`.
   */
  async advance(
    id: string,
    expectedOffset: number,
    newOffset: number,
    now: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(uploads)
      .set({ receivedBytes: newOffset, lastUsedAt: now })
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
      .set({
        status: "complete",
        error: null,
        ...input,
        lastUsedAt: input.completedAt,
      })
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

  /** This user's own Uploads (issue #68's AC: a user's page links to their Uploads, read-only), newest first. */
  async listForUser(userId: string): Promise<UploadRecord[]> {
    const rows = await this.db
      .select()
      .from(uploads)
      .where(eq(uploads.userId, userId))
      .orderBy(desc(uploads.createdAt));
    return rows.map(toRecord);
  }

  /**
   * Marks this Upload removed (issue #68's AC): the caller
   * (uploads/removal.ts) deletes its file first, this just records the
   * Removal and its Audit entry (ADR 0005), which holds only the Upload
   * id, owner and reason.
   */
  async markRemoved(
    id: string,
    userId: string,
    reason: string,
    actor: AuditActor,
    clock: Clock,
    now: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(uploads)
        .set({ removedAt: now, removedReason: reason })
        .where(eq(uploads.id, id));
      await recordAuditEntry(tx, clock, {
        actor,
        targetType: "upload",
        targetId: id,
        action: "remove",
        before: null,
        after: { ownerId: userId, reason },
      });
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
        lastUsedAt: input.createdAt,
      })
      .returning();
    if (!row) throw new Error("insert returned no row");
    return toRecord(row);
  }

  /**
   * Deletes every Upload gone stale (issue #69's AC): `complete` and
   * unreferenced by any non-deleted Generation's own `uploadIds`, or
   * `uploading`/`failed` and simply old — those can never be referenced,
   * so there's nothing to check. "Stale" compares `lastUsedAt`, falling
   * back to `createdAt` for a row from before that column existed.
   * Returns the deleted rows so the caller can remove their files from
   * `Storage`, the same hand-off `GenerationsRepository.finishDelete`
   * makes.
   */
  async deleteUnused(cutoff: Date): Promise<UploadRecord[]> {
    const stale = await this.db
      .select()
      .from(uploads)
      .where(
        sql`coalesce(${uploads.lastUsedAt}, ${uploads.createdAt}) < ${cutoff.toISOString()}`,
      );

    const deleted: UploadRecord[] = [];
    for (const row of stale) {
      if (row.status === "complete") {
        const [stillUsed] = await this.db
          .select({ id: generations.id })
          .from(generations)
          .where(
            and(
              isNull(generations.deletedAt),
              sql`${generations.uploadIds} @> ARRAY[${row.id}]::uuid[]`,
            ),
          )
          .limit(1);
        if (stillUsed) continue;
      }
      await this.db.delete(uploads).where(eq(uploads.id, row.id));
      deleted.push(toRecord(row));
    }
    return deleted;
  }
}
