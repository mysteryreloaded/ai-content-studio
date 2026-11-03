// Per-Model figures shared by `/api/admin/overview` (issue #203) and
// `/api/admin/models` (issue #204): queue counts, usable/attached
// Backends and which Modes no usable Backend can run. Computed in a
// fixed number of queries for the whole list, not once per Model.

import type {
  Clock,
  InputDefinition,
  ModeInputSetting,
  Workflow,
} from "@ai-content-studio/shared";
import {
  applyModeFixedValues,
  computeModePath,
  visibleModeBoundFields,
} from "@ai-content-studio/shared";
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { BackendRecord } from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";
import type { Database } from "../db/client.js";
import {
  backends as backendsTable,
  generations,
  modelBackends,
  modelRevisions,
  models as modelsTable,
  modes as modesTable,
  workflows as workflowsTable,
} from "../db/schema.js";
import type { ModelRecord } from "./repository.js";

const RUNNING_STATES = ["starting", "running", "saving"] as const;
const MEDIAN_WAIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ModelFigures {
  queued: number;
  running: number;
  oldestQueuedAt: Date | null;
  medianWait24hMs: number | null;
  usableBackends: number;
  attachedBackends: number;
  /** Mode names (Mode order) no usable attached Backend can run (issue #204). */
  modesWithoutBackend: string[];
  modeCount: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

interface QueueStats {
  queued: number;
  running: number;
  oldestQueuedAt: Date | null;
  medianWait24hMs: number | null;
}

/** Per-Model queued/running counts, the oldest queued wait and the 24h median start wait. */
async function queueStatsFor(
  db: Database,
  clock: Clock,
): Promise<Map<string, QueueStats>> {
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

  const stats = new Map<string, QueueStats>();
  function statsFor(modelId: string): QueueStats {
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

/** Every attached (non-deleted) Backend's id, grouped by Model. */
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

interface ModeShape {
  name: string;
  outputNodeIds: string[];
  inputSettings: ModeInputSetting[];
}

interface ModelWorkflowDetail {
  workflow: Workflow;
  inputs: InputDefinition[];
  modes: ModeShape[];
}

/** Each Model's current revision's Workflow, Inputs and Modes, for every Model in `modelIds`, in a fixed number of queries. */
async function workflowDetailsFor(
  db: Database,
  modelIds: string[],
): Promise<Map<string, ModelWorkflowDetail>> {
  const result = new Map<string, ModelWorkflowDetail>();
  if (modelIds.length === 0) return result;

  const revisionRows = await db
    .select({
      modelId: modelRevisions.modelId,
      revisionId: modelRevisions.id,
      workflowHash: modelRevisions.workflowHash,
      inputs: modelRevisions.inputs,
    })
    .from(modelRevisions)
    .innerJoin(
      modelsTable,
      and(
        eq(modelsTable.id, modelRevisions.modelId),
        eq(modelsTable.currentRevision, modelRevisions.revisionNumber),
      ),
    )
    .where(inArray(modelsTable.id, modelIds));

  if (revisionRows.length === 0) return result;

  const revisionIds = revisionRows.map((row) => row.revisionId);
  const workflowHashes = [
    ...new Set(revisionRows.map((row) => row.workflowHash)),
  ];

  const [workflowRows, modeRows] = await Promise.all([
    db
      .select({ hash: workflowsTable.hash, json: workflowsTable.json })
      .from(workflowsTable)
      .where(inArray(workflowsTable.hash, workflowHashes)),
    db
      .select({
        revisionId: modesTable.revisionId,
        name: modesTable.name,
        outputNodes: modesTable.outputNodes,
        inputSettings: modesTable.inputSettings,
      })
      .from(modesTable)
      .where(inArray(modesTable.revisionId, revisionIds))
      .orderBy(asc(modesTable.sortOrder)),
  ]);

  const workflowByHash = new Map(
    workflowRows.map((row) => [row.hash, row.json as Workflow]),
  );
  const modesByRevision = new Map<string, ModeShape[]>();
  for (const row of modeRows) {
    const list = modesByRevision.get(row.revisionId) ?? [];
    list.push({
      name: row.name,
      outputNodeIds: (row.outputNodes as Array<{ nodeId: string }>).map(
        (node) => node.nodeId,
      ),
      inputSettings: row.inputSettings as ModeInputSetting[],
    });
    modesByRevision.set(row.revisionId, list);
  }

  for (const row of revisionRows) {
    result.set(row.modelId, {
      workflow: workflowByHash.get(row.workflowHash) ?? {},
      inputs: row.inputs as InputDefinition[],
      modes: modesByRevision.get(row.revisionId) ?? [],
    });
  }
  return result;
}

/** "Usable", as #203 defines it: attached, enabled, not draining, reachable without a credentials error. */
function isUsableBackend(
  backend: BackendRecord,
  backendsService: BackendsService,
): boolean {
  if (!backend.enabled || backend.draining) return false;
  const health = backendsService.healthFor(backend.id);
  return !health.credentialsError && health.reachability === "reachable";
}

/**
 * Whether at least one usable Backend (by id, in `nodeTypesByBackendId`)
 * has every node class on this Mode's Path, same check as Submit's own
 * `hasUsableBackend` (generations/submission.ts), batched here across
 * every Model's Modes instead of one Model at a time.
 */
function modeHasUsableBackend(
  mode: ModeShape,
  detail: ModelWorkflowDetail,
  usableAttachedIds: readonly string[],
  nodeTypesByBackendId: ReadonlyMap<string, Set<string> | null>,
): boolean {
  const unresolvable = visibleModeBoundFields(
    mode.inputSettings,
    detail.inputs,
  );
  const workflowForMode = applyModeFixedValues(
    detail.workflow,
    detail.inputs,
    mode.inputSettings,
  );
  const path = computeModePath(
    workflowForMode,
    mode.outputNodeIds,
    unresolvable,
  );
  const pathClassTypes = [...path.nodeIds]
    .map((nodeId) => workflowForMode[nodeId]?.class_type)
    .filter((classType): classType is string => Boolean(classType));

  return usableAttachedIds.some((backendId) => {
    const nodeTypes = nodeTypesByBackendId.get(backendId);
    return (
      nodeTypes !== undefined &&
      nodeTypes !== null &&
      pathClassTypes.every((classType) => nodeTypes.has(classType))
    );
  });
}

/** Every Model's queue counts, usable/attached Backends and modesWithoutBackend, in a fixed number of queries for the whole list. */
export async function modelFiguresFor(
  db: Database,
  clock: Clock,
  modelList: ModelRecord[],
  backendList: BackendRecord[],
  backendsService: BackendsService,
): Promise<Map<string, ModelFigures>> {
  const modelIds = modelList.map((model) => model.id);

  const [queueStats, attached, workflowDetails] = await Promise.all([
    queueStatsFor(db, clock),
    attachedBackendsFor(db),
    workflowDetailsFor(db, modelIds),
  ]);

  const usableBackendIds = new Set(
    backendList
      .filter((backend) => isUsableBackend(backend, backendsService))
      .map((backend) => backend.id),
  );
  const nodeTypesByBackendId = new Map<string, Set<string> | null>();
  await Promise.all(
    backendList
      .filter((backend) => usableBackendIds.has(backend.id))
      .map(async (backend) => {
        nodeTypesByBackendId.set(
          backend.id,
          await backendsService.nodeTypesFor(backend),
        );
      }),
  );

  const result = new Map<string, ModelFigures>();
  for (const model of modelList) {
    const attachedIds = attached.get(model.id) ?? [];
    const usableAttachedIds = attachedIds.filter((id) =>
      usableBackendIds.has(id),
    );
    const detail = workflowDetails.get(model.id);
    const modesWithoutBackend: string[] = [];
    if (detail) {
      for (const mode of detail.modes) {
        if (
          !modeHasUsableBackend(
            mode,
            detail,
            usableAttachedIds,
            nodeTypesByBackendId,
          )
        ) {
          modesWithoutBackend.push(mode.name);
        }
      }
    }

    const stats = queueStats.get(model.id);
    result.set(model.id, {
      queued: stats?.queued ?? 0,
      running: stats?.running ?? 0,
      oldestQueuedAt: stats?.oldestQueuedAt ?? null,
      medianWait24hMs: stats?.medianWait24hMs ?? null,
      usableBackends: usableAttachedIds.length,
      attachedBackends: attachedIds.length,
      modesWithoutBackend,
      modeCount: detail?.modes.length ?? 0,
    });
  }
  return result;
}
