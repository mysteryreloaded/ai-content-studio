import { describe, expect, test } from "bun:test";
import { FakeClock } from "@ai-content-studio/shared";
import { createLogger } from "./logger.js";

describe("createLogger", () => {
  test("writes one JSON line with time, level and msg", () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    const lines: string[] = [];
    const logger = createLogger(clock, "debug", (line) => lines.push(line));

    logger.info("server started", { request_id: "abc" });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      time: "2026-01-01T00:00:00.000Z",
      level: "info",
      msg: "server started",
      request_id: "abc",
    });
  });

  test("drops lines below the minimum level", () => {
    const clock = new FakeClock();
    const lines: string[] = [];
    const logger = createLogger(clock, "warn", (line) => lines.push(line));

    logger.info("ignored", {});
    logger.warn("kept", {});

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "").msg).toBe("kept");
  });
});
