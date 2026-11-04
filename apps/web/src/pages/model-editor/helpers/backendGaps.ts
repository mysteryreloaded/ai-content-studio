import {
  OUTSIDE_SERVICE_NODE_CLASSES,
  modeBackendGaps,
} from "@ai-content-studio/shared";
import type {
  CheckModelBackend,
  CheckModelInput,
  CheckModelMode,
} from "@ai-content-studio/shared";

export interface ModeGapSeverity {
  mode: CheckModelMode;
  missingNodeType: string;
  pack: string | null;
  severity: "error" | "warning";
}

/**
 * Issue #217's agreed severity rule, for one attached Backend's own row:
 * an error only when no attached Backend has every node type on a Mode's
 * Path, a warning when some attached Backends can't run it but another
 * one can, and a missing partner (outside-service/API) node is always an
 * error regardless of what other Backends have.
 */
export function backendModeGaps(
  model: CheckModelInput,
  modes: readonly CheckModelMode[],
  backend: CheckModelBackend,
  reachableAttached: readonly CheckModelBackend[],
): ModeGapSeverity[] {
  const results: ModeGapSeverity[] = [];
  for (const mode of modes) {
    const ownGap = modeBackendGaps(model, mode, [backend])[0];
    if (!ownGap || ownGap.missingNodeType === null) continue;

    const allGaps = modeBackendGaps(model, mode, reachableAttached);
    const runnableCount = reachableAttached.length - allGaps.length;
    const isPartner = OUTSIDE_SERVICE_NODE_CLASSES.includes(
      ownGap.missingNodeType,
    );

    results.push({
      mode,
      missingNodeType: ownGap.missingNodeType,
      pack: ownGap.pack,
      severity: isPartner || runnableCount === 0 ? "error" : "warning",
    });
  }
  return results;
}
