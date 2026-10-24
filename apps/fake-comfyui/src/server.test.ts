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
