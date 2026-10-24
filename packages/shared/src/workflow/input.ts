// Inputs bound to Node fields (issue #46): an Admin turns a value-holding
// field into a labelled Input; the Workbench collects a value per Input and
// `buildPrompt` writes it back into every field the Input is bound to.

import { z } from "zod";
import { buildFrozenPrompt } from "./frozen-prompt.js";
import { computePath } from "./path.js";
import { decodePointsValue, resolvePointsPixels } from "./points.js";
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
 * A Video Upload Input (issue #51): takes one video Upload (MP4, MOV,
 * WebM or MKV; H.264, HEVC, VP8, VP9 or AV1). Binds to a loader flagged
 * `video_upload` or to `VHS_LoadVideo`/`VHS_LoadVideoFFmpeg`. Optionally
 * trimmable on a local player; an Upload the browser can't play passes
 * through untrimmed only when it already fits (ADR 0007).
 */
export interface VideoUploadInputDefinition extends InputBase {
  kind: "video_upload";
  /** Whole MB, 1 to the Operator's MAX_UPLOAD_MB. */
  maxSizeMb: number;
  /** The largest allowed width or height in pixels; null for no limit. */
  maxLongSide: number | null;
  minDurationMs: number;
  maxDurationMs: number;
  trimmable: boolean;
}

/**
 * An Audio Upload Input (issue #51): takes one audio Upload (WAV, MP3,
 * FLAC, OGG/Opus or M4A/AAC). Binds to a loader flagged `audio_upload`.
 * Optionally trimmable on a local player.
 */
export interface AudioUploadInputDefinition extends InputBase {
  kind: "audio_upload";
  /** Whole MB, 1 to the Operator's MAX_UPLOAD_MB. */
  maxSizeMb: number;
  minDurationMs: number;
  maxDurationMs: number;
  trimmable: boolean;
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

/** A Node field a Points Input reads from, rather than writes to (issue #52). */
export interface NodeFieldRef {
  nodeId: string;
  field: string;
}

/**
 * A Points Input (issue #52): the user clicks who to replace on the
 * first frame of `videoInputId`'s trimmed Upload, inside the crop
 * `widthField`/`heightField` resolve to. Its value is 1-10 points, each
 * a fraction (0-1) of that first frame; `buildPrompt` resolves
 * `widthField`/`heightField` from the built prompt, reproduces
 * `ImageScale`'s own centre crop and writes the points in whole pixels,
 * as a JSON string, to its one bound field. Like an Upload, it's always
 * required once shown: there's no Workflow-default fallback for "no
 * points".
 */
export interface PointsInputDefinition extends InputBase {
  kind: "points";
  /** The Video Upload Input (on the same Model) whose first frame this picks on. */
  videoInputId: string;
  /** The INT Node field `buildPrompt` reads the crop/scale target width from. */
  widthField: NodeFieldRef;
  /** The INT Node field `buildPrompt` reads the crop/scale target height from. */
  heightField: NodeFieldRef;
}

export type InputDefinition =
  | TextInputDefinition
  | NumberInputDefinition
  | SelectInputDefinition
  | ImageUploadInputDefinition
  | VideoUploadInputDefinition
  | AudioUploadInputDefinition
  | SeedInputDefinition
  | PointsInputDefinition;

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

/**
 * Why a video file breaks a Video Upload Input's limits, or null (issue
 * #51). Size and long side are checked the same way an Image Upload's
 * are; duration is checked against min/max. Dimensions/duration are
 * skipped while still unknown (not yet probed by the server).
 */
export function videoUploadLimitIssue(
  file: {
    size: number;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
  },
  limits: Pick<
    VideoUploadInputDefinition,
    "maxSizeMb" | "maxLongSide" | "minDurationMs" | "maxDurationMs"
  >,
): string | null {
  const sizeOrDimensionIssue = imageUploadLimitIssue(file, limits);
  if (sizeOrDimensionIssue) return sizeOrDimensionIssue;
  if (typeof file.durationMs === "number") {
    if (file.durationMs < limits.minDurationMs) {
      return `is shorter than ${(limits.minDurationMs / 1000).toFixed(1)}s`;
    }
    if (file.durationMs > limits.maxDurationMs) {
      return `is longer than ${(limits.maxDurationMs / 1000).toFixed(1)}s`;
    }
  }
  return null;
}

/** Why an audio file breaks an Audio Upload Input's limits, or null (issue #51): size and duration only, audio has no dimensions. */
export function audioUploadLimitIssue(
  file: { size: number; durationMs?: number | null },
  limits: Pick<
    AudioUploadInputDefinition,
    "maxSizeMb" | "minDurationMs" | "maxDurationMs"
  >,
): string | null {
  if (file.size > limits.maxSizeMb * BYTES_PER_MB) {
    return `is larger than ${limits.maxSizeMb} MB`;
  }
  if (typeof file.durationMs === "number") {
    if (file.durationMs < limits.minDurationMs) {
      return `is shorter than ${(limits.minDurationMs / 1000).toFixed(1)}s`;
    }
    if (file.durationMs > limits.maxDurationMs) {
      return `is longer than ${(limits.maxDurationMs / 1000).toFixed(1)}s`;
    }
  }
  return null;
}

/** Loaders a Video Upload Input may bind to besides a flagged `video_upload` field (issue #51). */
export const VIDEO_LOADER_CLASS_TYPES: ReadonlySet<string> = new Set([
  "VHS_LoadVideo",
  "VHS_LoadVideoFFmpeg",
]);

/** A video Upload's accepted containers, by file extension (issue #51); the real check is ffprobe's at complete. */
export const VIDEO_UPLOAD_EXTENSIONS: readonly string[] = [
  "mp4",
  "mov",
  "webm",
  "mkv",
];

/** An audio Upload's accepted containers, by file extension (issue #51); the real check is ffprobe's at complete. */
export const AUDIO_UPLOAD_EXTENSIONS: readonly string[] = [
  "wav",
  "mp3",
  "flac",
  "ogg",
  "opus",
  "m4a",
  "aac",
];

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
  /** Issue #51: the Backend flags this loader field `video_upload`. */
  videoUpload?: boolean;
  /** Issue #51: the Backend flags this loader field `audio_upload`. */
  audioUpload?: boolean;
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
  if (kind === "video_upload") {
    const spec = ctx.fieldSpecs?.get(node.class_type)?.[field];
    const isVideoLoader = VIDEO_LOADER_CLASS_TYPES.has(node.class_type);
    if (
      !isVideoLoader &&
      (spec ? !spec.videoUpload : typeof value !== "string")
    ) {
      return `field "${field}" on node "${nodeId}" isn't a video upload loader field`;
    }
  }
  if (kind === "audio_upload") {
    const spec = ctx.fieldSpecs?.get(node.class_type)?.[field];
    if (spec ? !spec.audioUpload : typeof value !== "string") {
      return `field "${field}" on node "${nodeId}" isn't an audio upload loader field`;
    }
  }
  if (kind === "points" && typeof value !== "string") {
    return `field "${field}" on node "${nodeId}" isn't a text field`;
  }
  return null;
}

/** Why `ref` can't be a Points Input's Width/Height field, or null (issue #52): must exist, hold a number, and not be link-fed. */
export function validatePointsFieldRef(
  label: "width" | "height",
  ref: NodeFieldRef,
  ctx: BindingValidationContext,
): string | null {
  const node = ctx.workflow[ref.nodeId];
  if (!node)
    return `${label} field's node "${ref.nodeId}" is not in the Workflow`;
  const value = node.inputs[ref.field];
  if (value === undefined) {
    return `${label} field "${ref.field}" is not on node "${ref.nodeId}"`;
  }
  if (isNodeLink(value)) {
    return `${label} field "${ref.field}" on node "${ref.nodeId}" is fed by a link, not a value`;
  }
  const spec = ctx.fieldSpecs?.get(node.class_type)?.[ref.field];
  if (spec ? spec.type !== "INT" : typeof value !== "number") {
    return `${label} field "${ref.field}" on node "${ref.nodeId}" isn't a whole-number (INT) field`;
  }
  return null;
}

/** Validates one Input's own shape and every one of its bindings against `ctx`. `allInputs` is this Model's full Inputs list (issue #52: a Points Input's `videoInputId` must name one of them). */
export function validateInputDefinition(
  input: InputDefinition,
  otherLabels: readonly string[],
  ctx: BindingValidationContext,
  otherIds: readonly string[] = [],
  allInputs: readonly InputDefinition[] = [],
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
  } else if (input.kind === "video_upload" || input.kind === "audio_upload") {
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
      input.kind === "video_upload" &&
      input.maxLongSide !== null &&
      (!Number.isInteger(input.maxLongSide) || input.maxLongSide < 1)
    ) {
      errors.push("max long side must be a whole number of pixels, at least 1");
    }
    if (!Number.isInteger(input.minDurationMs) || input.minDurationMs < 0) {
      errors.push(
        "min duration must be a whole number of milliseconds, at least 0",
      );
    }
    if (
      !Number.isInteger(input.maxDurationMs) ||
      input.maxDurationMs <= input.minDurationMs
    ) {
      errors.push("max duration must be greater than min duration");
    }
  } else if (input.kind === "points") {
    if (input.bindings.length > 1) {
      errors.push("a Points Input binds exactly one field");
    }
    const videoInput = allInputs.find(
      (other) => other.id === input.videoInputId,
    );
    if (!videoInput || videoInput.kind !== "video_upload") {
      errors.push("video Input must be one of this Model's Video Uploads");
    }
    const widthError = validatePointsFieldRef("width", input.widthField, ctx);
    if (widthError) errors.push(widthError);
    const heightError = validatePointsFieldRef(
      "height",
      input.heightField,
      ctx,
    );
    if (heightError) errors.push(heightError);
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
    } else if (
      input.kind === "image_upload" ||
      input.kind === "video_upload" ||
      input.kind === "audio_upload"
    ) {
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
    } else if (input.kind === "points") {
      // Always required, like an Upload: there's no Workflow-default
      // fallback for "no points" (issue #52). The crop-membership check
      // needs the first frame's and the target's pixel sizes, neither
      // known here, so it runs separately (`pointsValidationIssue`) once
      // the built prompt resolves them.
      shape[input.id] = z.string().refine(
        (raw) => {
          const points = decodePointsValue(raw);
          if (!points || points.length < 1 || points.length > 10) {
            return false;
          }
          return points.every(
            (point) =>
              point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1,
          );
        },
        { message: "needs 1-10 points, each within the frame" },
      );
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
  /** Issue #52: a Points Input's referenced video's first-frame pixel size, by Points Input id. */
  frameSizes: Readonly<Record<string, { width: number; height: number }>> = {},
): Workflow {
  const result: Workflow = {};
  for (const [nodeId, node] of Object.entries(workflow)) {
    result[nodeId] = { ...node, inputs: { ...node.inputs } };
  }

  // Points Inputs resolve last, against the final value of their
  // Width/Height fields (which another Input may itself bind), so every
  // other kind is written to `result` first.
  const pointsInputs: PointsInputDefinition[] = [];

  for (const input of inputs) {
    if (input.kind === "points") {
      pointsInputs.push(input);
      continue;
    }
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

  for (const input of pointsInputs) {
    const raw = values[input.id];
    if (typeof raw !== "string" || raw === "") continue;
    const points = decodePointsValue(raw);
    const frameSize = frameSizes[input.id];
    const width =
      result[input.widthField.nodeId]?.inputs[input.widthField.field];
    const height =
      result[input.heightField.nodeId]?.inputs[input.heightField.field];
    if (
      !points ||
      !frameSize ||
      typeof width !== "number" ||
      typeof height !== "number"
    ) {
      continue;
    }
    const pixels = resolvePointsPixels(
      points,
      frameSize.width,
      frameSize.height,
      width,
      height,
    );
    const encoded = JSON.stringify(pixels);
    for (const binding of input.bindings) {
      const node = result[binding.nodeId];
      if (!node) continue;
      node.inputs[binding.field] = encoded;
    }
  }

  return result;
}

/**
 * Builds the prompt a Generation sends (issue #46): each relevant Input's
 * value (or, blank, the Workflow's own value) written into its bound
 * fields, then frozen the same way `buildFrozenPrompt` always has been.
 * `frameSizes` (issue #52) is a Points Input's video's first-frame pixel
 * size, by Points Input id.
 */
export function buildPrompt(
  workflow: Workflow,
  inputs: readonly InputDefinition[],
  values: Record<string, string | number | undefined>,
  outputNodeIds: readonly string[],
  generationId: string,
  frameSizes?: Readonly<Record<string, { width: number; height: number }>>,
) {
  const applied = applyInputValues(workflow, inputs, values, frameSizes);
  return buildFrozenPrompt(applied, outputNodeIds, generationId);
}
