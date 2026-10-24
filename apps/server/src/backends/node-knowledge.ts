// Caches each Backend's `/object_info` node types in memory (issue #41).
// Refetched when the Backend becomes reachable again (`invalidate`, called
// by the health monitor) and otherwise about every 10 minutes; never
// stored in the database.

import type { Clock } from "@ai-content-studio/shared";
import { objectInfoTarget } from "./client.js";
import type { BackendRepository } from "./repository.js";
import type { BackendRecord } from "./repository.js";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

interface CacheEntry {
  nodeTypes: Set<string>;
  fetchedAt: number;
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

  /**
   * The node class types `backend` reports via `/object_info`: a cached
   * set when it's still fresh, otherwise a fresh fetch. Returns `null`
   * when that fetch fails, even with a stale cache on hand, so the
   * caller skips this Backend with a note instead of showing knowledge
   * that might no longer be current.
   */
  async nodeTypesFor(backend: BackendRecord): Promise<Set<string> | null> {
    const cached = this.cache.get(backend.id);
    const fresh =
      cached !== undefined &&
      this.clock.now().getTime() - cached.fetchedAt < REFRESH_INTERVAL_MS;
    if (fresh) return cached.nodeTypes;

    try {
      const body = await objectInfoTarget(
        backend,
        this.repository,
      ).fetchObjectInfo();
      const nodeTypes = new Set(Object.keys(body));
      this.cache.set(backend.id, {
        nodeTypes,
        fetchedAt: this.clock.now().getTime(),
      });
      return nodeTypes;
    } catch {
      return null;
    }
  }
}
