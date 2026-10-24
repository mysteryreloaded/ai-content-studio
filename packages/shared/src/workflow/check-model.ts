// checkModel (issue #49): a pure, live rail of every error and warning on
// a Model as an Admin edits it. Takes the Model's own data (Workflow,
// Inputs, Modes) plus each attached Backend's `/object_info` knowledge —
// nothing here makes a network call, so the Workbench editor can run it
// on every keystroke the same way it already runs computeModePath and
// resolveModeInputs. Checks for Uploads and points are added by their own
// tickets (issue #50/#51 and friends).

import {
  type BindingValidationContext,
  type ComfyFieldSpec,
  type InputDefinition,
  fieldKey,
  validateInputDefinition,
} from "./input.js";
import {
  type ModeInputSetting,
  applyModeFixedValues,
  computeModePath,
  modeInputSetting,
  resolveModeInputs,
  resolveModeOutputNodes,
  validateModeInputSettings,
  visibleModeBoundFields,
} from "./mode.js";
import type { Workflow } from "./types.js";

export type IssueSeverity = "error" | "warning";

export interface ModelIssue {
  severity: IssueSeverity;
  message: string;
  /** The Mode this issue is about, when it's Mode-specific. */
  modeId?: string;
  /** The Input this issue is about, when it's Input-specific. */
  inputId?: string;
  /** The Backend this issue is about, when it's Backend-specific. */
  backendId?: string;
}

/** One attached Backend's `/object_info` knowledge (issue #49), gathered by the server, passed in whole. */
export interface CheckModelBackend {
  id: string;
  name: string;
  enabled: boolean;
  /** False when this Backend's node knowledge isn't known right now (unreachable); it's then skipped with a warning. */
  reachable: boolean;
  nodeTypes: ReadonlySet<string>;
  fieldSpecs: ReadonlyMap<string, Record<string, ComfyFieldSpec>>;
}

/**
 * classType -> the node pack it ships in (ADR-0010: "static data shipped
 * with the studio, not inferred from `object_info`" — a Backend missing
 * a node class can't report that node's own pack). Grows as more node
 * classes are identified, same spirit as `mode.ts`'s `SAVE_NODE_KINDS`.
 */
export const NODE_PACKS: Readonly<Record<string, string>> = {
  CheckpointLoaderSimple: "ComfyUI core",
  CLIPTextEncode: "ComfyUI core",
  EmptyLatentImage: "ComfyUI core",
  KSampler: "ComfyUI core",
  VAEDecode: "ComfyUI core",
  VAEEncode: "ComfyUI core",
  SaveImage: "ComfyUI core",
  SaveAnimatedPNG: "ComfyUI core",
  SaveAnimatedWEBP: "ComfyUI core",
  SaveAudio: "ComfyUI core",
  SaveAudioMP3: "ComfyUI core",
  SaveAudioOpus: "ComfyUI core",
  LoadImage: "ComfyUI core",
  PreviewImage: "ComfyUI core",
  PreviewAudio: "ComfyUI core",
  PreviewAny: "ComfyUI core",
  Preview3D: "ComfyUI core",
  ControlNetLoader: "ComfyUI core",
  LoraLoader: "ComfyUI core",
  UpscaleModelLoader: "ComfyUI core",
  VHS_VideoCombine: "ComfyUI-VideoHelperSuite",
  VHS_VideoPreview: "ComfyUI-VideoHelperSuite",
  MaskPreview: "ComfyUI-VideoHelperSuite",
  SaveVideo: "ComfyUI core",
  SaveWEBM: "ComfyUI core",
  LTXVConditioning: "ComfyUI-LTXVideo",
};

function packForClassType(classType: string): string | null {
  return NODE_PACKS[classType] ?? null;
}

export interface CheckModelMode {
  id: string;
  name: string;
  outputNodeIds: readonly string[];
  /**
   * Each output node's classType as last resolved and saved, keyed by
   * node id, when known (ADR-0010, CEO review on issue #71): a
   * re-uploaded Workflow can keep a node id in place while giving it a
   * different class (e.g. a SaveImage swapped for a VHS_VideoCombine),
   * silently turning a Mode that saved images into one that now runs a
   * video save node under a stale "image" `kind`. Omit it (fresh output
   * node picks, not yet saved) to skip this check.
   */
  outputNodeClassTypes?: Readonly<Record<string, string>>;
  inputSettings: readonly ModeInputSetting[];
}

export interface CheckModelInput {
  workflow: Workflow;
  inputs: readonly InputDefinition[];
  modes: readonly CheckModelMode[];
}

function isOnStep(value: number, min: number, step: number): boolean {
  if (step <= 0) return true;
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** This Mode's Workflow and Path, with its fixed Input values applied (ADR 0001/issue #48). */
function pathFor(model: CheckModelInput, mode: CheckModelMode) {
  const workflow = applyModeFixedValues(
    model.workflow,
    model.inputs,
    mode.inputSettings,
  );
  const unresolvable = visibleModeBoundFields(mode.inputSettings, model.inputs);
  const path = computeModePath(workflow, mode.outputNodeIds, unresolvable);
  return { workflow, path };
}

/** The class types on `mode`'s Path, resolved against its own Workflow (fixed values applied). */
function pathClassTypes(
  workflow: Workflow,
  nodeIds: ReadonlySet<string>,
): Set<string> {
  const types = new Set<string>();
  for (const nodeId of nodeIds) {
    const classType = workflow[nodeId]?.class_type;
    if (classType) types.add(classType);
  }
  return types;
}

export interface ModeBackendGap {
  backendId: string;
  backendName: string;
  /** The first node class type on this Mode's Path that `backend` doesn't report, or null when it's unreachable. */
  missingNodeType: string | null;
  /** That node's pack, when any reachable Backend's `/object_info` reports it. */
  pack: string | null;
}

/**
 * Per attached Backend, why it can't run `mode` (issue #49's Backends
 * section: "Can't run Outpaint: missing X (pack Y)"). Omits a Backend
 * that can run it. The pack name comes from `NODE_PACKS` (ADR-0010), not
 * from any Backend's own `/object_info` — the Backend missing the node
 * is, definitionally, not the one that could report its pack.
 */
export function modeBackendGaps(
  model: CheckModelInput,
  mode: CheckModelMode,
  backends: readonly CheckModelBackend[],
): ModeBackendGap[] {
  const { workflow, path } = pathFor(model, mode);
  const classTypes = pathClassTypes(workflow, path.nodeIds);

  const gaps: ModeBackendGap[] = [];
  for (const backend of backends) {
    if (!backend.reachable) {
      gaps.push({
        backendId: backend.id,
        backendName: backend.name,
        missingNodeType: null,
        pack: null,
      });
      continue;
    }
    const missing = [...classTypes].find((ct) => !backend.nodeTypes.has(ct));
    if (missing === undefined) continue;
    gaps.push({
      backendId: backend.id,
      backendName: backend.name,
      missingNodeType: missing,
      pack: packForClassType(missing),
    });
  }
  return gaps;
}

/** `fieldKey` -> every `ComfyFieldSpec` reported for it, across `backends` (merged the same way `updateInputs`'s route does for enabled Backends). */
function mergedFieldSpecs(
  backends: readonly CheckModelBackend[],
): Map<string, Record<string, ComfyFieldSpec>> {
  const merged = new Map<string, Record<string, ComfyFieldSpec>>();
  for (const backend of backends) {
    if (!backend.enabled || !backend.reachable) continue;
    for (const [classType, fields] of backend.fieldSpecs) {
      merged.set(classType, { ...merged.get(classType), ...fields });
    }
  }
  return merged;
}

/**
 * Every error and warning on this Model (issue #49): a pure function of
 * its own data and its attached Backends' `/object_info` knowledge. The
 * editor rail calls this live on every edit; `checkEnableReadiness`
 * (server) and the modes/inputs save routes call it to decide whether an
 * enabled Model can still be saved without disabling it first.
 */
export function checkModel(
  model: CheckModelInput,
  backends: readonly CheckModelBackend[],
): ModelIssue[] {
  const issues: ModelIssue[] = [];

  if (model.modes.length === 0) {
    issues.push({ severity: "error", message: "needs at least one Mode" });
  }
  if (backends.length === 0) {
    issues.push({
      severity: "error",
      message: "needs at least one attached Backend",
    });
  }

  const unreachable = backends.filter((b) => !b.reachable);
  for (const backend of unreachable) {
    issues.push({
      severity: "warning",
      message: `Backend "${backend.name}" is unreachable and skipped in these checks`,
      backendId: backend.id,
    });
  }

  // Two Inputs on a field, outside bindings, select/number defaults,
  // and anything else validateInputDefinition already knows how to say
  // (issue #46): reused wholesale rather than re-implemented per field.
  const allOutputNodeIds = new Set(
    model.modes.flatMap((mode) => mode.outputNodeIds),
  );
  const usedFields = new Set<string>();
  const labelsSoFar: string[] = [];
  const idsSoFar: string[] = [];
  const fieldSpecs = mergedFieldSpecs(backends);

  for (const input of model.inputs) {
    const ctx: BindingValidationContext = {
      workflow: model.workflow,
      outputNodeIds: allOutputNodeIds,
      usedFields,
      fieldSpecs,
    };
    for (const message of validateInputDefinition(
      input,
      labelsSoFar,
      ctx,
      idsSoFar,
    )) {
      issues.push({ severity: "error", message, inputId: input.id });
    }
    labelsSoFar.push(input.label);
    idsSoFar.push(input.id);
    for (const binding of input.bindings) {
      usedFields.add(fieldKey(binding.nodeId, binding.field));
    }

    if (input.kind === "number") {
      for (const binding of input.bindings) {
        const classType =
          model.workflow[binding.nodeId]?.class_type ?? binding.classType;
        const spec = fieldSpecs.get(classType)?.[binding.field];
        if (!spec || (spec.type !== "INT" && spec.type !== "FLOAT")) continue;

        if (
          (spec.min !== undefined && input.min < spec.min) ||
          (spec.max !== undefined && input.max > spec.max)
        ) {
          issues.push({
            severity: "error",
            message: `"${input.label}"'s range is outside "${binding.field}"'s own range (${spec.min ?? "-∞"} to ${spec.max ?? "∞"})`,
            inputId: input.id,
          });
        }

        if (
          spec.type === "INT" &&
          spec.step !== undefined &&
          spec.step > 1 &&
          spec.min !== undefined &&
          (!isOnStep(input.min, spec.min, spec.step) ||
            !isOnStep(input.step, 0, spec.step))
        ) {
          issues.push({
            severity: "error",
            message: `"${input.label}": this field takes ${spec.min} + a multiple of ${spec.step}`,
            inputId: input.id,
          });
        }
      }
    }
  }

  const seedCount = model.inputs.filter((i) => i.kind === "seed").length;
  if (seedCount > 1) {
    issues.push({
      severity: "error",
      message: "a Model can have at most one Seed Input",
    });
  }

  // Duplicate Modes (ADR-0010): two Modes with the same Path and the same
  // fixed values are indistinguishable to a user, making one of them
  // dead weight on the Workbench's menu.
  const seenPaths = new Set<string>();
  for (const mode of model.modes) {
    if (mode.outputNodeIds.length === 0) continue;
    const { path } = pathFor(model, mode);
    const fixed = resolveModeInputs(
      model.inputs,
      mode.inputSettings,
    ).fixedValues;
    const key = JSON.stringify([
      [...path.nodeIds].sort(),
      Object.entries(fixed).sort(([a], [b]) => a.localeCompare(b)),
    ]);
    if (seenPaths.has(key)) {
      issues.push({
        severity: "warning",
        message: `Mode "${mode.name}" has the same Path and fixed values as another Mode`,
        modeId: mode.id,
      });
    } else {
      seenPaths.add(key);
    }
  }

  for (const mode of model.modes) {
    const outcome = resolveModeOutputNodes(model.workflow, mode.outputNodeIds);
    if (!outcome.ok) {
      for (const message of outcome.errors) {
        issues.push({ severity: "error", message, modeId: mode.id });
      }
      continue;
    }

    for (const message of validateModeInputSettings(
      mode.inputSettings,
      model.inputs,
    )) {
      issues.push({ severity: "error", message, modeId: mode.id });
    }

    if (mode.outputNodeClassTypes) {
      for (const node of outcome.outputNodes) {
        const savedClassType = mode.outputNodeClassTypes[node.nodeId];
        if (savedClassType !== undefined && savedClassType !== node.classType) {
          issues.push({
            severity: "error",
            message: `Mode "${mode.name}"'s output node "${node.nodeId}" is now a ${node.classType}, not the ${savedClassType} it was saved against; rebind it`,
            modeId: mode.id,
          });
        }
      }
    }

    const { workflow, path } = pathFor(model, mode);

    for (const input of model.inputs) {
      const setting = modeInputSetting(mode.inputSettings, input.id);
      if (setting.state === "hidden") continue;
      const onPath = input.bindings.some((binding) =>
        path.nodeIds.has(binding.nodeId),
      );
      if (onPath) continue;
      issues.push({
        severity: "warning",
        message:
          setting.state === "fixed"
            ? `"${input.label}" is fixed on Mode "${mode.name}" but isn't on its Path`
            : `"${input.label}" is shown on Mode "${mode.name}" but isn't on its Path`,
        modeId: mode.id,
        inputId: input.id,
      });
    }

    // Issue #52: unlike a Points Input's own (write) binding, checked
    // generically just above, its Width/Height fields are only ever
    // *read*; a Mode can still show the Input while one of them sits
    // off that Mode's Path, which would resolve against whatever the
    // Workflow's node there happens to hold, not this Mode's own run.
    for (const input of model.inputs) {
      if (input.kind !== "points") continue;
      const setting = modeInputSetting(mode.inputSettings, input.id);
      if (setting.state === "hidden") continue;
      if (!path.nodeIds.has(input.widthField.nodeId)) {
        issues.push({
          severity: "error",
          message: `"${input.label}"'s Width field is off Mode "${mode.name}"'s Path`,
          modeId: mode.id,
          inputId: input.id,
        });
      }
      if (!path.nodeIds.has(input.heightField.nodeId)) {
        issues.push({
          severity: "error",
          message: `"${input.label}"'s Height field is off Mode "${mode.name}"'s Path`,
          modeId: mode.id,
          inputId: input.id,
        });
      }
    }

    if (backends.length === 0) continue;

    const classTypes = pathClassTypes(workflow, path.nodeIds);
    const reachableBackends = backends.filter((b) => b.reachable);
    const runnableOn = reachableBackends.filter((backend) =>
      [...classTypes].every((ct) => backend.nodeTypes.has(ct)),
    );

    if (reachableBackends.length > 0 && runnableOn.length === 0) {
      for (const gap of modeBackendGaps(model, mode, reachableBackends)) {
        if (gap.missingNodeType === null) continue;
        issues.push({
          severity: "error",
          message: `Can't run "${mode.name}": missing ${gap.missingNodeType} (pack ${gap.pack ?? "unknown"})`,
          modeId: mode.id,
          backendId: gap.backendId,
        });
      }
    } else if (runnableOn.length < reachableBackends.length) {
      for (const gap of modeBackendGaps(model, mode, reachableBackends)) {
        if (gap.missingNodeType === null) continue;
        issues.push({
          severity: "warning",
          message: `Backend "${gap.backendName}" can't run "${mode.name}": missing ${gap.missingNodeType} (pack ${gap.pack ?? "unknown"})`,
          modeId: mode.id,
          backendId: gap.backendId,
        });
      }
    }
  }

  return issues;
}

/** `true` when any `checkModel` issue is an error (issue #49: errors block enabling and saving an enabled Model). */
export function hasBlockingErrors(issues: readonly ModelIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
