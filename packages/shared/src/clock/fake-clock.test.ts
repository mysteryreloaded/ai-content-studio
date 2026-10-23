import { describe, expect, test } from "bun:test";
import { FakeClock } from "./fake-clock.js";

describe("FakeClock", () => {
  test("advances now() without firing timers", () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    clock.advance(1_000);
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:01.000Z");
  });

  test("fires a due timeout when advanced past it", () => {
    const clock = new FakeClock();
    let fired = false;
    clock.setTimeout(() => {
      fired = true;
    }, 500);
    clock.advance(499);
    expect(fired).toBe(false);
    clock.advance(1);
    expect(fired).toBe(true);
  });

  test("fires timers in due order across one advance", () => {
    const clock = new FakeClock();
    const order: string[] = [];
    clock.setTimeout(() => order.push("second"), 200);
    clock.setTimeout(() => order.push("first"), 100);
    clock.advance(200);
    expect(order).toEqual(["first", "second"]);
  });

  test("a cleared timeout never fires", () => {
    const clock = new FakeClock();
    let fired = false;
    const timer = clock.setTimeout(() => {
      fired = true;
    }, 100);
    clock.clearTimeout(timer);
    clock.advance(200);
    expect(fired).toBe(false);
  });
});
