import type { Session } from "./session.js";

/** Hono's `Variables` for this app: every request carries its session (or `null`). */
export interface AppEnv {
  Variables: {
    session: Session | null;
  };
}
