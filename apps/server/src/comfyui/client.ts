// Talks to a Backend's ComfyUI-compatible HTTP API (issue #44): submits
// with a studio-chosen prompt id, reads a job's status from `/api/jobs/
// :id`, and streams a saved file from `/view`. The fake ComfyUI
// (apps/fake-comfyui) implements the same three endpoints, scripted.

import type { Workflow } from "@ai-content-studio/shared";
import type { ComfyUiTarget } from "../backends/client.js";

const FETCH_TIMEOUT_MS = 15_000;

function join(baseUrl: string, pathAndQuery: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${pathAndQuery}`;
}

/** A node id's own validation errors, as real ComfyUI and the fake both shape them: at least one entry's `type` names the kind of problem. */
export type NodeError = { type: string; message: string } | string[];

/** A rejection that isn't a missing node, `execution_error`, 413 or a reachability problem — failed without retry (issue #55's AC). */
export class PromptRejected extends Error {
  constructor(
    message: string,
    public readonly nodeErrors: Record<string, NodeError> | null,
  ) {
    super(message);
  }
}

/**
 * Unreachable while starting (issue #55's AC): the fetch itself failed
 * (network error, timed out) or the Backend answered with a 5xx — a
 * lost try, retried on any Backend, as opposed to a `PromptRejected`
 * (a real rejection of this prompt, never retried).
 */
export class BackendUnreachable extends Error {}

/** The Backend rejected the prompt as too large (413) — failed without retry (issue #55's AC). */
export class PayloadTooLarge extends Error {
  constructor() {
    super("the Backend rejected this as too large");
  }
}

/** Whether `nodeErrors` names a node type the Backend doesn't know (issue #55's AC: a lost try that also refetches node lists), vs. some other rejection. */
export function isMissingNodeError(
  nodeErrors: Record<string, NodeError> | null,
): boolean {
  if (!nodeErrors) return false;
  return Object.values(nodeErrors).some((entry) =>
    Array.isArray(entry)
      ? entry.some((message) => message.includes("unknown node type"))
      : entry.type === "missing_node",
  );
}

/** Submits `prompt` under `promptId`, the studio's own id (not ComfyUI-generated), so the run can be tracked without a round trip. */
export async function submitPrompt(
  target: ComfyUiTarget,
  promptId: string,
  prompt: Workflow,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(join(target.baseUrl, "/prompt"), {
      method: "POST",
      headers: { "content-type": "application/json", ...target.headers },
      body: JSON.stringify({
        prompt,
        prompt_id: promptId,
        client_id: promptId,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw new BackendUnreachable(
      err instanceof Error ? err.message : String(err),
    );
  }
  if (res.status === 413) throw new PayloadTooLarge();
  if (res.status >= 500) {
    throw new BackendUnreachable(`/prompt returned ${res.status}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new PromptRejected(
      `/prompt returned ${res.status}`,
      (body as { node_errors?: Record<string, NodeError> } | null)
        ?.node_errors ?? null,
    );
  }
}

/** Interrupts whatever `promptId` is running on this Backend (issue #55's AC: a max-run-time timeout cancels on ComfyUI before failing). Best-effort: a Backend too unreachable to cancel is about to be failed anyway. */
export async function cancelJob(
  target: ComfyUiTarget,
  promptId: string,
): Promise<void> {
  try {
    await fetch(join(target.baseUrl, "/interrupt"), {
      method: "POST",
      headers: { "content-type": "application/json", ...target.headers },
      body: JSON.stringify({ prompt_id: promptId }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    /* best-effort: the Generation fails either way */
  }
}

export type JobStatus = "running" | "completed" | "failed";

export interface JobFile {
  filename: string;
  subfolder: string;
  /** ComfyUI's own folder kind for this file: only `"output"` files are kept (issue #44's AC). */
  type: string;
}

/** ComfyUI's own output shape, keyed by media kind, not a made-up `files` list. */
export interface JobOutput {
  images?: JobFile[];
  gifs?: JobFile[];
  audio?: JobFile[];
}

/** No `step`/`totalSteps` here: that only ever comes from `/ws`'s `progress` message. */
export interface Job {
  id: string;
  status: JobStatus;
  outputs: Record<string, JobOutput> | null;
  error: string | null;
}

/** Reads a job's current status. `null` when the Backend doesn't know this id (e.g. it restarted). */
export async function readJob(
  target: ComfyUiTarget,
  promptId: string,
): Promise<Job | null> {
  const res = await fetch(join(target.baseUrl, `/api/jobs/${promptId}`), {
    headers: target.headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`/api/jobs/${promptId} returned ${res.status}`);
  return (await res.json()) as Job;
}

/** Fetches one output file's bytes from `/view`, as a streamable `Response` (issue #44: saved straight to a temp file). */
export async function fetchView(
  target: ComfyUiTarget,
  file: JobFile,
): Promise<Response> {
  const query = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder,
    type: file.type,
  });
  const res = await fetch(join(target.baseUrl, `/view?${query}`), {
    headers: target.headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`/view returned ${res.status}`);
  return res;
}

/** What `HEAD /view` tells about a Backend's own input file (issue #50). */
export interface InputFileInfo {
  size: number;
  lastModified: Date | null;
}

/** `HEAD /view` for `input/<subfolder>/<filename>`: null when the Backend doesn't have it. */
export async function headInputFile(
  target: ComfyUiTarget,
  subfolder: string,
  filename: string,
): Promise<InputFileInfo | null> {
  const query = new URLSearchParams({ filename, subfolder, type: "input" });
  const res = await fetch(join(target.baseUrl, `/view?${query}`), {
    method: "HEAD",
    headers: target.headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HEAD /view returned ${res.status}`);
  const size = Number(res.headers.get("content-length"));
  const lastModifiedHeader = res.headers.get("last-modified");
  const lastModified = lastModifiedHeader ? new Date(lastModifiedHeader) : null;
  return {
    size: Number.isFinite(size) ? size : -1,
    lastModified:
      lastModified && !Number.isNaN(lastModified.getTime())
        ? lastModified
        : null,
  };
}

/** Sends a file to `POST /upload/image` (ComfyUI's own endpoint), overwriting `input/<subfolder>/<filename>`. */
export async function uploadInputImage(
  target: ComfyUiTarget,
  subfolder: string,
  filename: string,
  file: Blob,
): Promise<void> {
  const form = new FormData();
  form.append("image", file, filename);
  form.append("type", "input");
  form.append("subfolder", subfolder);
  form.append("overwrite", "true");
  const res = await fetch(join(target.baseUrl, "/upload/image"), {
    method: "POST",
    headers: target.headers,
    body: form,
    // A whole Upload (up to MAX_UPLOAD_MB) goes in one request, so this
    // gets far longer than the API calls' timeout.
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!res.ok) throw new Error(`/upload/image returned ${res.status}`);
}

function wsUrlFor(baseUrl: string, clientId: string): string {
  const url = new URL(join(baseUrl, "/ws"));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("clientId", clientId);
  return url.toString();
}

export type JobEvent =
  | { type: "progress"; promptId: string; step: number; totalSteps: number }
  | { type: "status"; promptId: string; status: JobStatus; error?: string };

/**
 * One WebSocket connection per Backend, reconnecting on close. Used only
 * to wake a poll early (issue #44's AC: "follows `/ws`"); `/api/jobs/:id`
 * stays the source of truth, so a dropped/never-connected socket never
 * stalls a run, just makes it feel a little less live.
 */
export class ComfyUiSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private readonly listeners = new Set<(event: JobEvent) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly target: ComfyUiTarget,
    private readonly clientId: string,
  ) {
    this.connect();
  }

  onMessage(listener: (event: JobEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private connect(): void {
    if (this.closed) return;
    try {
      const ws = new WebSocket(wsUrlFor(this.target.baseUrl, this.clientId));
      this.ws = ws;
      ws.addEventListener("message", (event) => {
        const parsed = parseJobEvent(event.data);
        if (parsed) for (const listener of this.listeners) listener(parsed);
      });
      ws.addEventListener("close", () => this.scheduleReconnect());
      ws.addEventListener("error", () => this.scheduleReconnect());
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2_000);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

/**
 * Real ComfyUI wraps every `/ws` message as `{type, data}` (e.g. a
 * `progress` message's `data` is `{prompt_id, value, max}`); this unwraps
 * that envelope into the flat `JobEvent` the rest of the module uses.
 */
function parseJobEvent(data: unknown): JobEvent | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
      return null;
    }
    const { type } = parsed as { type: unknown };
    const envelope = (parsed as { data?: unknown }).data;
    if (!envelope || typeof envelope !== "object") return null;

    if (type === "progress") {
      const { prompt_id, value, max } = envelope as Record<string, unknown>;
      if (
        typeof prompt_id !== "string" ||
        typeof value !== "number" ||
        typeof max !== "number"
      ) {
        return null;
      }
      return {
        type: "progress",
        promptId: prompt_id,
        step: value,
        totalSteps: max,
      };
    }
    if (type === "status") {
      const { prompt_id, status, error } = envelope as Record<string, unknown>;
      if (typeof prompt_id !== "string" || typeof status !== "string") {
        return null;
      }
      return {
        type: "status",
        promptId: prompt_id,
        status: status as JobStatus,
        error: typeof error === "string" ? error : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}
