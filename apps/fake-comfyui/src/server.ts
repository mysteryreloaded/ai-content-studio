// A fake ComfyUI app: serves /system_stats and a captured /object_info like
// a real ComfyUI server, and can be scripted unreachable, so several
// instances can stand in for several Backends in tests (see issue #39,
// issue #41). Issue #44 adds the dispatch surface: /prompt (validated like
// ComfyUI), /ws progress, /api/jobs/:id and /view, each job scripted ahead
// of time to succeed after N steps with canned outputs, or to fail. Issue
// #54 adds /api/jobs/:id/cancel (the user's own cancel) and a `hang`
// script option, alongside issue #55's /interrupt (a timeout's own).
// Issue #50 adds `POST /upload/image` and `/view?type=input` (with HEAD),
// backed by an in-memory input folder a test can seed and inspect. Issue
// #79's contract suite settled that real ComfyUI's `/view` answers both
// HEAD and `Range` for any `type`, so `/view` here does too.

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
  /** Scripts the job to fail once its steps run out, with ComfyUI's own `execution_error` shape (issue #55), instead of completing. */
  fail?: string;
  /** Scripts `/prompt` to reject this `promptId` outright (issue #55): any other rejection, or a 413, instead of running it at all. */
  reject?: { status: number; error?: string };
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
  let unreachableTimer: ReturnType<typeof setTimeout> | null = null;
  const scripts = new Map<string, ScriptedJob>();
  const jobs = new Map<string, JobState>();
  const sockets = new Map<
    string,
    Set<{ send(data: string): void; close(): void }>
  >();
  const inputFiles = new Map<string, InputFile>();
  let uploadCount = 0;

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

  /** Every node type the submitted prompt uses must be known, like ComfyUI's own `/prompt` validation. A missing node type (issue #55) is distinguished by `type: "missing_node"`, so the studio knows to retry elsewhere instead of failing outright. */
  function validatePrompt(prompt: unknown):
    | { ok: true }
    | {
        ok: false;
        nodeErrors: Record<string, { type: string; message: string }>;
      } {
    if (!prompt || typeof prompt !== "object") {
      return { ok: false, nodeErrors: {} };
    }
    const fixture = objectInfoFixture as Record<string, unknown>;
    const nodeErrors: Record<string, { type: string; message: string }> = {};
    for (const [nodeId, node] of Object.entries(
      prompt as Record<string, unknown>,
    )) {
      const classType =
        node && typeof node === "object"
          ? (node as { class_type?: unknown }).class_type
          : undefined;
      if (typeof classType !== "string" || !(classType in fixture)) {
        nodeErrors[nodeId] = {
          type: "missing_node",
          message: `unknown node type ${String(classType)}`,
        };
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
          const { down, forMs } = body as { down?: boolean; forMs?: number };
          if (unreachableTimer) clearTimeout(unreachableTimer);
          unreachableTimer = null;
          unreachable = Boolean(down);
          /** An "unreachable spell" (issue #55): comes back on its own after `forMs`, instead of the test having to flip it back itself. */
          if (unreachable && forMs) {
            unreachableTimer = setTimeout(() => {
              unreachable = false;
              unreachableTimer = null;
            }, forMs);
          }
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

      /** Simulates ComfyUI's process restarting: forgets every in-flight job, so `/api/jobs/:id` 404s the way it would for a job the server never ran (issue #55's AC). */
      if (url.pathname === "/__control__/restart" && req.method === "POST") {
        for (const job of jobs.values()) {
          if (job.timer) clearInterval(job.timer);
        }
        jobs.clear();
        scripts.clear();
        for (const set of sockets.values()) {
          for (const ws of set) ws.close();
        }
        sockets.clear();
        return new Response(null, { status: 204 });
      }

      /** Drops every open `/ws` connection without closing the server itself (issue #55's AC). */
      if (url.pathname === "/__control__/drop-ws" && req.method === "POST") {
        for (const set of sockets.values()) {
          for (const ws of set) ws.close();
        }
        return new Response(null, { status: 204 });
      }

      if (url.pathname === "/interrupt" && req.method === "POST") {
        if (unreachable)
          return new Response("down for testing", { status: 503 });
        if (!isAuthorized(req, opts))
          return new Response("unauthorized", { status: 401 });
        return req.json().then((body: unknown) => {
          const { prompt_id } = body as { prompt_id?: string };
          const job = prompt_id ? jobs.get(prompt_id) : undefined;
          if (job && job.status === "running") {
            if (job.timer) clearInterval(job.timer);
            job.timer = null;
            job.status = "failed";
            job.error = "interrupted";
            sendTo(job.clientId, {
              type: "status",
              data: { prompt_id, status: "failed", error: job.error },
            });
          }
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
          const promptId = prompt_id ?? crypto.randomUUID();

          const rejectScript = scripts.get(promptId)?.reject;
          if (rejectScript) {
            scripts.delete(promptId);
            return Response.json(
              { error: rejectScript.error ?? "rejected" },
              { status: rejectScript.status },
            );
          }

          const validation = validatePrompt(prompt);
          if (!validation.ok) {
            return Response.json(
              { error: "invalid prompt", node_errors: validation.nodeErrors },
              { status: 400 },
            );
          }

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

      if (url.pathname === "/upload/image" && req.method === "POST") {
        if (unreachable)
          return new Response("down for testing", { status: 503 });
        if (!isAuthorized(req, opts))
          return new Response("unauthorized", { status: 401 });
        return req.formData().then(async (form) => {
          const image = form.get("image");
          if (!(image instanceof Blob)) {
            return new Response("no image", { status: 400 });
          }
          const name = (image as File).name ?? "image.png";
          const subfolder = String(form.get("subfolder") ?? "");
          uploadCount += 1;
          inputFiles.set(inputKey(subfolder, name), {
            bytes: new Uint8Array(await image.arrayBuffer()),
            lastModified: new Date(),
          });
          return Response.json({ name, subfolder, type: "input" });
        });
      }

      if (
        url.pathname === "/view" &&
        url.searchParams.get("type") === "input"
      ) {
        if (unreachable)
          return new Response("down for testing", { status: 503 });
        if (!isAuthorized(req, opts))
          return new Response("unauthorized", { status: 401 });
        const file = inputFiles.get(
          inputKey(
            url.searchParams.get("subfolder") ?? "",
            url.searchParams.get("filename") ?? "",
          ),
        );
        if (!file) return new Response("not found", { status: 404 });
        return serveView(req, file.bytes, file.lastModified);
      }

      if (url.pathname === "/view") {
        if (unreachable)
          return new Response("down for testing", { status: 503 });
        if (!isAuthorized(req, opts))
          return new Response("unauthorized", { status: 401 });
        const filename = url.searchParams.get("filename") ?? "";
        return serveView(req, fakeFileBytes(filename), null, {
          "content-type": contentTypeFor(filename),
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
    /** `forMs` scripts an "unreachable spell" (issue #55) that lifts on its own, instead of the caller flipping it back. */
    setUnreachable(down: boolean, forMs?: number) {
      if (unreachableTimer) clearTimeout(unreachableTimer);
      unreachableTimer = null;
      unreachable = down;
      if (down && forMs) {
        unreachableTimer = setTimeout(() => {
          unreachable = false;
          unreachableTimer = null;
        }, forMs);
      }
    },
    /** Scripts the job that will submit under `promptId` to succeed after N steps with canned outputs, to fail with `execution_error`, or (via `reject`) to be rejected outright (issue #55). */
    script(promptId: string, job: ScriptedJob) {
      scripts.set(promptId, job);
    },
    /** The input folder's file at `subfolder/filename`, as `/upload/image` stored it. */
    inputFile(subfolder: string, filename: string): InputFile | undefined {
      return inputFiles.get(inputKey(subfolder, filename));
    },
    /** Seeds the input folder, as if an earlier `/upload/image` had sent it at `lastModified`. */
    putInputFile(
      subfolder: string,
      filename: string,
      bytes: Uint8Array,
      lastModified: Date,
    ) {
      inputFiles.set(inputKey(subfolder, filename), { bytes, lastModified });
    },
    /** How many `/upload/image` requests arrived. */
    get uploadCount() {
      return uploadCount;
    },
    /** Drops every open `/ws` connection without closing the server itself (issue #55's AC). */
    dropWs() {
      for (const set of sockets.values()) {
        for (const ws of set) ws.close();
      }
    },
    /** Simulates ComfyUI's process restarting: forgets every in-flight job and script (issue #55's AC). */
    restart() {
      for (const job of jobs.values()) {
        if (job.timer) clearInterval(job.timer);
      }
      jobs.clear();
      scripts.clear();
      for (const set of sockets.values()) {
        for (const ws of set) ws.close();
      }
      sockets.clear();
    },
    stop() {
      if (unreachableTimer) clearTimeout(unreachableTimer);
      for (const job of jobs.values()) {
        if (job.timer) clearInterval(job.timer);
      }
      server.stop(true);
    },
  };
}

export interface InputFile {
  bytes: Uint8Array;
  lastModified: Date;
}

function inputKey(subfolder: string, filename: string): string {
  return subfolder ? `${subfolder}/${filename}` : filename;
}

/**
 * Real ComfyUI's `/view` (any `type`, `input` or `output`) answers through
 * aiohttp's `web.FileResponse`, which supports HEAD (aiohttp registers it
 * alongside every `GET` route) and `Range` (issue #79 settled this by
 * reading ComfyUI's own `server.py`). This mirrors both, instead of the
 * input/output branches each doing their own partial thing.
 */
function serveView(
  req: Request,
  bytes: Uint8Array,
  lastModified: Date | null,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers: Record<string, string> = {
    ...extraHeaders,
    "accept-ranges": "bytes",
  };
  if (lastModified) headers["last-modified"] = lastModified.toUTCString();

  const range = parseRangeHeader(req.headers.get("range"), bytes.length);
  if (range) {
    const slice = bytes.subarray(range.start, range.end + 1);
    return new Response(req.method === "HEAD" ? null : slice, {
      status: 206,
      headers: {
        ...headers,
        "content-length": String(slice.length),
        "content-range": `bytes ${range.start}-${range.end}/${bytes.length}`,
      },
    });
  }

  headers["content-length"] = String(bytes.length);
  return new Response(req.method === "HEAD" ? null : bytes, { headers });
}

/** Parses a `Range: bytes=start-end` header (including an open end or a suffix range), `null` when absent, unsatisfiable or malformed. */
function parseRangeHeader(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return null;

  let start: number;
  let end: number;
  if (startStr === "") {
    // A suffix range ("bytes=-500"): the last `endStr` bytes.
    start = Math.max(0, size - Number(endStr));
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? size - 1 : Math.min(Number(endStr), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || start > end || start >= size) return null;
  return { start, end };
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
