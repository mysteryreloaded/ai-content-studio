// Ties the repository and monitor together, honoring BACKENDS_ENABLED
// (issue #39: `false` stops all Backend contact and shows Admins a banner).

import type { Clock } from "@ai-content-studio/shared";
import { backendTarget } from "./client.js";
import type { LogEntryWriter } from "./log-entries.js";
import { BackendMonitor } from "./monitor.js";
import type { BackendRecord, BackendRepository } from "./repository.js";

export class BackendsService {
  private readonly monitor: BackendMonitor;

  constructor(
    private readonly repository: BackendRepository,
    clock: Clock,
    logger: LogEntryWriter,
    private readonly backendsEnabled: boolean,
  ) {
    this.monitor = new BackendMonitor(clock, logger);
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
  }

  healthFor(backendId: string) {
    return this.monitor.healthFor(backendId);
  }

  unreachableSince(backendId: string) {
    return this.monitor.unreachableSince(backendId);
  }

  stop(): void {
    this.monitor.stopAll();
  }
}
