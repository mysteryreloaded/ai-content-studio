// `/api/admin/overview`: the Overview admin landing page (issue #70).
// Polled every 10s. Models and Pause/Notice aren't included: Models
// (issues #40-#58) and Pause/Notice (issue #59) don't exist yet.

import type { Clock } from "@ai-content-studio/shared";
import { and, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { BackendRepository } from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";
import type { Database } from "../db/client.js";
import { logEntries } from "../db/schema.js";
import { freeDiskBytes } from "../problems/disk.js";
import type { ProblemsRegistry } from "../problems/problems.js";

const BYTES_PER_GB = 1024 * 1024 * 1024;

export function adminOverviewRoute(
  db: Database,
  clock: Clock,
  registry: ProblemsRegistry,
  backendRepository: BackendRepository,
  backendsService: BackendsService,
  dataDir: string,
  minFreeDiskGb: number,
  appVersion: string,
  bootTime: Date,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const basePath = "/api/admin/overview";

  guardedRoute(app, routes, basePath, "get", "/", "admin", async (c) => {
    const [backendList, errors24h, freeDiskGb] = await Promise.all([
      backendRepository.list(),
      countErrors24h(db, clock),
      diskFreeGbOrNull(dataDir),
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
      health: backendsService.healthFor(backend.id),
      unreachableSince:
        backendsService.unreachableSince(backend.id)?.toISOString() ?? null,
    }));

    return c.json({
      problems,
      backends,
      disabledBanner: backendsService.disabledBanner,
      disk: { freeGb: freeDiskGb, minFreeDiskGb },
      errors24h,
      version: appVersion,
      uptimeSeconds: Math.floor(
        (clock.now().getTime() - bootTime.getTime()) / 1000,
      ),
    });
  });

  return app;
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
