// A fake ComfyUI app: serves /system_stats and a captured /object_info like
// a real ComfyUI server, and can be scripted unreachable, so several
// instances can stand in for several Backends in tests (see issue #39,
// issue #41).

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

/** Starts a fake ComfyUI server. `setUnreachable` toggles it failing every request. */
export function startFakeComfyUi(opts: FakeComfyUiOptions) {
  let unreachable = false;

  const server = Bun.serve({
    port: opts.port,
    fetch(req) {
      const url = new URL(req.url);

      if (
        url.pathname === "/__control__/unreachable" &&
        req.method === "POST"
      ) {
        return req.json().then((body: unknown) => {
          unreachable = Boolean((body as { down?: boolean }).down);
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

      return new Response("not found", { status: 404 });
    },
  });

  return {
    url: `http://localhost:${server.port}`,
    setUnreachable(down: boolean) {
      unreachable = down;
    },
    stop() {
      server.stop(true);
    },
  };
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8188);
  const instance = startFakeComfyUi({ port });
  console.log(`fake-comfyui listening on ${instance.url}`);
}
