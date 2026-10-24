// Log entries (operational records distinct from Audit entries): written to
// stdout and Postgres, details truncated (issue #39).

import type { Clock } from "@ai-content-studio/shared";
import type { Database } from "../db/client.js";
import { logEntries } from "../db/schema.js";
import type { Logger } from "../logger.js";

export type LogEntryLevel = "error" | "warning" | "info";

export interface LogEntryInput {
  level: LogEntryLevel;
  message: string;
  details?: string;
  backendId?: string;
}

const MAX_DETAILS_LENGTH = 4000;

export interface LogEntryWriter {
  log(entry: LogEntryInput): Promise<void>;
}

const STDOUT_LEVEL: Record<LogEntryLevel, "warn" | "error" | "info"> = {
  error: "error",
  warning: "warn",
  info: "info",
};

export function createLogEntryWriter(
  db: Database,
  clock: Clock,
  logger: Logger,
): LogEntryWriter {
  return {
    async log(entry: LogEntryInput) {
      const createdAt = clock.now();
      const details = entry.details?.slice(0, MAX_DETAILS_LENGTH);

      logger[STDOUT_LEVEL[entry.level]](entry.message, {
        backend_id: entry.backendId,
        details,
      });

      await db.insert(logEntries).values({
        level: entry.level,
        message: entry.message,
        details: details ?? null,
        backendId: entry.backendId ?? null,
        createdAt,
      });
    },
  };
}
