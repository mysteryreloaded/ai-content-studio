// Ties the repository and monitor together, honoring BACKENDS_ENABLED
// (issue #39: `false` stops all Backend contact and shows Admins a banner).

import type { ComfyFieldSpec } from "@ai-content-studio/shared";
import type { Clock } from "@ai-content-studio/shared";
import { backendTarget } from "./client.js";
import type { LogEntryWriter } from "./log-entries.js";
import { BackendMonitor } from "./monitor.js";
import { NodeKnowledge } from "./node-knowledge.js";
import type { BackendRecord, BackendRepository } from "./repository.js";

export class BackendsService {
  private readonly monitor: BackendMonitor;
  private readonly nodeKnowledge: NodeKnowledge;

  constructor(
    private readonly repository: BackendRepository,
    clock: Clock,
    logger: LogEntryWriter,
    private readonly backendsEnabled: boolean,
    /** Issue #44: wakes the dispatcher — a Backend becoming reachable may free it up to take a Generation. */
    private readonly onBackendReachable?: () => void,
  ) {
    this.nodeKnowledge = new NodeKnowledge(repository, clock);
    this.monitor = new BackendMonitor(clock, logger, (backendId) => {
      this.nodeKnowledge.invalidate(backendId);
      this.onBackendReachable?.();
    });
  }

  /** Issue #77 CEO review: boot recovery skips contacting a Backend (a restore drill's whole point) while this is false. */
  get enabled(): boolean {
    return this.backendsEnabled;
  }

  /** Admins see this banner whenever BACKENDS_ENABLED=false. */
  get disabledBanner(): string | null {
    return this.backendsEnabled
      ? null
      : "Backend contact is disabled (BACKENDS_ENABLED=false): health checks are paused.";
  }

  async start(): Promise<void> {
    if (!this.backendsEnabled) return;
    const backends = await this.repository.list();
    for (const backend of backends) this.watch(backend);
  }

  watch(backend: BackendRecord): void {
    if (!this.backendsEnabled) return;
    this.monitor.watch(backendTarget(backend, this.repository));
  }

  unwatch(backendId: string): void {
    this.monitor.unwatch(backendId);
    this.nodeKnowledge.invalidate(backendId);
  }

  healthFor(backendId: string) {
    return this.monitor.healthFor(backendId);
  }

  /**
   * `backend`'s node class types from `/object_info` (issue #41), only
   * while it's reachable. Returns `null` when it isn't, or the fetch
   * otherwise fails, so the caller can skip it with a note.
   */
  async nodeTypesFor(backend: BackendRecord): Promise<Set<string> | null> {
    if (this.healthFor(backend.id).reachability !== "reachable") return null;
    return this.nodeKnowledge.nodeTypesFor(backend);
  }

  /**
   * `backend`'s `/object_info` field shapes (issue #46), only while it's
   * reachable, so an Admin's Input validation can check a select Input's
   * option values against a COMBO field's real choices.
   */
  async fieldSpecsFor(
    backend: BackendRecord,
  ): Promise<Map<string, Record<string, ComfyFieldSpec>> | null> {
    if (this.healthFor(backend.id).reachability !== "reachable") return null;
    return this.nodeKnowledge.fieldSpecsFor(backend);
  }

  unreachableSince(backendId: string) {
    return this.monitor.unreachableSince(backendId);
  }

  /** Forces the next `nodeTypesFor` call to refetch (issue #55: a missing-node rejection means this Backend's cached node list is stale). */
  invalidateNodeKnowledge(backendId: string): void {
    this.nodeKnowledge.invalidate(backendId);
  }

  stop(): void {
    this.monitor.stopAll();
  }
}
