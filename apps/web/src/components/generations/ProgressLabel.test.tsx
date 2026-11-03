// Issue #195's AC: "tests cover the cap and the indeterminate bar."
import { afterEach, describe, expect, test } from "bun:test";
import type { GenerationProgress as GenerationProgressData } from "./types.js";
import type { GenerationSummary } from "./types.js";

import "../../test/happy-dom-setup.js";

const { cleanup, render } = await import("@testing-library/react");
const { GenerationProgress } = await import("./ProgressLabel.js");

afterEach(() => {
  cleanup();
});

function generation(overrides: Partial<GenerationSummary>): GenerationSummary {
  return {
    id: "g1",
    modelId: "m1",
    modelSlug: "ltx",
    modelName: "LTX 2.5",
    modeId: "mode1",
    modeName: "Default",
    submissionId: "s1",
    state: "running",
    tries: 0,
    error: null,
    submittedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: null,
    assets: [],
    removedAt: null,
    ...overrides,
  };
}

function progress(
  overrides: Partial<GenerationProgressData>,
): GenerationProgressData {
  return {
    generationId: "g1",
    elapsedMs: 0,
    estimateMs: null,
    step: null,
    totalSteps: null,
    ...overrides,
  };
}

describe("GenerationProgress", () => {
  test("has no aria-valuenow (indeterminate) while starting", () => {
    const view = render(
      <GenerationProgress
        generation={generation({ state: "starting" })}
        progress={undefined}
      />,
    );

    expect(view.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(
      false,
    );
  });

  test("has no aria-valuenow (indeterminate) while running without an estimate yet", () => {
    const view = render(
      <GenerationProgress
        generation={generation({ state: "running" })}
        progress={undefined}
      />,
    );

    expect(view.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(
      false,
    );
  });

  test("is determinate at the elapsed/estimate percentage once there's an estimate", () => {
    const view = render(
      <GenerationProgress
        generation={generation({ state: "running" })}
        progress={progress({ elapsedMs: 30_000, estimateMs: 60_000 })}
      />,
    );

    expect(view.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "50",
    );
  });

  test("shows 99 while saving", () => {
    const view = render(
      <GenerationProgress
        generation={generation({ state: "saving" })}
        progress={undefined}
      />,
    );

    expect(view.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "99",
    );
  });
});
