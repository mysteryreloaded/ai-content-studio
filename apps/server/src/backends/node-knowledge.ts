// Caches each Backend's `/object_info` node types (and per-field shapes,
// issue #46) in memory (issue #41). Refetched when the Backend becomes
// reachable again (`invalidate`, called by the health monitor) and
// otherwise about every 10 minutes; never stored in the database.

import type { ComfyFieldSpec } from "@ai-content-studio/shared";
import type { Clock } from "@ai-content-studio/shared";
import { objectInfoTarget } from "./client.js";
import type { BackendRepository } from "./repository.js";
import type { BackendRecord } from "./repository.js";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

interface CacheEntry {
  nodeTypes: Set<string>;
  fieldSpecsByClassType: Map<string, Record<string, ComfyFieldSpec>>;
  fetchedAt: number;
}

/**
 * Parses `/object_info`'s per-node `input.required`/`input.optional` specs
 * (issue #46): a field is `["TYPE", {...}]` or, for a COMBO, `[["a","b"], {...}]`
 * (the legacy form) or `["COMBO", {"options": ["a","b"], ...}]` (the V3 form
 * ComfyUI's `comfy_api/latest/_io.py` nodes, such as LTX, report).
 */
function parseFieldSpecs(
  body: Record<string, unknown>,
): Map<string, Record<string, ComfyFieldSpec>> {
  const result = new Map<string, Record<string, ComfyFieldSpec>>();
  for (const [classType, raw] of Object.entries(body)) {
    const node = raw as {
      input?: {
        required?: Record<string, unknown>;
        optional?: Record<string, unknown>;
      };
    };
    const fields: Record<string, ComfyFieldSpec> = {};
    for (const group of [node.input?.required, node.input?.optional]) {
      if (!group) continue;
      for (const [field, spec] of Object.entries(group)) {
        if (!Array.isArray(spec) || spec.length === 0) continue;
        const [typeOrOptions, extra] = spec as [unknown, unknown];
        let parsed: ComfyFieldSpec | null = null;
        if (Array.isArray(typeOrOptions)) {
          parsed = {
            type: "COMBO",
            options: typeOrOptions.filter(
              (option): option is string => typeof option === "string",
            ),
          };
        } else if (typeOrOptions === "COMBO") {
          const options = (extra as { options?: unknown } | undefined)?.options;
          parsed = {
            type: "COMBO",
            options: Array.isArray(options)
              ? options.filter(
                  (option): option is string => typeof option === "string",
                )
              : undefined,
          };
        } else if (typeof typeOrOptions === "string") {
          parsed = { type: typeOrOptions };
        }
        if (!parsed) continue;
        // Issue #50: ComfyUI marks an image loader's file field
        // `{"image_upload": true}` (e.g. LoadImage.image). Issue #51
        // does the same for video/audio (`video_upload`/`audio_upload`).
        const flags = extra as
          | {
              image_upload?: unknown;
              video_upload?: unknown;
              audio_upload?: unknown;
            }
          | undefined;
        if (flags?.image_upload) parsed.imageUpload = true;
        if (flags?.video_upload) parsed.videoUpload = true;
        if (flags?.audio_upload) parsed.audioUpload = true;
        fields[field] = parsed;
      }
    }
    result.set(classType, fields);
  }
  return result;
}

export class NodeKnowledge {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly repository: Pick<
      BackendRepository,
      "decryptedCredentials"
    >,
    private readonly clock: Clock,
  ) {}

  /** Drops the cached entry, forcing the next call to refetch. */
  invalidate(backendId: string): void {
    this.cache.delete(backendId);
  }

  private isFresh(entry: CacheEntry | undefined): entry is CacheEntry {
    return (
      entry !== undefined &&
      this.clock.now().getTime() - entry.fetchedAt < REFRESH_INTERVAL_MS
    );
  }

  /**
   * `backend`'s cached, still-fresh `/object_info`, or a fresh fetch.
   * Returns `null` when that fetch fails, even with a stale cache on
   * hand, so the caller skips this Backend with a note instead of
   * showing knowledge that might no longer be current.
   */
  private async entryFor(backend: BackendRecord): Promise<CacheEntry | null> {
    const cached = this.cache.get(backend.id);
    if (this.isFresh(cached)) return cached;

    try {
      const body = await objectInfoTarget(
        backend,
        this.repository,
      ).fetchObjectInfo();
      const entry: CacheEntry = {
        nodeTypes: new Set(Object.keys(body)),
        fieldSpecsByClassType: parseFieldSpecs(body),
        fetchedAt: this.clock.now().getTime(),
      };
      this.cache.set(backend.id, entry);
      return entry;
    } catch {
      return null;
    }
  }

  /** The node class types `backend` reports via `/object_info`. */
  async nodeTypesFor(backend: BackendRecord): Promise<Set<string> | null> {
    const entry = await this.entryFor(backend);
    return entry?.nodeTypes ?? null;
  }

  /** Each reported class type's field shapes (issue #46), for checking a select Input's option values. */
  async fieldSpecsFor(
    backend: BackendRecord,
  ): Promise<Map<string, Record<string, ComfyFieldSpec>> | null> {
    const entry = await this.entryFor(backend);
    return entry?.fieldSpecsByClassType ?? null;
  }
}
