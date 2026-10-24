// Inputs bound to Node fields (issue #46): an Admin turns a value-holding
// field into a labelled Input; the Workbench collects a value per Input and
// `buildPrompt` writes it back into every field the Input is bound to.

import { z } from "zod";
import { buildFrozenPrompt } from "./frozen-prompt.js";
import { computePath } from "./path.js";
import { SEED_UPPER_BOUND, seedBoundFor } from "./seed.js";
import { type NodeFieldValue, type Workflow, isNodeLink } from "./types.js";

export type InputGroup = "describe" | "settings";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where one Input writes: a Node field, snapshotted at save time (issue #46). */
export interface InputBinding {
  nodeId: string;
  field: string;
  classType: string;
  title: string | null;
}

/** One option of a select Input: `values[i]` is written to `bindings[i]`. */
export interface SelectOption {
  id: string;
  label: string;
  values: NodeFieldValue[];
}

interface InputBase {
  id: string;
  group: InputGroup;
  label: string;
  help: string;
  bindings: InputBinding[];
}

export interface TextInputDefinition extends InputBase {
  kind: "text";
  multiline: boolean;
  /** 1-10,000; default 2,000. */
  maxLength: number;
  default: string;
}

export interface NumberInputDefinition extends InputBase {
  kind: "number";
  numberMode: "integer" | "decimal";
  min: number;
  max: number;
  /** > 0; a submitted value must sit on `min + k*step`. */
  step: number;
  default: number | null;
}

export interface SelectInputDefinition extends InputBase {
  kind: "select";
  /** 2-50 options; exactly 2 is shown as a toggle on the Workbench. */
  options: SelectOption[];
  default: string | null;
}

/**
 * An Image Upload Input (issue #50): takes one still image Upload (PNG,
 * JPEG or WebP). Its value is an Upload id; the prompt gets that Upload's
 * Backend file name, `studio/<upload-id>.<ext>` (see {@link uploadFileName}).
 * A shown one is always required.
 */
export interface ImageUploadInputDefinition extends InputBase {
  kind: "image_upload";
  /** Whole MB, 1 to the Operator's MAX_UPLOAD_MB. */
  maxSizeMb: number;
  /** The largest allowed width or height in pixels; null for no limit. */
  maxLongSide: number | null;
}

/**
 * A Model's own Input type (issue #47, ADR 0007): bound to exactly one
 * INT Node field, with no default, at most one per Model. Blank, the
 * studio draws a random seed; set, the user's own. `max` bounds the
 * draw/validation (below {@link SEED_UPPER_BOUND} too); an enabled Model
 * must have it set (checked at enable time, not here).
 */
export interface SeedInputDefinition extends InputBase {
  kind: "seed";
  max: number | null;
}

export type InputDefinition =
  | TextInputDefinition
  | NumberInputDefinition
  | SelectInputDefinition
  | ImageUploadInputDefinition
  | SeedInputDefinition;

export const BYTES_PER_MB = 1024 * 1024;

/** The still image types an Image Upload accepts (issue #50), by MIME type. */
export const IMAGE_UPLOAD_TYPES: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Why a file breaks an Image Upload Input's limits, or null (issue #50).
 * The same check runs on pick (browser), at complete and at submit
 * (server). Dimensions are skipped while still unknown.
 */
export function imageUploadLimitIssue(
  file: { size: number; width?: number | null; height?: number | null },
  limits: Pick<ImageUploadInputDefinition, "maxSizeMb" | "maxLongSide">,
): string | null {
  if (file.size > limits.maxSizeMb * BYTES_PER_MB) {
    return `is larger than ${limits.maxSizeMb} MB`;
  }
  if (
    limits.maxLongSide !== null &&
    typeof file.width === "number" &&
    typeof file.height === "number" &&
    Math.max(file.width, file.height) > limits.maxLongSide
  ) {
    return `is larger than ${limits.maxLongSide} px on its long side`;
  }
  return null;
}

/** An Upload's file name on a Backend, under its `input/studio` folder (issue #50). */
export function uploadFileName(uploadId: string, extension: string): string {
  return `studio/${uploadId}.${extension}`;
}

export function isToggle(input: SelectInputDefinition): boolean {
  return input.options.length === 2;
}

export function fieldKey(nodeId: string, field: string): string {
  return `${nodeId}::${field}`;
}

/** One value-holding (not link-fed) field of a Workflow, a candidate to become an Input. */
export interface BindableField {
  nodeId: string;
  field: string;
  classType: string;
  title: string | null;
  valueType: "string" | "number" | "boolean";
  value: NodeFieldValue;
}

export function listBindableFields(workflow: Workflow): BindableField[] {
  const fields: BindableField[] = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    for (const [field, value] of Object.entries(node.inputs)) {
      if (isNodeLink(value) || value === null || value === undefined) {
        continue;
      }
      fields.push({
        nodeId,
        field,
        classType: node.class_type,
        title: node._meta?.title ?? null,
        valueType: typeof value as "string" | "number" | "boolean",
        value,
      });
    }
  }
  return fields;
}

/**
 * One field's shape, per a Backend's `/object_info` (issue #46): a `COMBO`
 * field carries its allowed `options`, when the Backend reported them (a
 * V3-form COMBO node can omit them).
 */
export interface ComfyFieldSpec {
  type: string;
  options?: readonly string[];
  /** Issue #50: the Backend flags this loader field `image_upload` (ComfyUI's `LoadImage.image`). */
  imageUpload?: boolean;
  /** An INT/FLOAT field's own range and step, when the Backend reports them (issue #49). */
  min?: number;
  max?: number;
  step?: number;
}

export interface BindingValidationContext {
  workflow: Workflow;
  /** Node ids that are a Mode's named output (`filename_prefix` there can't be bound). */
  outputNodeIds: ReadonlySet<string>;
  /** `fieldKey` of every field already bound by another Input. */
  usedFields: ReadonlySet<string>;
  /**
   * A reachable Backend's `/object_info` field shapes, by class type
   * (issue #46). When absent, or a class type/field isn't in it, checks
   * that need it fall back to the Workflow's own JSON value type.
   */
  fieldSpecs?: ReadonlyMap<string, Record<string, ComfyFieldSpec>>;
  /** The Operator's MAX_UPLOAD_MB (issue #50), the ceiling on an Image Upload Input's max size. */
  maxUploadMb?: number;
}

type JsValueKind = "string" | "number" | "boolean";

function comfyTypeToJsKind(type: string): JsValueKind | null {
  switch (type) {
    case "INT":
    case "FLOAT":
      return "number";
    case "STRING":
      return "string";
    case "BOOLEAN":
      return "boolean";
    default:
      return null;
  }
}

function fieldSpecFor(
  ctx: BindingValidationContext,
  binding: InputBinding,
): ComfyFieldSpec | null {
  const classType =
    ctx.workflow[binding.nodeId]?.class_type ?? binding.classType;
  return ctx.fieldSpecs?.get(classType)?.[binding.field] ?? null;
}

/** Refuses a link-fed field, a field already bound elsewhere, an output node's `filename_prefix`, and a type mismatch. */
export function validateBinding(
  kind: InputDefinition["kind"],
  nodeId: string,
  field: string,
  ctx: BindingValidationContext,
): string | null {
  const node = ctx.workflow[nodeId];
  if (!node) return `node "${nodeId}" is not in the Workflow`;

  const value = node.inputs[field];
  if (value === undefined) {
    return `field "${field}" is not on node "${nodeId}"`;
  }
  if (isNodeLink(value)) {
    return `field "${field}" on node "${nodeId}" is fed by a link and can't be an Input`;
  }
  if (field === "filename_prefix" && ctx.outputNodeIds.has(nodeId)) {
    return `"filename_prefix" on an output node can't be bound`;
  }
  if (ctx.usedFields.has(fieldKey(nodeId, field))) {
    return `field "${field}" on node "${nodeId}" is already bound to another Input`;
  }
  if (kind === "text" && typeof value !== "string") {
    return `field "${field}" on node "${nodeId}" isn't a text field`;
  }
  if ((kind === "number" || kind === "seed") && typeof value !== "number") {
    return `field "${field}" on node "${nodeId}" isn't a number field`;
  }
  if (kind === "image_upload") {
    const spec = ctx.fieldSpecs?.get(node.class_type)?.[field];
    if (spec ? !spec.imageUpload : typeof value !== "string") {
      return `field "${field}" on node "${nodeId}" isn't an image upload loader field`;
    }
  }
  return null;
}

/** Validates one Input's own shape and every one of its bindings against `ctx`. */
export function validateInputDefinition(
  input: InputDefinition,
  otherLabels: readonly string[],
  ctx: BindingValidationContext,
  otherIds: readonly string[] = [],
): string[] {
  const errors: string[] = [];

  if (!UUID_RE.test(input.id)) {
    errors.push("id must be a UUID");
  }
  if (otherIds.includes(input.id)) {
    errors.push("id must be unique");
  }
  if (input.label.length < 1 || input.label.length > 60) {
    errors.push("label must be 1-60 characters");
  }
  const lowerLabel = input.label.toLowerCase();
  if (otherLabels.some((label) => label.toLowerCase() === lowerLabel)) {
    errors.push("label must be unique");
  }
  if (input.bindings.length === 0) {
    errors.push("needs at least one bound field");
  }
  for (const binding of input.bindings) {
    const error = validateBinding(
      input.kind,
      binding.nodeId,
      binding.field,
      ctx,
    );
    if (error) errors.push(error);
  }

  if (input.kind === "text") {
    if (input.maxLength < 1 || input.maxLength > 10_000) {
      errors.push("max length must be 1-10,000");
    }
    if (input.default.length > input.maxLength) {
      errors.push("default is longer than max length");
    }
  } else if (input.kind === "number") {
    if (!(input.max > input.min)) {
      errors.push("max must be greater than min");
    }
    if (!(input.step > 0)) {
      errors.push("step must be greater than 0");
    }
    if (
      input.default !== null &&
      (input.default < input.min || input.default > input.max)
    ) {
      errors.push("default must be between min and max");
    }
    if (input.numberMode === "decimal") {
      for (const binding of input.bindings) {
        const spec = fieldSpecFor(ctx, binding);
        if (spec?.type === "INT") {
          errors.push(
            `field "${binding.field}" on node "${binding.nodeId}" is whole (INT); a decimal Input can't bind it`,
          );
        }
      }
    }
  } else if (input.kind === "image_upload") {
    const ceiling = ctx.maxUploadMb ?? Number.POSITIVE_INFINITY;
    if (
      !Number.isInteger(input.maxSizeMb) ||
      input.maxSizeMb < 1 ||
      input.maxSizeMb > ceiling
    ) {
      errors.push(
        Number.isFinite(ceiling)
          ? `max size must be 1-${ceiling} MB`
          : "max size must be a whole number of MB, at least 1",
      );
    }
    if (
      input.maxLongSide !== null &&
      (!Number.isInteger(input.maxLongSide) || input.maxLongSide < 1)
    ) {
      errors.push("max long side must be a whole number of pixels, at least 1");
    }
  } else if (input.kind === "seed") {
    if (input.bindings.length > 1) {
      errors.push("a Seed Input binds exactly one field");
    }
    if (input.max !== null) {
      if (!Number.isInteger(input.max) || input.max < 1) {
        errors.push("max must be a positive whole number");
      } else if (input.max > SEED_UPPER_BOUND) {
        errors.push(`max must be below ${SEED_UPPER_BOUND + 1}`);
      }
    }
    for (const binding of input.bindings) {
      const spec = fieldSpecFor(ctx, binding);
      if (spec?.type === "FLOAT") {
        errors.push(
          `field "${binding.field}" on node "${binding.nodeId}" is a decimal field; a Seed Input needs a whole-number (INT) field`,
        );
      }
    }
  } else {
    if (input.options.length < 2 || input.options.length > 50) {
      errors.push("needs 2-50 options");
    }
    const optionIds = new Set<string>();
    for (const option of input.options) {
      if (option.label.length < 1) {
        errors.push("every option needs a label");
      }
      if (!UUID_RE.test(option.id)) {
        errors.push(`option id "${option.id}" must be a UUID`);
      }
      if (optionIds.has(option.id)) {
        errors.push(`option id "${option.id}" is used more than once`);
      }
      optionIds.add(option.id);
      if (option.values.length !== input.bindings.length) {
        errors.push(
          `option "${option.label}" needs a value for each bound field`,
        );
        continue;
      }
      option.values.forEach((value, valueIndex) => {
        if (value === null) return;
        const binding = input.bindings[valueIndex];
        if (!binding) return;
        const spec = fieldSpecFor(ctx, binding);
        if (spec?.type === "COMBO") {
          // A V3-form COMBO (issue #46) may report no `options` list; skip
          // the choice check rather than refusing every value.
          if (
            spec.options !== undefined &&
            (typeof value !== "string" || !spec.options.includes(value))
          ) {
            errors.push(
              `option "${option.label}" value for "${binding.field}" isn't one of the Backend's choices`,
            );
          }
          return;
        }
        const expectedKind = spec ? comfyTypeToJsKind(spec.type) : null;
        const workflowValue =
          ctx.workflow[binding.nodeId]?.inputs[binding.field];
        const kind =
          expectedKind ??
          (workflowValue !== undefined && !isNodeLink(workflowValue)
            ? (typeof workflowValue as JsValueKind)
            : null);
        if (kind && (typeof value as JsValueKind) !== kind) {
          errors.push(
            `option "${option.label}" value for "${binding.field}" must be a ${kind}`,
          );
        }
      });
    }
    if (
      input.default !== null &&
      !input.options.some((option) => option.id === input.default)
    ) {
      errors.push("default must be one of the options");
    }
  }

  return errors;
}

/** The Inputs relevant to a Mode: at least one binding on its Path. */
export function relevantInputs(
  inputs: readonly InputDefinition[],
  workflow: Workflow,
  outputNodeIds: readonly string[],
  unresolvableFields?: ReadonlySet<string>,
): InputDefinition[] {
  const path = computePath(workflow, outputNodeIds, unresolvableFields);
  return inputs.filter((input) =>
    input.bindings.some((binding) => path.nodeIds.has(binding.nodeId)),
  );
}

function isOnStep(value: number, min: number, step: number): boolean {
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/**
 * The zod object a Mode's relevant Inputs resolve to: strict (an unknown
 * key is a validation error), a number must sit on `min + k*step`, and
 * one-line text turns any line break into a space. An Input is optional
 * (a blank one leaves its fields as the Workflow has them) unless its id
 * is in `requiredIds` (issue #48: this Mode's grid marks it required), or
 * it's an Image Upload, which always takes a required Upload id (issue
 * #50: there's no Workflow-default fallback for a missing file).
 */
export function buildInputValuesSchema(
  inputs: readonly InputDefinition[],
  requiredIds: ReadonlySet<string> = new Set(),
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const input of inputs) {
    const required = requiredIds.has(input.id);
    if (input.kind === "text") {
      let schema: z.ZodTypeAny = required
        ? z.string().min(1).max(input.maxLength)
        : z.string().max(input.maxLength);
      if (!input.multiline) {
        schema = (schema as z.ZodString).transform((value) =>
          value.replace(/\r\n|\r|\n/g, " "),
        );
      }
      shape[input.id] = required ? schema : schema.optional();
    } else if (input.kind === "number") {
      const schema = z
        .number()
        .min(input.min)
        .max(input.max)
        .refine((value) => isOnStep(value, input.min, input.step), {
          message: `must sit on ${input.min} plus a multiple of ${input.step}`,
        })
        .refine(
          (value) => input.numberMode !== "integer" || Number.isInteger(value),
          { message: "must be a whole number" },
        );
      shape[input.id] = required ? schema : schema.optional();
    } else if (input.kind === "image_upload") {
      shape[input.id] = z
        .string({ error: "pick a file" })
        .regex(UUID_RE, { message: "must be an Upload id" });
    } else if (input.kind === "seed") {
      // Count-awareness (seed + count - 1 <= bound) is checked separately
      // by `validateSeedRange` once a Submission's count is known. A Seed
      // is never required (issue #48's grid doesn't offer it a state):
      // blank always means "draw one" (ADR 0007).
      shape[input.id] = z
        .number()
        .int()
        .min(0)
        .max(seedBoundFor(input))
        .optional();
    } else {
      const ids = input.options.map((option) => option.id);
      if (ids.length === 0) {
        shape[input.id] = z.never().optional();
        continue;
      }
      const schema = z.enum(ids as [string, ...string[]]);
      shape[input.id] = required ? schema : schema.optional();
    }
  }

  return z.object(shape).strict();
}

const schemaCache = new Map<
  string,
  z.ZodObject<Record<string, z.ZodTypeAny>>
>();

/**
 * {@link buildInputValuesSchema}, cached per Model revision and Mode
 * (issue #46): both the Workbench form resolver and the submit route call
 * this with the same (revisionId, modeId) for a given page load, so the
 * zod object is only built once. Revisions are immutable, so the cache is
 * never invalidated.
 */
export function parseInputValues(
  revisionId: string,
  modeId: string,
  inputs: readonly InputDefinition[],
  requiredIds: ReadonlySet<string> = new Set(),
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const key = `${revisionId}:${modeId}`;
  const cached = schemaCache.get(key);
  if (cached) return cached;

  const schema = buildInputValuesSchema(inputs, requiredIds);
  schemaCache.set(key, schema);
  return schema;
}

export interface InputIssue {
  path: string;
  code: string;
  message: string;
}

/** Maps a `buildInputValuesSchema` parse failure onto `{ path, code, message }`, per field. */
export function toInputIssues(error: z.ZodError): InputIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

/**
 * Writes each Input's submitted (or default) value into every field it's
 * bound to; a blank/absent Input leaves its fields untouched. An Image
 * Upload's value must already be its Backend file name
 * ({@link uploadFileName}), not the bare Upload id: only the server knows
 * the Upload's extension.
 */
export function applyInputValues(
  workflow: Workflow,
  inputs: readonly InputDefinition[],
  values: Record<string, string | number | undefined>,
): Workflow {
  const result: Workflow = {};
  for (const [nodeId, node] of Object.entries(workflow)) {
    result[nodeId] = { ...node, inputs: { ...node.inputs } };
  }

  for (const input of inputs) {
    const raw = values[input.id];
    if (input.kind === "select") {
      const optionId =
        typeof raw === "string" && raw.length > 0 ? raw : input.default;
      if (!optionId) continue;
      const option = input.options.find((o) => o.id === optionId);
      if (!option) continue;
      input.bindings.forEach((binding, index) => {
        const node = result[binding.nodeId];
        if (!node) return;
        node.inputs[binding.field] = option.values[index] ?? null;
      });
      continue;
    }

    if (input.kind === "seed") {
      if (raw === undefined || raw === "") continue;
      for (const binding of input.bindings) {
        const node = result[binding.nodeId];
        if (!node) continue;
        node.inputs[binding.field] = raw;
      }
      continue;
    }

    const value =
      raw === undefined || raw === ""
        ? input.kind === "text"
          ? input.default || undefined
          : input.kind === "number"
            ? (input.default ?? undefined)
            : undefined
        : raw;
    if (value === undefined) continue;

    for (const binding of input.bindings) {
      const node = result[binding.nodeId];
      if (!node) continue;
      node.inputs[binding.field] = value;
    }
  }

  return result;
}

/**
 * Builds the prompt a Generation sends (issue #46): each relevant Input's
 * value (or, blank, the Workflow's own value) written into its bound
 * fields, then frozen the same way `buildFrozenPrompt` always has been.
 */
export function buildPrompt(
  workflow: Workflow,
  inputs: readonly InputDefinition[],
  values: Record<string, string | number | undefined>,
  outputNodeIds: readonly string[],
  generationId: string,
) {
  const applied = applyInputValues(workflow, inputs, values);
  return buildFrozenPrompt(applied, outputNodeIds, generationId);
}
