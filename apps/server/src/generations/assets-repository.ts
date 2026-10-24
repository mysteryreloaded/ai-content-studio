// Asset persistence (issue #44): one row per kept output file. Idempotent
// on (Generation, node id, ComfyUI file name) via a unique index — a
// retried save catches the violation and treats it as "already saved".

import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { assets, generations } from "../db/schema.js";

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
}

/** The Asset's own id plus the Generation's owner, for `/api/assets/:id`'s ownership check. */
export interface AssetWithOwner extends AssetRecord {
  ownerId: string;
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
      .select({ asset: assets, ownerId: generations.userId })
      .from(assets)
      .innerJoin(generations, eq(generations.id, assets.generationId))
      .where(eq(assets.id, id));
    if (!row) return null;
    return { ...toRecord(row.asset), ownerId: row.ownerId };
  }

  async listForGeneration(generationId: string): Promise<AssetRecord[]> {
    const rows = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.generationId, generationId)));
    return rows.map(toRecord).sort((a, b) => a.sortOrder - b.sortOrder);
  }
}
