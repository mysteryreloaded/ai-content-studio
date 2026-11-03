import { describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "./server.js";

describe("fake ComfyUI /__control__/script-next (issue #187)", () => {
  test("a prompt with no per-id script takes the next queued one, FIFO", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      fake.scriptNext({
        outputs: {
          "1": {
            images: [{ filename: "a.png", subfolder: "", type: "output" }],
          },
        },
      });
      fake.scriptNext({
        outputs: {
          "1": {
            images: [{ filename: "b.png", subfolder: "", type: "output" }],
          },
        },
      });

      const workflow = { "1": { class_type: "SaveImage", inputs: {} } };
      const first = await fetch(`${fake.url}/prompt`, {
        method: "POST",
        body: JSON.stringify({ prompt: workflow, prompt_id: "p1" }),
      });
      const { prompt_id: firstId } = (await first.json()) as {
        prompt_id: string;
      };
      const second = await fetch(`${fake.url}/prompt`, {
        method: "POST",
        body: JSON.stringify({ prompt: workflow, prompt_id: "p2" }),
      });
      const { prompt_id: secondId } = (await second.json()) as {
        prompt_id: string;
      };

      await new Promise((resolve) => setTimeout(resolve, 50));
      const firstJob = (await (
        await fetch(`${fake.url}/api/jobs/${firstId}`)
      ).json()) as { outputs: { "1": { images: { filename: string }[] } } };
      const secondJob = (await (
        await fetch(`${fake.url}/api/jobs/${secondId}`)
      ).json()) as { outputs: { "1": { images: { filename: string }[] } } };
      expect(firstJob.outputs["1"].images[0]?.filename).toBe("a.png");
      expect(secondJob.outputs["1"].images[0]?.filename).toBe("b.png");
    } finally {
      fake.stop();
    }
  });

  test("an empty queue leaves today's behaviour (completes with no outputs)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const workflow = { "1": { class_type: "SaveImage", inputs: {} } };
      const res = await fetch(`${fake.url}/prompt`, {
        method: "POST",
        body: JSON.stringify({ prompt: workflow, prompt_id: "p3" }),
      });
      const { prompt_id } = (await res.json()) as { prompt_id: string };
      await new Promise((resolve) => setTimeout(resolve, 50));
      const job = (await (
        await fetch(`${fake.url}/api/jobs/${prompt_id}`)
      ).json()) as { status: string; outputs: unknown };
      expect(job.status).toBe("completed");
      expect(job.outputs).toEqual({});
    } finally {
      fake.stop();
    }
  });
});

describe("fake ComfyUI /object_info", () => {
  test("serves a captured object_info keyed by node class type", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const res = await fetch(`${fake.url}/object_info`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Object.keys(body)).toContain("KSampler");
      expect(Object.keys(body)).toContain("CheckpointLoaderSimple");
    } finally {
      fake.stop();
    }
  });

  test("fails like /system_stats while scripted unreachable", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      fake.setUnreachable(true);
      const res = await fetch(`${fake.url}/object_info`);
      expect(res.status).toBe(503);
    } finally {
      fake.stop();
    }
  });
});

// Issue #79 settled this against real ComfyUI's /view (aiohttp's
// web.FileResponse): HEAD and Range both work, for an output file and for
// an uploaded input file alike.
describe("fake ComfyUI /view (issue #79)", () => {
  test("HEAD and a Range request both work for an output file", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const full = await fetch(
        `${fake.url}/view?filename=studio_00001_.png&subfolder=studio&type=output`,
      );
      const bytes = await full.arrayBuffer();
      expect(full.status).toBe(200);
      expect(full.headers.get("accept-ranges")).toBe("bytes");

      const head = await fetch(
        `${fake.url}/view?filename=studio_00001_.png&subfolder=studio&type=output`,
        { method: "HEAD" },
      );
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(String(bytes.byteLength));
      expect(await head.arrayBuffer()).toHaveLength(0);

      const ranged = await fetch(
        `${fake.url}/view?filename=studio_00001_.png&subfolder=studio&type=output`,
        { headers: { range: "bytes=2-4" } },
      );
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get("content-range")).toBe(
        `bytes 2-4/${bytes.byteLength}`,
      );
      expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(
        new Uint8Array(bytes).subarray(2, 5),
      );
    } finally {
      fake.stop();
    }
  });

  test("issue #187: a stored output file replaces the placeholder", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const bytes = new TextEncoder().encode("real png bytes");
      fake.putOutputFile("out.png", bytes);
      const res = await fetch(`${fake.url}/view?filename=out.png`);
      expect(res.status).toBe(200);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);

      const unknown = await fetch(`${fake.url}/view?filename=other.png`);
      expect(await unknown.text()).toBe("fake-comfyui:other.png");

      const put = await fetch(
        `${fake.url}/__control__/output-file?filename=via-http.png`,
        { method: "POST", body: bytes },
      );
      expect(put.status).toBe(204);
      const viaHttp = await fetch(`${fake.url}/view?filename=via-http.png`);
      expect(new Uint8Array(await viaHttp.arrayBuffer())).toEqual(bytes);
    } finally {
      fake.stop();
    }
  });

  test("HEAD and a Range request both work for an uploaded input file", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const bytes = new TextEncoder().encode("hello input file");
      fake.putInputFile("studio", "a.png", bytes, new Date());

      const head = await fetch(
        `${fake.url}/view?filename=a.png&subfolder=studio&type=input`,
        { method: "HEAD" },
      );
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(String(bytes.length));

      const ranged = await fetch(
        `${fake.url}/view?filename=a.png&subfolder=studio&type=input`,
        { headers: { range: "bytes=6-" } },
      );
      expect(ranged.status).toBe(206);
      expect(await ranged.text()).toBe("input file");
    } finally {
      fake.stop();
    }
  });
});
