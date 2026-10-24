// Resolves a Generation's detail view (issue #57): for each Input the
// Generation's Mode showed, in the Model revision's own order and with
// the Mode's own labels (`resolveModeInputs`), the value it actually ran
// with, worded per the AC: text/"Default prompt: …", number/"Default
// (<Workflow value>)", an option's label/"Default (<label>)", the seed
// used, an Upload's facts or "None", and points drawn on the frame. A
// fixed or hidden Input isn't settings the user chose, so it's left out,
// same as the Workbench form itself (`resolveModeInputs`).

import {
  type InputDefinition,
  type SelectOption,
  uploadFileName,
} from "./input.js";
import { type ModeInputSetting, resolveModeInputs } from "./mode.js";
import type { Point } from "./points.js";
import { type NodeFieldValue, type Workflow, isNodeLink } from "./types.js";

/** The facts about one Upload actually used (issue #57's AC). */
export interface GenerationUploadFacts {
  id: string;
  name: string;
  size: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  thumbnailKey: string | null;
  /** The Upload it was trimmed from, by original name, or null when it wasn't (issue #51). */
  trimmedFromName: string | null;
}

/** One Upload the server looks up by the file name `buildPrompt` wrote (issue #50's naming, `uploadFileName`). */
export interface GenerationUploadLookup {
  id: string;
  extension: string;
  facts: GenerationUploadFacts;
}

export type GenerationInputSetting =
  | {
      inputId: string;
      label: string;
      kind: "text";
      display: string;
      /** The raw text actually submitted (Reuse these settings, issue #57's AC), same string `display` is built from. */
      value: string;
    }
  | {
      inputId: string;
      label: string;
      kind: "number";
      display: string;
      value: number;
    }
  | {
      inputId: string;
      label: string;
      kind: "select";
      display: string;
      /** The option id matched, or "" when none matched (Reuse these settings). */
      value: string;
    }
  | {
      inputId: string;
      label: string;
      kind: "seed";
      display: string;
      value: number;
    }
  | {
      inputId: string;
      label: string;
      kind: "upload";
      display: string;
      upload: GenerationUploadFacts | null;
    }
  | {
      inputId: string;
      label: string;
      kind: "points";
      display: string;
      points: Point[];
      frameWidth: number | null;
      frameHeight: number | null;
    };

function fieldValue(
  builtPrompt: Workflow,
  nodeId: string,
  field: string,
): NodeFieldValue | undefined {
  const value = builtPrompt[nodeId]?.inputs[field];
  return isNodeLink(value) ? undefined : value;
}

/** The Node field's own value before any Input override (same idea as `promptBindingFor`, generalised to any binding). */
function workflowDefaultFor(
  workflow: Workflow,
  nodeId: string,
  field: string,
): NodeFieldValue | undefined {
  const value = workflow[nodeId]?.inputs[field];
  return isNodeLink(value) ? undefined : value;
}

function matchingOption(
  options: readonly SelectOption[],
  values: readonly (NodeFieldValue | undefined)[],
): SelectOption | null {
  return (
    options.find((option) =>
      option.values.every((value, i) => value === values[i]),
    ) ?? null
  );
}

/**
 * This Generation's settings view (issue #57): one entry per Input the
 * Mode showed (optional or required), in the revision's order, under the
 * Mode's own label.
 */
export function resolveGenerationSettings(params: {
  inputs: readonly InputDefinition[];
  modeInputSettings: readonly ModeInputSetting[];
  workflow: Workflow;
  builtPrompt: Workflow;
  uploads: readonly GenerationUploadLookup[];
}): GenerationInputSetting[] {
  const { inputs, modeInputSettings, workflow, builtPrompt, uploads } = params;
  const { formInputs } = resolveModeInputs(inputs, modeInputSettings);

  return formInputs.map((input): GenerationInputSetting => {
    const binding = input.bindings[0];

    if (input.kind === "text") {
      const value = binding
        ? fieldValue(builtPrompt, binding.nodeId, binding.field)
        : undefined;
      const text = typeof value === "string" ? value : "";
      const workflowValue = binding
        ? workflowDefaultFor(workflow, binding.nodeId, binding.field)
        : undefined;
      const placeholder =
        typeof workflowValue === "string" ? workflowValue : "";
      const unsetValue = input.default || placeholder;
      return {
        inputId: input.id,
        label: input.label,
        kind: "text",
        display: text === unsetValue ? `Default prompt: ${text}` : text,
        value: text,
      };
    }

    if (input.kind === "number") {
      const value = binding
        ? fieldValue(builtPrompt, binding.nodeId, binding.field)
        : undefined;
      const number = typeof value === "number" ? value : 0;
      const workflowValue = binding
        ? workflowDefaultFor(workflow, binding.nodeId, binding.field)
        : undefined;
      const unsetValue =
        input.default ??
        (typeof workflowValue === "number" ? workflowValue : 0);
      return {
        inputId: input.id,
        label: input.label,
        kind: "number",
        display: number === unsetValue ? `Default (${number})` : String(number),
        value: number,
      };
    }

    if (input.kind === "select") {
      const values = input.bindings.map((b) =>
        fieldValue(builtPrompt, b.nodeId, b.field),
      );
      const matched = matchingOption(input.options, values);
      const label = matched?.label ?? "Default";
      return {
        inputId: input.id,
        label: input.label,
        kind: "select",
        display:
          matched && matched.id === input.default
            ? `Default (${label})`
            : label,
        value: matched?.id ?? "",
      };
    }

    if (input.kind === "seed") {
      const value = binding
        ? fieldValue(builtPrompt, binding.nodeId, binding.field)
        : undefined;
      const seed = typeof value === "number" ? value : 0;
      return {
        inputId: input.id,
        label: input.label,
        kind: "seed",
        display: String(seed),
        value: seed,
      };
    }

    if (
      input.kind === "image_upload" ||
      input.kind === "video_upload" ||
      input.kind === "audio_upload"
    ) {
      const value = binding
        ? fieldValue(builtPrompt, binding.nodeId, binding.field)
        : undefined;
      const match =
        typeof value === "string"
          ? uploads.find((u) => uploadFileName(u.id, u.extension) === value)
          : undefined;
      return {
        inputId: input.id,
        label: input.label,
        kind: "upload",
        display: match ? match.facts.name : "None",
        upload: match?.facts ?? null,
      };
    }

    // "points"
    const value = binding
      ? fieldValue(builtPrompt, binding.nodeId, binding.field)
      : undefined;
    let points: Point[] = [];
    if (typeof value === "string" && value !== "") {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) {
          points = parsed.filter(
            (p): p is Point =>
              !!p &&
              typeof (p as Point).x === "number" &&
              typeof (p as Point).y === "number",
          );
        }
      } catch {
        points = [];
      }
    }
    const widthValue = fieldValue(
      builtPrompt,
      input.widthField.nodeId,
      input.widthField.field,
    );
    const heightValue = fieldValue(
      builtPrompt,
      input.heightField.nodeId,
      input.heightField.field,
    );
    return {
      inputId: input.id,
      label: input.label,
      kind: "points",
      display: `${points.length} point${points.length === 1 ? "" : "s"}`,
      points,
      frameWidth: typeof widthValue === "number" ? widthValue : null,
      frameHeight: typeof heightValue === "number" ? heightValue : null,
    };
  });
}
