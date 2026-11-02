import { fieldKey, listBindableFields } from "@ai-content-studio/shared";
import type {
  BindableField,
  InputDefinition,
  Workflow,
} from "@ai-content-studio/shared";
/** `fieldKey` of every field bound by an Input other than `excludingId`. */
export function usedFieldKeys(
  inputs: InputDefinition[],
  excludingId: string,
): Set<string> {
  const used = new Set<string>();
  for (const input of inputs) {
    if (input.id === excludingId) continue;
    for (const binding of input.bindings) {
      used.add(fieldKey(binding.nodeId, binding.field));
    }
  }
  return used;
}
/** A field this Input can bind (issue #46): value-holding, type-compatible with its kind, not `filename_prefix`, and not already bound elsewhere. */
export function candidateFieldsFor(
  workflow: Workflow,
  input: InputDefinition,
  otherInputs: InputDefinition[],
): BindableField[] {
  const used = usedFieldKeys(otherInputs, input.id);
  const alreadyBound = new Set(
    input.bindings.map((binding) => fieldKey(binding.nodeId, binding.field)),
  );
  return listBindableFields(workflow).filter((field) => {
    if (field.field === "filename_prefix") return false;
    const key = fieldKey(field.nodeId, field.field);
    if (used.has(key) && !alreadyBound.has(key)) return false;
    if (input.kind === "text") return field.valueType === "string";
    if (input.kind === "number" || input.kind === "seed") {
      return field.valueType === "number";
    }
    // Issue #50: a loader's file name field (e.g. LoadImage.image); the
    // server checks the Backend flags it image_upload when it can.
    if (input.kind === "image_upload") return field.valueType === "string";
    // Issue #51: a video/audio loader's file name field; the server
    // checks the flag, or VHS_LoadVideo/VHS_LoadVideoFFmpeg for video.
    if (input.kind === "video_upload" || input.kind === "audio_upload") {
      return field.valueType === "string";
    }
    // Issue #52: the one field a Points Input writes its resolved
    // pixel JSON to.
    if (input.kind === "points") return field.valueType === "string";
    return true;
  });
}
/** The workflow's own number-valued fields (issue #52), for a Points Input's Width/Height field pickers; not restricted to unused ones, since those fields are only ever read, never written by the Points Input itself. */
export function numberFieldsFor(workflow: Workflow): BindableField[] {
  return listBindableFields(workflow).filter(
    (field) => field.valueType === "number",
  );
}
/** Adds or removes a binding, keeping a select Input's option values arrays the same length as its bindings. */
export function toggleBinding(
  input: InputDefinition,
  field: BindableField,
): InputDefinition {
  const index = input.bindings.findIndex(
    (binding) =>
      binding.nodeId === field.nodeId && binding.field === field.field,
  );

  if (index === -1) {
    // A Seed Input binds exactly one field: picking another replaces it (issue #47).
    const bindings = [
      ...(input.kind === "seed" ? [] : input.bindings),
      {
        nodeId: field.nodeId,
        field: field.field,
        classType: field.classType,
        title: field.title,
      },
    ];
    if (input.kind === "select") {
      return {
        ...input,
        bindings,
        options: input.options.map((option) => ({
          ...option,
          values: [...option.values, field.value],
        })),
      };
    }
    return { ...input, bindings };
  }

  const bindings = input.bindings.filter((_, i) => i !== index);
  if (input.kind === "select") {
    return {
      ...input,
      bindings,
      options: input.options.map((option) => ({
        ...option,
        values: option.values.filter((_, i) => i !== index),
      })),
    };
  }
  return { ...input, bindings };
}
