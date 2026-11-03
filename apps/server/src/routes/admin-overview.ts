// `/api/admin/overview`: the Overview admin landing page (issue #70,
// issue #203). Polled every 10s. Problems, Backends, Models (queue
// figures) and the disk/errors/version/uptime Studio facts; Pause and
// the Notice are read from `/api/admin/site-settings` instead (#202),
// not duplicated here.

import type { Clock } from "@ai-content-studio/shared";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { BackendRepository } from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";
import type { Database } from "../db/client.js";
import {
  backends as backendsTable,
  generations,
  logEntries,
  modelBackends,
  models as modelsTable,
  modes as modesTable,
} from "../db/schema.js";
import type { ModelRepository } from "../models/repository.js";
import { freeDiskBytes } from "../problems/disk.js";
import type { ProblemsRegistry } from "../problems/problems.js";

const BYTES_PER_GB = 1024 * 1024 * 1024;
const MEDIAN_WAIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RUNNING_STATES = ["starting", "running", "saving"] as const;

export function adminOverviewRoute(
  db: Database,
  clock: Clock,
  registry: ProblemsRegistry,
  backendRepository: BackendRepository,
  backendsService: BackendsService,
  modelRepository: ModelRepository,
  dataDir: string,
  minFreeDiskGb: number,
  appVersion: string,
  bootTime: Date,
  routes: RouteEntry[],
) {
  const basePath = "/api/admin/overview";

  return new Hono<AppEnv>().get(
    "/",
    guard(routes, basePath, "get", "/", "admin"),
    async (c) => {
      const [backendList, modelList, errors24h, freeDiskGb] = await Promise.all(
        [
          backendRepository.list(),
          modelRepository.list(),
          countErrors24h(db, clock),
          diskFreeGbOrNull(dataDir),
        ],
      );

      const [runningByBackend, modelQueueStats, attachedBackendRows] =
        await Promise.all([
          runningGenerationsByBackend(db),
          modelQueueStatsFor(db, clock),
          attachedBackendsFor(db),
        ]);

      const problems = registry.list().map((problem) => ({
        code: problem.code,
        message: problem.message,
        target: problem.target,
        since: problem.since.toISOString(),
      }));

      const backends = backendList.map((backend) => ({
        id: backend.id,
        name: backend.name,
        enabled: backend.enabled,
        draining: backend.draining,
        health: backendsService.healthFor(backend.id),
        unreachableSince:
          backendsService.unreachableSince(backend.id)?.toISOString() ?? null,
        running: runningByBackend.get(backend.id) ?? null,
      }));

      const models = modelList.map((model) => {
        const attached = attachedBackendRows.get(model.id) ?? [];
        const usableBackends = attached.filter((backendId) => {
          const backend = backendList.find((b) => b.id === backendId);
          if (!backend || !backend.enabled || backend.draining) return false;
          const health = backendsService.healthFor(backendId);
          return (
            !health.credentialsError && health.reachability === "reachable"
          );
        }).length;
        const stats = modelQueueStats.get(model.id);

        return {
          id: model.id,
          name: model.name,
          slug: model.slug,
          enabled: model.state === "enabled",
          queued: stats?.queued ?? 0,
          running: stats?.running ?? 0,
          oldestQueuedAt: stats?.oldestQueuedAt?.toISOString() ?? null,
          medianWait24hMs: stats?.medianWait24hMs ?? null,
          usableBackends,
          attachedBackends: attached.length,
        };
      });

      return c.json({
        problems,
        backends,
        models,
        disabledBanner: backendsService.disabledBanner,
        disk: { freeGb: freeDiskGb, minFreeDiskGb },
        errors24h,
        version: appVersion,
        uptimeSeconds: Math.floor(
          (clock.now().getTime() - bootTime.getTime()) / 1000,
        ),
      });
    },
  );
}

async function countErrors24h(db: Database, clock: Clock): Promise<number> {
  const since = new Date(clock.now().getTime() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(logEntries)
    .where(
      and(eq(logEntries.level, "error"), gte(logEntries.createdAt, since)),
    );
  return Number(row?.count ?? 0);
}

async function diskFreeGbOrNull(dataDir: string): Promise<number | null> {
  try {
    return (await freeDiskBytes(dataDir)) / BYTES_PER_GB;
  } catch {
    return null;
  }
}

interface RunningOnBackend {
  generationId: string;
  modelName: string;
  modeName: string;
}

/** The Generation currently starting, running or saving on each Backend; the most recently started one, when more than one try overlaps a `saving` handoff. */
async function runningGenerationsByBackend(
  db: Database,
): Promise<Map<string, RunningOnBackend>> {
  const rows = await db
    .select({
      backendId: generations.backendId,
      generationId: generations.id,
      modelName: modelsTable.name,
      modeName: modesTable.name,
      startedAt: generations.startedAt,
    })
    .from(generations)
    .innerJoin(modelsTable, eq(modelsTable.id, generations.modelId))
    .innerJoin(modesTable, eq(modesTable.id, generations.modeId))
    .where(
      and(
        inArray(generations.state, RUNNING_STATES),
        sql`${generations.backendId} is not null`,
      ),
    );

  const byBackend = new Map<
    string,
    RunningOnBackend & { startedAt: Date | null }
  >();
  for (const row of rows) {
    if (!row.backendId) continue;
    const existing = byBackend.get(row.backendId);
    const startedAt = row.startedAt;
    if (
      !existing ||
      (startedAt && (!existing.startedAt || startedAt > existing.startedAt))
    ) {
      byBackend.set(row.backendId, {
        generationId: row.generationId,
        modelName: row.modelName,
        modeName: row.modeName,
        startedAt,
      });
    }
  }

  const result = new Map<string, RunningOnBackend>();
  for (const [backendId, entry] of byBackend) {
    result.set(backendId, {
      generationId: entry.generationId,
      modelName: entry.modelName,
      modeName: entry.modeName,
    });
  }
  return result;
}

interface ModelQueueStats {
  queued: number;
  running: number;
  oldestQueuedAt: Date | null;
  medianWait24hMs: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/** Per-Model queued/running counts, the oldest queued wait and the 24h median start wait, for the Overview's Models table. */
async function modelQueueStatsFor(
  db: Database,
  clock: Clock,
): Promise<Map<string, ModelQueueStats>> {
  const since = new Date(clock.now().getTime() - MEDIAN_WAIT_WINDOW_MS);

  const [queueRows, waitRows] = await Promise.all([
    db
      .select({
        modelId: generations.modelId,
        state: generations.state,
        queuedAt: generations.queuedAt,
      })
      .from(generations)
      .where(inArray(generations.state, ["queued", ...RUNNING_STATES])),
    db
      .select({
        modelId: generations.modelId,
        queuedAt: generations.queuedAt,
        startedAt: generations.startedAt,
      })
      .from(generations)
      .where(
        and(
          sql`${generations.startedAt} is not null`,
          gte(generations.startedAt, since),
        ),
      ),
  ]);

  const stats = new Map<string, ModelQueueStats>();
  function statsFor(modelId: string): ModelQueueStats {
    let entry = stats.get(modelId);
    if (!entry) {
      entry = {
        queued: 0,
        running: 0,
        oldestQueuedAt: null,
        medianWait24hMs: null,
      };
      stats.set(modelId, entry);
    }
    return entry;
  }

  for (const row of queueRows) {
    const entry = statsFor(row.modelId);
    if (row.state === "queued") {
      entry.queued += 1;
      if (!entry.oldestQueuedAt || row.queuedAt < entry.oldestQueuedAt) {
        entry.oldestQueuedAt = row.queuedAt;
      }
    } else {
      entry.running += 1;
    }
  }

  const waitsByModel = new Map<string, number[]>();
  for (const row of waitRows) {
    if (!row.startedAt) continue;
    const waits = waitsByModel.get(row.modelId) ?? [];
    waits.push(row.startedAt.getTime() - row.queuedAt.getTime());
    waitsByModel.set(row.modelId, waits);
  }
  for (const [modelId, waits] of waitsByModel) {
    statsFor(modelId).medianWait24hMs = median(waits);
  }

  return stats;
}

/** Every attached (non-deleted) Backend's id, grouped by Model, for the Overview's "N of M usable Backends". */
async function attachedBackendsFor(
  db: Database,
): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      modelId: modelBackends.modelId,
      backendId: modelBackends.backendId,
    })
    .from(modelBackends)
    .innerJoin(backendsTable, eq(backendsTable.id, modelBackends.backendId))
    .where(isNull(backendsTable.deletedAt));

  const byModel = new Map<string, string[]>();
  for (const row of rows) {
    const list = byModel.get(row.modelId) ?? [];
    list.push(row.backendId);
    byModel.set(row.modelId, list);
  }
  return byModel;
}
