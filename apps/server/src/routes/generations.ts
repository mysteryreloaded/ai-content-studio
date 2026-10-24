// `/api/generations/stream`: one SSE stream per tab carrying every
// Generation of the signed-in user, across every Model (issue #43). A
// snapshot of active ones is sent on connect, then "change" events as
// they happen; a heartbeat (scheduled off the injected Clock, ADR 0006)
// keeps the connection alive through proxies.

import type { Clock, Timer } from "@ai-content-studio/shared";
import { Hono } from "hono";
import { type RouteEntry, guardedRoute } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { GenerationEvents } from "../generations/events.js";
import type { GenerationsRepository } from "../generations/repository.js";

const HEARTBEAT_INTERVAL_MS = 15_000;

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

      const snapshot = await generationsRepository.listActiveForUser(userId);

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
        start(controller) {
          const send = (event: string, data: unknown) => {
            try {
              controller.enqueue(encoder.encode(sseEvent(event, data)));
            } catch {
              cleanup();
            }
          };

          send("snapshot", { generations: snapshot });

          unsubscribe = generationEvents.subscribe(userId, (event) => {
            send(event.type, event.generation);
          });

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
