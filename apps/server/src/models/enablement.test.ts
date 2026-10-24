import { describe, expect, test } from "bun:test";
import type { Workflow } from "@ai-content-studio/shared";
import type { BackendRecord } from "../backends/repository.js";
import type { BackendsService } from "../backends/service.js";
import { checkEnableReadiness } from "./enablement.js";
import type { ModeRecord, ModelDetail } from "./repository.js";

const WORKFLOW: Workflow = {
  "1": { class_type: "LoadImage", inputs: {} },
  "2": { class_type: "KSampler", inputs: { model: ["1", 0] } },
  "3": { class_type: "SaveImage", inputs: { image: ["2", 0] } },
};

function backend(id: string): BackendRecord {
  return {
    id,
    name: id,
    baseUrl: "http://localhost",
    auth: "none",
    headerName: null,
    enabled: true,
    draining: false,
    version: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function mode(outputNodeIds: string[]): ModeRecord {
  return {
    id: "mode-1",
    sortOrder: 0,
    name: "Default",
    description: "",
    outputNodes: outputNodeIds.map((nodeId) => ({
      nodeId,
      classType: WORKFLOW[nodeId]?.class_type ?? "Unknown",
      title: null,
      kind: null,
    })),
  };
}

function detail(modes: ModeRecord[]): ModelDetail {
  return {
    model: {
      id: "model-1",
      name: "M1",
      slug: "m1",
      description: "",
      maxRunTimeMinutes: 30,
      state: "disabled",
      sortOrder: 0,
      currentRevision: 1,
      version: 1,
      termsBody: "",
      licenseUrl: "",
      attribution: "",
      termsVersion: null,
      termsVersionCreatedAt: null,
      termsRevision: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    revisionId: "revision-1",
    workflowHash: "hash",
    workflow: WORKFLOW,
    nodes: [],
    outsideServiceNotes: [],
    modes,
  };
}

function serviceWithNodeTypes(
  byBackend: Record<string, Set<string> | null>,
): BackendsService {
  return {
    nodeTypesFor: async (b: BackendRecord) => byBackend[b.id] ?? null,
  } as unknown as BackendsService;
}

describe("checkEnableReadiness", () => {
  test("refuses with no Modes", async () => {
    const result = await checkEnableReadiness(
      detail([]),
      [backend("b1")],
      serviceWithNodeTypes({
        b1: new Set(["LoadImage", "KSampler", "SaveImage"]),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain("at least one Mode");
  });

  test("refuses with no attached Backend", async () => {
    const result = await checkEnableReadiness(
      detail([mode(["3"])]),
      [],
      serviceWithNodeTypes({}),
    );
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain("attached Backend");
  });

  test("passes when a Mode's Path node types are all installed on an attached Backend", async () => {
    const result = await checkEnableReadiness(
      detail([mode(["3"])]),
      [backend("b1")],
      serviceWithNodeTypes({
        b1: new Set(["LoadImage", "KSampler", "SaveImage"]),
      }),
    );
    expect(result).toEqual({ ok: true, reasons: [] });
  });

  test("refuses a Mode missing a node type on every attached Backend", async () => {
    const result = await checkEnableReadiness(
      detail([mode(["3"])]),
      [backend("b1")],
      serviceWithNodeTypes({ b1: new Set(["LoadImage", "SaveImage"]) }),
    );
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toContain('Mode "Default"');
  });

  test("passes when at least one of several Backends can run the Mode", async () => {
    const result = await checkEnableReadiness(
      detail([mode(["3"])]),
      [backend("b1"), backend("b2")],
      serviceWithNodeTypes({
        b1: new Set(["SaveImage"]),
        b2: new Set(["LoadImage", "KSampler", "SaveImage"]),
      }),
    );
    expect(result.ok).toBe(true);
  });

  test("skips an unreachable Backend (null node types) rather than treating it as capable", async () => {
    const result = await checkEnableReadiness(
      detail([mode(["3"])]),
      [backend("b1")],
      serviceWithNodeTypes({ b1: null }),
    );
    expect(result.ok).toBe(false);
  });
});
