import { describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "./server.js";

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
