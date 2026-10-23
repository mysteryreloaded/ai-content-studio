// Ties the repository and monitor together, honoring BACKENDS_ENABLED
// (issue #39: `false` stops all Backend contact and shows Admins a banner).

import { backendTarget } from "./client";
import type { Clock } from "./clock";
import type { Logger } from "./logger";
import { BackendMonitor } from "./monitor";
import type { BackendRecord, BackendRepository } from "./repository";

export class BackendsService {
  private readonly monitor: BackendMonitor;

  constructor(
    private readonly repository: BackendRepository,
    clock: Clock,
    logger: Logger,
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

  stop(): void {
    this.monitor.stopAll();
  }
}
