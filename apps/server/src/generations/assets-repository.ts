// Asset persistence (issue #44): one row per kept output file. Idempotent
// on (Generation, node id, ComfyUI file name) via a unique index — a
// retried save catches the violation and treats it as "already saved".

import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { assets, generations, models, modes } from "../db/schema.js";

export interface AssetRecord {
  id: string;
  generationId: string;
  nodeId: string;
  sortOrder: number;
  kind: string;
  comfyuiFilename: string;
  contentType: string;
  size: number;
  storageKey: string;
  /** Issue #45: null when finishing never ran for this kind (audio) or couldn't read the file. */
  posterKey: string | null;
  thumbnailKey: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
}

type Row = typeof assets.$inferSelect;

function toRecord(row: Row): AssetRecord {
  return {
    id: row.id,
    generationId: row.generationId,
    nodeId: row.nodeId,
    sortOrder: row.sortOrder,
    kind: row.kind,
    comfyuiFilename: row.comfyuiFilename,
    contentType: row.contentType,
    size: row.size,
    storageKey: row.storageKey,
    posterKey: row.posterKey,
    thumbnailKey: row.thumbnailKey,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    fps: row.fps,
  };
}

function isUniqueViolation(err: unknown): boolean {
  const cause =
    err && typeof err === "object" && "cause" in err ? err.cause : err;
  return Boolean(
    cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "23505",
  );
}

export interface CreateAssetInput {
  generationId: string;
  nodeId: string;
  sortOrder: number;
  kind: string;
  comfyuiFilename: string;
  contentType: string;
  size: number;
  storageKey: string;
  posterKey?: string | null;
  thumbnailKey?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  fps?: number | null;
}

/**
 * The Asset's own id plus the Generation's owner (for `/api/assets/:id`'s
 * ownership check, shared by `/poster` and `/thumb`) and the Model slug
 * and Mode name (issue #45: for `?download=1`'s file name).
 */
export interface AssetWithOwner extends AssetRecord {
  ownerId: string;
  modelSlug: string;
  modeName: string;
  /** Issue #68: set once an Admin removed the Asset's own Generation — `/api/assets/:id` 404s it for anyone but an Admin. */
  generationRemovedAt: Date | null;
}

export class AssetsRepository {
  constructor(private readonly db: Database) {}

  /** Inserts the Asset, or returns `null` if it's already saved (same Generation, node and file name). */
  async createIfAbsent(input: CreateAssetInput): Promise<AssetRecord | null> {
    try {
      const [row] = await this.db.insert(assets).values(input).returning();
      if (!row) throw new Error("insert returned no row");
      return toRecord(row);
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  async getWithOwner(id: string): Promise<AssetWithOwner | null> {
    const [row] = await this.db
      .select({
        asset: assets,
        ownerId: generations.userId,
        modelSlug: models.slug,
        modeName: modes.name,
        generationRemovedAt: generations.removedAt,
      })
      .from(assets)
      .innerJoin(generations, eq(generations.id, assets.generationId))
      .innerJoin(models, eq(models.id, generations.modelId))
      .innerJoin(modes, eq(modes.id, generations.modeId))
      .where(eq(assets.id, id));
    if (!row) return null;
    return {
      ...toRecord(row.asset),
      ownerId: row.ownerId,
      modelSlug: row.modelSlug,
      modeName: row.modeName,
      generationRemovedAt: row.generationRemovedAt,
    };
  }

  async listForGeneration(generationId: string): Promise<AssetRecord[]> {
    const rows = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.generationId, generationId)));
    return rows
      .map(toRecord)
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          a.comfyuiFilename.localeCompare(b.comfyuiFilename),
      );
  }

  /**
   * Deletes every Asset of a Generation and returns the rows (issue
   * #68's AC): used when a save lands after an Admin already removed
   * the Generation mid-save, so the runner can delete the files it
   * just wrote instead of leaving them live.
   */
  async deleteForGeneration(generationId: string): Promise<AssetRecord[]> {
    const rows = await this.db
      .delete(assets)
      .where(eq(assets.generationId, generationId))
      .returning();
    return rows.map(toRecord);
  }
}
