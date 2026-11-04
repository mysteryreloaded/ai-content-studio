import type { CheckModelMode } from "@ai-content-studio/shared";
import { CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../../components/ui/button.js";
import { Pill } from "../../../components/ui/pill.js";
import { backendModeGaps, otherBackendGaps } from "../helpers/backendGaps.js";
import { toCheckModelBackends } from "../helpers/workflow.js";
import type {
  AdminBackendSummary,
  BackendHealth,
  ModelDetail,
} from "../types.js";
import { Section } from "../ui/Section.js";
import type { ModelEditor } from "../useModelEditor.js";

/** The health pill (issue #217): `credentialsError` outranks reachability. */
function HealthPill({ health }: { health: BackendHealth | undefined }) {
  if (!health || health.reachability === "unknown") {
    return <Pill tone="neutral">Checking…</Pill>;
  }
  if (health.credentialsError) {
    return <Pill tone="warn">Re-enter credentials</Pill>;
  }
  if (health.reachability === "reachable") {
    return <Pill tone="ok">Healthy</Pill>;
  }
  return <Pill tone="err">Unreachable</Pill>;
}

function GapLine({
  severity,
  children,
}: {
  severity: "error" | "warning";
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
      {severity === "error" ? (
        <CircleAlert
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-err"
        />
      ) : (
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-warn"
        />
      )}
      <span>{children}</span>
    </div>
  );
}

export function BackendsSection({
  editor,
  detail,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const { backends, checkModelBackends, modesDraft } = editor;
  const {
    allBackends,
    attachedBackends,
    attachError,
    attaching,
    backendsLoadError,
    detach,
    detachError,
    attach,
    othersObjectInfo,
  } = backends;

  const attached = attachedBackends ?? [];
  const checkModes: CheckModelMode[] = (modesDraft ?? [])
    .filter((mode) => mode.outputNodeIds.length > 0)
    .map((mode) => ({
      id: mode.key,
      name: mode.name,
      outputNodeIds: mode.outputNodeIds,
      inputSettings: mode.inputSettings,
    }));
  const model = {
    workflow: detail.workflow,
    inputs: detail.inputs ?? [],
    modes: checkModes,
  };
  const reachableAttached = (checkModelBackends ?? []).filter(
    (b) => b.reachable && attached.some((entry) => entry.backend.id === b.id),
  );

  function healthFor(backendId: string): BackendHealth | undefined {
    return allBackends?.find((b) => b.id === backendId)?.health;
  }

  const otherBackends: AdminBackendSummary[] = (allBackends ?? []).filter(
    (backend) => !attached.some((entry) => entry.backend.id === backend.id),
  );

  return (
    <Section
      title="Backends"
      sub="ComfyUI servers this Model runs on. Backends are shared between Models; each runs one Generation at a time."
    >
      {backendsLoadError && <p role="alert">{backendsLoadError}</p>}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Runs on</h3>
        <p className="text-muted-foreground">
          {attached.length} Backend{attached.length === 1 ? "" : "s"}, one
          Generation each at a time
        </p>

        {attached.length === 0 ? (
          <p className="text-muted-foreground">
            No Backends yet. Attach one below.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {attached.map((entry) => {
              const health = healthFor(entry.backend.id);
              const cb = checkModelBackends?.find(
                (b) => b.id === entry.backend.id,
              );
              const gaps = cb?.reachable
                ? backendModeGaps(model, checkModes, cb, reachableAttached)
                : [];
              return (
                <div
                  key={entry.backend.id}
                  data-backend-row={entry.backend.id}
                  className="flex items-start gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {entry.backend.name}
                      </span>
                      <HealthPill health={health} />
                      {health?.comfyuiVersion && (
                        <span className="text-muted-foreground">
                          ComfyUI {health.comfyuiVersion}
                        </span>
                      )}
                      <span className="font-mono text-muted-foreground">
                        {entry.backend.baseUrl}
                      </span>
                    </div>
                    {!cb || !cb.reachable ? (
                      <GapLine severity="warning">
                        Unreachable: its nodes can't be checked.
                      </GapLine>
                    ) : gaps.length === 0 ? (
                      <p className="text-muted-foreground">
                        Runs all {checkModes.length} Mode
                        {checkModes.length === 1 ? "" : "s"}
                      </p>
                    ) : (
                      gaps.map((gap) => (
                        <GapLine key={gap.mode.id} severity={gap.severity}>
                          Can't run {gap.mode.name}: missing{" "}
                          <code className="font-mono">
                            {gap.missingNodeType}
                          </code>{" "}
                          (pack {gap.pack ?? "unknown"})
                        </GapLine>
                      ))
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void detach(entry.backend.id)}
                  >
                    Detach
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        {detachError && <p role="alert">{detachError}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Other Backends</h3>
        {otherBackends.length === 0 ? (
          <p className="text-muted-foreground">No other Backends.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {otherBackends.map((backend) => {
              const info = othersObjectInfo?.find(
                (entry) => entry.id === backend.id,
              );
              const cb = info ? toCheckModelBackends([info])[0] : undefined;
              const gaps = cb?.reachable
                ? otherBackendGaps(model, checkModes, cb)
                : [];
              return (
                <div
                  key={backend.id}
                  className="flex items-start gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{backend.name}</span>
                      <HealthPill health={backend.health} />
                      {backend.health?.comfyuiVersion && (
                        <span className="text-muted-foreground">
                          ComfyUI {backend.health.comfyuiVersion}
                        </span>
                      )}
                    </div>
                    {!cb || !cb.reachable ? (
                      <GapLine severity="warning">
                        Unreachable: its nodes can't be checked.
                      </GapLine>
                    ) : gaps.length === 0 ? (
                      <p className="text-muted-foreground">
                        Runs all {checkModes.length} Mode
                        {checkModes.length === 1 ? "" : "s"}
                      </p>
                    ) : (
                      gaps.map((gap) => (
                        <GapLine key={gap.mode.id} severity="warning">
                          Can't run {gap.mode.name}: missing{" "}
                          <code className="font-mono">
                            {gap.missingNodeType}
                          </code>{" "}
                          (pack {gap.pack ?? "unknown"})
                        </GapLine>
                      ))
                    )}
                  </div>
                  <Button
                    type="button"
                    disabled={attaching}
                    onClick={() => void attach(backend.id)}
                  >
                    Attach
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        {attachError && <p role="alert">{attachError}</p>}
      </div>

      <p className="text-muted-foreground">
        New Backends are added on the{" "}
        <Link to="/admin/backends" className="text-primary underline">
          Backends page
        </Link>
        .
      </p>
    </Section>
  );
}
