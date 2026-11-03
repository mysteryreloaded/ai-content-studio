import { parseInputValues, toInputIssues } from "@ai-content-studio/shared";
import type {
  InputDefinition,
  WorkbenchInput,
} from "@ai-content-studio/shared";
import type { WorkbenchMode } from "./types.js";

/** The form's starting values for `mode`'s Inputs: each Input's own default, or blank. */
function initialValuesFor(mode: WorkbenchMode): Record<string, string> {
  const values: Record<string, string> = {};
  for (const input of mode.inputs) {
    if (input.kind === "seed") {
      values[input.id] = "";
      continue;
    }
    values[input.id] =
      input.kind === "image_upload" ||
      input.kind === "video_upload" ||
      input.kind === "audio_upload" ||
      input.kind === "points" ||
      input.default === null ||
      input.default === undefined
        ? ""
        : String(input.default);
  }
  return values;
}

/** Whether `raw` parses for `input`'s own kind and constraints (mirrors `buildInputValuesSchema`'s per-field checks), blank always passing. */
function valueParsesForInput(input: WorkbenchInput, raw: string): boolean {
  if (raw === "") return true;
  if (input.kind === "text") return raw.length <= input.maxLength;
  if (input.kind === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return false;
    if (n < input.min || n > input.max) return false;
    if (input.numberMode === "integer" && !Number.isInteger(n)) return false;
    const steps = (n - input.min) / input.step;
    return Math.abs(steps - Math.round(steps)) < 1e-9;
  }
  if (input.kind === "seed") {
    const n = Number(raw);
    return (
      Number.isInteger(n) &&
      n >= 0 &&
      n <= (input.max ?? Number.POSITIVE_INFINITY)
    );
  }
  if (
    input.kind === "image_upload" ||
    input.kind === "video_upload" ||
    input.kind === "audio_upload" ||
    input.kind === "points"
  ) {
    // An Upload id's (or a Points value's) own completeness can only
    // be checked server-side; carrying it across a reload is
    // best-effort here.
    return true;
  }
  return input.options.some((option) => option.id === raw);
}

/**
 * Carries `basis`'s values onto `mode`'s own Inputs (issue #48 AC6):
 * an Input `mode` also shows keeps its value, the rest default. With
 * `validate` (the 409 `model_changed` reload, where the Model's Inputs
 * may have changed underneath the form), a carried value that no
 * longer parses for that Input is dropped rather than kept to fail on
 * the next submit.
 */
export function carryValuesFor(
  mode: WorkbenchMode,
  basis: Record<string, string>,
  validate = false,
): Record<string, string> {
  const next = initialValuesFor(mode);
  for (const input of mode.inputs) {
    const raw = basis[input.id];
    if (raw === undefined) continue;
    if (validate && !valueParsesForInput(input, raw)) continue;
    next[input.id] = raw;
  }
  return next;
}

/** The submitted payload for `mode`'s Inputs: blank values are left out, a number is parsed. */
export function valuesPayload(
  mode: WorkbenchMode,
  values: Record<string, string>,
): Record<string, string | number> {
  const payload: Record<string, string | number> = {};
  for (const input of mode.inputs) {
    const raw = values[input.id];
    if (raw === undefined || raw === "") continue;
    payload[input.id] =
      input.kind === "number" || input.kind === "seed" ? Number(raw) : raw;
  }
  return payload;
}

/** `WorkbenchInput` carries everything `buildInputValuesSchema` needs; `bindings`/`group`/`help` are unused filler (the Workbench never sees them). */
function toInputDefinition(input: WorkbenchInput): InputDefinition {
  const base = {
    id: input.id,
    group: "describe" as const,
    label: input.label,
    help: input.help,
    bindings: [],
  };
  if (input.kind === "text") {
    return {
      ...base,
      kind: "text",
      multiline: input.multiline,
      maxLength: input.maxLength,
      default: input.default,
    };
  }
  if (input.kind === "image_upload") {
    return {
      ...base,
      kind: "image_upload",
      maxSizeMb: input.maxSizeMb,
      maxLongSide: input.maxLongSide,
    };
  }
  if (input.kind === "video_upload") {
    return {
      ...base,
      kind: "video_upload",
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
      kind: "audio_upload",
      maxSizeMb: input.maxSizeMb,
      minDurationMs: input.minDurationMs,
      maxDurationMs: input.maxDurationMs,
      trimmable: input.trimmable,
    };
  }
  if (input.kind === "number") {
    return {
      ...base,
      kind: "number",
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
      kind: "seed",
      max: input.max,
    };
  }
  if (input.kind === "points") {
    // `buildInputValuesSchema`'s points branch only checks the shape of
    // the value itself; `videoInputId`/`widthField`/`heightField`
    // aren't read, so these are filler the same way `bindings` is above.
    return {
      ...base,
      kind: "points",
      videoInputId: input.videoInputId,
      widthField: { nodeId: "", field: "" },
      heightField: { nodeId: "", field: "" },
    };
  }
  return {
    ...base,
    kind: "select",
    options: input.options.map((option) => ({
      id: option.id,
      label: option.label,
      values: [],
    })),
    default: input.default,
  };
}

/** `mode.inputs` ids marked `required` on the server (issue #48), for the client's own `parseInputValues` schema. */
function requiredIdsFor(mode: WorkbenchMode): Set<string> {
  return new Set(
    mode.inputs.filter((input) => input.required).map((input) => input.id),
  );
}

/** Live, client-side validation (issue #46): the same `parseInputValues` schema the server uses, so field issues show before submit. */
export function liveIssuesFor(
  revision: number,
  mode: WorkbenchMode,
  values: Record<string, string>,
): Record<string, string> {
  const schema = parseInputValues(
    String(revision),
    mode.id,
    mode.inputs.map(toInputDefinition),
    requiredIdsFor(mode),
  );
  const result = schema.safeParse(valuesPayload(mode, values));
  if (result.success) return {};
  return Object.fromEntries(
    toInputIssues(result.error).map((issue) => [issue.path, issue.message]),
  );
}
