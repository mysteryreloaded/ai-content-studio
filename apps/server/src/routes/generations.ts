// `/api/generations/stream`: one SSE stream per tab carrying every
// Generation of the signed-in user, across every Model (issue #43). A
// snapshot of active ones is sent on connect, then "change" events as
// they happen; a heartbeat (scheduled off the injected Clock, ADR 0006)
// keeps the connection alive through proxies.

import type { Clock, Timer } from "@ai-content-studio/shared";
import { Hono } from "hono";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { Database } from "../db/client.js";
import { getCapsStatus } from "../generations/caps.js";
import { deleteStorageFor } from "../generations/deletion.js";
import type { GenerationEvent } from "../generations/events.js";
import type { GenerationEvents } from "../generations/events.js";
import type { GenerationsRepository } from "../generations/repository.js";
import type { Storage } from "../storage/storage.js";

/** The AC asks for "every few seconds"; Bun.serve's own idle socket timeout is 10s. */
const HEARTBEAT_INTERVAL_MS = 5_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Hono app served from `Bun.serve({ fetch: app.fetch })` gets the `Server` as `c.env`. */
interface BunServerEnv {
  timeout?: (request: Request, seconds: number) => void;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** `/api/generations`: the signed-in user's own Generation stream (issue #43), detail dialog and delete (issue #57). */
export function generationsRoute(
  db: Database,
  generationsRepository: GenerationsRepository,
  generationEvents: GenerationEvents,
  clock: Clock,
  storage: Storage,
  routes: RouteEntry[],
) {
  const basePath = "/api/generations";

  return (
    new Hono<AppEnv>()
      // `/api/generations/caps`: this user's Caps and current usage (issue
      // #53), for the Workbench foot.
      .get(
        "/caps",
        guard(routes, basePath, "get", "/caps", "active"),
        async (c) => {
          const session = c.get("session");
          if (!session) return c.json({ error: "unauthorized" }, 401);
          const status = await getCapsStatus(db, clock, session.user.id);
          return c.json(status);
        },
      )
      .get(
        "/stream",
        guard(routes, basePath, "get", "/stream", "active"),
        async (c) => {
          const session = c.get("session");
          if (!session) return c.json({ error: "unauthorized" }, 401);
          const userId = session.user.id;

          c.header("Content-Type", "text/event-stream");
          c.header("Cache-Control", "no-cache");
          c.header("Connection", "keep-alive");
          // Keeps nginx (and similar reverse proxies) from buffering the
          // stream, so events reach the browser as they're written.
          c.header("X-Accel-Buffering", "no");

          const encoder = new TextEncoder();
          let heartbeatTimer: Timer | null = null;
          let unsubscribe: (() => void) | null = null;

          const body = new ReadableStream({
            async start(controller) {
              const send = (event: string, data: unknown) => {
                try {
                  controller.enqueue(encoder.encode(sseEvent(event, data)));
                } catch {
                  cleanup();
                }
              };

              // Subscribes before querying the snapshot: a Generation
              // submitted in between is published here and buffered, rather
              // than falling in the gap between the two and reaching
              // neither (QA round 3). Once the snapshot is sent, anything
              // it already covers is dropped from the buffer so it isn't
              // delivered twice.
              let bufferingBeforeSnapshot = true;
              const buffered: GenerationEvent[] = [];
              unsubscribe = generationEvents.subscribe(userId, (event) => {
                if (bufferingBeforeSnapshot) {
                  buffered.push(event);
                  return;
                }
                sendGenerationEvent(event);
              });

              function sendGenerationEvent(event: GenerationEvent) {
                if (event.type === "progress") {
                  send("progress", event.progress);
                } else if (event.type === "disconnect") {
                  cleanup();
                  try {
                    controller.close();
                  } catch {
                    // already closing/closed
                  }
                } else {
                  send("change", event.generation);
                }
              }

              const snapshot =
                await generationsRepository.listActiveForUser(userId);
              send("snapshot", { generations: snapshot });
              bufferingBeforeSnapshot = false;

              const snapshotIds = new Set(snapshot.map((g) => g.id));
              for (const event of buffered) {
                if (
                  event.type === "change" &&
                  snapshotIds.has(event.generation.id)
                ) {
                  continue;
                }
                sendGenerationEvent(event);
              }

              const scheduleHeartbeat = () => {
                heartbeatTimer = clock.setTimeout(() => {
                  try {
                    controller.enqueue(encoder.encode(": heartbeat\n\n"));
                    scheduleHeartbeat();
                  } catch {
                    cleanup();
                  }
                }, HEARTBEAT_INTERVAL_MS);
              };
              scheduleHeartbeat();

              // Bun.serve closes an idle connection after 10s; a quiet SSE
              // stream between heartbeats would otherwise be cut.
              const server = c.env as BunServerEnv | undefined;
              server?.timeout?.(c.req.raw, 0);

              function cleanup() {
                unsubscribe?.();
                if (heartbeatTimer !== null) clock.clearTimeout(heartbeatTimer);
              }

              c.req.raw.signal.addEventListener("abort", cleanup);
            },
            cancel() {
              unsubscribe?.();
              if (heartbeatTimer !== null) clock.clearTimeout(heartbeatTimer);
            },
          });

          return c.body(body);
        },
      )
      // `/api/generations/:id`: one Generation's own detail (issue #57's
      // AC) — the owner only; a missing id or someone else's Generation
      // both come back 404, so a pasted link can't be used to probe which
      // ids exist. Registered after the static `/caps` and `/stream` paths
      // above, which must win over this one matching "caps"/"stream" as an
      // `:id`.
      .get(
        "/:id",
        guard(routes, basePath, "get", "/:id", "active"),
        async (c) => {
          const session = c.get("session");
          if (!session) return c.json({ error: "unauthorized" }, 401);

          const id = c.req.param("id");
          if (!id || !UUID_RE.test(id))
            return c.json({ error: "not found" }, 404);

          const detail = await generationsRepository.getDetailForUser(
            id,
            session.user.id,
          );
          if (!detail) return c.json({ error: "not found" }, 404);
          return c.json(detail);
        },
      )
      // `/api/generations/:id` DELETE (issue #57's AC): one ended
      // Generation, into a Tombstone. 404 for anything not this user's own,
      // already deleted, or still under way.
      .delete(
        "/:id",
        guard(routes, basePath, "delete", "/:id", "active"),
        async (c) => {
          const session = c.get("session");
          if (!session) return c.json({ error: "unauthorized" }, 401);

          const id = c.req.param("id");
          if (!id || !UUID_RE.test(id))
            return c.json({ error: "not found" }, 404);

          const keys = await generationsRepository.deleteGeneration(
            id,
            session.user.id,
            clock.now(),
          );
          if (!keys) return c.json({ error: "not found" }, 404);
          await deleteStorageFor(storage, keys);
          return c.json({ ok: true });
        },
      )
      // `/api/generations/:id/dismiss-removed` (issue #68's AC): the owner
      // dismissing their "Removed by an administrator" card. 404 for
      // anything not this user's own, or that isn't removed.
      .post(
        "/:id/dismiss-removed",
        guard(routes, basePath, "post", "/:id/dismiss-removed", "active"),
        async (c) => {
          const session = c.get("session");
          if (!session) return c.json({ error: "unauthorized" }, 401);

          const id = c.req.param("id");
          if (!id || !UUID_RE.test(id))
            return c.json({ error: "not found" }, 404);

          const ok = await generationsRepository.dismissRemoved(
            id,
            session.user.id,
            clock.now(),
          );
          if (!ok) return c.json({ error: "not found" }, 404);
          return c.json({ ok: true });
        },
      )
  );
}
