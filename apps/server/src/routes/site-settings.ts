import type { Clock, Timer } from "@ai-content-studio/shared";
import { type Context, Hono } from "hono";
import { type RouteEntry, guard } from "../auth/access.js";
import type { AppEnv } from "../auth/app-env.js";
import type { NoticeEvents } from "../branding/notice-events.js";
import {
  BACKGROUND_STORAGE_KEY,
  LOGO_STORAGE_KEY,
  activeTermsVersion,
  getPauseNotice,
  getSiteSettings,
} from "../branding/site-settings-store.js";
import type { Database } from "../db/client.js";
import type { ModelRepository } from "../models/repository.js";
import type { Storage } from "../storage/storage.js";

/** Mirrors `routes/generations.ts`'s heartbeat cadence, below Bun.serve's 10s idle socket timeout. */
const HEARTBEAT_INTERVAL_MS = 5_000;

interface BunServerEnv {
  timeout?: (request: Request, seconds: number) => void;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** `/api/site-settings`: the public branding the landing page (and `index.html`) read. */
export function siteSettingsRoute(
  db: Database,
  storage: Storage,
  modelRepository: ModelRepository,
  noticeEvents: NoticeEvents,
  clock: Clock,
  routes: RouteEntry[] = [],
) {
  const basePath = "/api/site-settings";

  return (
    new Hono<AppEnv>()
      .get("/", guard(routes, basePath, "get", "/", "public"), async (c) => {
        const settings = await getSiteSettings(db);
        return c.json({
          title: settings.title,
          landingText: settings.landingText,
          accent: settings.accent,
          signUpMode: settings.signUpMode,
          contact: settings.contact,
          hasLogo: settings.logo !== null,
          hasBackground: settings.background !== null,
          hasTerms: activeTermsVersion(settings) !== null,
          footerLinks: settings.footerLinks,
          hasNonVideoEnabledModel:
            await modelRepository.hasEnabledNonVideoModel(),
        });
      })
      // `/api/site-settings/notice-stream`: the Notice/Pause banner
      // (issue #59), public so it reaches signed-out visitors too.
      // Mirrors `routes/generations.ts`'s SSE pattern, but with one
      // shared, unkeyed audience instead of one per user.
      .get(
        "/notice-stream",
        guard(routes, basePath, "get", "/notice-stream", "public"),
        async (c) => {
          c.header("Content-Type", "text/event-stream");
          c.header("Cache-Control", "no-cache");
          c.header("Connection", "keep-alive");
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

              // Subscribes before reading the snapshot (mirrors
              // `routes/generations.ts`): a change published in between is
              // buffered here instead of landing in the gap between the two.
              let bufferingBeforeSnapshot = true;
              let latestBuffered: unknown = null;
              unsubscribe = noticeEvents.subscribe((snapshot) => {
                if (bufferingBeforeSnapshot) {
                  latestBuffered = snapshot;
                  return;
                }
                send("notice", snapshot);
              });

              send("notice", await getPauseNotice(db));
              bufferingBeforeSnapshot = false;
              if (latestBuffered) send("notice", latestBuffered);

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
      .get(
        "/logo",
        guard(routes, basePath, "get", "/logo", "public"),
        async (c) => serveImage(c, db, storage, "logo"),
      )
      .get(
        "/background",
        guard(routes, basePath, "get", "/background", "public"),
        async (c) => serveImage(c, db, storage, "background"),
      )
  );
}

async function serveImage(
  c: Context<AppEnv>,
  db: Database,
  storage: Storage,
  which: "logo" | "background",
) {
  const settings = await getSiteSettings(db);
  const image = settings[which];
  if (!image) return c.json({ error: "not found" }, 404);

  const key = which === "logo" ? LOGO_STORAGE_KEY : BACKGROUND_STORAGE_KEY;
  const bytes = await storage.read(key);
  return c.body(new Uint8Array(bytes), 200, {
    "Content-Type": image.contentType,
    "Cache-Control": "no-cache",
    ETag: `"${image.hash}"`,
  });
}
