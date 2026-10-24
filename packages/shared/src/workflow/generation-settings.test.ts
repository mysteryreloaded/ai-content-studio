import { describe, expect, test } from "bun:test";
import { resolveGenerationSettings } from "./generation-settings.js";
import type {
  ImageUploadInputDefinition,
  NumberInputDefinition,
  PointsInputDefinition,
  SeedInputDefinition,
  SelectInputDefinition,
  TextInputDefinition,
  VideoUploadInputDefinition,
} from "./input.js";
import type { ModeInputSetting } from "./mode.js";
import type { Workflow } from "./types.js";

const WORKFLOW: Workflow = {
  "1": {
    class_type: "CLIPTextEncode",
    inputs: { text: "a cat" },
  },
  "2": {
    class_type: "KSampler",
    inputs: { steps: 20, seed: 0 },
  },
  "3": {
    class_type: "ImageScale",
    inputs: { width: 512, height: 512 },
  },
};

const textInput: TextInputDefinition = {
  id: "prompt",
  kind: "text",
  group: "describe",
  label: "Prompt",
  help: "",
  multiline: true,
  maxLength: 2000,
  default: "",
  bindings: [
    { nodeId: "1", field: "text", classType: "CLIPTextEncode", title: null },
  ],
};

const numberInput: NumberInputDefinition = {
  id: "steps",
  kind: "number",
  group: "settings",
  label: "Steps",
  help: "",
  numberMode: "integer",
  min: 1,
  max: 100,
  step: 1,
  default: null,
  bindings: [
    { nodeId: "2", field: "steps", classType: "KSampler", title: null },
  ],
};

const selectInput: SelectInputDefinition = {
  id: "speed",
  kind: "select",
  group: "settings",
  label: "Speed",
  help: "",
  default: "fast",
  options: [
    { id: "fast", label: "Fast", values: [20] },
    { id: "slow", label: "Slow", values: [50] },
  ],
  bindings: [
    { nodeId: "2", field: "steps", classType: "KSampler", title: null },
  ],
};

const seedInput: SeedInputDefinition = {
  id: "seed",
  kind: "seed",
  group: "settings",
  label: "Seed",
  help: "",
  max: null,
  bindings: [
    { nodeId: "2", field: "seed", classType: "KSampler", title: null },
  ],
};

const videoUploadInput: VideoUploadInputDefinition = {
  id: "video",
  kind: "video_upload",
  group: "describe",
  label: "Video",
  help: "",
  maxSizeMb: 500,
  maxLongSide: null,
  minDurationMs: 0,
  maxDurationMs: 60_000,
  trimmable: true,
  bindings: [
    { nodeId: "4", field: "video", classType: "VHS_LoadVideo", title: null },
  ],
};

const pointsInput: PointsInputDefinition = {
  id: "points",
  kind: "points",
  group: "settings",
  label: "Who to replace",
  help: "",
  videoInputId: "video",
  widthField: { nodeId: "3", field: "width" },
  heightField: { nodeId: "3", field: "height" },
  bindings: [
    { nodeId: "5", field: "points", classType: "SomeNode", title: null },
  ],
};

function noModeSettings(): ModeInputSetting[] {
  return [];
}

describe("resolveGenerationSettings", () => {
  test("a text Input left blank shows 'Default prompt: …'", () => {
    const [setting] = resolveGenerationSettings({
      inputs: [textInput],
      modeInputSettings: noModeSettings(),
      workflow: WORKFLOW,
      builtPrompt: {
        "1": { class_type: "CLIPTextEncode", inputs: { text: "a cat" } },
      },
      uploads: [],
    });
    expect(setting?.display).toBe("Default prompt: a cat");
  });

  test("a text Input the user filled in shows the text as-is", () => {
    const [setting] = resolveGenerationSettings({
      inputs: [textInput],
      modeInputSettings: noModeSettings(),
      workflow: WORKFLOW,
      builtPrompt: {
        "1": { class_type: "CLIPTextEncode", inputs: { text: "a dog" } },
      },
      uploads: [],
    });
    expect(setting?.display).toBe("a dog");
  });

  test("a number Input left blank shows 'Default (<Workflow value>)'", () => {
    const [setting] = resolveGenerationSettings({
      inputs: [numberInput],
      modeInputSettings: noModeSettings(),
      workflow: WORKFLOW,
      builtPrompt: {
        "2": { class_type: "KSampler", inputs: { steps: 20, seed: 0 } },
      },
      uploads: [],
    });
    expect(setting?.display).toBe("Default (20)");
  });

  test("a number Input the user set shows the number", () => {
    const [setting] = resolveGenerationSettings({
      inputs: [numberInput],
      modeInputSettings: noModeSettings(),
      workflow: WORKFLOW,
      builtPrompt: {
        "2": { class_type: "KSampler", inputs: { steps: 35, seed: 0 } },
      },
      uploads: [],
    });
    expect(setting?.display).toBe("35");
    expect(setting?.kind === "number" && setting.value).toBe(35);
  });

  test("a select Input at its default option shows 'Default (<label>)'", () => {
    const [setting] = resolveGenerationSettings({
      inputs: [selectInput],
      modeInputSettings: noModeSettings(),
      workflow: WORKFLOW,
      builtPrompt: {
        "2": { class_type: "KSampler", inputs: { steps: 20, seed: 0 } },
      },
      uploads: [],
    });
    expect(setting?.display).toBe("Default (Fast)");
  });

  test("a select Input away from its default shows the option's own label", () => {
    const [setting] = resolveGenerationSettings({
      inputs: [selectInput],
      modeInputSettings: noModeSettings(),
      workflow: WORKFLOW,
      builtPrompt: {
        "2": { class_type: "KSampler", inputs: { steps: 50, seed: 0 } },
      },
      uploads: [],
    });
    expect(setting?.display).toBe("Slow");
    expect(setting?.kind === "select" && setting.value).toBe("slow");
  });

  test("the seed used", () => {
    const [setting] = resolveGenerationSettings({
      inputs: [seedInput],
      modeInputSettings: noModeSettings(),
      workflow: WORKFLOW,
      builtPrompt: {
        "2": { class_type: "KSampler", inputs: { steps: 20, seed: 4242 } },
      },
      uploads: [],
    });
    expect(setting?.display).toBe("4242");
  });

  test("an Upload Input left out shows 'None'", () => {
    const [setting] = resolveGenerationSettings({
      inputs: [videoUploadInput],
      modeInputSettings: noModeSettings(),
      workflow: WORKFLOW,
      builtPrompt: {
        "4": { class_type: "VHS_LoadVideo", inputs: { video: null } },
      },
      uploads: [],
    });
    expect(setting?.display).toBe("None");
    expect((setting as { upload: unknown }).upload).toBeNull();
  });

  test("an Upload Input that was used shows its facts, with a trimmed-from note", () => {
    const [setting] = resolveGenerationSettings({
      inputs: [videoUploadInput],
      modeInputSettings: noModeSettings(),
      workflow: WORKFLOW,
      builtPrompt: {
        "4": {
          class_type: "VHS_LoadVideo",
          inputs: { video: "studio/upload-1.mp4" },
        },
      },
      uploads: [
        {
          id: "upload-1",
          extension: "mp4",
          facts: {
            id: "upload-1",
            name: "clip.mp4",
            size: 1024,
            durationMs: 3000,
            width: 1920,
            height: 1080,
            thumbnailKey: "thumb/upload-1.jpg",
            trimmedFromName: "original.mp4",
          },
        },
      ],
    });
    expect(setting?.display).toBe("clip.mp4");
    const uploadSetting = setting as {
      upload: { trimmedFromName: string | null };
    };
    expect(uploadSetting.upload?.trimmedFromName).toBe("original.mp4");
  });

  test("a Points Input decodes the pixels drawn on the frame", () => {
    const [setting] = resolveGenerationSettings({
      inputs: [pointsInput],
      modeInputSettings: noModeSettings(),
      workflow: WORKFLOW,
      builtPrompt: {
        "3": { class_type: "ImageScale", inputs: { width: 512, height: 512 } },
        "5": {
          class_type: "SomeNode",
          inputs: { points: JSON.stringify([{ x: 10, y: 20 }]) },
        },
      },
      uploads: [],
    });
    expect(setting?.display).toBe("1 point");
    const pointsSetting = setting as {
      points: { x: number; y: number }[];
      frameWidth: number | null;
      frameHeight: number | null;
    };
    expect(pointsSetting.points).toEqual([{ x: 10, y: 20 }]);
    expect(pointsSetting.frameWidth).toBe(512);
    expect(pointsSetting.frameHeight).toBe(512);
  });

  test("a fixed Input is left out, like the Workbench form itself", () => {
    const fixedSetting: ModeInputSetting = {
      inputId: "steps",
      state: "fixed",
      fixedValue: 20,
      label: "",
    };
    const result = resolveGenerationSettings({
      inputs: [numberInput],
      modeInputSettings: [fixedSetting],
      workflow: WORKFLOW,
      builtPrompt: {},
      uploads: [],
    });
    expect(result).toEqual([]);
  });
});
