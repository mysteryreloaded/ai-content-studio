import { describe, expect, test } from "bun:test";
import type { InputDefinition, Workflow } from "@ai-content-studio/shared";
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
    inputSettings: [],
    outputNodes: outputNodeIds.map((nodeId) => ({
      nodeId,
      classType: WORKFLOW[nodeId]?.class_type ?? "Unknown",
      title: null,
      kind: null,
    })),
  };
}

function detail(
  modes: ModeRecord[],
  inputs: InputDefinition[] = [],
): ModelDetail {
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
    inputs,
  };
}

function serviceWithNodeTypes(
  byBackend: Record<string, Set<string> | null>,
): BackendsService {
  return {
    nodeTypesFor: async (b: BackendRecord) => byBackend[b.id] ?? null,
    fieldSpecsFor: async () => null,
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

  describe("Upload loaders (issue #50)", () => {
    const loaderWorkflow: Workflow = {
      "1": { class_type: "LoadImage", inputs: { image: "example.png" } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    };
    const allTypes = new Set(["LoadImage", "SaveImage"]);

    function loaderDetail(
      workflow: Workflow,
      inputs: ModelDetail["inputs"] = [],
    ): ModelDetail {
      const base = detail([mode(["2"])]);
      return {
        ...base,
        workflow,
        inputs,
        modes: [
          {
            ...mode([]),
            outputNodes: [
              { nodeId: "2", classType: "SaveImage", title: null, kind: null },
            ],
          },
        ],
      };
    }

    function serviceWithFiles(
      byBackend: Record<string, string[]>,
    ): BackendsService {
      return {
        nodeTypesFor: async () => allTypes,
        fieldSpecsFor: async (b: BackendRecord) =>
          new Map([
            [
              "LoadImage",
              {
                image: {
                  type: "COMBO",
                  options: byBackend[b.id] ?? [],
                  imageUpload: true,
                },
              },
            ],
          ]),
      } as unknown as BackendsService;
    }

    test("passes a loader whose fixed file is on every enabled Backend", async () => {
      const result = await checkEnableReadiness(
        loaderDetail(loaderWorkflow),
        [backend("b1")],
        serviceWithFiles({ b1: ["example.png"] }),
      );
      expect(result).toEqual({ ok: true, reasons: [] });
    });

    test("refuses a loader with neither a shown Input nor a fixed value", async () => {
      const result = await checkEnableReadiness(
        loaderDetail({
          ...loaderWorkflow,
          "1": { class_type: "LoadImage", inputs: { image: "" } },
        }),
        [backend("b1")],
        serviceWithFiles({ b1: ["example.png"] }),
      );
      expect(result.ok).toBe(false);
      expect(result.reasons).toEqual([
        'Mode "Default": Upload loader "1" (LoadImage) has neither a shown Input nor a fixed value for "image"',
      ]);
    });

    test("refuses a fixed file missing on an enabled attached Backend, ignoring a disabled one", async () => {
      const disabled = { ...backend("b3"), enabled: false };
      const result = await checkEnableReadiness(
        loaderDetail(loaderWorkflow),
        [backend("b1"), backend("b2"), disabled],
        serviceWithFiles({ b1: ["example.png"], b2: ["other.png"] }),
      );
      expect(result.reasons).toEqual([
        'Mode "Default": fixed file "example.png" for Upload loader "1" isn\'t on Backend "b2"',
      ]);
    });

    test("a shown Image Upload Input bound to the loader satisfies both checks", async () => {
      const result = await checkEnableReadiness(
        loaderDetail(
          {
            ...loaderWorkflow,
            "1": { class_type: "LoadImage", inputs: { image: "" } },
          },
          [
            {
              id: "8a3c1c5e-2d4b-4d55-9d0e-3f1f0f6b7a01",
              kind: "image_upload",
              group: "describe",
              label: "Photo",
              help: "",
              maxSizeMb: 10,
              maxLongSide: null,
              bindings: [
                {
                  nodeId: "1",
                  field: "image",
                  classType: "LoadImage",
                  title: null,
                },
              ],
            },
          ],
        ),
        [backend("b1")],
        serviceWithFiles({ b1: [] }),
      );
      expect(result).toEqual({ ok: true, reasons: [] });
    });
  });

  test("refuses a Seed Input with no max (issue #47, ADR 0007)", async () => {
    const seedInput: InputDefinition = {
      id: "seed-1",
      kind: "seed",
      group: "settings",
      label: "Seed",
      help: "",
      max: null,
      bindings: [
        { nodeId: "2", field: "seed", classType: "KSampler", title: null },
      ],
    };
    const result = await checkEnableReadiness(
      detail([mode(["3"])], [seedInput]),
      [backend("b1")],
      serviceWithNodeTypes({
        b1: new Set(["LoadImage", "KSampler", "SaveImage"]),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("needs a max"))).toBe(true);
  });

  test("requires both of a visibly-switched branch's node types (issue #48)", async () => {
    const switchWorkflow: Workflow = {
      prim: { class_type: "PrimitiveBoolean", inputs: { value: true } },
      switch: {
        class_type: "ComfySwitchNode",
        inputs: { switch: ["prim", 0], on_true: ["a", 0], on_false: ["b", 0] },
      },
      a: { class_type: "LoadImage", inputs: {} },
      b: { class_type: "LoadVideo", inputs: {} },
      out: { class_type: "SaveImage", inputs: { image: ["switch", 0] } },
    };
    const flagInput: InputDefinition = {
      id: "flag-1",
      kind: "select",
      group: "settings",
      label: "Flag",
      help: "",
      default: null,
      options: [
        { id: "off", label: "Off", values: [false] },
        { id: "on", label: "On", values: [true] },
      ],
      bindings: [
        {
          nodeId: "prim",
          field: "value",
          classType: "PrimitiveBoolean",
          title: null,
        },
      ],
    };
    const switchDetail: ModelDetail = {
      model: detail([], []).model,
      revisionId: "revision-1",
      workflowHash: "hash",
      workflow: switchWorkflow,
      nodes: [],
      outsideServiceNotes: [],
      modes: [
        {
          id: "mode-1",
          sortOrder: 0,
          name: "Default",
          description: "",
          inputSettings: [],
          outputNodes: [
            {
              nodeId: "out",
              classType: "SaveImage",
              title: null,
              kind: "image",
            },
          ],
        },
      ],
      inputs: [flagInput],
    };

    // The Backend only has LoadImage/SaveImage: "on_false" (LoadVideo) is
    // unreachable, but since flag-1 is a visible Input, both branches are
    // on the Path, so this Backend can't actually run the Mode.
    const result = await checkEnableReadiness(
      switchDetail,
      [backend("b1")],
      serviceWithNodeTypes({
        b1: new Set([
          "PrimitiveBoolean",
          "ComfySwitchNode",
          "LoadImage",
          "SaveImage",
        ]),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('Mode "Default"'))).toBe(true);
  });

  test("passes with a Seed Input that has a max set", async () => {
    const seedInput: InputDefinition = {
      id: "seed-1",
      kind: "seed",
      group: "settings",
      label: "Seed",
      help: "",
      max: 1000,
      bindings: [
        { nodeId: "2", field: "seed", classType: "KSampler", title: null },
      ],
    };
    const result = await checkEnableReadiness(
      detail([mode(["3"])], [seedInput]),
      [backend("b1")],
      serviceWithNodeTypes({
        b1: new Set(["LoadImage", "KSampler", "SaveImage"]),
      }),
    );
    expect(result).toEqual({ ok: true, reasons: [] });
  });
});
