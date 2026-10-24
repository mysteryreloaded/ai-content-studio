import { describe, expect, test } from "bun:test";
import { startFakeComfyUi } from "@ai-content-studio/fake-comfyui";
import { FakeClock } from "@ai-content-studio/shared";
import { NodeKnowledge } from "./node-knowledge.js";
import type { BackendRecord } from "./repository.js";

const noCredsRepo = { decryptedCredentials: async () => null };

function record(
  baseUrl: string,
  overrides: Partial<BackendRecord> = {},
): BackendRecord {
  return {
    id: "b1",
    name: "T",
    baseUrl,
    auth: "none",
    headerName: null,
    enabled: true,
    version: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("NodeKnowledge", () => {
  test("fetches and caches a Backend's /object_info node types", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const clock = new FakeClock();
      const knowledge = new NodeKnowledge(noCredsRepo, clock);
      const backend = record(fake.url);

      const first = await knowledge.nodeTypesFor(backend);
      expect(first?.has("KSampler")).toBe(true);

      // Even once the Backend goes down, the still-fresh cache answers.
      fake.setUnreachable(true);
      const second = await knowledge.nodeTypesFor(backend);
      expect(second?.has("KSampler")).toBe(true);
    } finally {
      fake.stop();
    }
  });

  test("refetches after the 10-minute cache expires", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const clock = new FakeClock();
      const knowledge = new NodeKnowledge(noCredsRepo, clock);
      const backend = record(fake.url);

      await knowledge.nodeTypesFor(backend);
      clock.advance(11 * 60 * 1000);

      fake.setUnreachable(true);
      const afterExpiry = await knowledge.nodeTypesFor(backend);
      // the stale fetch failed, so null is returned rather than silently
      // serving the expired cache as if it were fresh
      expect(afterExpiry).toBeNull();
    } finally {
      fake.stop();
    }
  });

  test("invalidate forces the next call to refetch immediately", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const clock = new FakeClock();
      const knowledge = new NodeKnowledge(noCredsRepo, clock);
      const backend = record(fake.url);

      await knowledge.nodeTypesFor(backend);
      fake.setUnreachable(true);
      knowledge.invalidate(backend.id);

      const afterInvalidate = await knowledge.nodeTypesFor(backend);
      expect(afterInvalidate).toBeNull();
    } finally {
      fake.stop();
    }
  });

  test("returns null when there's nothing cached and the fetch fails", async () => {
    const clock = new FakeClock();
    const knowledge = new NodeKnowledge(noCredsRepo, clock);
    const backend = record("http://localhost:1");

    const result = await knowledge.nodeTypesFor(backend);
    expect(result).toBeNull();
  });

  test("fieldSpecsFor parses INT/FLOAT bounds and COMBO options from /object_info (issue #46)", async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const clock = new FakeClock();
      const knowledge = new NodeKnowledge(noCredsRepo, clock);
      const backend = record(fake.url);

      const specs = await knowledge.fieldSpecsFor(backend);
      const kSampler = specs?.get("KSampler");
      expect(kSampler?.steps).toEqual({ type: "INT" });
      expect(kSampler?.sampler_name?.type).toBe("COMBO");
      expect(kSampler?.sampler_name?.options).toContain("euler");
    } finally {
      fake.stop();
    }
  });

  test('fieldSpecsFor parses a V3-form COMBO (`["COMBO", {options}]`, issue #46)', async () => {
    const fake = startFakeComfyUi({ port: 0 });
    try {
      const clock = new FakeClock();
      const knowledge = new NodeKnowledge(noCredsRepo, clock);
      const backend = record(fake.url);

      const specs = await knowledge.fieldSpecsFor(backend);
      const ltxv = specs?.get("LTXVConditioning");
      expect(ltxv?.frame_rate_option?.type).toBe("COMBO");
      expect(ltxv?.frame_rate_option?.options).toEqual(["24", "25", "30"]);
    } finally {
      fake.stop();
    }
  });
});
