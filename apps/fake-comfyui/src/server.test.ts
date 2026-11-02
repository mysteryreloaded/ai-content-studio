import { describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "./server.js";

type FakeComfyUi = ReturnType<typeof startFakeComfyUi>;

/** Polls `/api/jobs/:id` until the job leaves `running`, so a test never races the script's timer. */
async function waitForJob(
  fake: FakeComfyUi,
  promptId: string,
): Promise<{ status: string; error: string | null; outputs: unknown }> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const res = await fetch(`${fake.url}/api/jobs/${promptId}`);
    const body = (await res.json()) as {
      status: string;
      error: string | null;
      outputs: unknown;
    };
    if (body.status !== "running") return body;
    if (Date.now() > deadline) throw new Error("job still running");
    await new Promise((r) => setTimeout(r, 5));
  }
}

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

// Issue #187: the shots script pushes scripts and output bytes ahead of
// each submission, without knowing ComfyUI's `prompt_id` in advance, so the
// fake learns a FIFO script queue plus a stored-output-file lookup.
describe("fake ComfyUI issue #187 control surface", () => {
  test("a queued script runs for the next unregistered prompt_id, first in first out", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      fake.scriptNext({ fail: "CUDA out of memory" });
      fake.scriptNext({
        steps: 2,
        outputs: {
          "21": {
            images: [
              { filename: "a.mp4", subfolder: "", type: "output" },
            ],
          },
        },
      });
      fake.scriptNext({ fail: "a different failure" });

      const first = await fetch(`${fake.url}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          prompt: { "1": { class_type: "KSampler" } },
          prompt_id: "id-one",
        }),
        headers: { "content-type": "application/json" },
      });
      const second = await fetch(`${fake.url}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          prompt: { "1": { class_type: "KSampler" } },
          prompt_id: "id-two",
        }),
        headers: { "content-type": "application/json" },
      });
      const third = await fetch(`${fake.url}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          prompt: { "1": { class_type: "KSampler" } },
          prompt_id: "id-three",
        }),
        headers: { "content-type": "application/json" },
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(200);

      const one = await waitForJob(fake, "id-one");
      expect(one.status).toBe("failed");
      expect(one.error).toBe("CUDA out of memory");

      const two = await waitForJob(fake, "id-two");
      expect(two.status).toBe("completed");
      expect(two.outputs).toEqual({
        "21": {
          images: [{ filename: "a.mp4", subfolder: "", type: "output" }],
        },
      });

      const three = await waitForJob(fake, "id-three");
      expect(three.status).toBe("failed");
      expect(three.error).toBe("a different failure");
    } finally {
      fake.stop();
    }
  });

  test("a /__control__/script entry for the same prompt_id still wins over the queue", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      fake.scriptNext({ fail: "queued failure" });
      fake.script("registered", { fail: "registered failure" });

      const res = await fetch(`${fake.url}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          prompt: { "1": { class_type: "KSampler" } },
          prompt_id: "registered",
        }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(200);
      const job = await waitForJob(fake, "registered");
      expect(job.error).toBe("registered failure");

      // The queued script survives: the next unregistered prompt_id takes it.
      const next = await fetch(`${fake.url}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          prompt: { "1": { class_type: "KSampler" } },
          prompt_id: "after",
        }),
        headers: { "content-type": "application/json" },
      });
      expect(next.status).toBe(200);
      expect((await waitForJob(fake, "after")).error).toBe("queued failure");
    } finally {
      fake.stop();
    }
  });

  test("an empty queue leaves today's behavior intact", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const res = await fetch(`${fake.url}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          prompt: { "1": { class_type: "KSampler" } },
          prompt_id: "plain",
        }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(200);
      const job = await waitForJob(fake, "plain");
      expect(job.status).toBe("completed");
      expect(job.outputs).toEqual({});
    } finally {
      fake.stop();
    }
  });

  test("restart forgets queued scripts, like it forgets registered ones", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      fake.scriptNext({ fail: "queued failure" });
      fake.restart();

      const res = await fetch(`${fake.url}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          prompt: { "1": { class_type: "KSampler" } },
          prompt_id: "post-restart",
        }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(200);
      expect((await waitForJob(fake, "post-restart")).status).toBe("completed");
    } finally {
      fake.stop();
    }
  });

  test("/__control__/output-file stores raw bytes that /view serves back, HEAD and Range included", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const bytes = new TextEncoder().encode("stored output bytes");
      const res = await fetch(
        `${fake.url}/__control__/output-file?filename=out-wide.mp4`,
        { method: "POST", body: bytes },
      );
      expect(res.status).toBe(204);

      const full = await fetch(
        `${fake.url}/view?filename=out-wide.mp4&type=output`,
      );
      expect(full.status).toBe(200);
      expect(full.headers.get("content-type")).toBe("video/mp4");
      expect(new TextDecoder().decode(await full.arrayBuffer())).toBe(
        "stored output bytes",
      );

      const head = await fetch(
        `${fake.url}/view?filename=out-wide.mp4&type=output`,
        { method: "HEAD" },
      );
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(String(bytes.length));

      const ranged = await fetch(
        `${fake.url}/view?filename=out-wide.mp4&type=output`,
        { headers: { range: "bytes=7-12" } },
      );
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get("content-range")).toBe(`bytes 7-12/${bytes.length}`);
      expect(new TextDecoder().decode(await ranged.arrayBuffer())).toBe(
        "output",
      );
    } finally {
      fake.stop();
    }
  });

  test("a filename with no stored file still gets the placeholder, as before", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const res = await fetch(
        `${fake.url}/view?filename=never-stored.png&type=output`,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(await res.text()).toBe("fake-comfyui:never-stored.png");
    } finally {
      fake.stop();
    }
  });

  test("putOutputFile and scriptNext work as instance methods, without the HTTP endpoints", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      fake.putOutputFile("out.png", new TextEncoder().encode("an image"));
      const view = await fetch(`${fake.url}/view?filename=out.png&type=output`);
      expect(view.headers.get("content-type")).toBe("image/png");
      expect(await view.text()).toBe("an image");

      fake.scriptNext({ fail: "from a method" });
      const res = await fetch(`${fake.url}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          prompt: { "1": { class_type: "KSampler" } },
          prompt_id: "method-driven",
        }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(200);
      expect((await waitForJob(fake, "method-driven")).error).toBe("from a method");
    } finally {
      fake.stop();
    }
  });
});
