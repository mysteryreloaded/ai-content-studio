// Issue #77's `check-storage`: compares what the database references
// against what's actually under the data directory, reporting files
// the database expects but storage doesn't have ("missing") and files
// storage has that nothing references ("orphaned"). Shipped in the
// image so an Operator runs it inside the `studio` container, after a
// restore or on its own:
//
//   docker compose exec studio bun run apps/server/src/storage/check-storage.ts [--fix]
//
// `--fix` deletes orphaned files and tombstones (ADR 0011) any
// Generation whose Asset file is missing, the same shape a user's own
// delete leaves. It never touches a missing Upload file — there's no
// Tombstone-shaped fix for an Upload, so those are reported only.

import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Database } from "../db/client.js";
import { createDatabase } from "../db/client.js";
import { assets, siteSettings, uploads as uploadsTable } from "../db/schema.js";
import { deleteStorageFor } from "../generations/deletion.js";
import { GenerationsRepository } from "../generations/repository.js";
import type { Storage } from "./storage.js";
import { createLocalStorage } from "./storage.js";

export type MissingSource = "asset" | "upload" | "branding";

export interface MissingFile {
  key: string;
  source: MissingSource;
  generationId?: string;
  /** Only set on an Asset's own `storageKey`, not its poster/thumbnail (issue #77 CEO review): only a missing main file should tombstone the Generation. */
  primary?: boolean;
}

/** An hour's grace for a file whose row insert hasn't landed yet (issue #77 CEO review): `runner.ts`'s `saveAssets` and the Upload transcode write a file, then insert its row — a file younger than this during that window looks orphaned (or its Asset looks missing) but isn't. */
const RACE_GRACE_MS = 60 * 60 * 1000;

/** `runner.ts`'s `finishAsset` (issue #45) and `c2pa.ts`'s signer (issue #75) write under these names before renaming over the final file; never treat one as orphaned, whatever its age. */
function isInProgressTempName(name: string): boolean {
  return (
    name.includes(".tmp-") ||
    name.includes(".finishing-") ||
    name.includes(".c2pa-manifest-") ||
    name.includes(".c2pa-signing-")
  );
}

export interface CheckStorageReport {
  missing: MissingFile[];
  orphaned: string[];
  /** Only set when `fix: true`: files actually deleted. */
  deletedOrphans: string[];
  /** Only set when `fix: true`: Generations tombstoned for a missing Asset. */
  tombstonedGenerationIds: string[];
}

interface FoundFile {
  key: string;
  mtimeMs: number;
}

/** Every file under `root`, relative to it, skipping in-progress writes (storage.ts's `*.tmp-*`, and Asset finishing/signing's own temp names). */
async function listFiles(root: string, dir = root): Promise<FoundFile[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: FoundFile[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, full)));
    } else if (entry.isFile() && !isInProgressTempName(entry.name)) {
      const key = path.relative(root, full).split(path.sep).join("/");
      files.push({ key, mtimeMs: (await stat(full)).mtimeMs });
    }
  }
  return files;
}

export async function checkStorage(
  db: Database,
  storage: Storage,
  dataDir: string,
  now: Date,
  options: { fix: boolean },
): Promise<CheckStorageReport> {
  const assetRows = await db
    .select({
      generationId: assets.generationId,
      storageKey: assets.storageKey,
      posterKey: assets.posterKey,
      thumbnailKey: assets.thumbnailKey,
    })
    .from(assets);
  const uploadRows = await db
    .select({
      storageKey: uploadsTable.storageKey,
      thumbnailKey: uploadsTable.thumbnailKey,
    })
    .from(uploadsTable);
  const [settingsRow] = await db
    .select({
      logoKey: siteSettings.logoKey,
      backgroundKey: siteSettings.backgroundKey,
    })
    .from(siteSettings);

  const referenced = new Map<string, MissingFile>();
  for (const row of assetRows) {
    referenced.set(row.storageKey, {
      key: row.storageKey,
      source: "asset",
      generationId: row.generationId,
      primary: true,
    });
    if (row.posterKey) {
      referenced.set(row.posterKey, {
        key: row.posterKey,
        source: "asset",
        generationId: row.generationId,
      });
    }
    if (row.thumbnailKey) {
      referenced.set(row.thumbnailKey, {
        key: row.thumbnailKey,
        source: "asset",
        generationId: row.generationId,
      });
    }
  }
  for (const row of uploadRows) {
    referenced.set(row.storageKey, { key: row.storageKey, source: "upload" });
    if (row.thumbnailKey) {
      referenced.set(row.thumbnailKey, {
        key: row.thumbnailKey,
        source: "upload",
      });
    }
  }
  if (settingsRow?.logoKey) {
    referenced.set(settingsRow.logoKey, {
      key: settingsRow.logoKey,
      source: "branding",
    });
  }
  if (settingsRow?.backgroundKey) {
    referenced.set(settingsRow.backgroundKey, {
      key: settingsRow.backgroundKey,
      source: "branding",
    });
  }

  const onDisk = new Map(
    (await listFiles(dataDir)).map((file) => [file.key, file.mtimeMs]),
  );

  const missing = [...referenced.values()].filter(
    (ref) => !onDisk.has(ref.key),
  );
  // A file younger than RACE_GRACE_MS isn't reported (or deleted) as
  // orphaned: saveAssets/the Upload transcode write it before inserting
  // its row, so one freshly written during that window has no row yet
  // but isn't actually abandoned (issue #77 CEO review).
  const orphaned = [...onDisk.entries()]
    .filter(([key]) => !referenced.has(key))
    .filter(([, mtimeMs]) => now.getTime() - mtimeMs >= RACE_GRACE_MS)
    .map(([key]) => key);

  const report: CheckStorageReport = {
    missing,
    orphaned,
    deletedOrphans: [],
    tombstonedGenerationIds: [],
  };

  if (!options.fix) return report;

  for (const key of orphaned) {
    await storage.delete(key);
    report.deletedOrphans.push(key);
  }

  // Only the Asset's own file missing tombstones the Generation (issue
  // #77 CEO review): a missing poster/thumbnail alone leaves the
  // intact main file (and its Asset row) untouched.
  const generationIds = [
    ...new Set(
      missing
        .filter(
          (item) =>
            item.source === "asset" && item.primary && item.generationId,
        )
        .map((item) => item.generationId as string),
    ),
  ];
  if (generationIds.length > 0) {
    const repository = new GenerationsRepository(db);
    const keys = await repository.tombstoneGenerationsWithMissingAssets(
      generationIds,
      now,
    );
    await deleteStorageFor(storage, keys);
    report.tombstonedGenerationIds = generationIds;
  }

  return report;
}

function printReport(report: CheckStorageReport, fix: boolean): void {
  console.log(`missing: ${report.missing.length}`);
  for (const item of report.missing) {
    const suffix = item.generationId
      ? ` (generation ${item.generationId})`
      : "";
    console.log(`  - [${item.source}] ${item.key}${suffix}`);
  }
  console.log(`orphaned: ${report.orphaned.length}`);
  for (const key of report.orphaned) {
    console.log(`  - ${key}`);
  }
  if (fix) {
    console.log(`deleted ${report.deletedOrphans.length} orphaned file(s)`);
    console.log(
      `tombstoned ${report.tombstonedGenerationIds.length} Generation(s) with missing Assets`,
    );
  }
}

if (import.meta.main) {
  const fix = process.argv.includes("--fix");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL must be set");
    process.exit(1);
  }
  const dataDir = process.env.DATA_DIR ?? "/data";

  const { sql, db } = createDatabase(databaseUrl);
  const storage = createLocalStorage(dataDir);
  try {
    const report = await checkStorage(db, storage, dataDir, new Date(), {
      fix,
    });
    printReport(report, fix);

    // Only a missing primary Asset file is actually resolved by --fix
    // (tombstoned); a missing poster/thumbnail alone isn't touched
    // (issue #77 CEO review), so it stays unresolved.
    const unresolvedMissing = fix
      ? report.missing.filter(
          (item) => !(item.source === "asset" && item.primary),
        )
      : report.missing;
    const unresolvedOrphaned = fix ? [] : report.orphaned;
    if (unresolvedMissing.length > 0 || unresolvedOrphaned.length > 0) {
      process.exit(1);
    }
  } finally {
    await sql.end();
  }
}
