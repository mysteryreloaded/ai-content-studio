// Resolving an Input into what a form (the Workbench, or the Model
// editor's own Test panel, issue #74 CEO review) needs to render and
// validate its field: a Workflow's own value as a blank's placeholder
// (issue #46), and a Points Input's Width/Height resolved onto whichever
// shown Number or Select Input binds that field live (issue #52).

import type { InputDefinition } from "./input.js";
import type { NodeFieldValue, Workflow } from "./types.js";
import { isNodeLink } from "./types.js";

export type WorkbenchInputOption = { id: string; label: string };

export type WorkbenchInput = {
  id: string;
  group: "describe" | "settings";
  label: string;
  help: string;
  required: boolean;
  placeholder: string | number | boolean | null;
} & (
  | { kind: "text"; multiline: boolean; maxLength: number; default: string }
  | {
      kind: "number";
      numberMode: "integer" | "decimal";
      min: number;
      max: number;
      step: number;
      default: number | null;
    }
  | {
      kind: "select";
      options: WorkbenchInputOption[];
      default: string | null;
    }
  | { kind: "image_upload"; maxSizeMb: number; maxLongSide: number | null }
  | {
      kind: "video_upload";
      maxSizeMb: number;
      maxLongSide: number | null;
      minDurationMs: number;
      maxDurationMs: number;
      trimmable: boolean;
    }
  | {
      kind: "audio_upload";
      maxSizeMb: number;
      minDurationMs: number;
      maxDurationMs: number;
      trimmable: boolean;
    }
  | { kind: "seed"; max: number | null }
  | {
      kind: "points";
      videoInputId: string;
      widthInputId: string | null;
      heightInputId: string | null;
      widthOptionValues: Record<string, number> | null;
      heightOptionValues: Record<string, number> | null;
      defaultWidth: number | null;
      defaultHeight: number | null;
    }
);

/** The Workflow's own value for an Input's first binding, shown as its placeholder when blank. */
function placeholderFor(
  input: InputDefinition,
  workflow: Workflow,
): string | number | boolean | null {
  const binding = input.bindings[0];
  const value = binding
    ? workflow[binding.nodeId]?.inputs[binding.field]
    : undefined;
  return value === undefined || isNodeLink(value) ? null : value;
}

/** The shown Input, if any, bound to `ref`'s field (issue #52: a Points Input's Width/Height may itself be a live Number or Select Input). */
function boundInputFor(
  ref: { nodeId: string; field: string },
  formInputs: readonly InputDefinition[],
): InputDefinition | null {
  return (
    formInputs.find((other) =>
      other.bindings.some(
        (binding) =>
          binding.nodeId === ref.nodeId && binding.field === ref.field,
      ),
    ) ?? null
  );
}

/**
 * A Select Input bound to `ref`'s field resolves to a different value
 * per option, not a number the client can just parse (issue #52 CEO
 * review round 2 point 4): this is that option id -> value map, so the
 * form can look up whichever option is currently chosen (or defaulted).
 */
function selectOptionValuesFor(
  ref: { nodeId: string; field: string },
  input: InputDefinition | null,
): Record<string, number> | null {
  if (!input || input.kind !== "select") return null;
  const bindingIndex = input.bindings.findIndex(
    (binding) => binding.nodeId === ref.nodeId && binding.field === ref.field,
  );
  if (bindingIndex === -1) return null;
  const values: Record<string, number> = {};
  for (const option of input.options) {
    const value: NodeFieldValue | undefined = option.values[bindingIndex];
    if (typeof value === "number") values[option.id] = value;
  }
  return values;
}

/** Trims an Input down to what a form needs to render and validate its field: never the bindings or an option's per-field values. */
export function toWorkbenchInput(
  input: InputDefinition,
  workflow: Workflow,
  required: boolean,
  formInputs: readonly InputDefinition[] = [],
): WorkbenchInput {
  const base = {
    id: input.id,
    group: input.group,
    label: input.label,
    help: input.help,
    required,
    placeholder: placeholderFor(input, workflow),
  };
  if (input.kind === "text") {
    return {
      ...base,
      kind: "text" as const,
      multiline: input.multiline,
      maxLength: input.maxLength,
      default: input.default,
    };
  }
  if (input.kind === "image_upload") {
    return {
      ...base,
      placeholder: null,
      kind: "image_upload" as const,
      maxSizeMb: input.maxSizeMb,
      maxLongSide: input.maxLongSide,
    };
  }
  if (input.kind === "video_upload") {
    return {
      ...base,
      placeholder: null,
      kind: "video_upload" as const,
      maxSizeMb: input.maxSizeMb,
      maxLongSide: input.maxLongSide,
      minDurationMs: input.minDurationMs,
      maxDurationMs: input.maxDurationMs,
      trimmable: input.trimmable,
    };
  }
  if (input.kind === "audio_upload") {
    return {
      ...base,
      placeholder: null,
      kind: "audio_upload" as const,
      maxSizeMb: input.maxSizeMb,
      minDurationMs: input.minDurationMs,
      maxDurationMs: input.maxDurationMs,
      trimmable: input.trimmable,
    };
  }
  if (input.kind === "number") {
    return {
      ...base,
      kind: "number" as const,
      numberMode: input.numberMode,
      min: input.min,
      max: input.max,
      step: input.step,
      default: input.default,
    };
  }
  if (input.kind === "seed") {
    return {
      ...base,
      kind: "seed" as const,
      max: input.max,
    };
  }
  if (input.kind === "points") {
    const widthValue =
      workflow[input.widthField.nodeId]?.inputs[input.widthField.field];
    const heightValue =
      workflow[input.heightField.nodeId]?.inputs[input.heightField.field];
    const widthInput = boundInputFor(input.widthField, formInputs);
    const heightInput = boundInputFor(input.heightField, formInputs);
    return {
      ...base,
      placeholder: null,
      kind: "points" as const,
      videoInputId: input.videoInputId,
      // issue #52: when the Mode shows a Number or Select Input bound
      // to the same field, the form watches its live value instead of
      // this literal (an Admin's `widthField` is often one these Inputs
      // own).
      widthInputId: widthInput?.id ?? null,
      heightInputId: heightInput?.id ?? null,
      // issue #52 CEO review round 2: a Select Input's own value is an
      // option id, not the field's number — this is that option id's
      // -> value map, so the form can resolve whichever's chosen.
      widthOptionValues: selectOptionValuesFor(input.widthField, widthInput),
      heightOptionValues: selectOptionValuesFor(input.heightField, heightInput),
      defaultWidth: typeof widthValue === "number" ? widthValue : null,
      defaultHeight: typeof heightValue === "number" ? heightValue : null,
    };
  }
  return {
    ...base,
    kind: "select" as const,
    options: input.options.map((option) => ({
      id: option.id,
      label: option.label,
    })),
    default: input.default,
  };
}
