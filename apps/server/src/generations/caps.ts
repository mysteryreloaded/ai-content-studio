// Caps (issue #53, ADR 0009 "Caps are checked in the locking
// transaction"): the daily Cap counts the rolling 24h, excluding
// failed Generations (cancelled-before-running isn't modeled yet —
// #55's concern); the concurrent Cap counts queued through saving. A
// user's effective Cap is their own override (0-1,000) when set,
// otherwise the Site default.

import {
  type CapsStatus,
  DAY_MS,
  effectiveCap,
} from "@ai-content-studio/shared";
import type { Clock } from "@ai-content-studio/shared";
import { and, eq, gt, notInArray, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client.js";
import { generations, siteSettings, users } from "../db/schema.js";

type Queryable = Database | Transaction;

export class DailyCapExceeded extends Error {
  constructor(
    public readonly cap: number,
    public readonly remaining: number,
  ) {
    super("daily_cap_exceeded");
  }
}

export class ConcurrentCapExceeded extends Error {
  constructor(
    public readonly cap: number,
    public readonly remaining: number,
  ) {
    super("concurrent_cap_exceeded");
  }
}

export interface EffectiveCaps {
  dailyCap: number;
  concurrentCap: number;
}

export function effectiveCapsFor(
  site: { dailyCap: number; concurrentCap: number },
  user: {
    dailyCapOverride: number | null;
    concurrentCapOverride: number | null;
  },
): EffectiveCaps {
  return {
    dailyCap: effectiveCap(site.dailyCap, user.dailyCapOverride),
    concurrentCap: effectiveCap(site.concurrentCap, user.concurrentCapOverride),
  };
}

/** Toward the daily Cap: this user's own Generations submitted since `since`, excluding failed ones. */
export async function countDailyForUser(
  db: Queryable,
  userId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        gt(generations.submittedAt, since),
        notInArray(generations.state, ["failed"]),
      ),
    );
  return Number(row?.count ?? 0);
}

/** Toward the concurrent Cap: this user's own Generations still queued through saving. */
export async function countConcurrentForUser(
  db: Queryable,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        notInArray(generations.state, ["succeeded", "failed"]),
      ),
    );
  return Number(row?.count ?? 0);
}

/** The oldest Generation counted toward the daily Cap, or null when none are counted: when it ages out of the 24h window, a daily slot frees. */
export async function oldestCountedSubmittedAt(
  db: Queryable,
  userId: string,
  since: Date,
): Promise<Date | null> {
  const [row] = await db
    .select({ submittedAt: generations.submittedAt })
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        gt(generations.submittedAt, since),
        notInArray(generations.state, ["failed"]),
      ),
    )
    .orderBy(generations.submittedAt)
    .limit(1);
  return row?.submittedAt ?? null;
}

/** This user's Caps and current usage, for the Workbench foot (issue #53's AC). */
export async function getCapsStatus(
  db: Database,
  clock: Clock,
  userId: string,
): Promise<CapsStatus> {
  const now = clock.now();
  const since = new Date(now.getTime() - DAY_MS);

  const [siteRow] = await db
    .select({
      dailyCap: siteSettings.dailyCap,
      concurrentCap: siteSettings.concurrentCap,
    })
    .from(siteSettings)
    .limit(1);
  const [userRow] = await db
    .select({
      dailyCapOverride: users.dailyCapOverride,
      concurrentCapOverride: users.concurrentCapOverride,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!siteRow) throw new Error("site_settings row is missing");
  if (!userRow) throw new Error("user not found");

  const caps = effectiveCapsFor(siteRow, userRow);
  const [dailyUsed, concurrentUsed, oldest] = await Promise.all([
    countDailyForUser(db, userId, since),
    countConcurrentForUser(db, userId),
    oldestCountedSubmittedAt(db, userId, since),
  ]);

  return {
    dailyCap: caps.dailyCap,
    dailyUsed,
    concurrentCap: caps.concurrentCap,
    concurrentUsed,
    oldestCountedSubmittedAt: oldest ? oldest.toISOString() : null,
  };
}
