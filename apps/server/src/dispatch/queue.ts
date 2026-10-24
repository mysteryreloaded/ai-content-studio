// Queries behind the dispatcher (issue #44, ADR 0002): who's queued, who's
// free, and the claim itself. Kept apart from GenerationsRepository, which
// is about a user's own view of their Generations, not dispatch mechanics.

import type { ResolvedOutputNode, Workflow } from "@ai-content-studio/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { generations, models, modes } from "../db/schema.js";
import type { GenerationState } from "../generations/repository.js";

export interface QueuedGeneration {
  id: string;
  modelId: string;
  modeId: string;
  userId: string;
  nodeTypes: string[];
  submittedAt: Date;
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
        submittedAt: generations.submittedAt,
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

  /** Cancels a `queued` Generation at once (issue #54's AC): nothing was ever sent to a Backend. Returns whether it actually was still queued. */
  async cancelQueued(generationId: string): Promise<boolean> {
    const rows = await this.db
      .update(generations)
      .set({ state: "cancelled" })
      .where(
        and(eq(generations.id, generationId), eq(generations.state, "queued")),
      )
      .returning({ id: generations.id });
    return rows.length > 0;
  }

  /**
   * Moves a `starting`/`running` Generation to `cancelling` (issue #54):
   * the runner's own poll loop notices this and sends the Backend's
   * interrupt. Returns whether it actually made that move.
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
   * reached at all.
   */
  async markCancelled(
    generationId: string,
    opts: { pendingBackendCancel: boolean },
  ): Promise<void> {
    await this.db
      .update(generations)
      .set({
        state: "cancelled",
        pendingBackendCancel: opts.pendingBackendCancel,
      })
      .where(eq(generations.id, generationId));
  }

  /** Read live mid-run, so the runner's poll loop notices a cancel requested by another request (issue #54). */
  async currentState(generationId: string): Promise<GenerationState | null> {
    const [row] = await this.db
      .select({ state: generations.state })
      .from(generations)
      .where(eq(generations.id, generationId));
    return row?.state ?? null;
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

  /**
   * Claims `generationId` onto `backendId`, atomically moving it from
   * `queued` to `starting`. Returns `false` (not an error) when it lost
   * the race — another instance claimed it first, or the Backend's own
   * unfinished-try unique index rejected a concurrent double-booking.
   */
  async claim(
    generationId: string,
    backendId: string,
    startedAt: Date,
  ): Promise<boolean> {
    try {
      const rows = await this.db
        .update(generations)
        .set({ state: "starting", backendId, startedAt })
        .where(
          and(
            eq(generations.id, generationId),
            eq(generations.state, "queued"),
          ),
        )
        .returning({ id: generations.id });
      return rows.length > 0;
    } catch (err) {
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }

  /** Guarded to only move `starting` -> `running`: a concurrent cancel may have already moved this Generation to `cancelling` (issue #54), and this must not stomp that back. */
  async markRunning(generationId: string): Promise<void> {
    await this.db
      .update(generations)
      .set({ state: "running" })
      .where(
        and(
          eq(generations.id, generationId),
          eq(generations.state, "starting"),
        ),
      );
  }

  /** Moves to `saving`: the Backend's own run has ended, so it's free for the next start. */
  async markSaving(generationId: string): Promise<void> {
    await this.db
      .update(generations)
      .set({ state: "saving" })
      .where(eq(generations.id, generationId));
  }

  async markSucceeded(generationId: string): Promise<void> {
    await this.db
      .update(generations)
      .set({ state: "succeeded" })
      .where(eq(generations.id, generationId));
  }

  async markFailed(generationId: string, error: string): Promise<void> {
    await this.db
      .update(generations)
      .set({ state: "failed", error })
      .where(eq(generations.id, generationId));
  }

  async detailForRun(generationId: string): Promise<RunDetail | null> {
    const [row] = await this.db
      .select({ generation: generations, mode: modes, model: models })
      .from(generations)
      .innerJoin(modes, eq(modes.id, generations.modeId))
      .innerJoin(models, eq(models.id, generations.modelId))
      .where(eq(generations.id, generationId));
    if (!row) return null;
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
    };
  }
}
