import { describe, expect, test } from "bun:test";
import type {
  ImageUploadInputDefinition,
  NumberInputDefinition,
  SelectInputDefinition,
  TextInputDefinition,
} from "./input.js";
import { relevantInputs } from "./input.js";
import {
  applyModeFixedValues,
  computeModePath,
  inferOutputNodeKind,
  isPreviewNodeClass,
  modeInputSetting,
  modeMenuGroup,
  resolveModeInputs,
  resolveModeOutputNodes,
  reviseModeInputSettings,
  validateModeInputSettings,
  validateModeName,
  visibleModeBoundFields,
} from "./mode.js";
import type { ModeInputSetting } from "./mode.js";
import type { Workflow } from "./types.js";

describe("resolveModeOutputNodes", () => {
  const workflow: Workflow = {
    "1": { class_type: "LoadImage", inputs: {} },
    "2": {
      class_type: "SaveImage",
      inputs: { image: ["1", 0] },
      _meta: { title: "Final frame" },
    },
    "3": { class_type: "PreviewImage", inputs: { image: ["1", 0] } },
    "4": { class_type: "PreviewAudio", inputs: { audio: ["1", 0] } },
  };

  test("resolves ordered output nodes, inferring kind and title", () => {
    const result = resolveModeOutputNodes(workflow, ["2"]);
    expect(result).toEqual({
      ok: true,
      outputNodes: [
        {
          nodeId: "2",
          classType: "SaveImage",
          title: "Final frame",
          kind: "image",
        },
      ],
    });
  });

  test("refuses an empty list", () => {
    const result = resolveModeOutputNodes(workflow, []);
    expect(result.ok).toBe(false);
  });

  test("refuses a node that isn't in the Workflow", () => {
    const result = resolveModeOutputNodes(workflow, ["ghost"]);
    expect(result).toEqual({
      ok: false,
      errors: ['output node "ghost" is not in the Workflow'],
    });
  });

  test("refuses a preview node", () => {
    const result = resolveModeOutputNodes(workflow, ["3"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("preview node");
    }
  });

  test("refuses a PreviewAudio output node", () => {
    const result = resolveModeOutputNodes(workflow, ["4"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("preview node");
    }
  });

  test("refuses a node named twice", () => {
    const result = resolveModeOutputNodes(workflow, ["2", "2"]);
    expect(result.ok).toBe(false);
  });
});

describe("inferOutputNodeKind / isPreviewNodeClass", () => {
  test("infers known save classes", () => {
    expect(inferOutputNodeKind("SaveImage")).toBe("image");
    expect(inferOutputNodeKind("VHS_VideoCombine")).toBe("video");
    expect(inferOutputNodeKind("SaveAudio")).toBe("audio");
  });

  test("returns null for an unknown class", () => {
    expect(inferOutputNodeKind("SomeCustomSaver")).toBeNull();
  });

  test("flags known preview classes", () => {
    expect(isPreviewNodeClass("PreviewImage")).toBe(true);
    expect(isPreviewNodeClass("PreviewAudio")).toBe(true);
    expect(isPreviewNodeClass("PreviewAny")).toBe(true);
    expect(isPreviewNodeClass("Preview3D")).toBe(true);
    expect(isPreviewNodeClass("MaskPreview")).toBe(true);
    expect(isPreviewNodeClass("SaveImage")).toBe(false);
  });

  test("infers SaveVideo/SaveWEBM as video", () => {
    expect(inferOutputNodeKind("SaveVideo")).toBe("video");
    expect(inferOutputNodeKind("SaveWEBM")).toBe("video");
  });
});

describe("computeModePath", () => {
  test("delegates to computePath", () => {
    const workflow: Workflow = {
      "1": { class_type: "LoadImage", inputs: {} },
      "2": { class_type: "SaveImage", inputs: { image: ["1", 0] } },
    };
    const path = computeModePath(workflow, ["2"]);
    expect(path.nodeIds).toEqual(new Set(["1", "2"]));
  });
});

describe("validateModeName", () => {
  test("accepts a unique 1-60 character name", () => {
    expect(validateModeName("First/last frame", ["Other"])).toBeNull();
  });

  test("refuses an empty name", () => {
    expect(validateModeName("", [])).not.toBeNull();
  });

  test("refuses a name over 60 characters", () => {
    expect(validateModeName("a".repeat(61), [])).not.toBeNull();
  });

  test("refuses a name that collides case-insensitively", () => {
    expect(validateModeName("Default", ["default"])).not.toBeNull();
  });
});

describe("Mode × Input settings (issue #48)", () => {
  const textInput: TextInputDefinition = {
    id: "prompt",
    kind: "text",
    group: "describe",
    label: "Prompt",
    help: "",
    default: "",
    multiline: true,
    maxLength: 2000,
    bindings: [{ nodeId: "1", field: "text", classType: "X", title: null }],
  };
  const numberInput: NumberInputDefinition = {
    id: "steps",
    kind: "number",
    group: "settings",
    label: "Steps",
    help: "",
    default: null,
    numberMode: "integer",
    min: 1,
    max: 50,
    step: 1,
    bindings: [{ nodeId: "2", field: "steps", classType: "X", title: null }],
  };
  const selectInput: SelectInputDefinition = {
    id: "aspect",
    kind: "select",
    group: "settings",
    label: "Aspect",
    help: "",
    default: null,
    options: [
      { id: "square", label: "Square", values: [] },
      { id: "wide", label: "Wide", values: [] },
    ],
    bindings: [{ nodeId: "3", field: "aspect", classType: "X", title: null }],
  };
  const inputs = [textInput, numberInput, selectInput];
  const imageUploadInput: ImageUploadInputDefinition = {
    id: "image",
    kind: "image_upload",
    group: "describe",
    label: "Image",
    help: "",
    maxSizeMb: 10,
    maxLongSide: null,
    bindings: [{ nodeId: "4", field: "image", classType: "X", title: null }],
  };

  describe("modeInputSetting", () => {
    test("defaults to optional with no label override", () => {
      expect(modeInputSetting([], "prompt")).toEqual({
        inputId: "prompt",
        state: "optional",
        fixedValue: null,
        label: "",
      });
    });
  });

  describe("validateModeInputSettings", () => {
    test("accepts a setting per Input", () => {
      const settings: ModeInputSetting[] = [
        { inputId: "prompt", state: "required", fixedValue: null, label: "" },
        {
          inputId: "steps",
          state: "fixed",
          fixedValue: 20,
          label: "",
        },
      ];
      expect(validateModeInputSettings(settings, inputs)).toEqual([]);
    });

    test("refuses a setting for an Input not on the Model", () => {
      const settings: ModeInputSetting[] = [
        { inputId: "missing", state: "hidden", fixedValue: null, label: "" },
      ];
      expect(validateModeInputSettings(settings, inputs)[0]).toContain(
        "not on this Model",
      );
    });

    test("refuses more than one setting for the same Input", () => {
      const settings: ModeInputSetting[] = [
        { inputId: "prompt", state: "hidden", fixedValue: null, label: "" },
        { inputId: "prompt", state: "optional", fixedValue: null, label: "" },
      ];
      expect(validateModeInputSettings(settings, inputs)[0]).toContain(
        "more than one setting",
      );
    });

    test("refuses a fixed number value outside min/max", () => {
      const settings: ModeInputSetting[] = [
        { inputId: "steps", state: "fixed", fixedValue: 999, label: "" },
      ];
      expect(validateModeInputSettings(settings, inputs)[0]).toContain(
        "between min and max",
      );
    });

    test("refuses a fixed number value off step/whole", () => {
      const settings: ModeInputSetting[] = [
        { inputId: "steps", state: "fixed", fixedValue: 1.5, label: "" },
      ];
      expect(validateModeInputSettings(settings, inputs)[0]).toContain(
        "whole number",
      );
    });

    test("refuses a fixed select value that isn't an option", () => {
      const settings: ModeInputSetting[] = [
        {
          inputId: "aspect",
          state: "fixed",
          fixedValue: "tall",
          label: "",
        },
      ];
      expect(validateModeInputSettings(settings, inputs)[0]).toContain(
        "one of its options",
      );
    });

    test("refuses a fixed number value off its step", () => {
      const settings: ModeInputSetting[] = [
        { inputId: "steps", state: "fixed", fixedValue: 21, label: "" },
      ];
      const steppedInputs = [
        textInput,
        { ...numberInput, step: 5 },
        selectInput,
      ];
      expect(validateModeInputSettings(settings, steppedInputs)).toEqual([]);
      const offStep: ModeInputSetting[] = [
        { inputId: "steps", state: "fixed", fixedValue: 22, label: "" },
      ];
      expect(validateModeInputSettings(offStep, steppedInputs)[0]).toContain(
        "step",
      );
    });

    test("refuses fixing an Image Upload (issue #48 CEO review: always takes a real Upload id)", () => {
      const settings: ModeInputSetting[] = [
        {
          inputId: "image",
          state: "fixed",
          fixedValue: "some-file",
          label: "",
        },
      ];
      expect(
        validateModeInputSettings(settings, [...inputs, imageUploadInput])[0],
      ).toContain("Image Upload");
    });

    test("refuses a Mode label over 60 characters", () => {
      const settings: ModeInputSetting[] = [
        {
          inputId: "prompt",
          state: "optional",
          fixedValue: null,
          label: "a".repeat(61),
        },
      ];
      expect(validateModeInputSettings(settings, inputs)[0]).toContain(
        "Mode label",
      );
    });
  });

  describe("resolveModeInputs", () => {
    test("every Input is optional with no settings", () => {
      const resolved = resolveModeInputs(inputs, []);
      expect(resolved.formInputs.map((i) => i.id)).toEqual([
        "prompt",
        "steps",
        "aspect",
      ]);
      expect(resolved.requiredIds.size).toBe(0);
      expect(resolved.fixedValues).toEqual({});
    });

    test("drops hidden Inputs, requires required ones, fixes fixed ones", () => {
      const settings: ModeInputSetting[] = [
        { inputId: "prompt", state: "required", fixedValue: null, label: "" },
        { inputId: "steps", state: "hidden", fixedValue: null, label: "" },
        {
          inputId: "aspect",
          state: "fixed",
          fixedValue: "square",
          label: "",
        },
      ];
      const resolved = resolveModeInputs(inputs, settings);
      expect(resolved.formInputs.map((i) => i.id)).toEqual(["prompt"]);
      expect(resolved.requiredIds).toEqual(new Set(["prompt"]));
      expect(resolved.fixedValues).toEqual({ aspect: "square" });
    });

    test("overrides an Input's label with the Mode's own", () => {
      const settings: ModeInputSetting[] = [
        {
          inputId: "prompt",
          state: "optional",
          fixedValue: null,
          label: "Describe your scene",
        },
      ];
      const resolved = resolveModeInputs(inputs, settings);
      expect(resolved.formInputs[0]?.label).toBe("Describe your scene");
    });
  });

  describe("visibleModeBoundFields", () => {
    test("includes optional and required bindings, excludes hidden and fixed ones", () => {
      const settings: ModeInputSetting[] = [
        { inputId: "steps", state: "hidden", fixedValue: null, label: "" },
        {
          inputId: "aspect",
          state: "fixed",
          fixedValue: "square",
          label: "",
        },
      ];
      expect(visibleModeBoundFields(settings, inputs)).toEqual(
        new Set(["1::text"]),
      );
    });
  });

  describe("computeModePath with unresolvableFields", () => {
    const workflow: Workflow = {
      prim: { class_type: "PrimitiveBoolean", inputs: { value: true } },
      switch: {
        class_type: "ComfySwitchNode",
        inputs: { switch: ["prim", 0], on_true: ["a", 0], on_false: ["b", 0] },
      },
      a: { class_type: "LoadImage", inputs: {} },
      b: { class_type: "LoadVideo", inputs: {} },
      out: { class_type: "SaveImage", inputs: { image: ["switch", 0] } },
    };

    test("prunes the other branch when the switch's value is a plain literal", () => {
      const path = computeModePath(workflow, ["out"]);
      expect(path.nodeIds.has("a")).toBe(true);
      expect(path.nodeIds.has("b")).toBe(false);
    });

    test("keeps both branches when the literal is fed by a visible Input's bound field", () => {
      const path = computeModePath(workflow, ["out"], new Set(["prim::value"]));
      expect(path.nodeIds.has("a")).toBe(true);
      expect(path.nodeIds.has("b")).toBe(true);
    });
  });

  describe("applyModeFixedValues (issue #48 CEO review)", () => {
    const switchWorkflow: Workflow = {
      prim: { class_type: "PrimitiveBoolean", inputs: { value: false } },
      switch: {
        class_type: "ComfySwitchNode",
        inputs: {
          switch: ["prim", 0],
          on_true: ["ltx", 0],
          on_false: ["custom", 0],
        },
      },
      ltx: { class_type: "LTXNode", inputs: { text: "" } },
      custom: { class_type: "CustomNode", inputs: { text: "" } },
      out: { class_type: "SaveImage", inputs: { image: ["switch", 0] } },
    };
    const engineInput: SelectInputDefinition = {
      id: "engine",
      kind: "select",
      group: "settings",
      label: "Engine",
      help: "",
      default: null,
      options: [
        { id: "custom", label: "Custom", values: [false] },
        { id: "ltx", label: "LTX", values: [true] },
      ],
      bindings: [
        { nodeId: "prim", field: "value", classType: "X", title: null },
      ],
    };
    const ltxOnlyInput: TextInputDefinition = {
      ...textInput,
      id: "ltx-prompt",
      label: "LTX prompt",
      bindings: [{ nodeId: "ltx", field: "text", classType: "X", title: null }],
    };
    const customOnlyInput: TextInputDefinition = {
      ...textInput,
      id: "custom-prompt",
      label: "Custom prompt",
      bindings: [
        { nodeId: "custom", field: "text", classType: "X", title: null },
      ],
    };
    const allInputs = [engineInput, ltxOnlyInput, customOnlyInput];
    const fixedToLtx: ModeInputSetting[] = [
      { inputId: "engine", state: "fixed", fixedValue: "ltx", label: "" },
    ];

    test("writes a fixed select's value into the switch's steering field", () => {
      const applied = applyModeFixedValues(
        switchWorkflow,
        allInputs,
        fixedToLtx,
      );
      expect(applied.prim?.inputs.value).toBe(true);
    });

    test("computeModePath follows the fixed side, not the Workflow's own literal", () => {
      const applied = applyModeFixedValues(
        switchWorkflow,
        allInputs,
        fixedToLtx,
      );
      const path = computeModePath(applied, ["out"]);
      expect(path.nodeIds.has("ltx")).toBe(true);
      expect(path.nodeIds.has("custom")).toBe(false);
    });

    test("relevantInputs shows only the fixed side's Input", () => {
      const applied = applyModeFixedValues(
        switchWorkflow,
        allInputs,
        fixedToLtx,
      );
      const relevant = relevantInputs(allInputs, applied, ["out"]).map(
        (input) => input.id,
      );
      expect(relevant).toContain("ltx-prompt");
      expect(relevant).not.toContain("custom-prompt");
    });

    test("round-9 CEO review: leaves a hidden select's own default unwritten, only a fixed value is applied", () => {
      // A hidden Input isn't fixed, so its default must not steer the
      // switch — buildPrompt later writes the Workflow's own value for
      // it, and Path/relevant/enablement/editor must agree with that,
      // not with the default this bug used to apply here.
      const hiddenEngine: SelectInputDefinition = {
        ...engineInput,
        id: "hidden-engine",
        default: "ltx",
      };
      const hiddenSetting: ModeInputSetting[] = [
        {
          inputId: "hidden-engine",
          state: "hidden",
          fixedValue: null,
          label: "",
        },
      ];
      const applied = applyModeFixedValues(
        switchWorkflow,
        [hiddenEngine, ltxOnlyInput, customOnlyInput],
        hiddenSetting,
      );
      expect(applied.prim?.inputs.value).toBe(false);
    });
  });

  describe("modeMenuGroup", () => {
    test("groups as prompt when no required Input asks for an Upload", () => {
      expect(modeMenuGroup(inputs, [])).toBe("prompt");
    });

    test("ignores a hidden Upload-kind Input's group", () => {
      const uploadInput = {
        ...textInput,
        id: "image",
        kind: "image_upload",
      } as unknown as TextInputDefinition;
      const settings: ModeInputSetting[] = [
        { inputId: "image", state: "hidden", fixedValue: null, label: "" },
      ];
      expect(modeMenuGroup([...inputs, uploadInput], settings)).toBe("prompt");
    });

    test("groups by an optional (shown, not hidden) Upload-kind Input too (issue #48 CEO review: Uploads are always required)", () => {
      const uploadInput = {
        ...textInput,
        id: "image",
        kind: "image_upload",
      } as unknown as TextInputDefinition;
      const settings: ModeInputSetting[] = [
        { inputId: "image", state: "optional", fixedValue: null, label: "" },
      ];
      expect(modeMenuGroup([...inputs, uploadInput], settings)).toBe("images");
    });

    test("groups by a required Upload-kind Input", () => {
      const uploadInput = {
        ...textInput,
        id: "image",
        kind: "image_upload",
      } as unknown as TextInputDefinition;
      const settings: ModeInputSetting[] = [
        { inputId: "image", state: "required", fixedValue: null, label: "" },
      ];
      expect(modeMenuGroup([...inputs, uploadInput], settings)).toBe("images");
    });
  });

  describe("reviseModeInputSettings", () => {
    test("drops a setting for an Input that no longer exists", () => {
      const settings: ModeInputSetting[] = [
        { inputId: "prompt", state: "required", fixedValue: null, label: "" },
        { inputId: "ghost", state: "hidden", fixedValue: null, label: "" },
      ];
      expect(reviseModeInputSettings(settings, inputs)).toEqual([
        { inputId: "prompt", state: "required", fixedValue: null, label: "" },
      ]);
    });

    test("reverts a fixed setting whose value no longer validates", () => {
      const settings: ModeInputSetting[] = [
        { inputId: "steps", state: "fixed", fixedValue: 40, label: "" },
      ];
      const narrowedInputs = [
        textInput,
        { ...numberInput, max: 30 },
        selectInput,
      ];
      expect(reviseModeInputSettings(settings, narrowedInputs)).toEqual([
        { inputId: "steps", state: "optional", fixedValue: null, label: "" },
      ]);
    });

    test("keeps a fixed setting whose value still validates", () => {
      const settings: ModeInputSetting[] = [
        { inputId: "steps", state: "fixed", fixedValue: 20, label: "" },
      ];
      expect(reviseModeInputSettings(settings, inputs)).toEqual(settings);
    });
  });
});
