// A Mode's output nodes and Path (ADR 0001, issue #42), and a Mode's
// per-Input settings (issue #48): hidden, optional, required or fixed,
// with an optional Mode-specific label.

import { fieldKey } from "./input.js";
import type { ComfyFieldSpec, InputDefinition } from "./input.js";
import { computePath } from "./path.js";
import type { NodeFieldValue, Workflow } from "./types.js";

export type AssetKind = "video" | "image" | "audio";

/**
 * Known ComfyUI save node classes mapped to the Asset kind they produce,
 * used to infer an output node's `kind` when the Admin doesn't set one.
 * Starts with the save nodes seen in practice and grows as more are
 * identified (same spirit as outside-service.ts's node class lists).
 */
export const SAVE_NODE_KINDS: Record<string, AssetKind> = {
  SaveImage: "image",
  SaveAnimatedPNG: "image",
  SaveAnimatedWEBP: "image",
  SaveAudio: "audio",
  SaveAudioMP3: "audio",
  SaveAudioOpus: "audio",
  VHS_VideoCombine: "video",
  SaveVideo: "video",
  SaveWEBM: "video",
};

/**
 * Preview-only node classes: ADR 0001 refuses these as a Mode's output
 * node ("side outputs such as a preview node ... are not allowed").
 * `PreviewImage`, `PreviewAudio`, `PreviewAny` and `Preview3D` are
 * ComfyUI's own core preview nodes; `MaskPreview` and VideoHelperSuite's
 * preview node are commonly paired with them.
 */
export const PREVIEW_NODE_CLASSES: ReadonlySet<string> = new Set([
  "PreviewImage",
  "PreviewAudio",
  "PreviewAny",
  "Preview3D",
  "MaskPreview",
  "VHS_VideoPreview",
]);

export function inferOutputNodeKind(classType: string): AssetKind | null {
  return SAVE_NODE_KINDS[classType] ?? null;
}

export function isPreviewNodeClass(classType: string): boolean {
  return PREVIEW_NODE_CLASSES.has(classType);
}

/** One of a Mode's ordered output nodes, resolved against its Workflow. */
export interface ResolvedOutputNode {
  nodeId: string;
  classType: string;
  title: string | null;
  kind: AssetKind | null;
}

export type ResolveOutputNodesResult =
  | { ok: true; outputNodes: ResolvedOutputNode[] }
  | { ok: false; errors: string[] };

/**
 * Resolves and validates a Mode's ordered output node ids against a
 * Workflow: each must exist and must not be a preview node, and there
 * must be at least one (the first is the main Asset).
 */
export function resolveModeOutputNodes(
  workflow: Workflow,
  outputNodeIds: readonly string[],
): ResolveOutputNodesResult {
  const errors: string[] = [];
  if (outputNodeIds.length === 0) {
    errors.push("a Mode needs at least one output node");
  }

  const seen = new Set<string>();
  const outputNodes: ResolvedOutputNode[] = [];
  for (const nodeId of outputNodeIds) {
    if (seen.has(nodeId)) {
      errors.push(`output node "${nodeId}" is named more than once`);
      continue;
    }
    seen.add(nodeId);

    const node = workflow[nodeId];
    if (!node) {
      errors.push(`output node "${nodeId}" is not in the Workflow`);
      continue;
    }
    if (isPreviewNodeClass(node.class_type)) {
      errors.push(
        `output node "${nodeId}" (${node.class_type}) is a preview node and can't be a Mode's output`,
      );
      continue;
    }
    outputNodes.push({
      nodeId,
      classType: node.class_type,
      title: node._meta?.title ?? null,
      kind: inferOutputNodeKind(node.class_type),
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, outputNodes };
}

/**
 * A Mode's Path (ADR 0001): its output nodes plus everything upstream.
 * `unresolvableFields` (issue #48) keeps both sides of a switch steered
 * by a field in that set, rather than pruning one on a value a visible
 * Input could still change.
 */
export function computeModePath(
  workflow: Workflow,
  outputNodeIds: readonly string[],
  unresolvableFields?: ReadonlySet<string>,
) {
  return computePath(workflow, outputNodeIds, unresolvableFields);
}

/** A Mode's name: 1-60 characters, unique among the Model's other Modes (case-insensitive). */
export function validateModeName(
  name: string,
  otherNames: readonly string[],
): string | null {
  if (name.length < 1 || name.length > 60) {
    return "must be 1-60 characters";
  }
  const lower = name.toLowerCase();
  if (otherNames.some((other) => other.toLowerCase() === lower)) {
    return "a Mode with this name already exists";
  }
  return null;
}

/**
 * One Input's state within one Mode (issue #48): hidden, optional,
 * required, or fixed to a value. An Input with no setting for a given
 * Mode defaults to optional with no label override (every Mode's Path
 * Inputs showed this way before the Mode × Input grid existed).
 */
export type ModeInputState = "hidden" | "optional" | "required" | "fixed";

export interface ModeInputSetting {
  inputId: string;
  state: ModeInputState;
  /** Only meaningful when `state` is "fixed": an option id (select), or a literal text/number value. */
  fixedValue: NodeFieldValue;
  /** Blank means this Mode uses the Input's own label. */
  label: string;
}

/** Finds `inputId`'s setting for this Mode, or the optional/no-label default when it has none. */
export function modeInputSetting(
  settings: readonly ModeInputSetting[],
  inputId: string,
): ModeInputSetting {
  return (
    settings.find((setting) => setting.inputId === inputId) ?? {
      inputId,
      state: "optional",
      fixedValue: null,
      label: "",
    }
  );
}

/**
 * Validates one Mode's `ModeInputSetting`s against its Model's Inputs:
 * each setting's Input must exist, at most one setting per Input, a
 * fixed value must respect that Input's options or range, and a label
 * override must be 1-60 characters.
 */
export function validateModeInputSettings(
  settings: readonly ModeInputSetting[],
  inputs: readonly InputDefinition[],
): string[] {
  const errors: string[] = [];
  const byId = new Map(inputs.map((input) => [input.id, input]));
  const seen = new Set<string>();

  for (const setting of settings) {
    if (seen.has(setting.inputId)) {
      errors.push(`Input "${setting.inputId}" has more than one setting`);
      continue;
    }
    seen.add(setting.inputId);

    const input = byId.get(setting.inputId);
    if (!input) {
      errors.push(`Input "${setting.inputId}" is not on this Model`);
      continue;
    }

    if (setting.label !== "" && setting.label.length > 60) {
      errors.push(`"${input.label}"'s Mode label must be 1-60 characters`);
    }

    if (setting.state !== "fixed") continue;

    if (input.kind === "text") {
      if (typeof setting.fixedValue !== "string") {
        errors.push(`"${input.label}"'s fixed value must be text`);
      } else if (setting.fixedValue.length > input.maxLength) {
        errors.push(`"${input.label}"'s fixed value is longer than max length`);
      }
    } else if (input.kind === "number") {
      if (typeof setting.fixedValue !== "number") {
        errors.push(`"${input.label}"'s fixed value must be a number`);
      } else if (
        setting.fixedValue < input.min ||
        setting.fixedValue > input.max
      ) {
        errors.push(
          `"${input.label}"'s fixed value must be between min and max`,
        );
      } else if (
        input.numberMode === "integer" &&
        !Number.isInteger(setting.fixedValue)
      ) {
        errors.push(`"${input.label}"'s fixed value must be a whole number`);
      } else if (!isOnStep(setting.fixedValue, input.min, input.step)) {
        errors.push(`"${input.label}"'s fixed value must sit on its step`);
      }
    } else if (input.kind === "select") {
      if (
        typeof setting.fixedValue !== "string" ||
        !input.options.some((option) => option.id === setting.fixedValue)
      ) {
        errors.push(
          `"${input.label}"'s fixed value must be one of its options`,
        );
      }
    } else if (input.kind === "seed") {
      // ADR 0007: blank always means "draw one"; fixing a Seed would
      // make every Submission draw the same one, defeating the point.
      errors.push(`"${input.label}" is a Seed and can't be fixed`);
    }
  }

  return errors;
}

function isOnStep(value: number, min: number, step: number): boolean {
  if (step <= 0) return true;
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/**
 * The `fieldKey`s this Mode's visible (optional or required) Inputs are
 * bound to (issue #48): fed into {@link computeModePath} so a switch
 * steered by one of them keeps both branches on the Path, since a user
 * could still change it.
 */
export function visibleModeBoundFields(
  settings: readonly ModeInputSetting[],
  inputs: readonly InputDefinition[],
): Set<string> {
  const fields = new Set<string>();
  for (const input of inputs) {
    const setting = modeInputSetting(settings, input.id);
    if (setting.state === "hidden" || setting.state === "fixed") continue;
    for (const binding of input.bindings) {
      fields.add(fieldKey(binding.nodeId, binding.field));
    }
  }
  return fields;
}

export interface ResolvedModeInputs {
  /** The Inputs this Mode's form shows: optional or required, in the Admin's order, label overridden per Mode. */
  formInputs: InputDefinition[];
  /** `formInputs` ids whose value is required to submit. */
  requiredIds: Set<string>;
  /** Fixed Inputs' values, by Input id, for `applyInputValues`/`buildPrompt` to write regardless of what's submitted. */
  fixedValues: Record<string, NodeFieldValue>;
}

/**
 * Resolves a Mode's relevant Inputs (those with a binding on its Path)
 * against its `ModeInputSetting`s (issue #48): splits them into what the
 * form shows (optional/required, labelled per this Mode) and what's
 * fixed, excluding hidden ones from both.
 */
export function resolveModeInputs(
  inputs: readonly InputDefinition[],
  settings: readonly ModeInputSetting[],
): ResolvedModeInputs {
  const formInputs: InputDefinition[] = [];
  const requiredIds = new Set<string>();
  const fixedValues: Record<string, NodeFieldValue> = {};

  for (const input of inputs) {
    const setting = modeInputSetting(settings, input.id);
    if (setting.state === "hidden") continue;
    if (setting.state === "fixed") {
      fixedValues[input.id] = setting.fixedValue;
      continue;
    }
    formInputs.push(
      setting.label === "" ? input : { ...input, label: setting.label },
    );
    if (setting.state === "required") requiredIds.add(input.id);
  }

  return { formInputs, requiredIds, fixedValues };
}

/**
 * Which Workbench Mode menu group a Mode falls under (issue #48),
 * grouped by what its *required* Inputs ask the user to start from (an
 * optional Upload doesn't commit the user to that path). Upload Input
 * kinds land in later issues (#50, #66); until then every Mode groups
 * as "prompt".
 */
export type ModeMenuGroup = "prompt" | "images" | "audio" | "video";

const UPLOAD_KIND_GROUPS: Record<string, ModeMenuGroup> = {
  image_upload: "images",
  audio_upload: "audio",
  video_upload: "video",
};

/** The Mode menu group this Mode's required Inputs put it in; "prompt" when none require an Upload. */
export function modeMenuGroup(
  inputs: readonly InputDefinition[],
  settings: readonly ModeInputSetting[],
): ModeMenuGroup {
  for (const input of inputs) {
    const setting = modeInputSetting(settings, input.id);
    if (setting.state !== "required") continue;
    const group = UPLOAD_KIND_GROUPS[input.kind as string];
    if (group) return group;
  }
  return "prompt";
}

/**
 * Carries a Mode's `ModeInputSetting`s forward across an Inputs edit
 * (issue #48): drops a setting whose Input no longer exists, and
 * reverts a fixed setting whose value no longer validates against that
 * Input's current options/range (e.g. an option or a wider range was
 * narrowed away) to "optional" rather than leaving a stale, unchecked
 * fixed value in place.
 */
export function reviseModeInputSettings(
  settings: readonly ModeInputSetting[],
  inputs: readonly InputDefinition[],
): ModeInputSetting[] {
  const byId = new Map(inputs.map((input) => [input.id, input]));
  const revised: ModeInputSetting[] = [];
  for (const setting of settings) {
    if (!byId.has(setting.inputId)) continue;
    if (setting.state !== "fixed") {
      revised.push(setting);
      continue;
    }
    const stillValid =
      validateModeInputSettings([setting], inputs).length === 0;
    revised.push(
      stillValid
        ? setting
        : { ...setting, state: "optional", fixedValue: null },
    );
  }
  return revised;
}
