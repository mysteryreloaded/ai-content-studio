// A fake ComfyUI app: serves /system_stats and a captured /object_info like
// a real ComfyUI server, and can be scripted unreachable, so several
// instances can stand in for several Backends in tests (see issue #39,
// issue #41). Issue #44 adds the dispatch surface: /prompt (validated like
// ComfyUI), /ws progress, /api/jobs/:id and /view, each job scripted ahead
// of time to succeed after N steps with canned outputs, or to fail.

import objectInfoFixture from "./object-info-fixture.json" with {
  type: "json",
};

export interface FakeComfyUiOptions {
  port: number;
  comfyuiVersion?: string;
  vramTotal?: number;
  vramFree?: number;
  /** When set, requests must send `Authorization: Basic base64(user:pass)`. */
  basicAuth?: { user: string; pass: string };
  /** When set, requests must send this exact header name/value. */
  headerAuth?: { name: string; value: string };
}

function systemStatsBody(opts: FakeComfyUiOptions) {
  return {
    system: {
      os: "posix",
      comfyui_version: opts.comfyuiVersion ?? "0.3.0",
    },
    devices: [
      {
        name: "cuda:0",
        type: "cuda",
        vram_total: opts.vramTotal ?? 24 * 1024 * 1024 * 1024,
        vram_free: opts.vramFree ?? 20 * 1024 * 1024 * 1024,
      },
    ],
  };
}

function isAuthorized(req: Request, opts: FakeComfyUiOptions): boolean {
  if (opts.basicAuth) {
    const header = req.headers.get("authorization") ?? "";
    const expected = `Basic ${btoa(`${opts.basicAuth.user}:${opts.basicAuth.pass}`)}`;
    if (header !== expected) return false;
  }
  if (opts.headerAuth) {
    if (req.headers.get(opts.headerAuth.name) !== opts.headerAuth.value)
      return false;
  }
  return true;
}

export interface JobFile {
  filename: string;
  subfolder: string;
  type: string;
}

/** ComfyUI's own output shape, keyed by media kind, not a made-up `files` list. */
export interface JobOutput {
  images?: JobFile[];
  gifs?: JobFile[];
  audio?: JobFile[];
}

export interface ScriptedJob {
  /** How many progress steps before the job finishes (default 1). */
  steps?: number;
  /** Delay between steps, in ms (default 5 — fast, but still observable as several states). */
  stepIntervalMs?: number;
  /** Output files per output node id, kept only when `type` is `"output"`. */
  outputs?: Record<string, JobOutput>;
  /** Scripts the job to fail once its steps run out, instead of completing. */
  fail?: string;
  /** Issue #54: never advances on its own, staying `running` until `/api/jobs/:id/cancel` is called. */
  hang?: boolean;
}

interface JobState {
  status: "running" | "completed" | "failed" | "cancelled";
  step: number;
  totalSteps: number;
  outputs: Record<string, JobOutput> | null;
  error: string | null;
  clientId: string;
  script: ScriptedJob;
  timer: ReturnType<typeof setInterval> | null;
}

type WsData = { clientId: string };

/** Starts a fake ComfyUI server. `setUnreachable` toggles it failing every request. */
export function startFakeComfyUi(opts: FakeComfyUiOptions) {
  let unreachable = false;
  const scripts = new Map<string, ScriptedJob>();
  const jobs = new Map<string, JobState>();
  const sockets = new Map<string, Set<{ send(data: string): void }>>();

  function sendTo(clientId: string, payload: unknown) {
    for (const ws of sockets.get(clientId) ?? []) {
      ws.send(JSON.stringify(payload));
    }
  }

  function advance(promptId: string) {
    const job = jobs.get(promptId);
    if (!job || job.status !== "running") return;
    job.step += 1;
    sendTo(job.clientId, {
      type: "progress",
      data: { prompt_id: promptId, value: job.step, max: job.totalSteps },
    });
    if (job.step < job.totalSteps) return;

    if (job.timer) clearInterval(job.timer);
    job.timer = null;
    if (job.script.fail) {
      job.status = "failed";
      job.error = job.script.fail;
      sendTo(job.clientId, {
        type: "status",
        data: { prompt_id: promptId, status: "failed", error: job.error },
      });
      return;
    }
    job.status = "completed";
    job.outputs = job.script.outputs ?? {};
    sendTo(job.clientId, {
      type: "status",
      data: { prompt_id: promptId, status: "completed" },
    });
  }

  /** Every node type the submitted prompt uses must be known, like ComfyUI's own `/prompt` validation. */
  function validatePrompt(
    prompt: unknown,
  ): { ok: true } | { ok: false; nodeErrors: Record<string, string[]> } {
    if (!prompt || typeof prompt !== "object") {
      return { ok: false, nodeErrors: {} };
    }
    const fixture = objectInfoFixture as Record<string, unknown>;
    const nodeErrors: Record<string, string[]> = {};
    for (const [nodeId, node] of Object.entries(
      prompt as Record<string, unknown>,
    )) {
      const classType =
        node && typeof node === "object"
          ? (node as { class_type?: unknown }).class_type
          : undefined;
      if (typeof classType !== "string" || !(classType in fixture)) {
        nodeErrors[nodeId] = [`unknown node type ${String(classType)}`];
      }
    }
    if (Object.keys(nodeErrors).length > 0) return { ok: false, nodeErrors };
    return { ok: true };
  }

  const server = Bun.serve<WsData>({
    port: opts.port,
    fetch(req, srv) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const clientId = url.searchParams.get("clientId") ?? "";
        const upgraded = srv.upgrade(req, { data: { clientId } });
        if (upgraded) return undefined;
        return new Response("upgrade failed", { status: 400 });
      }

      if (
        url.pathname === "/__control__/unreachable" &&
        req.method === "POST"
      ) {
        return req.json().then((body: unknown) => {
          unreachable = Boolean((body as { down?: boolean }).down);
          return new Response(null, { status: 204 });
        });
      }

      if (url.pathname === "/__control__/script" && req.method === "POST") {
        return req.json().then((body: unknown) => {
          const { promptId, ...script } = body as ScriptedJob & {
            promptId: string;
          };
          scripts.set(promptId, script);
          return new Response(null, { status: 204 });
        });
      }

      if (url.pathname === "/system_stats") {
        if (unreachable)
          return new Response("down for testing", { status: 503 });
        if (!isAuthorized(req, opts))
          return new Response("unauthorized", { status: 401 });
        return Response.json(systemStatsBody(opts));
      }

      if (url.pathname === "/object_info") {
        if (unreachable)
          return new Response("down for testing", { status: 503 });
        if (!isAuthorized(req, opts))
          return new Response("unauthorized", { status: 401 });
        return Response.json(objectInfoFixture);
      }

      if (url.pathname === "/prompt" && req.method === "POST") {
        if (unreachable)
          return new Response("down for testing", { status: 503 });
        if (!isAuthorized(req, opts))
          return new Response("unauthorized", { status: 401 });
        return req.json().then((body: unknown) => {
          const { prompt, prompt_id, client_id } = body as {
            prompt: unknown;
            prompt_id?: string;
            client_id?: string;
          };
          const validation = validatePrompt(prompt);
          if (!validation.ok) {
            return Response.json(
              { error: "invalid prompt", node_errors: validation.nodeErrors },
              { status: 400 },
            );
          }

          const promptId = prompt_id ?? crypto.randomUUID();
          const script = scripts.get(promptId) ?? {};
          scripts.delete(promptId);
          const totalSteps = script.steps ?? 1;
          const job: JobState = {
            status: "running",
            step: 0,
            totalSteps,
            outputs: null,
            error: null,
            clientId: client_id ?? promptId,
            script,
            timer: null,
          };
          jobs.set(promptId, job);
          // issue #54: a hung job never advances on its own, so it stays
          // running until cancelled.
          if (!script.hang) {
            job.timer = setInterval(
              () => advance(promptId),
              script.stepIntervalMs ?? 5,
            );
          }

          return Response.json({ prompt_id: promptId }, { status: 200 });
        });
      }

      if (
        url.pathname.startsWith("/api/jobs/") &&
        url.pathname.endsWith("/cancel") &&
        req.method === "POST"
      ) {
        if (unreachable)
          return new Response("down for testing", { status: 503 });
        if (!isAuthorized(req, opts))
          return new Response("unauthorized", { status: 401 });
        const promptId = url.pathname.slice(
          "/api/jobs/".length,
          -"/cancel".length,
        );
        const job = jobs.get(promptId);
        if (!job) return new Response("not found", { status: 404 });
        if (job.timer) clearInterval(job.timer);
        job.timer = null;
        job.status = "cancelled";
        sendTo(job.clientId, {
          type: "status",
          data: { prompt_id: promptId, status: "cancelled" },
        });
        return new Response(null, { status: 204 });
      }

      if (url.pathname.startsWith("/api/jobs/")) {
        if (unreachable)
          return new Response("down for testing", { status: 503 });
        if (!isAuthorized(req, opts))
          return new Response("unauthorized", { status: 401 });
        const promptId = url.pathname.slice("/api/jobs/".length);
        const job = jobs.get(promptId);
        if (!job) return new Response("not found", { status: 404 });
        return Response.json({
          id: promptId,
          status: job.status,
          outputs: job.outputs,
          error: job.error,
        });
      }

      if (url.pathname === "/view") {
        if (unreachable)
          return new Response("down for testing", { status: 503 });
        if (!isAuthorized(req, opts))
          return new Response("unauthorized", { status: 401 });
        const filename = url.searchParams.get("filename") ?? "";
        return new Response(fakeFileBytes(filename), {
          headers: { "content-type": contentTypeFor(filename) },
        });
      }

      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        const clientId = ws.data.clientId;
        let set = sockets.get(clientId);
        if (!set) {
          set = new Set();
          sockets.set(clientId, set);
        }
        set.add(ws);
      },
      message() {
        /* the fake never reads anything from the client */
      },
      close(ws) {
        sockets.get(ws.data.clientId)?.delete(ws);
      },
    },
  });

  return {
    url: `http://localhost:${server.port}`,
    setUnreachable(down: boolean) {
      unreachable = down;
    },
    /** Scripts the job that will submit under `promptId` to succeed after N steps with canned outputs, or to fail. */
    script(promptId: string, job: ScriptedJob) {
      scripts.set(promptId, job);
    },
    stop() {
      for (const job of jobs.values()) {
        if (job.timer) clearInterval(job.timer);
      }
      server.stop(true);
    },
  };
}

/** Deterministic bytes for a filename, so a test can assert on saved content without a real codec. */
function fakeFileBytes(filename: string): Uint8Array {
  const text = `fake-comfyui:${filename}`;
  return new TextEncoder().encode(text);
}

function contentTypeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const byExt: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    flac: "audio/flac",
  };
  return byExt[ext] ?? "application/octet-stream";
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8188);
  const instance = startFakeComfyUi({ port });
  console.log(`fake-comfyui listening on ${instance.url}`);
}
