import { describe, expect, test } from "bun:test";
import { backendTarget, systemStatsUrl } from "./client.js";
import type { BackendRecord } from "./repository.js";

const noCredsRepo = { decryptedCredentials: async () => null };

function record(overrides: Partial<BackendRecord> = {}): BackendRecord {
  return {
    id: "b1",
    name: "T",
    baseUrl: "http://localhost:8188",
    auth: "none",
    headerName: null,
    enabled: true,
    draining: false,
    version: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("systemStatsUrl", () => {
  test("appends to a bare base URL", () => {
    expect(systemStatsUrl("http://10.0.0.5:8188")).toBe(
      "http://10.0.0.5:8188/system_stats",
    );
  });

  test("keeps a base URL's own path", () => {
    expect(systemStatsUrl("https://comfy.example.com/instance-1")).toBe(
      "https://comfy.example.com/instance-1/system_stats",
    );
  });

  test("trims a trailing slash before appending", () => {
    expect(systemStatsUrl("https://comfy.example.com/instance-1/")).toBe(
      "https://comfy.example.com/instance-1/system_stats",
    );
  });
});

describe("backendTarget", () => {
  test("requests /system_stats under the Backend's own base path", async () => {
    let receivedPath: string | undefined;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        receivedPath = new URL(req.url).pathname;
        return Response.json({
          system: { comfyui_version: "0.3.9" },
          devices: [],
        });
      },
    });
    try {
      const target = backendTarget(
        record({ baseUrl: `http://localhost:${server.port}/instance-1` }),
        noCredsRepo,
      );
      await target.fetchSystemStats();
      expect(receivedPath).toBe("/instance-1/system_stats");
    } finally {
      server.stop(true);
    }
  });

  test("times out a hung Backend instead of waiting forever", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch() {
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        return new Response("too slow");
      },
    });
    try {
      const target = backendTarget(
        record({ baseUrl: `http://localhost:${server.port}` }),
        noCredsRepo,
        50,
      );
      await expect(target.fetchSystemStats()).rejects.toThrow();
    } finally {
      server.stop(true);
    }
  });
});
