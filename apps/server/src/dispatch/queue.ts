// Queries behind the dispatcher (issue #44, #55; ADR 0002): who's queued,
// who's free, the claim itself, and the reliable-dispatch machinery (lost
// tries, timeouts, boot recovery). Kept apart from GenerationsRepository,
// which is about a user's own view of their Generations, not dispatch
// mechanics.
//
// `tries` doubles as this row's own concurrency token (issue #55): most
// writes below are conditioned on both `tries` and the state they
// expect to move on from, so a stale in-process runner's write silently
// no-ops once a watchdog sweep or a later try has already moved the row
// on (returns `false`/`"stale"` instead of throwing).

import type { ResolvedOutputNode, Workflow } from "@ai-content-studio/shared";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { generations, models, modes, uploads } from "../db/schema.js";

/** At most this many tries before a lost try gives up for good (issue #55's AC). */
export const MAX_TRIES = 2;

export interface QueuedGeneration {
  id: string;
  modelId: string;
  modeId: string;
  userId: string;
  nodeTypes: string[];
  tries: number;
  submittedAt: Date;
  /** Issue #74: a Test run, still claimable while Paused. */
  isTest: boolean;
  /** Issue #74: the one attached Backend a Test pinned itself to, or null for Any. */
  pinnedBackendId: string | null;
}

/** Everything the runner needs once a Generation is claimed. */
export interface RunDetail {
  id: string;
  revisionId: string;
  modelId: string;
  modelSlug: string;
  modelName: string;
  modeId: string;
  modeName: string;
  userId: string;
  submissionId: string;
  submittedAt: Date;
  builtPrompt: Workflow;
  outputNodes: ResolvedOutputNode[];
  maxRunTimeMinutes: number;
  /** Issue #50: each Upload the prompt names, sent to the Backend before the prompt. */
  uploads: RunUpload[];
  /** Issue #74: a Test run, carried through so its SSE updates keep the Gallery's "Test" marker. */
  isTest: boolean;
}

export interface RunUpload {
  id: string;
  extension: string;
  size: number;
  storageKey: string;
}

/** A Generation stuck in `starting`/`running`/`cancelling` (or `saving`) across a restart, found by boot recovery (issue #55's AC; `cancelling` added by issue #54). */
export interface UnfinishedGeneration {
  id: string;
  state: "starting" | "running" | "cancelling" | "saving";
  backendId: string;
  tries: number;
}

/** A Generation whose `starting` try has run past its 10-minute cap (issue #55's AC), found by the dispatcher's watchdog sweep. */
export interface StuckStartingGeneration {
  id: string;
  backendId: string;
  tries: number;
}

/** A Generation `running` on `backendId`, for the watchdog's "unreachable for > 2 min" and max-run-time checks (issue #55's AC). */
export interface RunningGeneration {
  id: string;
  backendId: string;
  tries: number;
  startedAt: Date;
  maxRunTimeMinutes: number;
}

export type LoseTryOutcome = "retried" | "exhausted" | "stale";

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

export class DispatchQueue {
  constructor(private readonly db: Database) {}

  /** Up to 200 queued Generations, oldest first (the caller re-sorts by the user's own fewest-active-first rule). */
  async listQueued(): Promise<QueuedGeneration[]> {
    const rows = await this.db
      .select({
        id: generations.id,
        modelId: generations.modelId,
        modeId: generations.modeId,
        userId: generations.userId,
        nodeTypes: generations.nodeTypes,
        tries: generations.tries,
        submittedAt: generations.submittedAt,
        isTest: generations.isTest,
        pinnedBackendId: generations.pinnedBackendId,
      })
      .from(generations)
      .where(eq(generations.state, "queued"))
      .orderBy(generations.submittedAt)
      .limit(200);
    return rows;
  }

  /** How many starting-or-running Generations each user currently has. */
  async activeCountsByUser(): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ userId: generations.userId, count: sql<number>`count(*)` })
      .from(generations)
      .where(inArray(generations.state, ["starting", "running"]))
      .groupBy(generations.userId);
    return new Map(rows.map((row) => [row.userId, Number(row.count)]));
  }

  /** Backend ids currently mid-run (issue #44's ADR: `saving` doesn't count — the Backend already freed). `cancelling` still counts: the Backend's interrupt hasn't been confirmed yet (issue #54). */
  async busyBackendIds(): Promise<Set<string>> {
    const rows = await this.db
      .select({ backendId: generations.backendId })
      .from(generations)
      .where(
        and(
          inArray(generations.state, ["starting", "running", "cancelling"]),
          isNotNull(generations.backendId),
        ),
      );
    return new Set(rows.map((row) => row.backendId as string));
  }

  /**
   * Claims `generationId` onto `backendId`, atomically moving it from
   * `queued` to `starting` and counting this as a new try. Returns the
   * try number this run now owns (1 or 2), or `null` when it lost the
   * race — another instance claimed it first, or the Backend's own
   * unfinished-try unique index rejected a concurrent double-booking.
   */
  async claim(
    generationId: string,
    backendId: string,
    startedAt: Date,
  ): Promise<number | null> {
    try {
      const rows = await this.db
        .update(generations)
        .set({
          state: "starting",
          backendId,
          startedAt,
          tries: sql`${generations.tries} + 1`,
        })
        .where(
          and(
            eq(generations.id, generationId),
            eq(generations.state, "queued"),
          ),
        )
        .returning({ tries: generations.tries });
      return rows[0]?.tries ?? null;
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  /** Moves a claimed try on to `running`, only from `starting`: a watchdog sweep or a later try may already have moved this try on. */
  async markRunning(generationId: string, tries: number): Promise<boolean> {
    const rows = await this.db
      .update(generations)
      .set({ state: "running" })
      .where(
        and(
          eq(generations.id, generationId),
          eq(generations.tries, tries),
          eq(generations.state, "starting"),
        ),
      )
      .returning({ id: generations.id });
    return rows.length > 0;
  }

  /**
   * Moves to `saving`, from `starting` or `running`: the Backend's own
   * run has ended, so it's free for the next start. `starting` is
   * allowed too for boot recovery (issue #55's AC), which can find a
   * job already completed before its own `markRunning` write ever
   * landed, catching up both transitions as one.
   */
  async markSaving(generationId: string, tries: number): Promise<boolean> {
    const rows = await this.db
      .update(generations)
      .set({ state: "saving" })
      .where(
        and(
          eq(generations.id, generationId),
          eq(generations.tries, tries),
          inArray(generations.state, ["starting", "running"]),
        ),
      )
      .returning({ id: generations.id });
    return rows.length > 0;
  }

  /** Only from `saving`. */
  async markSucceeded(
    generationId: string,
    tries: number,
    endedAt: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(generations)
      .set({ state: "succeeded", endedAt })
      .where(
        and(
          eq(generations.id, generationId),
          eq(generations.tries, tries),
          eq(generations.state, "saving"),
        ),
      )
      .returning({ id: generations.id });
    return rows.length > 0;
  }

  /**
   * Ends the Generation for good: any rejection but a missing node,
   * `execution_error`, no outputs, 413, a save that never lands, a
   * timeout, or (from `queued`) giving up after 15 minutes without a
   * usable Backend (issue #55's AC) — never retried. Valid from any
   * unfinished state.
   */
  async markFailed(
    generationId: string,
    tries: number,
    error: string,
    endedAt: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(generations)
      .set({ state: "failed", error, endedAt })
      .where(
        and(
          eq(generations.id, generationId),
          eq(generations.tries, tries),
          inArray(generations.state, [
            "queued",
            "starting",
            "running",
            "saving",
          ]),
        ),
      )
      .returning({ id: generations.id });
    return rows.length > 0;
  }

  /**
   * Records a lost try (issue #55's AC: unreachable while starting,
   * unreachable > 2 min while running, a 404'd job, or a missing-node
   * rejection). Below `MAX_TRIES`, requeues it (resetting `queuedAt`) for
   * a try on any Backend; at `MAX_TRIES`, fails it with
   * `exhaustedMessage` instead. `"stale"` means another write already
   * moved this try on first.
   */
  async loseTry(
    generationId: string,
    tries: number,
    exhaustedMessage: string,
    now: Date,
  ): Promise<LoseTryOutcome> {
    // `tries` itself only moves forward at claim time (the next try); a
    // lost try just ends this one. The state precondition below is what
    // actually guards against a stale write once this call lands.
    // `saving` is included for boot recovery (issue #55's AC): a job
    // whose Backend forgot it mid-save has unrecoverable output
    // filenames, so it's lost the same as a 404 while running.
    const exhausted = tries >= MAX_TRIES;
    const rows = await this.db
      .update(generations)
      .set(
        exhausted
          ? {
              state: "failed",
              backendId: null,
              error: exhaustedMessage,
              endedAt: now,
            }
          : {
              state: "queued",
              backendId: null,
              startedAt: null,
              queuedAt: now,
            },
      )
      .where(
        and(
          eq(generations.id, generationId),
          eq(generations.tries, tries),
          inArray(generations.state, ["starting", "running", "saving"]),
        ),
      )
      .returning({ id: generations.id });
    if (rows.length === 0) return "stale";
    return exhausted ? "exhausted" : "retried";
  }

  async detailForRun(generationId: string): Promise<RunDetail | null> {
    const [row] = await this.db
      .select({ generation: generations, mode: modes, model: models })
      .from(generations)
      .innerJoin(modes, eq(modes.id, generations.modeId))
      .innerJoin(models, eq(models.id, generations.modelId))
      .where(eq(generations.id, generationId));
    if (!row) return null;

    const uploadRows =
      row.generation.uploadIds.length === 0
        ? []
        : await this.db
            .select()
            .from(uploads)
            .where(inArray(uploads.id, row.generation.uploadIds));
    return {
      id: row.generation.id,
      revisionId: row.generation.revisionId,
      modelId: row.generation.modelId,
      modelSlug: row.model.slug,
      modelName: row.model.name,
      modeId: row.generation.modeId,
      modeName: row.mode.name,
      userId: row.generation.userId,
      submissionId: row.generation.submissionId,
      submittedAt: row.generation.submittedAt,
      builtPrompt: row.generation.builtPrompt as Workflow,
      outputNodes: row.mode.outputNodes as ResolvedOutputNode[],
      maxRunTimeMinutes: row.model.maxRunTimeMinutes,
      isTest: row.generation.isTest,
      uploads: uploadRows.map((upload) => ({
        id: upload.id,
        extension: upload.extension ?? "",
        size: upload.size,
        storageKey: upload.storageKey,
      })),
    };
  }

  /** `starting` tries that have run past `thresholdMs` (issue #55's AC: 10 minutes) — a safety net for a try no in-process runner is still polling. */
  async listStuckStarting(
    thresholdMs: number,
    now: Date,
  ): Promise<StuckStartingGeneration[]> {
    const cutoff = new Date(now.getTime() - thresholdMs);
    const rows = await this.db
      .select({
        id: generations.id,
        backendId: generations.backendId,
        tries: generations.tries,
      })
      .from(generations)
      .where(
        and(
          eq(generations.state, "starting"),
          isNotNull(generations.backendId),
          lt(generations.startedAt, cutoff),
        ),
      );
    return rows.map((row) => ({
      id: row.id,
      backendId: row.backendId as string,
      tries: row.tries,
    }));
  }

  /** Every `running` Generation on `backendId`, for the watchdog's "unreachable for > 2 min" check (issue #55's AC). */
  async listRunningOnBackend(backendId: string): Promise<RunningGeneration[]> {
    const rows = await this.db
      .select({
        id: generations.id,
        tries: generations.tries,
        startedAt: generations.startedAt,
        maxRunTimeMinutes: models.maxRunTimeMinutes,
      })
      .from(generations)
      .innerJoin(models, eq(models.id, generations.modelId))
      .where(
        and(
          eq(generations.state, "running"),
          eq(generations.backendId, backendId),
        ),
      );
    return rows.map((row) => ({
      id: row.id,
      backendId,
      tries: row.tries,
      startedAt: row.startedAt as Date,
      maxRunTimeMinutes: row.maxRunTimeMinutes,
    }));
  }

  /** Every Generation left `starting`, `running`, `cancelling` or `saving` with a Backend assigned — boot recovery's starting point (issue #55's AC; `cancelling` added by issue #54, so a crash mid-cancel still gets confirmed). */
  async listUnfinished(): Promise<UnfinishedGeneration[]> {
    const rows = await this.db
      .select({
        id: generations.id,
        state: generations.state,
        backendId: generations.backendId,
        tries: generations.tries,
      })
      .from(generations)
      .where(
        and(
          inArray(generations.state, [
            "starting",
            "running",
            "cancelling",
            "saving",
          ]),
          isNotNull(generations.backendId),
        ),
      );
    return rows.map((row) => ({
      id: row.id,
      // Narrowed by the `inArray` above to one of the four unfinished states.
      state: row.state as UnfinishedGeneration["state"],
      backendId: row.backendId as string,
      tries: row.tries,
    }));
  }

  /** Cancels a `queued` Generation at once (issue #54's AC): nothing was ever sent to a Backend. Returns whether it actually was still queued. */
  async cancelQueued(generationId: string, endedAt: Date): Promise<boolean> {
    const rows = await this.db
      .update(generations)
      .set({ state: "cancelled", endedAt })
      .where(
        and(eq(generations.id, generationId), eq(generations.state, "queued")),
      )
      .returning({ id: generations.id });
    return rows.length > 0;
  }

  /**
   * Moves a `starting`/`running` Generation to `cancelling` (issue #54):
   * the runner's own poll loop notices this and sends the Backend's
   * interrupt. Not conditioned on `tries`: whichever try currently owns
   * `starting`/`running` is by definition the one still live, and a
   * `loseTry`/`markFailed` write can no longer land once this lands
   * either (neither's own state precondition matches `cancelling`).
   * Returns whether it actually made that move.
   */
  async markCancelling(generationId: string): Promise<boolean> {
    const rows = await this.db
      .update(generations)
      .set({ state: "cancelling" })
      .where(
        and(
          eq(generations.id, generationId),
          inArray(generations.state, ["starting", "running"]),
        ),
      )
      .returning({ id: generations.id });
    return rows.length > 0;
  }

  /**
   * Finalizes a cancelled Generation (issue #54): confirmed by the
   * Backend (the interrupt was reported, or the job's gone), or marked
   * anyway with `pendingBackendCancel` when the Backend couldn't be
   * reached at all. Conditioned on `tries` and `cancelling`, the same
   * concurrency-token pattern as every other terminal write.
   */
  async markCancelled(
    generationId: string,
    tries: number,
    opts: { pendingBackendCancel: boolean },
    endedAt: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(generations)
      .set({
        state: "cancelled",
        pendingBackendCancel: opts.pendingBackendCancel,
        endedAt,
      })
      .where(
        and(
          eq(generations.id, generationId),
          eq(generations.tries, tries),
          eq(generations.state, "cancelling"),
        ),
      )
      .returning({ id: generations.id });
    return rows.length > 0;
  }

  /** Read live mid-run, so the runner's poll loop notices a cancel requested by another request (issue #54). */
  async currentState(
    generationId: string,
  ): Promise<(typeof generations.$inferSelect)["state"] | null> {
    const [row] = await this.db
      .select({ state: generations.state })
      .from(generations)
      .where(eq(generations.id, generationId));
    return row?.state ?? null;
  }

  /**
   * Whether an Admin removed this Generation (issue #68's AC): checked
   * after a save lands, since `markCancelling` only matches
   * `starting`/`running` and so never stops a `saving` run that an
   * Admin removed mid-save — the runner deletes what it just saved
   * instead of leaving it live for the owner to download.
   */
  async isRemoved(generationId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ removedAt: generations.removedAt })
      .from(generations)
      .where(eq(generations.id, generationId));
    return row?.removedAt != null;
  }

  /** Every Generation still waiting for its Backend to be re-told about a cancel it missed (issue #54), grouped with the Backend it needs resending to. */
  async pendingBackendCancels(): Promise<
    { generationId: string; backendId: string }[]
  > {
    const rows = await this.db
      .select({
        generationId: generations.id,
        backendId: generations.backendId,
      })
      .from(generations)
      .where(
        and(
          eq(generations.pendingBackendCancel, true),
          isNotNull(generations.backendId),
        ),
      );
    return rows.map((row) => ({
      generationId: row.generationId,
      backendId: row.backendId as string,
    }));
  }

  /** Backend ids that still owe a re-sent cancel interrupt (issue #54): never matched to new work until this clears. */
  async pendingCancelBackendIds(): Promise<Set<string>> {
    const pending = await this.pendingBackendCancels();
    return new Set(pending.map((row) => row.backendId));
  }

  async clearPendingBackendCancel(generationId: string): Promise<void> {
    await this.db
      .update(generations)
      .set({ pendingBackendCancel: false })
      .where(eq(generations.id, generationId));
  }
}
