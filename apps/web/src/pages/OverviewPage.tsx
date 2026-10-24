import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 10_000;

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
  health: BackendHealth;
  unreachableSince: string | null;
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
  disabledBanner: string | null;
  disk: { freeGb: number | null; minFreeDiskGb: number };
  errors24h: number;
  version: string;
  uptimeSeconds: number;
}

function useOverview(): OverviewResponse | null {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    function poll() {
      fetch("/api/admin/overview")
        .then((res) => (res.ok ? res.json() : null))
        .then((body: OverviewResponse | null) => {
          if (!cancelled && body) setOverview(body);
        })
        .catch(() => {
          /* leave the previous data showing */
        });
    }

    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return overview;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function backendState(backend: OverviewBackend): string {
  if (backend.health.reachability === "unreachable") {
    return backend.health.credentialsError
      ? `unreachable since ${backend.unreachableSince ?? "?"} (awaiting credentials)`
      : `unreachable since ${backend.unreachableSince ?? "?"}`;
  }
  if (backend.health.reachability === "unknown") return "unknown";
  return "idle";
}

export function OverviewPage() {
  const overview = useOverview();

  if (!overview) return <p>Loading…</p>;

  const diskFloorGb = overview.disk.minFreeDiskGb * 2;
  const diskLow =
    overview.disk.freeGb !== null && overview.disk.freeGb < diskFloorGb;

  return (
    <section>
      <h2>Overview</h2>

      {overview.disabledBanner && <p role="alert">{overview.disabledBanner}</p>}

      <h3>Problems</h3>
      {overview.problems.length === 0 ? (
        <p>No Problems.</p>
      ) : (
        <ul>
          {overview.problems.map((problem) => (
            <li key={`${problem.code}:${problem.target ?? ""}`}>
              <strong>{problem.code}</strong>: {problem.message} (since{" "}
              {problem.since})
            </li>
          ))}
        </ul>
      )}

      <h3>Backends</h3>
      {overview.backends.length === 0 ? (
        <p>No Backends registered.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>State</th>
              <th>Version</th>
              <th>VRAM</th>
            </tr>
          </thead>
          <tbody>
            {overview.backends.map((backend) => (
              <tr key={backend.id}>
                <td>{backend.name}</td>
                <td>{backendState(backend)}</td>
                <td>{backend.health.comfyuiVersion ?? "—"}</td>
                <td>
                  {backend.health.vramFree !== null &&
                  backend.health.vramTotal !== null
                    ? `${backend.health.vramFree} / ${backend.health.vramTotal} GB free`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Studio</h3>
      <ul>
        <li>
          Disk:{" "}
          {overview.disk.freeGb !== null
            ? `${overview.disk.freeGb.toFixed(1)} GB free`
            : "unknown"}{" "}
          {diskLow && <strong>(low, floor is {diskFloorGb} GB)</strong>}
        </li>
        <li>24h errors: {overview.errors24h}</li>
        <li>Version: {overview.version}</li>
        <li>Uptime: {formatUptime(overview.uptimeSeconds)}</li>
      </ul>

      <p>
        Models, Pause and Notice aren't shown here yet: they need the Model and
        Generation pipeline (issues #40-#58) and Pause/Notice (issue #59), none
        of which exist in this codebase yet.
      </p>
    </section>
  );
}
