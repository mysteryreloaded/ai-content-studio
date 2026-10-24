// Contract suite (issue #79): drives the comfyui module's own client
// functions (upload, submit, /ws progress, /api/jobs, /view, cancel) plus
// the backends module's /system_stats and /object_info, against a fake
// ComfyUI by default and a real one when COMFYUI_CONTRACT_URL is set,
// proving the fake (apps/fake-comfyui) tells the truth about ComfyUI's own
// HTTP/WS surface. CI's path-triggered "ComfyUI contract" job
// (.github/workflows/ci.yml) sets that env var to the pinned CPU-only
// ComfyUI from docs/ops/backend-kit.md's "ComfyUI version" section.
//
// Every Workflow here is "weightless": built only from ComfyUI's own core
// nodes (no checkpoint, no custom node pack beyond the test-only
// TestSleep/ComfySwitchNode that ship in ComfyUI's own `tests/execution`
// fixtures), so the real-mode run needs nothing installed beyond ComfyUI
// itself plus that one fixture folder (see the CI job for how it's wired
// in). `fake.script(...)` is only ever called when running against the
// fake — the real run just lets the actual graph produce its own job.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import type { Workflow } from "@ai-content-studio/shared";
import {
  type ComfyUiTarget,
  objectInfoUrl,
  systemStatsUrl,
} from "../backends/client.js";
import {
  ComfyUiSocket,
  type Job,
  type JobEvent,
  cancelJob,
  fetchView,
  headInputFile,
  readJob,
  submitPrompt,
  uploadInputImage,
} from "./client.js";

const REAL_URL = process.env.COMFYUI_CONTRACT_URL;

/** Only meaningful against the fake: a no-op against a real ComfyUI, which runs the actual graph instead of a canned one. */
type Scripter = (
  promptId: string,
  job: Parameters<FakeInstance["script"]>[1],
) => void;
type FakeInstance = ReturnType<typeof startFakeComfyUi>;

interface Ctx {
  target: ComfyUiTarget;
  script: Scripter;
}

/** Runs `body` against the fake (started and stopped around it) or, when `COMFYUI_CONTRACT_URL` is set, against that real Backend. */
async function withComfyUi(body: (ctx: Ctx) => Promise<void>): Promise<void> {
  if (REAL_URL) {
    await body({
      target: { baseUrl: REAL_URL, headers: {} },
      script: () => {},
    });
    return;
  }
  const fake = startFakeComfyUi({ port: 0 });
  try {
    await body({
      target: { baseUrl: fake.url, headers: {} },
      script: (promptId, job) => fake.script(promptId, job),
    });
  } finally {
    fake.stop();
  }
}

async function waitForJob(
  target: ComfyUiTarget,
  promptId: string,
  states: readonly Job["status"][],
  timeoutMs = 20_000,
): Promise<Job> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await readJob(target, promptId);
    if (job && states.includes(job.status)) return job;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for ${promptId} to reach ${states.join("/")}, last saw ${job?.status ?? "no job"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** EmptyImage -> SaveImage: no Upload, no checkpoint, no custom node pack. */
function imageWorkflow(outputPrefix: string): Workflow {
  return {
    "1": {
      class_type: "EmptyImage",
      inputs: { width: 8, height: 8, batch_size: 1, color: 0 },
    },
    "2": {
      class_type: "SaveImage",
      inputs: { images: ["1", 0], filename_prefix: outputPrefix },
    },
  };
}

/** EmptyImage -> TestSleep -> SaveImage: a controllable delay for /ws progress and cancel, from ComfyUI's own test-only node (see the CI job). */
function sleepingImageWorkflow(
  seconds: number,
  outputPrefix: string,
): Workflow {
  return {
    "1": {
      class_type: "EmptyImage",
      inputs: { width: 8, height: 8, batch_size: 1, color: 0 },
    },
    "2": {
      class_type: "TestSleep",
      inputs: { value: ["1", 0], seconds },
    },
    "3": {
      class_type: "SaveImage",
      inputs: { images: ["2", 0], filename_prefix: outputPrefix },
    },
  };
}

/** Two EmptyImages behind a ComfySwitchNode -> SaveImage: exercises a branching node type alongside the others. */
function switchWorkflow(outputPrefix: string): Workflow {
  return {
    "1": {
      class_type: "EmptyImage",
      inputs: { width: 8, height: 8, batch_size: 1, color: 0xff0000 },
    },
    "2": {
      class_type: "EmptyImage",
      inputs: { width: 8, height: 8, batch_size: 1, color: 0x0000ff },
    },
    "3": {
      class_type: "ComfySwitchNode",
      inputs: { switch: true, on_true: ["1", 0], on_false: ["2", 0] },
    },
    "4": {
      class_type: "SaveImage",
      inputs: { images: ["3", 0], filename_prefix: outputPrefix },
    },
  };
}

/** EmptyImage + EmptyAudio -> CreateVideo -> SaveVideo: the video+audio path (issue #79's AC). */
function videoWorkflow(outputPrefix: string): Workflow {
  return {
    "1": {
      class_type: "EmptyImage",
      inputs: { width: 8, height: 8, batch_size: 2, color: 0 },
    },
    "2": {
      class_type: "EmptyAudio",
      inputs: { duration: 1, sample_rate: 44100, channels: 2 },
    },
    "3": {
      class_type: "CreateVideo",
      inputs: { images: ["1", 0], fps: 8, audio: ["2", 0] },
    },
    "4": {
      class_type: "SaveVideo",
      inputs: {
        video: ["3", 0],
        filename_prefix: outputPrefix,
        format: "auto",
        codec: "auto",
      },
    },
  };
}

/** EmptyAudio -> SaveAudioAdvanced: the audio-only path (issue #79's AC). */
function audioWorkflow(outputPrefix: string): Workflow {
  return {
    "1": {
      class_type: "EmptyAudio",
      inputs: { duration: 1, sample_rate: 44100, channels: 2 },
    },
    "2": {
      class_type: "SaveAudioAdvanced",
      inputs: {
        audio: ["1", 0],
        filename_prefix: outputPrefix,
        format: "flac",
      },
    },
  };
}

describe(`ComfyUI contract (${REAL_URL ? `real: ${REAL_URL}` : "fake"})`, () => {
  test("/system_stats and /object_info both answer", async () => {
    await withComfyUi(async ({ target }) => {
      const stats = await fetch(systemStatsUrl(target.baseUrl), {
        headers: target.headers,
      });
      expect(stats.status).toBe(200);
      const statsBody = (await stats.json()) as { system?: { os?: string } };
      expect(typeof statsBody.system?.os).toBe("string");

      const info = await fetch(objectInfoUrl(target.baseUrl), {
        headers: target.headers,
      });
      expect(info.status).toBe(200);
      const infoBody = (await info.json()) as Record<string, unknown>;
      // Every node type this suite's own Workflows use must be known.
      for (const nodeType of [
        "EmptyImage",
        "SaveImage",
        "TestSleep",
        "ComfySwitchNode",
        "CreateVideo",
        "SaveVideo",
        "EmptyAudio",
        "SaveAudioAdvanced",
      ]) {
        expect(Object.keys(infoBody)).toContain(nodeType);
      }
    });
  });

  test("submits an image Workflow, follows /ws progress, polls /api/jobs to completion, and /view serves the saved file", async () => {
    await withComfyUi(async ({ target, script }) => {
      const promptId = randomUUID();
      const prefix = `contract-${promptId.slice(0, 8)}`;
      script(promptId, {
        steps: 3,
        stepIntervalMs: 5,
        outputs: {
          "2": {
            images: [
              {
                filename: `${prefix}_00001_.png`,
                subfolder: "",
                type: "output",
              },
            ],
          },
        },
      });

      const socket = new ComfyUiSocket(target, promptId);
      const events: JobEvent[] = [];
      socket.onMessage((event) => events.push(event));

      try {
        await submitPrompt(target, promptId, imageWorkflow(prefix));
        const job = await waitForJob(target, promptId, ["completed", "failed"]);
        expect(job.status).toBe("completed");
        expect(events.some((e) => e.type === "progress")).toBe(true);

        const outputs =
          job.outputs?.["2"]?.images ?? job.outputs?.["3"]?.images;
        const file = outputs?.[0];
        if (!file) throw new Error("no image output recorded");

        const view = await fetchView(target, file);
        expect(view.ok).toBe(true);
        const bytes = await view.arrayBuffer();
        expect(bytes.byteLength).toBeGreaterThan(0);
      } finally {
        socket.close();
      }
    });
  });

  test("submits a branching Workflow through ComfySwitchNode", async () => {
    await withComfyUi(async ({ target, script }) => {
      const promptId = randomUUID();
      const prefix = `contract-switch-${promptId.slice(0, 8)}`;
      script(promptId, {
        steps: 1,
        stepIntervalMs: 5,
        outputs: {
          "4": {
            images: [
              {
                filename: `${prefix}_00001_.png`,
                subfolder: "",
                type: "output",
              },
            ],
          },
        },
      });

      await submitPrompt(target, promptId, switchWorkflow(prefix));
      const job = await waitForJob(target, promptId, ["completed", "failed"]);
      expect(job.status).toBe("completed");
    });
  });

  test("submits a video Workflow (EmptyImage + EmptyAudio -> CreateVideo -> SaveVideo)", async () => {
    await withComfyUi(async ({ target, script }) => {
      const promptId = randomUUID();
      const prefix = `contract-video-${promptId.slice(0, 8)}`;
      script(promptId, {
        steps: 1,
        stepIntervalMs: 5,
        outputs: {
          "4": {
            images: [
              {
                filename: `${prefix}_00001_.mp4`,
                subfolder: "",
                type: "output",
              },
            ],
          },
        },
      });

      await submitPrompt(target, promptId, videoWorkflow(prefix));
      const job = await waitForJob(
        target,
        promptId,
        ["completed", "failed"],
        40_000,
      );
      expect(job.status).toBe("completed");
      // ComfyUI's SaveVideo reports under the "images" key, not a "videos"
      // key of its own (settled by reading its own PreviewVideo.as_dict).
      expect(job.outputs?.["4"]?.images?.[0]?.filename).toBeTruthy();
    });
  });

  test("submits an audio Workflow (EmptyAudio -> SaveAudioAdvanced)", async () => {
    await withComfyUi(async ({ target, script }) => {
      const promptId = randomUUID();
      const prefix = `contract-audio-${promptId.slice(0, 8)}`;
      script(promptId, {
        steps: 1,
        stepIntervalMs: 5,
        outputs: {
          "2": {
            audio: [
              {
                filename: `${prefix}_00001_.flac`,
                subfolder: "",
                type: "output",
              },
            ],
          },
        },
      });

      await submitPrompt(target, promptId, audioWorkflow(prefix));
      const job = await waitForJob(
        target,
        promptId,
        ["completed", "failed"],
        40_000,
      );
      expect(job.status).toBe("completed");
      expect(job.outputs?.["2"]?.audio?.[0]?.filename).toBeTruthy();
    });
  });

  test("a running job can be cancelled through /api/jobs/:id/cancel", async () => {
    await withComfyUi(async ({ target, script }) => {
      const promptId = randomUUID();
      // Fake: never advances on its own until cancelled. Real: a long
      // enough sleep that the cancel always lands while it's still running.
      script(promptId, { hang: true });

      await submitPrompt(
        target,
        promptId,
        sleepingImageWorkflow(30, "contract-cancel"),
      );
      await waitForJob(target, promptId, ["running"]);

      await cancelJob(target, promptId);

      const job = await waitForJob(target, promptId, ["cancelled"]);
      expect(job.status).toBe("cancelled");
    });
  });

  test("uploads an input file, then HEAD and a Range GET on /view (type=input) both see it (issue #79's AC)", async () => {
    await withComfyUi(async ({ target }) => {
      const subfolder = `contract-${randomUUID().slice(0, 8)}`;
      const filename = "upload.png";
      const bytes = new TextEncoder().encode("a tiny PNG stand-in");

      await uploadInputImage(target, subfolder, filename, new Blob([bytes]));

      const info = await headInputFile(target, subfolder, filename);
      if (!info) throw new Error("uploaded file not found via HEAD /view");
      expect(info.size).toBe(bytes.length);
      expect(info.lastModified).not.toBeNull();

      const query = new URLSearchParams({ filename, subfolder, type: "input" });
      const ranged = await fetch(
        `${target.baseUrl.replace(/\/+$/, "")}/view?${query}`,
        { headers: { ...target.headers, range: "bytes=2-5" } },
      );
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get("content-range")).toBe(
        `bytes 2-5/${bytes.length}`,
      );
    });
  });
});
