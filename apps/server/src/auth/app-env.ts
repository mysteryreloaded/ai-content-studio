import type { LogEntryWriter } from "../backends/log-entries.js";
import type { Session } from "./session.js";

/** Hono's `Variables` for this app: every request carries its session (or `null`). */
export interface AppEnv {
  Variables: {
    session: Session | null;
    /**
     * The Site terms' current version (issue #60), or `null` when none
     * are set. Set alongside `session` by `sessionMiddleware` (only
     * looked up when a session exists) and read by `requireAccess`'s
     * "active"/"admin" levels to gate on acceptance.
     */
    termsVersion: number | null;
    /** Set once per request by `app.ts`'s logging middleware; used by Audit entries. */
    requestId: string;
    /** Set once per request by `app.ts`; used to log a non-Admin hitting an admin route (issue #67). */
    logWriter: LogEntryWriter;
  };
}
