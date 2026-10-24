// An unhandled error is logged as an `error` with source "app" (issue
// #67), and never throws itself — even when the writer it logs through
// fails (e.g. the DB a 500 is already complaining about), so app.ts's
// `onError` can always still answer 500.

import { describe, expect, test } from "bun:test";
import type { LogEntryInput, LogEntryWriter } from "./backends/log-entries.js";
import { logUnhandledError } from "./error-logging.js";
import type { Logger } from "./logger.js";

function silentLogger(): Logger {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function recordingWriter(): {
  writer: LogEntryWriter;
  entries: LogEntryInput[];
} {
  const entries: LogEntryInput[] = [];
  return {
    writer: {
      async log(entry) {
        entries.push(entry);
      },
    },
    entries,
  };
}

describe("logUnhandledError", () => {
  test("logs the error's message, stack and userId", async () => {
    const { writer, entries } = recordingWriter();
    await logUnhandledError(
      writer,
      silentLogger(),
      "user-1",
      new Error("kaboom"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("error");
    expect(entries[0]?.source).toBe("app");
    expect(entries[0]?.message).toBe("kaboom");
    expect(entries[0]?.details).toContain("kaboom");
    expect(entries[0]?.userId).toBe("user-1");
  });

  test("never throws when the writer itself fails, and falls back to the stdout logger", async () => {
    const lines: string[] = [];
    const logger: Logger = {
      debug() {},
      info() {},
      warn() {},
      error(msg) {
        lines.push(msg);
      },
    };
    const writer: LogEntryWriter = {
      async log() {
        throw new Error("db unreachable");
      },
    };

    await expect(
      logUnhandledError(writer, logger, undefined, new Error("kaboom")),
    ).resolves.toBeUndefined();

    expect(lines).toContain("failed to write unhandled-error Log entry");
  });

  test("handles a non-Error throw", async () => {
    const { writer, entries } = recordingWriter();
    await logUnhandledError(
      writer,
      silentLogger(),
      undefined,
      "a string throw",
    );

    expect(entries[0]?.message).toBe("unhandled error");
    expect(entries[0]?.details).toBeUndefined();
  });
});
