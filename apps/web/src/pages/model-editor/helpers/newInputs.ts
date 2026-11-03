import { VIDEO_LOADER_CLASS_TYPES } from "@ai-content-studio/shared";
import type {
  AudioUploadInputDefinition,
  BindableField,
  ImageUploadInputDefinition,
  InputDefinition,
  NumberInputDefinition,
  PointsInputDefinition,
  SeedInputDefinition,
  SelectInputDefinition,
  TextInputDefinition,
  VideoUploadInputDefinition,
} from "@ai-content-studio/shared";
import { toggleBinding } from "./bindings.js";
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
    group: "settings",
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
    group: "settings",
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
    group: "settings",
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
    group: "settings",
    label: "",
    help: "",
    videoInputId: "",
    widthField: { nodeId: "", field: "" },
    heightField: { nodeId: "", field: "" },
    bindings: [],
  };
}

/** A fresh Input of `kind`, with its defaults (issue #215's New Input menu and type-change). */
export function newInputOfKind(kind: InputDefinition["kind"]): InputDefinition {
  switch (kind) {
    case "text":
      return newTextInput();
    case "number":
      return newNumberInput();
    case "seed":
      return newSeedInput();
    case "select":
      return newSelectInput();
    case "image_upload":
      return newImageUploadInput();
    case "video_upload":
      return newVideoUploadInput();
    case "audio_upload":
      return newAudioUploadInput();
    case "points":
      return newPointsInput();
  }
}

/** Changing an Input's type (issue #215): a fresh Input of `kind`, keeping its id, label and help. Only offered while the Input has no bindings. */
export function changeInputKind(
  input: InputDefinition,
  kind: InputDefinition["kind"],
): InputDefinition {
  return {
    ...newInputOfKind(kind),
    id: input.id,
    label: input.label,
    help: input.help,
  };
}

/** The new-Input kind this field matches (issue #214's "Make it an Input"): a loader's file field becomes an Upload; an int field named like seed becomes a Seed (only when `hasSeed` is false); another number becomes Number; a string becomes Text; a boolean becomes a 2-option (toggle) Select. */
export function newInputKindForField(
  field: BindableField,
  hasSeed: boolean,
): InputDefinition["kind"] {
  if (field.valueType === "string") {
    if (field.classType === "LoadImage") return "image_upload";
    if (VIDEO_LOADER_CLASS_TYPES.has(field.classType)) return "video_upload";
    if (/load.*audio|audio.*load/i.test(field.classType)) return "audio_upload";
    return "text";
  }
  if (field.valueType === "number") {
    return !hasSeed && /seed/i.test(field.field) ? "seed" : "number";
  }
  return "select";
}

/** This field's label once it becomes an Input (issue #214): a loader drops "Load " from its title; a `value` field is named after the node; otherwise it's "<title> <field>". */
export function labelForNewInput(
  field: BindableField,
  kind: InputDefinition["kind"],
): string {
  const title = field.title || field.classType;
  if (
    kind === "image_upload" ||
    kind === "video_upload" ||
    kind === "audio_upload"
  ) {
    return title.replace(/^Load /, "");
  }
  if (field.field === "value") return title;
  return `${title} ${field.field}`;
}

/** Builds and binds the new Input a "Make it an Input" / "New Input from this field" creates (issue #214). */
export function newInputFromField(
  field: BindableField,
  hasSeed: boolean,
): InputDefinition {
  const kind = newInputKindForField(field, hasSeed);
  const label = labelForNewInput(field, kind);
  if (kind === "select") {
    // A boolean field's new Input is the agreed 2-option toggle (issue
    // #214 CEO review): seeded Off/On with false/true, not `toggleBinding`'s
    // generic "push this field's current value onto every option" (which
    // would give both options that one value and no label at all).
    const binding = {
      nodeId: field.nodeId,
      field: field.field,
      classType: field.classType,
      title: field.title,
    };
    return {
      ...newSelectInput(),
      label,
      options: [
        { id: crypto.randomUUID(), label: "Off", values: [false] },
        { id: crypto.randomUUID(), label: "On", values: [true] },
      ],
      bindings: [binding],
    };
  }
  const base: InputDefinition =
    kind === "text"
      ? newTextInput()
      : kind === "number"
        ? newNumberInput()
        : kind === "seed"
          ? newSeedInput()
          : kind === "image_upload"
            ? newImageUploadInput()
            : kind === "video_upload"
              ? newVideoUploadInput()
              : newAudioUploadInput();
  return toggleBinding({ ...base, label }, field);
}
