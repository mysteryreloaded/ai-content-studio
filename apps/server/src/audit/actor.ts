import type { Context } from "hono";
import type { AppEnv } from "../auth/app-env.js";
import type { AuditActor } from "./audit.js";

function clientIp(c: Context<AppEnv>): string | null {
  const forwardedFor = c.req.header("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || null;
}

/** The Admin actor for an Audit entry (ADR 0005), from the current request's session. */
export function adminActorFrom(c: Context<AppEnv>): AuditActor {
  const session = c.get("session");
  if (!session) throw new Error("adminActorFrom requires a session");
  return {
    type: "admin",
    userId: session.user.id,
    email: session.user.email,
    ip: clientIp(c),
    userAgent: c.req.header("user-agent") ?? null,
    requestId: c.get("requestId"),
  };
}
