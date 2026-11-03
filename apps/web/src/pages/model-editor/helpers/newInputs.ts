import type {
  AudioUploadInputDefinition,
  ImageUploadInputDefinition,
  NumberInputDefinition,
  PointsInputDefinition,
  SeedInputDefinition,
  SelectInputDefinition,
  TextInputDefinition,
  VideoUploadInputDefinition,
} from "@ai-content-studio/shared";
export function newTextInput(): TextInputDefinition {
  return {
    id: crypto.randomUUID(),
    kind: "text",
    group: "describe",
    label: "",
    help: "",
    default: "",
    multiline: false,
    maxLength: 2000,
    bindings: [],
  };
}
export function newNumberInput(): NumberInputDefinition {
  return {
    id: crypto.randomUUID(),
    kind: "number",
    group: "settings",
    label: "",
    help: "",
    default: null,
    numberMode: "integer",
    min: 0,
    max: 100,
    step: 1,
    bindings: [],
  };
}
export function newSeedInput(): SeedInputDefinition {
  return {
    id: crypto.randomUUID(),
    kind: "seed",
    group: "settings",
    label: "Seed",
    help: "",
    max: null,
    bindings: [],
  };
}
export function newSelectInput(): SelectInputDefinition {
  return {
    id: crypto.randomUUID(),
    kind: "select",
    group: "settings",
    label: "",
    help: "",
    default: null,
    options: [
      { id: crypto.randomUUID(), label: "", values: [] },
      { id: crypto.randomUUID(), label: "", values: [] },
    ],
    bindings: [],
  };
}
export function newImageUploadInput(): ImageUploadInputDefinition {
  return {
    id: crypto.randomUUID(),
    kind: "image_upload",
    group: "describe",
    label: "",
    help: "",
    maxSizeMb: 20,
    maxLongSide: null,
    bindings: [],
  };
}
export function newVideoUploadInput(): VideoUploadInputDefinition {
  return {
    id: crypto.randomUUID(),
    kind: "video_upload",
    group: "describe",
    label: "",
    help: "",
    maxSizeMb: 50,
    maxLongSide: null,
    minDurationMs: 0,
    maxDurationMs: 10_000,
    trimmable: true,
    bindings: [],
  };
}
export function newAudioUploadInput(): AudioUploadInputDefinition {
  return {
    id: crypto.randomUUID(),
    kind: "audio_upload",
    group: "describe",
    label: "",
    help: "",
    maxSizeMb: 20,
    minDurationMs: 0,
    maxDurationMs: 10_000,
    trimmable: true,
    bindings: [],
  };
}
export function newPointsInput(): PointsInputDefinition {
  return {
    id: crypto.randomUUID(),
    kind: "points",
    group: "describe",
    label: "",
    help: "",
    videoInputId: "",
    widthField: { nodeId: "", field: "" },
    heightField: { nodeId: "", field: "" },
    bindings: [],
  };
}
