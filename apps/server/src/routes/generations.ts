// `/api/generations/stream`: one SSE stream per tab carrying every
// Generation of the signed-in user, across every Model (issue #43). A
// snapshot of active ones is sent on connect, then "change" events as
// they happen; a heartbeat (scheduled off the injected Clock, ADR 0006)
// keeps the connection alive through proxies.

import type { Clock, Timer } from "@ai-content-studio/shared";
import { Hono } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { GenerationEvent } from "../generations/events.js";
import type { GenerationEvents } from "../generations/events.js";
import type { GenerationsRepository } from "../generations/repository.js";

/** The AC asks for "every few seconds"; Bun.serve's own idle socket timeout is 10s. */
const HEARTBEAT_INTERVAL_MS = 5_000;

/** A Hono app served from `Bun.serve({ fetch: app.fetch })` gets the `Server` as `c.env`. */
interface BunServerEnv {
  timeout?: (request: Request, seconds: number) => void;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** `/api/generations`: the signed-in user's own Generation stream (issue #43). */
export function generationsRoute(
  generationsRepository: GenerationsRepository,
  generationEvents: GenerationEvents,
  clock: Clock,
  routes: RouteEntry[],
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  guardedRoute(
    app,
    routes,
    "/api/generations",
    "get",
    "/stream",
    "active",
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
            send(event.type, event.generation);
          });

          const snapshot =
            await generationsRepository.listActiveForUser(userId);
          send("snapshot", { generations: snapshot });
          bufferingBeforeSnapshot = false;

          const snapshotIds = new Set(snapshot.map((g) => g.id));
          for (const event of buffered) {
            if (snapshotIds.has(event.generation.id)) continue;
            send(event.type, event.generation);
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
  );

  return app;
}
