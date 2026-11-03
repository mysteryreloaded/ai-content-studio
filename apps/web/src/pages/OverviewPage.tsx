import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AdminPage } from "../components/admin/AdminPage.js";
import { AdminPageHeader } from "../components/admin/AdminPageHeader.js";
import { AdminSection } from "../components/admin/AdminSection.js";
import { AdminTable, adminHeadCell } from "../components/admin/AdminTable.js";
import { EmptyState } from "../components/admin/EmptyState.js";
import { LoadError } from "../components/admin/LoadError.js";
import { Pill } from "../components/ui/pill.js";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { api, ok } from "../lib/api.js";
import { formatDuration, formatTime, formatWhen } from "../lib/format.js";
import { NoticeForm, PauseControl } from "./PauseNoticeForm.js";
import {
  type AdminSiteSettings,
  siteSettingsQueryKey,
} from "./site-settings-shared.js";

const POLL_INTERVAL_MS = 10_000;
const GENERATING_PANEL_ID = "overview-generating";

type PillTone = "ok" | "err" | "warn" | "accent" | "neutral";

type Reachability = "unknown" | "reachable" | "unreachable";

interface BackendHealth {
  reachability: Reachability;
  comfyuiVersion: string | null;
  vramTotal: number | null;
  vramFree: number | null;
  credentialsError: boolean;
}

interface OverviewBackend {
  id: string;
  name: string;
  enabled: boolean;
  draining: boolean;
  health: BackendHealth;
  unreachableSince: string | null;
  running: { generationId: string; modelName: string; modeName: string } | null;
}

interface OverviewModel {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  queued: number;
  running: number;
  oldestQueuedAt: string | null;
  medianWait24hMs: number | null;
  usableBackends: number;
  attachedBackends: number;
}

interface OverviewProblem {
  code: string;
  message: string;
  target: string | null;
  since: string;
}

interface OverviewResponse {
  problems: OverviewProblem[];
  backends: OverviewBackend[];
  models: OverviewModel[];
  disabledBanner: string | null;
  disk: { freeGb: number | null; minFreeDiskGb: number };
  errors24h: number;
  version: string;
  uptimeSeconds: number;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours} h ${minutes} min`;
}

/** The page's own time rule: `formatTime` for today, `formatWhen` otherwise. */
function formatSince(iso: string): string {
  const isToday = new Date(iso).toDateString() === new Date().toDateString();
  return isToday ? formatTime(iso) : formatWhen(iso);
}

function gibValue(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

function problemLink(problem: OverviewProblem): ReactNode {
  switch (problem.code) {
    case "backend_unreachable":
    case "backend_failing":
      return (
        <Link to="/admin/backends" className="shrink-0 underline">
          Backends
        </Link>
      );
    case "model_without_backend":
      return problem.target ? (
        <Link
          to={`/admin/models/${problem.target}`}
          className="shrink-0 underline"
        >
          Model
        </Link>
      ) : null;
    case "generating_paused":
      return (
        <button
          type="button"
          className="shrink-0 underline"
          onClick={() =>
            document
              .getElementById(GENERATING_PANEL_ID)
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          Generating
        </button>
      );
    default:
      return null;
  }
}

function ProblemsBanner({ problems }: { problems: OverviewProblem[] }) {
  if (problems.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <Pill tone="ok">No Problems</Pill>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-r-md border border-l-[3px] border-border border-l-err bg-card px-3 py-[9px]">
      <div className="flex items-center gap-2">
        <h2>Problems</h2>
        <Pill tone="err">
          {problems.length} {problems.length === 1 ? "error" : "errors"}
        </Pill>
      </div>
      {problems.map((problem) => (
        <div
          key={`${problem.code}:${problem.target ?? ""}`}
          className="flex flex-wrap items-start gap-2 py-[7px]"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-err" />
          <span className="min-w-0 flex-1">{problem.message}</span>
          <span className="shrink-0 text-[12.5px] text-muted-foreground">
            since {formatSince(problem.since)}
          </span>
          {problemLink(problem)}
        </div>
      ))}
    </div>
  );
}

function usableBackendsCell(model: OverviewModel) {
  if (model.attachedBackends === 0) return "No Backends";
  if (model.usableBackends === 0) {
    return <Pill tone="err">0 of {model.attachedBackends}</Pill>;
  }
  return `${model.usableBackends} of ${model.attachedBackends}`;
}

function ModelsTable({
  models,
  now,
}: {
  models: OverviewModel[];
  now: number;
}) {
  if (models.length === 0) {
    return (
      <EmptyState>
        No Models yet.{" "}
        <Link to="/admin/models" className="underline">
          New Model
        </Link>
      </EmptyState>
    );
  }

  return (
    <AdminTable>
      <TableHeader>
        <TableRow>
          <TableHead className={adminHeadCell}>Model</TableHead>
          <TableHead className={adminHeadCell}>Queued</TableHead>
          <TableHead className={adminHeadCell}>Running</TableHead>
          <TableHead className={adminHeadCell}>Oldest wait</TableHead>
          <TableHead className={adminHeadCell}>Median wait, 24h</TableHead>
          <TableHead className={adminHeadCell}>Usable Backends</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((model) => (
          <TableRow key={model.id}>
            <TableCell>
              <div className="flex items-center gap-2">
                <Link to={`/admin/models/${model.id}`} className="font-medium">
                  {model.name}
                </Link>
                {!model.enabled && <Pill tone="neutral">Disabled</Pill>}
              </div>
            </TableCell>
            <TableCell className="tabular-nums">
              {model.queued === 0 ? (
                "0"
              ) : (
                <Link
                  to={`/admin/generations?model=${model.id}&status=queued`}
                  className="underline"
                >
                  {model.queued}
                </Link>
              )}
            </TableCell>
            <TableCell className="tabular-nums">
              {model.running === 0 ? (
                "0"
              ) : (
                <Link
                  to={`/admin/generations?model=${model.id}&status=running`}
                  className="underline"
                >
                  {model.running}
                </Link>
              )}
            </TableCell>
            <TableCell className="tabular-nums">
              {model.oldestQueuedAt
                ? formatDuration(now - new Date(model.oldestQueuedAt).getTime())
                : "—"}
            </TableCell>
            <TableCell className="tabular-nums">
              {model.medianWait24hMs === null
                ? "—"
                : formatDuration(model.medianWait24hMs)}
            </TableCell>
            <TableCell className="tabular-nums">
              {usableBackendsCell(model)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </AdminTable>
  );
}

function backendStateInfo(backend: OverviewBackend): {
  tone: PillTone;
  label: ReactNode;
} {
  if (!backend.enabled) return { tone: "neutral", label: "Disabled" };
  if (backend.health.credentialsError) {
    return { tone: "warn", label: "Re-enter credentials" };
  }
  if (backend.health.reachability === "unreachable") {
    const since = backend.unreachableSince
      ? formatSince(backend.unreachableSince)
      : "?";
    return { tone: "err", label: `Unreachable since ${since}` };
  }
  if (backend.draining) return { tone: "warn", label: "Draining" };
  if (backend.running) {
    return {
      tone: "accent",
      label: (
        <Link to={`/admin/generations/${backend.running.generationId}`}>
          Running {backend.running.modelName} · {backend.running.modeName}
        </Link>
      ),
    };
  }
  if (backend.health.reachability === "unknown") {
    return { tone: "neutral", label: "Checking…" };
  }
  return { tone: "ok", label: "Idle" };
}

function BackendsTable({ backends }: { backends: OverviewBackend[] }) {
  if (backends.length === 0) {
    return (
      <EmptyState>
        No Backends yet.{" "}
        <Link to="/admin/backends" className="underline">
          New Backend
        </Link>
      </EmptyState>
    );
  }

  return (
    <AdminTable>
      <TableHeader>
        <TableRow>
          <TableHead className={adminHeadCell}>Name</TableHead>
          <TableHead className={adminHeadCell}>State</TableHead>
          <TableHead className={adminHeadCell}>ComfyUI</TableHead>
          <TableHead className={adminHeadCell}>VRAM</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {backends.map((backend) => {
          const state = backendStateInfo(backend);
          const { vramFree, vramTotal } = backend.health;
          return (
            <TableRow key={backend.id}>
              <TableCell className="font-medium">{backend.name}</TableCell>
              <TableCell>
                <Pill tone={state.tone}>{state.label}</Pill>
              </TableCell>
              <TableCell className="tabular-nums">
                {backend.health.comfyuiVersion
                  ? `v${backend.health.comfyuiVersion}`
                  : "—"}
              </TableCell>
              <TableCell className="tabular-nums">
                {vramFree !== null && vramTotal !== null
                  ? `${gibValue(vramFree)} of ${gibValue(vramTotal)} GiB free`
                  : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </AdminTable>
  );
}

function StudioPanel({ overview }: { overview: OverviewResponse }) {
  const diskFloorGb = overview.disk.minFreeDiskGb * 2;
  const diskLow =
    overview.disk.freeGb !== null && overview.disk.freeGb < diskFloorGb;

  return (
    <AdminSection title="Studio">
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5">
        <dt className="text-[12.5px] text-muted-foreground">Disk free</dt>
        <dd className="flex flex-wrap items-center gap-2 tabular-nums">
          {overview.disk.freeGb !== null
            ? `${overview.disk.freeGb.toFixed(1)} GB`
            : "Unknown"}
          {diskLow && (
            <>
              <Pill tone="warn">Low</Pill>
              <span className="text-[12.5px] text-muted-foreground">
                Floor is {diskFloorGb} GB
              </span>
            </>
          )}
        </dd>

        <dt className="text-[12.5px] text-muted-foreground">
          Errors, last 24 h
        </dt>
        <dd className="tabular-nums">
          <Link to="/admin/logs?level=error" className="underline">
            {overview.errors24h}
          </Link>
        </dd>

        <dt className="text-[12.5px] text-muted-foreground">Version</dt>
        <dd>{overview.version}</dd>

        <dt className="text-[12.5px] text-muted-foreground">Uptime</dt>
        <dd className="tabular-nums">{formatUptime(overview.uptimeSeconds)}</dd>
      </dl>
    </AdminSection>
  );
}

export function OverviewPage() {
  const {
    data: overview,
    error: overviewError,
    refetch: refetchOverview,
  } = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => ok<OverviewResponse>(api.api.admin.overview.$get()),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const { data: settings } = useQuery({
    queryKey: siteSettingsQueryKey,
    queryFn: () => ok<AdminSiteSettings>(api.api.admin["site-settings"].$get()),
    refetchInterval: POLL_INTERVAL_MS,
  });

  return (
    <AdminPage>
      <AdminPageHeader title="Overview" />

      {overviewError && (
        <LoadError
          message="could not load the Overview"
          onRetry={() => void refetchOverview()}
        />
      )}

      {overview && (
        <>
          {overview.disabledBanner && (
            <div
              role="alert"
              className="rounded-r-md border border-l-[3px] border-border border-l-warn bg-card px-3 py-[9px] text-warn"
            >
              {overview.disabledBanner}
            </div>
          )}

          <ProblemsBanner problems={overview.problems} />

          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="order-2 flex min-w-0 flex-col gap-2 lg:order-none lg:col-start-1 lg:row-start-1">
              <h2>Models</h2>
              <ModelsTable models={overview.models} now={Date.now()} />
            </div>

            <div className="order-3 flex min-w-0 flex-col gap-2 lg:order-none lg:col-start-1 lg:row-start-2">
              <h2>Backends</h2>
              <BackendsTable backends={overview.backends} />
            </div>

            <div
              id={GENERATING_PANEL_ID}
              className="order-1 min-w-0 lg:order-none lg:col-start-2 lg:row-start-1"
            >
              <AdminSection title="Generating">
                <div className="flex flex-col gap-sections">
                  <PauseControl settings={settings} />
                  <div className="border-t border-border pt-4">
                    <NoticeForm settings={settings} />
                  </div>
                </div>
              </AdminSection>
            </div>

            <div className="order-4 min-w-0 lg:order-none lg:col-start-2 lg:row-start-2">
              <StudioPanel overview={overview} />
            </div>
          </div>
        </>
      )}
    </AdminPage>
  );
}
