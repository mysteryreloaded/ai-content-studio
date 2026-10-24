import type { LogEntryWriter } from "../backends/log-entries.js";
import type { Session } from "./session.js";

/** Hono's `Variables` for this app: every request carries its session (or `null`). */
export interface AppEnv {
  Variables: {
    session: Session | null;
    /** Set once per request by `app.ts`'s logging middleware; used by Audit entries. */
    requestId: string;
    /** Set once per request by `app.ts`; used to log a non-Admin hitting an admin route (issue #67). */
    logWriter: LogEntryWriter;
  };
}
