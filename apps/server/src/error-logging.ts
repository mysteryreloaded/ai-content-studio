// An unhandled error must still answer 500 even when writing its own Log
// entry fails (e.g. the DB that `logWriter` writes to is itself down):
// swallow that failure and fall back to the stdout `Logger` (issue #67).

import type { LogEntryWriter } from "./backends/log-entries.js";
import type { Logger } from "./logger.js";

export async function logUnhandledError(
  logWriter: LogEntryWriter,
  logger: Logger,
  userId: string | undefined,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? err.message : "unhandled error";
  const details = err instanceof Error ? err.stack : undefined;

  try {
    await logWriter.log({
      level: "error",
      source: "app",
      message,
      details,
      userId,
    });
  } catch (logErr) {
    logger.error("failed to write unhandled-error Log entry", {
      message,
      error: logErr instanceof Error ? logErr.message : String(logErr),
    });
  }
}
