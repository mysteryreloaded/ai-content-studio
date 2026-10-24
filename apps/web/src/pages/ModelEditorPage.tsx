import {
  MODEL_ATTRIBUTION_MAX_LENGTH,
  MODEL_TERMS_MAX_LENGTH,
  applyModeFixedValues,
  checkModel,
  computeModePath,
  fieldKey,
  hasBlockingErrors,
  isValidModelLicenseUrl,
  listBindableFields,
  modeBackendGaps,
  modeInputSetting,
  relevantInputs,
  renderMarkdown,
  resolveModeInputs,
  visibleModeBoundFields,
} from "@ai-content-studio/shared";
import type {
  AudioUploadInputDefinition,
  BindableField,
  CheckModelBackend,
  ImageUploadInputDefinition,
  InputDefinition,
  ModeInputSetting,
  ModeInputState,
  ModelIssue,
  NodeFieldRef,
  NumberInputDefinition,
  PointsInputDefinition,
  SeedInputDefinition,
  SelectInputDefinition,
  SelectOption,
  TextInputDefinition,
  VideoUploadInputDefinition,
  Workflow,
} from "@ai-content-studio/shared";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router-dom";
import { useSession } from "../useSession.js";

interface ModelNode {
  id: string;
  classType: string;
  title: string | null;
}

/** A bound field's own JS value type, for coercing a select option's typed-in value to match it (issue #46). */
function bindingValueKind(
  workflow: Workflow,
  nodeId: string,
  field: string,
): "string" | "number" | "boolean" | null {
  const value = workflow[nodeId]?.inputs[field];
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return null;
  return typeof value as "string" | "number" | "boolean";
}

interface OutsideServiceNote {
  nodeId: string;
  classType: string;
  keySet: boolean;
}

interface ResolvedOutputNode {
  nodeId: string;
  classType: string;
  title: string | null;
  kind: "video" | "image" | "audio" | null;
}

interface ModeRecord {
  id: string;
  sortOrder: number;
  name: string;
  description: string;
  outputNodes: ResolvedOutputNode[];
  inputSettings: ModeInputSetting[];
}

interface DraftMode {
  /** Client-only, stable across re-renders; stripped before saving. */
  key: string;
  name: string;
  description: string;
  outputNodeIds: string[];
  inputSettings: ModeInputSetting[];
}

interface ModelDetail {
  model: {
    id: string;
    name: string;
    slug: string;
    description: string;
    maxRunTimeMinutes: number;
    state: "enabled" | "disabled";
    currentRevision: number;
    version: number;
    termsBody: string;
    licenseUrl: string;
    attribution: string;
    termsVersion: number | null;
    termsVersionCreatedAt: string | null;
    termsRevision: number;
  };
  workflowHash: string;
  workflow: Workflow;
  nodes: ModelNode[];
  outsideServiceNotes: OutsideServiceNote[];
  modes: ModeRecord[];
  inputs: InputDefinition[];
}

/** `pendingWorkflow`'s own nodes, the same shape `detail.nodes` is in, for the rebind picker's node choices (issue #71). */
function nodesFromWorkflow(workflow: Workflow): ModelNode[] {
  return Object.entries(workflow).map(([id, node]) => ({
    id,
    classType: node.class_type,
    title: node._meta?.title ?? null,
  }));
}

/** A broken binding/output's own node id, repointable by the rebind picker (issue #71, CEO review). */
interface BrokenNodeRef {
  nodeId: string;
  description: string;
}

/**
 * Every Mode output node and Input binding whose saved classType no
 * longer matches (or whose node id is gone from) `pendingWorkflow`
 * (issue #71's rebind picker): the same staleness `checkModel` itself
 * flags, surfaced here by node id so each one gets its own picker. One
 * entry per broken node id — the rebind, like the carry-forward it
 * fixes, is "by node id" (ADR-0010).
 */
function findBrokenNodeRefs(
  detail: ModelDetail,
  pendingWorkflow: Workflow,
): BrokenNodeRef[] {
  const broken: BrokenNodeRef[] = [];
  const seen = new Set<string>();

  function isBroken(nodeId: string, savedClassType: string): boolean {
    const node = pendingWorkflow[nodeId];
    return !node || node.class_type !== savedClassType;
  }

  for (const mode of detail.modes) {
    for (const node of mode.outputNodes) {
      if (seen.has(node.nodeId) || !isBroken(node.nodeId, node.classType)) {
        continue;
      }
      seen.add(node.nodeId);
      broken.push({
        nodeId: node.nodeId,
        description: `Mode "${mode.name || "this Mode"}"'s output node "${node.nodeId}" (was ${node.classType})`,
      });
    }
  }
  for (const input of detail.inputs) {
    for (const binding of input.bindings) {
      if (
        seen.has(binding.nodeId) ||
        !isBroken(binding.nodeId, binding.classType)
      ) {
        continue;
      }
      seen.add(binding.nodeId);
      broken.push({
        nodeId: binding.nodeId,
        description: `Input "${input.label || "this Input"}"'s "${binding.field}" binding, node "${binding.nodeId}" (was ${binding.classType})`,
      });
    }
  }
  return broken;
}

/** `detail.modes` turned into `checkModel`'s `CheckModelMode`s, with `rebindMap` applied first: a remapped output node is dropped from the staleness check since it's now fresh (issue #71). */
function checkModelModesFrom(
  modes: ModeRecord[],
  rebindMap: Readonly<Record<string, string>>,
) {
  return modes.map((mode) => ({
    id: mode.id,
    name: mode.name,
    outputNodeIds: mode.outputNodes.map(
      (node) => rebindMap[node.nodeId] ?? node.nodeId,
    ),
    outputNodeClassTypes: Object.fromEntries(
      mode.outputNodes
        .filter((node) => !(node.nodeId in rebindMap))
        .map((node) => [node.nodeId, node.classType]),
    ),
    inputSettings: mode.inputSettings,
  }));
}

/** `detail.inputs` with `rebindMap` applied to each binding's node id (and its snapshotted classType/title) against `workflow` (issue #71). */
function reboundInputsFrom(
  inputs: InputDefinition[],
  workflow: Workflow,
  rebindMap: Readonly<Record<string, string>>,
): InputDefinition[] {
  if (Object.keys(rebindMap).length === 0) return inputs;
  return inputs.map((input) => ({
    ...input,
    bindings: input.bindings.map((binding) => {
      const newNodeId = rebindMap[binding.nodeId];
      if (!newNodeId) return binding;
      const node = workflow[newNodeId];
      return {
        ...binding,
        nodeId: newNodeId,
        classType: node?.class_type ?? binding.classType,
        title: node?._meta?.title ?? null,
      };
    }),
  }));
}

function draftsFrom(detail: ModelDetail): DraftMode[] {
  return detail.modes.map((mode) => ({
    key: mode.id,
    name: mode.name,
    description: mode.description,
    outputNodeIds: mode.outputNodes.map((node) => node.nodeId),
    inputSettings: mode.inputSettings,
  }));
}

/** This Mode's visible (optional/required) bound fields, for `computeModePath`'s unresolvableFields (issue #48). */
function visibleBoundFieldsFor(
  mode: DraftMode,
  inputs: InputDefinition[],
): Set<string> {
  return visibleModeBoundFields(mode.inputSettings, inputs);
}

/**
 * This Mode's Workflow, with its fixed Input values written in (issue
 * #48 CEO review): a fixed value is known before sending (ADR 0001), so
 * every Path computed for display must pick its switch's side the same
 * way the real prompt would.
 */
function workflowForMode(
  mode: DraftMode,
  inputs: InputDefinition[],
  workflow: Workflow,
): Workflow {
  return applyModeFixedValues(workflow, inputs, mode.inputSettings);
}

/** Node ids this Input's bindings touch, to decide which Modes its Path makes "eligible" (issue #48). */
function boundNodeIds(input: InputDefinition): Set<string> {
  return new Set(input.bindings.map((binding) => binding.nodeId));
}

function withoutKey(draft: DraftMode) {
  const { key, ...rest } = draft;
  void key;
  return rest;
}

function sameModes(a: DraftMode[], b: DraftMode[]): boolean {
  return (
    JSON.stringify(a.map(withoutKey)) === JSON.stringify(b.map(withoutKey))
  );
}

function sameInputs(a: InputDefinition[], b: InputDefinition[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function newTextInput(): TextInputDefinition {
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

function newNumberInput(): NumberInputDefinition {
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

function newSeedInput(): SeedInputDefinition {
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

function newSelectInput(): SelectInputDefinition {
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

function newImageUploadInput(): ImageUploadInputDefinition {
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

function newVideoUploadInput(): VideoUploadInputDefinition {
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

function newAudioUploadInput(): AudioUploadInputDefinition {
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

/** A new Points Input (issue #52): no video Input or Width/Height field picked yet. */
function newPointsInput(): PointsInputDefinition {
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

/** `fieldKey` of every field bound by an Input other than `excludingId`. */
function usedFieldKeys(
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
function candidateFieldsFor(
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
function numberFieldsFor(workflow: Workflow): BindableField[] {
  return listBindableFields(workflow).filter(
    (field) => field.valueType === "number",
  );
}

/** Adds or removes a binding, keeping a select Input's option values arrays the same length as its bindings. */
function toggleBinding(
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

interface AdminBackendSummary {
  id: string;
  name: string;
  baseUrl: string;
}

/** `GET /:id/object-info`'s JSON shape (issue #49): a Backend's `/object_info` knowledge, plain enough to send over the wire. */
interface ObjectInfoBackendJson {
  id: string;
  name: string;
  enabled: boolean;
  reachable: boolean;
  nodeTypes: string[];
  fieldSpecs: Record<string, Record<string, unknown>>;
}

/** Turns `object-info`'s JSON back into `checkModel`'s `CheckModelBackend`s, so the rail runs live, client-side. */
function toCheckModelBackends(
  backends: ObjectInfoBackendJson[],
): CheckModelBackend[] {
  return backends.map((backend) => ({
    id: backend.id,
    name: backend.name,
    enabled: backend.enabled,
    reachable: backend.reachable,
    nodeTypes: new Set(backend.nodeTypes),
    fieldSpecs: new Map(
      Object.entries(backend.fieldSpecs),
    ) as CheckModelBackend["fieldSpecs"],
  }));
}

interface AttachedBackendEntry {
  backend: AdminBackendSummary;
  reachable: boolean;
  missingNodeTypes: string[] | null;
  note: string | null;
}

interface DetailsForm {
  name: string;
  slug: string;
  description: string;
  maxRunTimeMinutes: number;
}

interface ErrorPayload {
  error?: string;
  errors?: { field: string; message: string }[];
}

interface RevisionSummary {
  revisionNumber: number;
  createdAt: string;
  workflowHash: string;
  modeCount: number;
  inputCount: number;
}

async function readFileAsJson(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}

function detailsFrom(detail: ModelDetail): DetailsForm {
  return {
    name: detail.model.name,
    slug: detail.model.slug,
    description: detail.model.description,
    maxRunTimeMinutes: detail.model.maxRunTimeMinutes,
  };
}

function sameDetails(a: DetailsForm, b: DetailsForm): boolean {
  return (
    a.name === b.name &&
    a.slug === b.slug &&
    a.description === b.description &&
    a.maxRunTimeMinutes === b.maxRunTimeMinutes
  );
}

interface TermsForm {
  termsBody: string;
  licenseUrl: string;
  attribution: string;
}

function termsFrom(detail: ModelDetail): TermsForm {
  return {
    termsBody: detail.model.termsBody,
    licenseUrl: detail.model.licenseUrl,
    attribution: detail.model.attribution,
  };
}

function sameTerms(a: TermsForm, b: TermsForm): boolean {
  return (
    a.termsBody === b.termsBody &&
    a.licenseUrl === b.licenseUrl &&
    a.attribution === b.attribution
  );
}

/** The message for a failed save: field errors, then the server's own `error` (a stale version, a taken name/slug, ...), else a fallback. */
async function messageFrom(res: Response, fallback: string): Promise<string> {
  const payload: ErrorPayload = await res.json().catch(() => ({}));
  const issues = payload.errors
    ?.map((e) => `${e.field}: ${e.message}`)
    .join(", ");
  return issues ?? payload.error ?? fallback;
}

/** The Model editor: Details, and the Workflow's nodes with a filter (issue #40). */
export function ModelEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useSession();
  const maxUploadMb =
    session.status === "signed-in" ? session.user.maxUploadMb : undefined;

  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<DetailsForm | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [nodeFilter, setNodeFilter] = useState("");
  const [attachedBackends, setAttachedBackends] = useState<
    AttachedBackendEntry[] | null
  >(null);
  const [backendsLoadError, setBackendsLoadError] = useState<string | null>(
    null,
  );
  const [allBackends, setAllBackends] = useState<AdminBackendSummary[] | null>(
    null,
  );
  // null until the first successful load (issue #49 CEO review): checkModel
  // treats an empty Backend list as an error, so staying null — rather than
  // defaulting to [] — keeps the rail from flagging a healthy Model as
  // backend-less while /object-info is still in flight or has failed.
  const [objectInfo, setObjectInfo] = useState<ObjectInfoBackendJson[] | null>(
    null,
  );
  const [attachBackendId, setAttachBackendId] = useState("");
  const [attachError, setAttachError] = useState<string | null>(null);
  const [modesDraft, setModesDraft] = useState<DraftMode[] | null>(null);
  const [editingModeIndex, setEditingModeIndex] = useState<number | null>(null);
  const [modesSaveError, setModesSaveError] = useState<string | null>(null);
  const [savingModes, setSavingModes] = useState(false);
  const [inputsDraft, setInputsDraft] = useState<InputDefinition[] | null>(
    null,
  );
  const [editingInputIndex, setEditingInputIndex] = useState<number | null>(
    null,
  );
  const [newInputKind, setNewInputKind] =
    useState<InputDefinition["kind"]>("text");
  const [inputsSaveError, setInputsSaveError] = useState<string | null>(null);
  const [savingInputs, setSavingInputs] = useState(false);
  const [stateError, setStateError] = useState<string[] | null>(null);
  const [togglingState, setTogglingState] = useState(false);
  const [termsForm, setTermsForm] = useState<TermsForm | null>(null);
  const [askAgain, setAskAgain] = useState(false);
  const [savingTerms, setSavingTerms] = useState(false);
  const [termsSaveError, setTermsSaveError] = useState<string | null>(null);
  // Issue #71: a re-uploaded Workflow file lives only in the editor
  // (parsed client-side) until "Replace Workflow" sends it in one PUT —
  // there's no separate server-side draft.
  const [pendingWorkflow, setPendingWorkflow] = useState<unknown | null>(null);
  const [pendingWorkflowFileName, setPendingWorkflowFileName] = useState<
    string | null
  >(null);
  const [workflowUploadError, setWorkflowUploadError] = useState<string | null>(
    null,
  );
  const [uploadingWorkflow, setUploadingWorkflow] = useState(false);
  // Issue #71's rebind picker (CEO review): old node id -> the picked
  // Workflow's node id it's repointed onto, for the Mode outputs/Input
  // bindings `findBrokenNodeRefs` flags. Reset whenever a different file
  // is picked, since the broken node ids it answers for change too.
  const [rebindMap, setRebindMap] = useState<Record<string, string>>({});
  const [revisions, setRevisions] = useState<RevisionSummary[] | null>(null);
  const [revisionsLoadError, setRevisionsLoadError] = useState<string | null>(
    null,
  );
  const [restoringRevision, setRestoringRevision] = useState<number | null>(
    null,
  );
  const [restoreErrors, setRestoreErrors] = useState<Record<number, string>>(
    {},
  );
  // Set right before navigating away after a successful delete: `dirty`
  // is still computed from this render's (pre-setForm(null)) state when
  // the blocker runs, since state updates haven't flushed yet, so without
  // this it would ask "Discard unsaved changes?" a second time right
  // after the Admin already confirmed the delete itself.
  const bypassBlockerRef = useRef(false);
  // issue #48 AC3: a new Model (no Inputs yet) opens on the Inputs
  // section; one that already has Inputs opens on Modes instead, with
  // its first Mode's sheet expanded. Only the first load of a given
  // Model decides this — a reload after Save shouldn't yank the page
  // back or collapse what the Admin has open.
  const didInitialOpenRef = useRef(false);
  const inputsHeadingRef = useRef<HTMLHeadingElement>(null);
  const modesHeadingRef = useRef<HTMLHeadingElement>(null);

  function load() {
    if (!id) return;
    fetch(`/api/admin/models/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<ModelDetail>;
      })
      .then((body) => {
        setDetail(body);
        setForm(detailsFrom(body));
        setModesDraft(draftsFrom(body));
        setEditingModeIndex(null);
        setModesSaveError(null);
        setInputsDraft(body.inputs);
        setEditingInputIndex(null);
        setInputsSaveError(null);
        setStateError(null);
        setLoadError(null);
        setTermsForm(termsFrom(body));
        setAskAgain(false);
        setTermsSaveError(null);
      })
      .catch(() => setLoadError("could not load this Model"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the route's :id changes
  useEffect(load, [id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a different :id gets its own "open on" decision
  useEffect(() => {
    didInitialOpenRef.current = false;
  }, [id]);

  useEffect(() => {
    if (!detail || didInitialOpenRef.current) return;
    didInitialOpenRef.current = true;
    if ((detail.inputs ?? []).length === 0) {
      inputsHeadingRef.current?.scrollIntoView({ block: "start" });
    } else {
      setEditingModeIndex(detail.modes.length > 0 ? 0 : null);
      modesHeadingRef.current?.scrollIntoView({ block: "start" });
    }
  }, [detail]);

  function loadAttachedBackends() {
    if (!id) return;
    fetch(`/api/admin/models/${id}/backends`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ backends: AttachedBackendEntry[] }>;
      })
      .then((body) => {
        setAttachedBackends(body.backends);
        setBackendsLoadError(null);
      })
      .catch(() => setBackendsLoadError("could not load Backends"));
  }

  /** `/object-info` (issue #49): each attached Backend's node knowledge, for the live rail. */
  function loadObjectInfo() {
    if (!id) return;
    fetch(`/api/admin/models/${id}/object-info`)
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ backends: ObjectInfoBackendJson[] }>)
          : null,
      )
      .then((body) => {
        if (body) setObjectInfo(body.backends);
      })
      .catch(() => {
        /* the rail just runs without Backend-aware checks */
      });
  }

  function loadAllBackends() {
    fetch("/api/admin/backends")
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ backends: AdminBackendSummary[] }>)
          : null,
      )
      .then((body) => {
        if (body) setAllBackends(body.backends);
      })
      .catch(() => {
        /* the "attach" picker just stays empty */
      });
  }

  /** Issue #71: every numbered revision, for the Revisions section. */
  function loadRevisions() {
    if (!id) return;
    fetch(`/api/admin/models/${id}/revisions`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ revisions: RevisionSummary[] }>;
      })
      .then((body) => {
        setRevisions(body.revisions);
        setRevisionsLoadError(null);
      })
      .catch(() => setRevisionsLoadError("could not load revisions"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the route's :id changes
  useEffect(() => {
    loadAttachedBackends();
    loadAllBackends();
    loadObjectInfo();
    loadRevisions();
  }, [id]);

  async function handlePickWorkflowFile(file: File | null) {
    setWorkflowUploadError(null);
    setRebindMap({});
    if (!file) {
      setPendingWorkflow(null);
      setPendingWorkflowFileName(null);
      return;
    }
    try {
      setPendingWorkflow(await readFileAsJson(file));
      setPendingWorkflowFileName(file.name);
    } catch {
      setPendingWorkflow(null);
      setPendingWorkflowFileName(null);
      setWorkflowUploadError("that file isn't valid JSON");
    }
  }

  function setRebind(nodeId: string, newNodeId: string) {
    setRebindMap((prev) => {
      if (newNodeId === "") {
        const { [nodeId]: _removed, ...rest } = prev;
        void _removed;
        return rest;
      }
      return { ...prev, [nodeId]: newNodeId };
    });
  }

  async function handleReplaceWorkflow() {
    if (!detail || pendingWorkflow === null) return;
    setUploadingWorkflow(true);
    setWorkflowUploadError(null);

    const rebind = Object.entries(rebindMap).map(([nodeId, newNodeId]) => ({
      nodeId,
      newNodeId,
    }));

    try {
      const res = await fetch(`/api/admin/models/${detail.model.id}/workflow`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: detail.model.version,
          workflow: pendingWorkflow,
          ...(rebind.length > 0 ? { rebind } : {}),
          ...(mustDisableToSaveWorkflow ? { disable: true } : {}),
        }),
      });

      if (!res.ok) {
        setWorkflowUploadError(await messageFrom(res, "upload failed"));
        return;
      }

      setPendingWorkflow(null);
      setPendingWorkflowFileName(null);
      setRebindMap({});
      load();
      loadRevisions();
    } finally {
      setUploadingWorkflow(false);
    }
  }

  async function handleRestoreRevision(
    revisionNumber: number,
    disable: boolean,
  ) {
    if (!detail) return;
    setRestoringRevision(revisionNumber);
    setRestoreErrors((prev) => {
      const next = { ...prev };
      delete next[revisionNumber];
      return next;
    });

    try {
      const res = await fetch(
        `/api/admin/models/${detail.model.id}/revisions/${revisionNumber}/restore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: detail.model.version,
            ...(disable ? { disable: true } : {}),
          }),
        },
      );

      if (!res.ok) {
        const message = await messageFrom(res, "restore failed");
        setRestoreErrors((prev) => ({ ...prev, [revisionNumber]: message }));
        return;
      }

      load();
      loadRevisions();
    } finally {
      setRestoringRevision(null);
    }
  }

  async function handleAttach(event: FormEvent) {
    event.preventDefault();
    if (!detail || !attachBackendId) return;
    setAttachError(null);

    const res = await fetch(`/api/admin/models/${detail.model.id}/backends`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backendId: attachBackendId }),
    });

    if (!res.ok) {
      setAttachError(await messageFrom(res, "could not attach this Backend"));
      return;
    }

    setAttachBackendId("");
    loadAttachedBackends();
    loadObjectInfo();
  }

  async function handleDetach(backendId: string) {
    if (!detail) return;
    await fetch(`/api/admin/models/${detail.model.id}/backends/${backendId}`, {
      method: "DELETE",
    });
    loadAttachedBackends();
    loadObjectInfo();
  }

  function addMode() {
    if (!modesDraft) return;
    setModesDraft([
      ...modesDraft,
      {
        key: crypto.randomUUID(),
        name: "",
        description: "",
        outputNodeIds: [],
        inputSettings: [],
      },
    ]);
    setEditingModeIndex(modesDraft.length);
  }

  function removeMode(index: number) {
    if (!modesDraft) return;
    setModesDraft(modesDraft.filter((_, i) => i !== index));
    if (editingModeIndex === index) setEditingModeIndex(null);
  }

  function updateMode(index: number, patch: Partial<DraftMode>) {
    if (!modesDraft) return;
    setModesDraft(
      modesDraft.map((mode, i) => (i === index ? { ...mode, ...patch } : mode)),
    );
  }

  /** Duplicates Mode `index` right after it, as a fresh (unsaved) Mode (issue #48). */
  function duplicateMode(index: number) {
    if (!modesDraft) return;
    const mode = modesDraft[index];
    if (!mode) return;
    const copy: DraftMode = {
      ...mode,
      key: crypto.randomUUID(),
      name: `${mode.name} copy`.slice(0, 60),
    };
    setModesDraft([
      ...modesDraft.slice(0, index + 1),
      copy,
      ...modesDraft.slice(index + 1),
    ]);
  }

  /** Sets Mode `modeIndex`'s setting for `inputId` (issue #48's grid cell). */
  function setModeInputSetting(
    modeIndex: number,
    inputId: string,
    patch: Partial<ModeInputSetting>,
  ) {
    if (!modesDraft) return;
    const mode = modesDraft[modeIndex];
    if (!mode) return;
    const current = modeInputSetting(mode.inputSettings, inputId);
    const next: ModeInputSetting = { ...current, ...patch };
    const withoutThisInput = mode.inputSettings.filter(
      (s) => s.inputId !== inputId,
    );
    updateMode(modeIndex, {
      inputSettings: [...withoutThisInput, next],
    });
  }

  /** "Apply to every Mode whose Path holds this Input" (issue #48): copies `inputId`'s setting onto every other Mode whose output nodes depend on one of its bound fields. */
  function applySettingToEveryEligibleMode(
    sourceIndex: number,
    input: InputDefinition,
  ) {
    if (!detail || !modesDraft) return;
    const setting = modeInputSetting(
      (modesDraft[sourceIndex] as DraftMode).inputSettings,
      input.id,
    );
    const nodeIds = boundNodeIds(input);
    setModesDraft(
      modesDraft.map((mode, i) => {
        if (i === sourceIndex) return mode;
        if (mode.outputNodeIds.length === 0) return mode;
        const path = computeModePath(
          workflowForMode(mode, detail.inputs ?? [], detail.workflow),
          mode.outputNodeIds,
          visibleBoundFieldsFor(mode, detail.inputs ?? []),
        );
        const onPath = [...nodeIds].some((id) => path.nodeIds.has(id));
        if (!onPath) return mode;
        return {
          ...mode,
          inputSettings: [
            ...mode.inputSettings.filter((s) => s.inputId !== input.id),
            { ...setting },
          ],
        };
      }),
    );
  }

  /** Toggles `nodeId` in and out of the currently *picking* Mode's output nodes (the Workflow table's Add/Remove button). */
  function toggleOutputNodeInEditingMode(nodeId: string) {
    if (editingModeIndex === null || !modesDraft) return;
    const mode = modesDraft[editingModeIndex];
    if (!mode) return;
    const outputNodeIds = mode.outputNodeIds.includes(nodeId)
      ? mode.outputNodeIds.filter((id) => id !== nodeId)
      : [...mode.outputNodeIds, nodeId];
    updateMode(editingModeIndex, { outputNodeIds });
  }

  /** Removes `nodeId` from Mode `index`'s own output-node list, regardless of which Mode is currently being picked. */
  function removeOutputNode(index: number, nodeId: string) {
    if (!modesDraft) return;
    const mode = modesDraft[index];
    if (!mode) return;
    updateMode(index, {
      outputNodeIds: mode.outputNodeIds.filter((id) => id !== nodeId),
    });
  }

  /** Reorders `nodeId` within Mode `index`'s own output-node list, regardless of which Mode is currently being picked. */
  function moveOutputNode(
    index: number,
    nodeId: string,
    direction: "up" | "down",
  ) {
    if (!modesDraft) return;
    const mode = modesDraft[index];
    if (!mode) return;
    const position = mode.outputNodeIds.indexOf(nodeId);
    const swapWith = direction === "up" ? position - 1 : position + 1;
    if (
      position === -1 ||
      swapWith < 0 ||
      swapWith >= mode.outputNodeIds.length
    ) {
      return;
    }
    const outputNodeIds = [...mode.outputNodeIds];
    const a = outputNodeIds[position] as string;
    const b = outputNodeIds[swapWith] as string;
    outputNodeIds[position] = b;
    outputNodeIds[swapWith] = a;
    updateMode(index, { outputNodeIds });
  }

  async function handleSaveModes() {
    if (!detail || !modesDraft) return;
    setSavingModes(true);
    setModesSaveError(null);

    try {
      const currentInputIds = new Set(
        (detail.inputs ?? []).map((input) => input.id),
      );
      const res = await fetch(`/api/admin/models/${detail.model.id}/modes`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: detail.model.version,
          ...(mustDisableToSave ? { disable: true } : {}),
          modes: modesDraft.map(withoutKey).map((mode) => ({
            ...mode,
            inputSettings: mode.inputSettings.filter((s) =>
              currentInputIds.has(s.inputId),
            ),
          })),
        }),
      });

      if (!res.ok) {
        setModesSaveError(await messageFrom(res, "save failed"));
        return;
      }

      load();
    } finally {
      setSavingModes(false);
    }
  }

  function addInput() {
    if (!inputsDraft) return;
    if (newInputKind === "seed" && inputsDraft.some((i) => i.kind === "seed")) {
      return;
    }
    const created =
      newInputKind === "text"
        ? newTextInput()
        : newInputKind === "number"
          ? newNumberInput()
          : newInputKind === "seed"
            ? newSeedInput()
            : newInputKind === "image_upload"
              ? newImageUploadInput()
              : newInputKind === "video_upload"
                ? newVideoUploadInput()
                : newInputKind === "audio_upload"
                  ? newAudioUploadInput()
                  : newInputKind === "points"
                    ? newPointsInput()
                    : newSelectInput();
    setInputsDraft([...inputsDraft, created]);
    setEditingInputIndex(inputsDraft.length);
  }

  function removeInput(index: number) {
    if (!inputsDraft) return;
    setInputsDraft(inputsDraft.filter((_, i) => i !== index));
    if (editingInputIndex === index) setEditingInputIndex(null);
  }

  function updateInput(index: number, next: InputDefinition) {
    if (!inputsDraft) return;
    setInputsDraft(inputsDraft.map((input, i) => (i === index ? next : input)));
  }

  /** Toggles `field` in and out of the currently *picking* Input's bindings. */
  function toggleFieldInEditingInput(field: BindableField) {
    if (editingInputIndex === null || !inputsDraft) return;
    const input = inputsDraft[editingInputIndex];
    if (!input) return;
    updateInput(editingInputIndex, toggleBinding(input, field));
  }

  async function handleSaveInputs() {
    if (!detail || !inputsDraft) return;
    setSavingInputs(true);
    setInputsSaveError(null);

    try {
      const res = await fetch(`/api/admin/models/${detail.model.id}/inputs`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: detail.model.version,
          ...(mustDisableToSave ? { disable: true } : {}),
          inputs: inputsDraft,
        }),
      });

      if (!res.ok) {
        setInputsSaveError(await messageFrom(res, "save failed"));
        return;
      }

      load();
    } finally {
      setSavingInputs(false);
    }
  }

  async function handleToggleState() {
    if (!detail) return;
    setTogglingState(true);
    setStateError(null);
    const endpoint = detail.model.state === "enabled" ? "disable" : "enable";

    try {
      const res = await fetch(
        `/api/admin/models/${detail.model.id}/${endpoint}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: detail.model.version }),
        },
      );

      if (!res.ok) {
        const payload: { error?: string; reasons?: string[] } = await res
          .json()
          .catch(() => ({}));
        setStateError(
          payload.reasons ?? [payload.error ?? "could not change state"],
        );
        return;
      }

      load();
    } finally {
      setTogglingState(false);
    }
  }

  const dirty = Boolean(
    detail && form && !sameDetails(detailsFrom(detail), form),
  );

  const modesDirty = Boolean(
    detail && modesDraft && !sameModes(draftsFrom(detail), modesDraft),
  );

  const inputsDirty = Boolean(
    detail && inputsDraft && !sameInputs(detail.inputs, inputsDraft),
  );

  const termsDirty = Boolean(
    detail &&
      termsForm &&
      (!sameTerms(termsFrom(detail), termsForm) || askAgain),
  );

  // Issue #71 CEO review: `load()` after Replace Workflow/Restore wipes
  // every draft back to the server's own state, silently discarding
  // whatever's unsaved in another section — so both stay disabled while
  // any section is dirty, the same way a risky action elsewhere would.
  const anyDraftDirty = dirty || modesDirty || inputsDirty || termsDirty;

  const termsPreviewHtml = termsForm ? renderMarkdown(termsForm.termsBody) : "";

  async function handleSaveTerms(event: FormEvent) {
    event.preventDefault();
    if (!detail || !termsForm) return;
    setSavingTerms(true);
    setTermsSaveError(null);

    try {
      const res = await fetch(`/api/admin/models/${detail.model.id}/terms`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: detail.model.termsRevision,
          ...termsForm,
          askAgain,
        }),
      });

      if (!res.ok) {
        setTermsSaveError(await messageFrom(res, "save failed"));
        return;
      }

      load();
    } finally {
      setSavingTerms(false);
    }
  }

  // issue #49: checkModel runs live, client-side, against whatever's in
  // the drafts right now — the rail updates on every edit, before Save.
  const checkModelBackends = useMemo(
    () => (objectInfo === null ? null : toCheckModelBackends(objectInfo)),
    [objectInfo],
  );
  const modelIssues: ModelIssue[] = useMemo(() => {
    if (!detail || !modesDraft || !inputsDraft || !checkModelBackends)
      return [];
    return checkModel(
      {
        workflow: detail.workflow,
        inputs: inputsDraft,
        modes: modesDraft.map((mode) => ({
          id: mode.key,
          name: mode.name,
          outputNodeIds: mode.outputNodeIds,
          inputSettings: mode.inputSettings,
        })),
      },
      checkModelBackends,
    );
  }, [detail, modesDraft, inputsDraft, checkModelBackends]);
  const modelHasErrors = hasBlockingErrors(modelIssues);
  // An enabled Model with errors can only be saved by disabling it (issue
  // #49): Modes/Inputs then offer "Save and disable" instead of Save.
  const mustDisableToSave = detail?.model.state === "enabled" && modelHasErrors;

  // Issue #71: the same rail, run against the picked-but-not-yet-saved
  // Workflow file plus the Model's currently *saved* Modes/Inputs (what
  // "Replace Workflow" actually carries forward, by node id) — not the
  // Modes/Inputs drafts, which are saved separately.
  const pendingWorkflowIssues: ModelIssue[] = useMemo(() => {
    if (!detail || pendingWorkflow === null || !checkModelBackends) return [];
    try {
      const workflow = pendingWorkflow as Workflow;
      return checkModel(
        {
          workflow,
          inputs: reboundInputsFrom(detail.inputs, workflow, rebindMap),
          modes: checkModelModesFrom(detail.modes, rebindMap),
        },
        checkModelBackends,
      );
    } catch {
      // Not a Workflow-shaped object; the server's own parse will refuse
      // it with a clear message once "Replace Workflow" is pressed.
      return [];
    }
  }, [detail, pendingWorkflow, checkModelBackends, rebindMap]);
  const mustDisableToSaveWorkflow =
    detail?.model.state === "enabled" &&
    hasBlockingErrors(pendingWorkflowIssues);

  /** Issue #71's rebind picker: every broken Mode output/Input binding, each repointable to a node of the picked file. */
  const brokenNodeRefs: BrokenNodeRef[] = useMemo(() => {
    if (!detail || pendingWorkflow === null) return [];
    try {
      return findBrokenNodeRefs(detail, pendingWorkflow as Workflow);
    } catch {
      return [];
    }
  }, [detail, pendingWorkflow]);
  const pendingWorkflowNodes: ModelNode[] = useMemo(() => {
    if (pendingWorkflow === null) return [];
    try {
      return nodesFromWorkflow(pendingWorkflow as Workflow);
    } catch {
      return [];
    }
  }, [pendingWorkflow]);

  const editingMode =
    editingModeIndex !== null ? (modesDraft?.[editingModeIndex] ?? null) : null;
  const editingPath =
    detail && editingMode && editingMode.outputNodeIds.length > 0
      ? computeModePath(
          workflowForMode(editingMode, detail.inputs ?? [], detail.workflow),
          editingMode.outputNodeIds,
          visibleBoundFieldsFor(editingMode, detail.inputs ?? []),
        )
      : null;

  const editingInput =
    editingInputIndex !== null
      ? (inputsDraft?.[editingInputIndex] ?? null)
      : null;
  const editingInputCandidates =
    detail && editingInput && inputsDraft
      ? candidateFieldsFor(detail.workflow, editingInput, inputsDraft)
      : null;

  useEffect(() => {
    if (!dirty && !modesDirty && !inputsDirty && !termsDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, modesDirty, inputsDirty, termsDirty]);

  // Catches every in-app navigation away from the editor while dirty: the
  // "Back to Models" button, AdminShell's nav links, and the browser's
  // own Back/Forward (issue #40 follow-up: beforeunload alone misses all
  // three since they never unload the page).
  useBlocker(({ currentLocation, nextLocation }) => {
    if (
      bypassBlockerRef.current ||
      (!dirty && !modesDirty && !inputsDirty && !termsDirty) ||
      currentLocation.pathname === nextLocation.pathname
    ) {
      return false;
    }
    return !window.confirm("Discard unsaved changes?");
  });

  function goBack() {
    navigate("/admin/models");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!detail || !form) return;
    setSaving(true);
    setSaveError(null);

    try {
      const res = await fetch(`/api/admin/models/${detail.model.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, version: detail.model.version }),
      });

      if (!res.ok) {
        setSaveError(await messageFrom(res, "save failed"));
        return;
      }

      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!detail) return;
    if (!window.confirm("Delete this Model?")) return;
    setDeleteError(null);

    const res = await fetch(
      `/api/admin/models/${detail.model.id}?version=${detail.model.version}`,
      { method: "DELETE" },
    );

    if (!res.ok) {
      setDeleteError(await messageFrom(res, "delete failed"));
      return;
    }

    // The Model is gone; there's nothing left to discard a confirm over.
    bypassBlockerRef.current = true;
    navigate("/admin/models");
  }

  if (loadError) return <p role="alert">{loadError}</p>;
  if (!detail || !form) return <p>Loading…</p>;

  const filteredNodes = detail.nodes.filter((node) => {
    const needle = nodeFilter.trim().toLowerCase();
    if (!needle) return true;
    return (
      node.id.toLowerCase().includes(needle) ||
      node.classType.toLowerCase().includes(needle) ||
      (node.title ?? "").toLowerCase().includes(needle)
    );
  });

  return (
    <section>
      <button type="button" onClick={goBack}>
        Back to Models
      </button>
      <h2>{detail.model.name}</h2>
      <p>
        State: {detail.model.state} · Revision: {detail.model.currentRevision}
        {" · "}
        <a href={`/api/admin/models/${detail.model.id}/history`}>History</a>
      </p>

      <button
        type="button"
        disabled={
          togglingState || (detail.model.state !== "enabled" && modelHasErrors)
        }
        onClick={() => void handleToggleState()}
      >
        {detail.model.state === "enabled" ? "Disable" : "Enable"}
      </button>
      {stateError && (
        <ul role="alert">
          {stateError.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      <ModelCheckRail issues={modelIssues} />

      <section>
        <h3>Revisions</h3>
        {revisionsLoadError && <p role="alert">{revisionsLoadError}</p>}
        {revisions && revisions.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Revision</th>
                <th>Created</th>
                <th>Modes</th>
                <th>Inputs</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((revision) => (
                <tr key={revision.revisionNumber}>
                  <td>
                    {revision.revisionNumber}
                    {revision.revisionNumber === detail.model.currentRevision &&
                      " (current)"}
                  </td>
                  <td>{new Date(revision.createdAt).toLocaleString()}</td>
                  <td>{revision.modeCount}</td>
                  <td>{revision.inputCount}</td>
                  <td>
                    <button
                      type="button"
                      disabled={
                        restoringRevision !== null ||
                        revision.revisionNumber ===
                          detail.model.currentRevision ||
                        anyDraftDirty
                      }
                      title={
                        anyDraftDirty
                          ? "Save or discard your other unsaved changes first"
                          : undefined
                      }
                      onClick={() =>
                        void handleRestoreRevision(
                          revision.revisionNumber,
                          false,
                        )
                      }
                    >
                      Restore
                    </button>
                    {restoreErrors[revision.revisionNumber] && (
                      <>
                        <p role="alert">
                          {restoreErrors[revision.revisionNumber]}
                        </p>
                        {detail.model.state === "enabled" && (
                          <button
                            type="button"
                            disabled={
                              restoringRevision !== null || anyDraftDirty
                            }
                            title={
                              anyDraftDirty
                                ? "Save or discard your other unsaved changes first"
                                : undefined
                            }
                            onClick={() =>
                              void handleRestoreRevision(
                                revision.revisionNumber,
                                true,
                              )
                            }
                          >
                            Restore and disable
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {detail.outsideServiceNotes.length > 0 && (
        <ul>
          {detail.outsideServiceNotes.map((note) => (
            <li key={note.nodeId}>
              {note.classType} (node {note.nodeId}) has no key set in the
              Workflow; set it on the Backend instead.
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(event) => void handleSubmit(event)}>
        <h3>Details</h3>

        <label htmlFor="model-name">Name</label>
        <input
          id="model-name"
          value={form.name}
          maxLength={80}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />

        <label htmlFor="model-slug">Slug</label>
        <input
          id="model-slug"
          value={form.slug}
          maxLength={80}
          onChange={(event) => setForm({ ...form, slug: event.target.value })}
        />

        <label htmlFor="model-description">Description</label>
        <textarea
          id="model-description"
          value={form.description}
          onChange={(event) =>
            setForm({ ...form, description: event.target.value })
          }
        />

        <label htmlFor="model-max-run-time">Max run time (minutes)</label>
        <input
          id="model-max-run-time"
          type="number"
          min={1}
          max={240}
          value={form.maxRunTimeMinutes}
          onChange={(event) =>
            setForm({
              ...form,
              maxRunTimeMinutes: Number(event.target.value),
            })
          }
        />

        <button type="submit" disabled={saving || !dirty}>
          Save
        </button>
        {saveError && <p role="alert">{saveError}</p>}
      </form>

      <section>
        <h3>Backends</h3>
        {backendsLoadError && <p role="alert">{backendsLoadError}</p>}

        {attachedBackends && attachedBackends.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Base URL</th>
                <th>Missing node types</th>
                <th>Can't run</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {attachedBackends.map((entry) => {
                const thisBackend = checkModelBackends?.find(
                  (b) => b.id === entry.backend.id,
                );
                const gapsByMode =
                  detail && modesDraft && thisBackend
                    ? modesDraft
                        .filter((mode) => mode.outputNodeIds.length > 0)
                        .flatMap((mode) => {
                          const checkMode = {
                            id: mode.key,
                            name: mode.name,
                            outputNodeIds: mode.outputNodeIds,
                            inputSettings: mode.inputSettings,
                          };
                          return modeBackendGaps(
                            {
                              workflow: detail.workflow,
                              inputs: detail.inputs ?? [],
                              modes: [checkMode],
                            },
                            checkMode,
                            [thisBackend],
                          )
                            .filter((gap) => gap.missingNodeType !== null)
                            .map((gap) => ({ mode, gap }));
                        })
                    : [];
                return (
                  <tr key={entry.backend.id}>
                    <td>{entry.backend.name}</td>
                    <td>{entry.backend.baseUrl}</td>
                    <td>
                      {entry.note
                        ? entry.note
                        : entry.missingNodeTypes &&
                            entry.missingNodeTypes.length > 0
                          ? entry.missingNodeTypes.join(", ")
                          : "none"}
                    </td>
                    <td>
                      {gapsByMode.length === 0
                        ? "every Mode"
                        : gapsByMode.map(({ mode, gap }) => (
                            <div key={mode.key}>
                              Can't run "{mode.name || "this Mode"}": missing{" "}
                              {gap.missingNodeType} (pack{" "}
                              {gap.pack ?? "unknown"})
                            </div>
                          ))}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void handleDetach(entry.backend.id)}
                      >
                        Detach
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {attachedBackends && attachedBackends.length === 0 && (
          <p>No Backends attached.</p>
        )}

        <form onSubmit={(event) => void handleAttach(event)}>
          <label htmlFor="attach-backend">Attach a Backend</label>
          <select
            id="attach-backend"
            value={attachBackendId}
            onChange={(event) => setAttachBackendId(event.target.value)}
          >
            <option value="">Choose a Backend…</option>
            {(allBackends ?? [])
              .filter(
                (backend) =>
                  !attachedBackends?.some(
                    (entry) => entry.backend.id === backend.id,
                  ),
              )
              .map((backend) => (
                <option key={backend.id} value={backend.id}>
                  {backend.name}
                </option>
              ))}
          </select>
          <button type="submit" disabled={!attachBackendId}>
            Attach
          </button>
          {attachError && <p role="alert">{attachError}</p>}
        </form>
      </section>

      <section>
        <h3 ref={modesHeadingRef}>Modes</h3>
        {modesDraft?.map((mode, index) => (
          <fieldset key={mode.key}>
            <label htmlFor={`mode-name-${index}`}>Mode name</label>
            <input
              id={`mode-name-${index}`}
              value={mode.name}
              maxLength={60}
              onChange={(event) =>
                updateMode(index, { name: event.target.value })
              }
            />

            <label htmlFor={`mode-description-${index}`}>
              Mode description
            </label>
            <input
              id={`mode-description-${index}`}
              value={mode.description}
              onChange={(event) =>
                updateMode(index, { description: event.target.value })
              }
            />

            <p>
              Output nodes (first is the main Asset):{" "}
              {mode.outputNodeIds.length === 0 ? "none chosen" : null}
            </p>
            <ol>
              {mode.outputNodeIds.map((nodeId, position) => (
                <li key={nodeId}>
                  {nodeId}
                  <button
                    type="button"
                    onClick={() => moveOutputNode(index, nodeId, "up")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveOutputNode(index, nodeId, "down")}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeOutputNode(index, nodeId)}
                  >
                    Remove
                  </button>
                  {position === 0 && " (main Asset)"}
                </li>
              ))}
            </ol>

            {detail && <ModeSheetFacts mode={mode} detail={detail} />}

            <button
              type="button"
              aria-pressed={editingModeIndex === index}
              onClick={() =>
                setEditingModeIndex(editingModeIndex === index ? null : index)
              }
            >
              {editingModeIndex === index
                ? "Done picking output nodes"
                : "Pick output nodes in the Workflow below"}
            </button>
            <button type="button" onClick={() => duplicateMode(index)}>
              Duplicate Mode
            </button>
            <button type="button" onClick={() => removeMode(index)}>
              Remove Mode
            </button>
          </fieldset>
        ))}

        <button type="button" onClick={addMode}>
          Add Mode
        </button>

        {detail && modesDraft && modesDraft.length > 0 && (
          <ModeInputGrid
            modes={modesDraft}
            inputs={detail.inputs}
            workflow={detail.workflow}
            onChange={setModeInputSetting}
            onApplyToEveryEligibleMode={applySettingToEveryEligibleMode}
          />
        )}

        <button
          type="button"
          disabled={savingModes || !modesDirty}
          onClick={() => void handleSaveModes()}
        >
          {mustDisableToSave ? "Save and disable" : "Save Modes"}
        </button>
        {modesSaveError && <p role="alert">{modesSaveError}</p>}
      </section>

      {termsForm && (
        <form onSubmit={(event) => void handleSaveTerms(event)}>
          <h3>Terms and attribution</h3>
          <p>
            <a
              href="https://github.com/mysteryreloaded/ai-content-studio/blob/main/docs/licensing.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              Licensing docs
            </a>
          </p>

          <label htmlFor="model-terms-body">Model terms (Markdown)</label>
          <textarea
            id="model-terms-body"
            rows={10}
            value={termsForm.termsBody}
            maxLength={MODEL_TERMS_MAX_LENGTH}
            onChange={(event) =>
              setTermsForm({ ...termsForm, termsBody: event.target.value })
            }
          />

          <h4>Preview</h4>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images */}
          <div dangerouslySetInnerHTML={{ __html: termsPreviewHtml }} />

          <label htmlFor="model-license-url">License URL</label>
          <input
            id="model-license-url"
            value={termsForm.licenseUrl}
            onChange={(event) =>
              setTermsForm({ ...termsForm, licenseUrl: event.target.value })
            }
          />
          {!isValidModelLicenseUrl(termsForm.licenseUrl) && (
            <p role="alert">Must be an http(s) URL, or blank</p>
          )}

          <label htmlFor="model-attribution">Attribution</label>
          <input
            id="model-attribution"
            value={termsForm.attribution}
            maxLength={MODEL_ATTRIBUTION_MAX_LENGTH}
            onChange={(event) =>
              setTermsForm({ ...termsForm, attribution: event.target.value })
            }
          />

          <p>
            {detail.model.termsBody === ""
              ? "No terms are set: anyone can use this Model without accepting anything."
              : `Current version ${detail.model.termsVersion}, effective ${
                  detail.model.termsVersionCreatedAt
                    ? new Date(
                        detail.model.termsVersionCreatedAt,
                      ).toLocaleDateString()
                    : "unknown"
                }.`}
          </p>

          <label>
            <input
              type="checkbox"
              checked={askAgain}
              onChange={(event) => setAskAgain(event.target.checked)}
            />
            Ask everyone to accept again
          </label>

          <button
            type="submit"
            disabled={
              savingTerms ||
              !termsDirty ||
              !isValidModelLicenseUrl(termsForm.licenseUrl)
            }
          >
            Save Terms
          </button>
          {termsSaveError && <p role="alert">{termsSaveError}</p>}
        </form>
      )}

      <section>
        <h3 ref={inputsHeadingRef}>Inputs</h3>
        {inputsDraft?.map((input, index) => (
          <fieldset key={input.id}>
            <p>Kind: {input.kind}</p>

            <label htmlFor={`input-group-${index}`}>Group</label>
            <select
              id={`input-group-${index}`}
              value={input.group}
              onChange={(event) =>
                updateInput(index, {
                  ...input,
                  group: event.target.value as InputDefinition["group"],
                })
              }
            >
              <option value="describe">Describe it</option>
              <option value="settings">Settings</option>
            </select>

            <label htmlFor={`input-label-${index}`}>Label</label>
            <input
              id={`input-label-${index}`}
              value={input.label}
              maxLength={60}
              onChange={(event) =>
                updateInput(index, { ...input, label: event.target.value })
              }
            />

            <label htmlFor={`input-help-${index}`}>Help (optional)</label>
            <input
              id={`input-help-${index}`}
              value={input.help}
              onChange={(event) =>
                updateInput(index, { ...input, help: event.target.value })
              }
            />

            {input.kind === "text" && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={input.multiline}
                    onChange={(event) =>
                      updateInput(index, {
                        ...input,
                        multiline: event.target.checked,
                      })
                    }
                  />
                  Multi-line
                </label>

                <label htmlFor={`input-maxlength-${index}`}>Max length</label>
                <input
                  id={`input-maxlength-${index}`}
                  type="number"
                  min={1}
                  max={10_000}
                  value={input.maxLength}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      maxLength: Number(event.target.value),
                    })
                  }
                />

                <label htmlFor={`input-default-${index}`}>
                  Default (optional)
                </label>
                <input
                  id={`input-default-${index}`}
                  value={input.default}
                  maxLength={input.maxLength}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      default: event.target.value,
                    })
                  }
                />
              </>
            )}

            {input.kind === "image_upload" && (
              <>
                <p>
                  Shown under "Your files" and always required. Bind it to a
                  loader's file field, such as LoadImage's "image".
                </p>
                <label htmlFor={`input-max-size-${index}`}>Max size (MB)</label>
                <input
                  id={`input-max-size-${index}`}
                  type="number"
                  min={1}
                  max={maxUploadMb}
                  step={1}
                  value={input.maxSizeMb}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      maxSizeMb: Number(event.target.value),
                    })
                  }
                />

                <label htmlFor={`input-max-long-side-${index}`}>
                  Max long side (px, optional)
                </label>
                <input
                  id={`input-max-long-side-${index}`}
                  type="number"
                  min={1}
                  step={1}
                  value={input.maxLongSide ?? ""}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      maxLongSide:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </>
            )}

            {(input.kind === "video_upload" ||
              input.kind === "audio_upload") && (
              <>
                <p>
                  Shown under "Your media" and always required. Bind it to a
                  loader's file field
                  {input.kind === "video_upload"
                    ? " flagged video_upload, or to VHS_LoadVideo/VHS_LoadVideoFFmpeg."
                    : " flagged audio_upload."}
                </p>
                <label htmlFor={`input-max-size-${index}`}>Max size (MB)</label>
                <input
                  id={`input-max-size-${index}`}
                  type="number"
                  min={1}
                  max={maxUploadMb}
                  step={1}
                  value={input.maxSizeMb}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      maxSizeMb: Number(event.target.value),
                    })
                  }
                />

                {input.kind === "video_upload" && (
                  <>
                    <label htmlFor={`input-max-long-side-${index}`}>
                      Max long side (px, optional)
                    </label>
                    <input
                      id={`input-max-long-side-${index}`}
                      type="number"
                      min={1}
                      step={1}
                      value={input.maxLongSide ?? ""}
                      onChange={(event) =>
                        updateInput(index, {
                          ...input,
                          maxLongSide:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                    />
                  </>
                )}

                <label htmlFor={`input-min-duration-${index}`}>
                  Min duration (ms)
                </label>
                <input
                  id={`input-min-duration-${index}`}
                  type="number"
                  min={0}
                  step={100}
                  value={input.minDurationMs}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      minDurationMs: Number(event.target.value),
                    })
                  }
                />

                <label htmlFor={`input-max-duration-${index}`}>
                  Max duration (ms)
                </label>
                <input
                  id={`input-max-duration-${index}`}
                  type="number"
                  min={1}
                  step={100}
                  value={input.maxDurationMs}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      maxDurationMs: Number(event.target.value),
                    })
                  }
                />

                <label>
                  <input
                    type="checkbox"
                    checked={input.trimmable}
                    onChange={(event) =>
                      updateInput(index, {
                        ...input,
                        trimmable: event.target.checked,
                      })
                    }
                  />
                  Trimmable on a local player
                </label>
              </>
            )}

            {input.kind === "points" && (
              <>
                <p>
                  A user picks 1-10 points on the first frame of the chosen
                  Video Upload Input's trimmed clip, inside the crop the
                  Width/Height fields resolve to. Bind its own field (the
                  resolved pixel points, as a JSON string) below.
                </p>

                <label htmlFor={`input-video-${index}`}>
                  Video Upload Input
                </label>
                <select
                  id={`input-video-${index}`}
                  value={input.videoInputId}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      videoInputId: event.target.value,
                    })
                  }
                >
                  <option value="">(choose one)</option>
                  {inputsDraft
                    ?.filter(
                      (other): other is VideoUploadInputDefinition =>
                        other.kind === "video_upload",
                    )
                    .map((videoInput) => (
                      <option key={videoInput.id} value={videoInput.id}>
                        {videoInput.label || videoInput.id}
                      </option>
                    ))}
                </select>

                {(["widthField", "heightField"] as const).map((key) => {
                  const ref = input[key];
                  return (
                    <div key={key}>
                      <label htmlFor={`input-${key}-${index}`}>
                        {key === "widthField" ? "Width" : "Height"} field
                      </label>
                      <select
                        id={`input-${key}-${index}`}
                        value={
                          ref.nodeId ? fieldKey(ref.nodeId, ref.field) : ""
                        }
                        onChange={(event) => {
                          const value = event.target.value;
                          const nextRef: NodeFieldRef =
                            value === ""
                              ? { nodeId: "", field: "" }
                              : {
                                  nodeId: value.slice(0, value.indexOf("::")),
                                  field: value.slice(value.indexOf("::") + 2),
                                };
                          updateInput(index, { ...input, [key]: nextRef });
                        }}
                      >
                        <option value="">(choose one)</option>
                        {numberFieldsFor(detail.workflow).map((field) => (
                          <option
                            key={fieldKey(field.nodeId, field.field)}
                            value={fieldKey(field.nodeId, field.field)}
                          >
                            {field.nodeId}.{field.field} ({field.classType})
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </>
            )}

            {input.kind === "number" && (
              <>
                <label htmlFor={`input-mode-${index}`}>Number</label>
                <select
                  id={`input-mode-${index}`}
                  value={input.numberMode}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      numberMode: event.target
                        .value as NumberInputDefinition["numberMode"],
                    })
                  }
                >
                  <option value="integer">Whole</option>
                  <option value="decimal">Decimal</option>
                </select>

                <label htmlFor={`input-min-${index}`}>Min</label>
                <input
                  id={`input-min-${index}`}
                  type="number"
                  value={input.min}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      min: Number(event.target.value),
                    })
                  }
                />

                <label htmlFor={`input-max-${index}`}>Max</label>
                <input
                  id={`input-max-${index}`}
                  type="number"
                  value={input.max}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      max: Number(event.target.value),
                    })
                  }
                />

                <label htmlFor={`input-step-${index}`}>Step</label>
                <input
                  id={`input-step-${index}`}
                  type="number"
                  min={0}
                  value={input.step}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      step: Number(event.target.value),
                    })
                  }
                />

                <label htmlFor={`input-default-${index}`}>
                  Default (optional)
                </label>
                <input
                  id={`input-default-${index}`}
                  type="number"
                  value={input.default ?? ""}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      default:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </>
            )}

            {input.kind === "seed" && (
              <>
                <p>Bound to exactly one INT field; no default (issue #47).</p>
                <label htmlFor={`input-max-${index}`}>
                  Max (required to enable this Model)
                </label>
                <input
                  id={`input-max-${index}`}
                  type="number"
                  min={1}
                  value={input.max ?? ""}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      max:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </>
            )}

            {input.kind === "select" && (
              <>
                <p>
                  Options
                  {input.options.length === 2 && " (shown as a toggle)"}:
                </p>
                {input.options.map((option, optionIndex) => (
                  <fieldset key={option.id}>
                    <label
                      htmlFor={`input-option-label-${index}-${optionIndex}`}
                    >
                      Option label
                    </label>
                    <input
                      id={`input-option-label-${index}-${optionIndex}`}
                      value={option.label}
                      onChange={(event) =>
                        updateInput(index, {
                          ...input,
                          options: input.options.map((o, i) =>
                            i === optionIndex
                              ? { ...o, label: event.target.value }
                              : o,
                          ),
                        })
                      }
                    />
                    {input.bindings.map((binding, bindingIndex) => {
                      const valueKind = bindingValueKind(
                        detail.workflow,
                        binding.nodeId,
                        binding.field,
                      );
                      const setOptionValue = (
                        value: string | number | boolean,
                      ) => {
                        updateInput(index, {
                          ...input,
                          options: input.options.map((o, i) =>
                            i === optionIndex
                              ? {
                                  ...o,
                                  values: o.values.map((v, vi) =>
                                    vi === bindingIndex ? value : v,
                                  ),
                                }
                              : o,
                          ),
                        });
                      };
                      const fieldId = `input-option-value-${index}-${optionIndex}-${bindingIndex}`;
                      return (
                        <span key={fieldKey(binding.nodeId, binding.field)}>
                          <label htmlFor={fieldId}>
                            {binding.nodeId}.{binding.field}
                          </label>
                          {valueKind === "boolean" ? (
                            <input
                              id={fieldId}
                              type="checkbox"
                              checked={option.values[bindingIndex] === true}
                              onChange={(event) =>
                                setOptionValue(event.target.checked)
                              }
                            />
                          ) : valueKind === "number" ? (
                            <input
                              id={fieldId}
                              type="number"
                              value={String(option.values[bindingIndex] ?? "")}
                              onChange={(event) =>
                                setOptionValue(Number(event.target.value))
                              }
                            />
                          ) : (
                            <input
                              id={fieldId}
                              value={String(option.values[bindingIndex] ?? "")}
                              onChange={(event) =>
                                setOptionValue(event.target.value)
                              }
                            />
                          )}
                        </span>
                      );
                    })}
                    {input.options.length > 2 && (
                      <button
                        type="button"
                        onClick={() =>
                          updateInput(index, {
                            ...input,
                            options: input.options.filter(
                              (_, i) => i !== optionIndex,
                            ),
                          })
                        }
                      >
                        Remove option
                      </button>
                    )}
                  </fieldset>
                ))}
                {input.options.length < 50 && (
                  <button
                    type="button"
                    onClick={() =>
                      updateInput(index, {
                        ...input,
                        options: [
                          ...input.options,
                          {
                            id: crypto.randomUUID(),
                            label: "",
                            values: input.bindings.map(() => ""),
                          },
                        ],
                      })
                    }
                  >
                    Add option
                  </button>
                )}

                <label htmlFor={`input-default-${index}`}>
                  Default (optional)
                </label>
                <select
                  id={`input-default-${index}`}
                  value={input.default ?? ""}
                  onChange={(event) =>
                    updateInput(index, {
                      ...input,
                      default: event.target.value || null,
                    })
                  }
                >
                  <option value="">None</option>
                  {input.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label || option.id}
                    </option>
                  ))}
                </select>
              </>
            )}

            <p>
              Bound fields: {input.bindings.length === 0 ? "none chosen" : null}
            </p>
            <ul>
              {input.bindings.map((binding) => (
                <li key={fieldKey(binding.nodeId, binding.field)}>
                  {binding.nodeId}.{binding.field} ({binding.classType})
                  <button
                    type="button"
                    onClick={() =>
                      updateInput(
                        index,
                        toggleBinding(input, {
                          nodeId: binding.nodeId,
                          field: binding.field,
                          classType: binding.classType,
                          title: binding.title,
                          valueType:
                            input.kind === "number" ? "number" : "string",
                          value: "",
                        }),
                      )
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <button
              type="button"
              aria-pressed={editingInputIndex === index}
              onClick={() =>
                setEditingInputIndex(editingInputIndex === index ? null : index)
              }
            >
              {editingInputIndex === index
                ? "Done picking fields"
                : "Pick fields in the Workflow below"}
            </button>
            <button type="button" onClick={() => removeInput(index)}>
              Remove Input
            </button>
          </fieldset>
        ))}

        <label htmlFor="new-input-kind">New Input kind</label>
        <select
          id="new-input-kind"
          value={newInputKind}
          onChange={(event) =>
            setNewInputKind(event.target.value as InputDefinition["kind"])
          }
        >
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="select">Select</option>
          <option
            value="seed"
            disabled={inputsDraft?.some((i) => i.kind === "seed")}
          >
            Seed
          </option>
          <option value="image_upload">Image upload</option>
          <option value="video_upload">Video upload</option>
          <option value="audio_upload">Audio upload</option>
          <option value="points">Points</option>
        </select>
        <button type="button" onClick={addInput}>
          Add Input
        </button>
        <button
          type="button"
          disabled={savingInputs || !inputsDirty}
          onClick={() => void handleSaveInputs()}
        >
          {mustDisableToSave ? "Save and disable" : "Save Inputs"}
        </button>
        {inputsSaveError && <p role="alert">{inputsSaveError}</p>}
      </section>

      <section>
        <h3>Workflow</h3>

        <label htmlFor="replace-workflow-file">
          Replace Workflow (API format JSON)
        </label>
        <input
          id="replace-workflow-file"
          type="file"
          accept="application/json"
          onChange={(event) =>
            void handlePickWorkflowFile(event.target.files?.[0] ?? null)
          }
        />
        {pendingWorkflowFileName && (
          <p>
            Picked "{pendingWorkflowFileName}": Modes' output nodes and Inputs'
            bindings carry forward by node id. Nothing is sent until you press
            "Replace Workflow".
          </p>
        )}
        <ModelCheckRail issues={pendingWorkflowIssues} />
        {brokenNodeRefs.length > 0 && (
          <section aria-label="Rebind broken bindings and outputs">
            <h4>Rebind</h4>
            <p>
              These no longer match a node of the picked file by class; repoint
              each to a node there instead of disabling the Model.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Broken</th>
                  <th>Repoint to</th>
                </tr>
              </thead>
              <tbody>
                {brokenNodeRefs.map((ref) => (
                  <tr key={ref.nodeId}>
                    <td>{ref.description}</td>
                    <td>
                      <select
                        aria-label={`Rebind node "${ref.nodeId}"`}
                        value={rebindMap[ref.nodeId] ?? ""}
                        onChange={(event) =>
                          setRebind(ref.nodeId, event.target.value)
                        }
                      >
                        <option value="">Leave broken</option>
                        {pendingWorkflowNodes.map((node) => (
                          <option key={node.id} value={node.id}>
                            {node.id} ({node.classType})
                            {node.title ? ` "${node.title}"` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <button
          type="button"
          disabled={
            uploadingWorkflow || pendingWorkflow === null || anyDraftDirty
          }
          title={
            anyDraftDirty
              ? "Save or discard your other unsaved changes first"
              : undefined
          }
          onClick={() => void handleReplaceWorkflow()}
        >
          {mustDisableToSaveWorkflow
            ? "Replace Workflow and disable"
            : "Replace Workflow"}
        </button>
        {workflowUploadError && <p role="alert">{workflowUploadError}</p>}

        {editingMode && (
          <p>
            Picking output nodes for "{editingMode.name || "this Mode"}": click
            a row below to add or remove it. Nodes off its Path are dimmed.
          </p>
        )}
        <label htmlFor="node-filter">Filter nodes</label>
        <input
          id="node-filter"
          value={nodeFilter}
          onChange={(event) => setNodeFilter(event.target.value)}
        />
        <table>
          <thead>
            <tr>
              <th>Id</th>
              <th>Class</th>
              <th>Title</th>
              {editingMode && <th>Output node</th>}
            </tr>
          </thead>
          <tbody>
            {filteredNodes.map((node) => {
              const onPath = editingPath
                ? editingPath.nodeIds.has(node.id)
                : true;
              const chosen =
                editingMode?.outputNodeIds.includes(node.id) ?? false;
              return (
                <tr
                  key={node.id}
                  style={editingPath && !onPath ? { opacity: 0.35 } : undefined}
                >
                  <td>{node.id}</td>
                  <td>{node.classType}</td>
                  <td>{node.title ?? ""}</td>
                  {editingMode && (
                    <td>
                      <button
                        type="button"
                        onClick={() => toggleOutputNodeInEditingMode(node.id)}
                      >
                        {chosen ? "Remove" : "Add"}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {editingInput && editingInputCandidates && (
          <>
            <p>
              Picking fields for "{editingInput.label || "this Input"}": click a
              row below to add or remove it. Only value-holding, type-compatible
              fields not already bound elsewhere are shown.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Field</th>
                  <th>Class</th>
                  <th>Current value</th>
                  <th>Bound</th>
                </tr>
              </thead>
              <tbody>
                {editingInputCandidates.map((field) => {
                  const chosen = editingInput.bindings.some(
                    (binding) =>
                      binding.nodeId === field.nodeId &&
                      binding.field === field.field,
                  );
                  return (
                    <tr key={fieldKey(field.nodeId, field.field)}>
                      <td>{field.nodeId}</td>
                      <td>{field.field}</td>
                      <td>{field.classType}</td>
                      <td>{String(field.value)}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => toggleFieldInEditingInput(field)}
                        >
                          {chosen ? "Remove" : "Add"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>

      <button type="button" onClick={() => void handleDelete()}>
        Delete
      </button>
      {deleteError && <p role="alert">{deleteError}</p>}
    </section>
  );
}

const MODE_INPUT_STATES: ModeInputState[] = [
  "hidden",
  "optional",
  "required",
  "fixed",
];

/**
 * The Model's live rail (issue #49): every error and warning `checkModel`
 * currently finds, recomputed on each render against whatever's in the
 * Modes/Inputs drafts right now — before either is saved.
 */
function ModelCheckRail({ issues }: { issues: ModelIssue[] }) {
  if (issues.length === 0) return null;
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  return (
    <section aria-label="Model checks">
      <h3>Checks</h3>
      {errors.length > 0 && (
        <ul role="alert">
          {errors.map((issue) => (
            <li key={issue.message}>Error: {issue.message}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul>
          {warnings.map((issue) => (
            <li key={issue.message}>Warning: {issue.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One grid cell's fixed-value editor, matching the Input's own kind (issue #48: "fixed values respect options and ranges"). */
function FixedValueEditor({
  input,
  value,
  onChange,
}: {
  input: InputDefinition;
  value: string | number | boolean | null;
  onChange: (value: string | number | boolean | null) => void;
}) {
  if (input.kind === "text") {
    return (
      <input
        aria-label={`${input.label} fixed value`}
        value={typeof value === "string" ? value : ""}
        maxLength={input.maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (input.kind === "number") {
    return (
      <input
        aria-label={`${input.label} fixed value`}
        type="number"
        value={typeof value === "number" ? value : ""}
        min={input.min}
        max={input.max}
        step={input.step}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          onChange(Number.isFinite(parsed) ? parsed : null);
        }}
      />
    );
  }
  // A Seed can't be fixed (ADR 0007: the grid never offers it), so the
  // only kind left here is select.
  if (input.kind !== "select") return null;
  return (
    <select
      aria-label={`${input.label} fixed value`}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Choose…</option>
      {input.options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A Mode sheet's Path facts and live form preview (issue #48 AC3): what
 * the Mode's Path resolves to against the current Workflow, and what
 * its Workbench form would show right now (relevant Inputs, labelled
 * and marked required per this Mode's own settings, with fixed ones
 * called out separately), kept live as the Admin edits the grid.
 */
function ModeSheetFacts({
  mode,
  detail,
}: {
  mode: DraftMode;
  detail: ModelDetail;
}) {
  if (mode.outputNodeIds.length === 0) {
    return <p>Path: pick at least one output node to see its facts.</p>;
  }

  const inputs = detail.inputs ?? [];
  const unresolvable = visibleModeBoundFields(mode.inputSettings ?? [], inputs);
  const workflow = workflowForMode(mode, inputs, detail.workflow);
  const path = computeModePath(workflow, mode.outputNodeIds, unresolvable);
  const relevant = relevantInputs(
    inputs,
    workflow,
    mode.outputNodeIds,
    unresolvable,
  );
  const { formInputs, requiredIds, fixedValues } = resolveModeInputs(
    relevant,
    mode.inputSettings ?? [],
  );

  return (
    <div>
      <p>
        Path: {path.nodeIds.size} node{path.nodeIds.size === 1 ? "" : "s"}
        {path.missingOutputNodeIds.length > 0 &&
          " — an output node is missing from the Workflow!"}
      </p>
      <h4>Form preview</h4>
      {formInputs.length === 0 ? (
        <p>No Inputs show on this Mode's form.</p>
      ) : (
        <ul>
          {formInputs.map((input) => (
            <li key={input.id}>
              {input.label}
              {requiredIds.has(input.id) && " (required)"}
            </li>
          ))}
        </ul>
      )}
      {Object.keys(fixedValues).length > 0 && (
        <p>{Object.keys(fixedValues).length} Input(s) fixed to a value.</p>
      )}
    </div>
  );
}

/**
 * The Mode × Input grid (issue #48): a row per Input, a column per Mode,
 * each cell holding that Mode's state for that Input (hidden, optional,
 * required, or fixed with a value) plus an optional Mode-specific label.
 * "Apply to every Mode whose Path holds this Input" copies a cell onto
 * every other Mode that could use it.
 */
function ModeInputGrid({
  modes,
  inputs,
  workflow,
  onChange,
  onApplyToEveryEligibleMode,
}: {
  modes: DraftMode[];
  inputs: InputDefinition[];
  workflow: Workflow;
  onChange: (
    modeIndex: number,
    inputId: string,
    patch: Partial<ModeInputSetting>,
  ) => void;
  onApplyToEveryEligibleMode: (
    modeIndex: number,
    input: InputDefinition,
  ) => void;
}) {
  if (!inputs || inputs.length === 0) return null;

  return (
    <>
      <h4>Mode × Input grid</h4>
      <table>
        <thead>
          <tr>
            <th>Input</th>
            {modes.map((mode, i) => (
              <th key={mode.key}>{mode.name || `Mode ${i + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {inputs.map((input) => (
            <tr key={input.id}>
              <th scope="row">{input.label}</th>
              {modes.map((mode, modeIndex) => {
                const onPath =
                  mode.outputNodeIds.length > 0 &&
                  [...boundNodeIds(input)].some((id) =>
                    computeModePath(
                      workflowForMode(mode, inputs, workflow),
                      mode.outputNodeIds,
                      visibleBoundFieldsFor(mode, inputs),
                    ).nodeIds.has(id),
                  );
                const setting = modeInputSetting(mode.inputSettings, input.id);
                return (
                  <td
                    key={mode.key}
                    style={!onPath ? { opacity: 0.4 } : undefined}
                  >
                    <label>
                      State
                      <select
                        value={setting.state}
                        onChange={(event) =>
                          onChange(modeIndex, input.id, {
                            state: event.target.value as ModeInputState,
                            fixedValue:
                              event.target.value === "fixed"
                                ? setting.fixedValue
                                : null,
                          })
                        }
                      >
                        {MODE_INPUT_STATES
                          // ADR 0007: a Seed can't be fixed, or every
                          // Submission would draw the same one. An
                          // Image/Video/Audio Upload always takes a
                          // real Upload id (issue #48 CEO review, issue
                          // #51), so none of them can be fixed either.
                          // A Points Input always takes the user's own
                          // clicks (issue #52), same reasoning.
                          .filter(
                            (state) =>
                              state !== "fixed" ||
                              (input.kind !== "seed" &&
                                input.kind !== "image_upload" &&
                                input.kind !== "video_upload" &&
                                input.kind !== "audio_upload" &&
                                input.kind !== "points"),
                          )
                          .map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                      </select>
                    </label>

                    {setting.state === "fixed" && (
                      <FixedValueEditor
                        input={input}
                        value={setting.fixedValue}
                        onChange={(fixedValue) =>
                          onChange(modeIndex, input.id, { fixedValue })
                        }
                      />
                    )}

                    <label>
                      Mode label
                      <input
                        value={setting.label}
                        placeholder={input.label}
                        maxLength={60}
                        onChange={(event) =>
                          onChange(modeIndex, input.id, {
                            label: event.target.value,
                          })
                        }
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() =>
                        onApplyToEveryEligibleMode(modeIndex, input)
                      }
                    >
                      Apply to every Mode whose Path holds this Input
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
