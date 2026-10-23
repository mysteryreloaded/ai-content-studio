// Log entries (operational records distinct from Audit entries): written to
// stdout and Postgres, details truncated (issue #39).

import type postgres from "postgres";
import type { Clock } from "./clock";

export type LogLevel = "error" | "warning" | "info";

export interface LogEntryInput {
  level: LogLevel;
  message: string;
  details?: string;
  backendId?: string;
}

const MAX_DETAILS_LENGTH = 4000;

export interface Logger {
  log(entry: LogEntryInput): Promise<void>;
}

export function createLogger(sql: postgres.Sql, clock: Clock): Logger {
  return {
    async log(entry: LogEntryInput) {
      const createdAt = clock.now();
      const details = entry.details?.slice(0, MAX_DETAILS_LENGTH);

      const line = JSON.stringify({ ...entry, details, createdAt: createdAt.toISOString() });
      if (entry.level === "error") console.error(line);
      else if (entry.level === "warning") console.warn(line);
      else console.log(line);

      await sql`
        insert into log_entries (level, message, details, backend_id, created_at)
        values (${entry.level}, ${entry.message}, ${details ?? null}, ${entry.backendId ?? null}, ${createdAt})
      `;
    },
  };
}
