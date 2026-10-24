import { describe, expect, test } from "bun:test";
import {
  buildNotificationContent,
  notificationClickTarget,
  shouldNotify,
} from "./notificationDecision.js";
import type { TrackedSubmission } from "./types.js";

function submission(
  generations: TrackedSubmission["generations"],
): TrackedSubmission {
  return {
    submissionId: "s1",
    modelName: "LTX 2.5",
    modeName: "First frame",
    generations,
  };
}

const ENDED = submission([
  { id: "a", state: "succeeded" },
  { id: "b", state: "failed" },
]);

const UNDER_WAY = submission([
  { id: "a", state: "succeeded" },
  { id: "b", state: "running" },
]);

const ALL_REMOVED = submission([
  { id: "a", state: "succeeded", removed: true },
]);

describe("shouldNotify", () => {
  test("true for a newly-ended Submission, no tab visible, not cancelled", () => {
    expect(
      shouldNotify({
        submission: ENDED,
        alreadyDecided: false,
        anyTabVisible: false,
        ownCancelled: false,
      }),
    ).toBe(true);
  });

  test("false while still under way", () => {
    expect(
      shouldNotify({
        submission: UNDER_WAY,
        alreadyDecided: false,
        anyTabVisible: false,
        ownCancelled: false,
      }),
    ).toBe(false);
  });

  test("false while any studio tab is visible", () => {
    expect(
      shouldNotify({
        submission: ENDED,
        alreadyDecided: false,
        anyTabVisible: true,
        ownCancelled: false,
      }),
    ).toBe(false);
  });

  test("false once already decided (exactly one Notification per Submission)", () => {
    expect(
      shouldNotify({
        submission: ENDED,
        alreadyDecided: true,
        anyTabVisible: false,
        ownCancelled: false,
      }),
    ).toBe(false);
  });

  test("false for the user's own cancel", () => {
    expect(
      shouldNotify({
        submission: ENDED,
        alreadyDecided: false,
        anyTabVisible: false,
        ownCancelled: true,
      }),
    ).toBe(false);
  });

  test("false once every Generation was Removed", () => {
    expect(
      shouldNotify({
        submission: ALL_REMOVED,
        alreadyDecided: false,
        anyTabVisible: false,
        ownCancelled: false,
      }),
    ).toBe(false);
  });
});

describe("buildNotificationContent", () => {
  test("title is the site title; body is counts, Model and Mode only", () => {
    expect(buildNotificationContent(ENDED, "My Studio")).toEqual({
      title: "My Studio",
      body: "1 ready · 1 failed — LTX 2.5 · First frame",
    });
  });
});

describe("notificationClickTarget", () => {
  test("the first succeeded Generation", () => {
    expect(notificationClickTarget(ENDED)).toBe("a");
  });
});
