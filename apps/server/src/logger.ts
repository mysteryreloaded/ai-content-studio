import type { Clock } from "@ai-content-studio/shared";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogFields {
  request_id?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/**
 * Dependency-free JSON-lines logger. One line per call: `time`, `level`,
 * `msg` and whatever fields the caller passes. Never pass IPs, user
 * agents or cookies in `fields` — the logger does not strip them.
 */
export function createLogger(
  clock: Clock,
  minLevel: LogLevel,
  write: (line: string) => void = (line) => console.log(line),
): Logger {
  const log = (level: LogLevel, msg: string, fields?: LogFields) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    write(
      JSON.stringify({
        time: clock.now().toISOString(),
        level,
        msg,
        ...fields,
      }),
    );
  };

  return {
    debug: (msg, fields) => log("debug", msg, fields),
    info: (msg, fields) => log("info", msg, fields),
    warn: (msg, fields) => log("warn", msg, fields),
    error: (msg, fields) => log("error", msg, fields),
  };
}
