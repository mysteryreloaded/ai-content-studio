import {
  MODEL_ATTRIBUTION_MAX_LENGTH,
  MODEL_TERMS_MAX_LENGTH,
  computeModePath,
  fieldKey,
  isValidModelLicenseUrl,
  listBindableFields,
  renderMarkdown,
} from "@ai-content-studio/shared";
import type {
  BindableField,
  InputDefinition,
  NumberInputDefinition,
  SelectInputDefinition,
  SelectOption,
  TextInputDefinition,
  Workflow,
} from "@ai-content-studio/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router-dom";

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
}

interface DraftMode {
  /** Client-only, stable across re-renders; stripped before saving. */
  key: string;
  name: string;
  description: string;
  outputNodeIds: string[];
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

function draftsFrom(detail: ModelDetail): DraftMode[] {
  return detail.modes.map((mode) => ({
    key: mode.id,
    name: mode.name,
    description: mode.description,
    outputNodeIds: mode.outputNodes.map((node) => node.nodeId),
  }));
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
    if (input.kind === "number") return field.valueType === "number";
    return true;
  });
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
    const bindings = [
      ...input.bindings,
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
  // Set right before navigating away after a successful delete: `dirty`
  // is still computed from this render's (pre-setForm(null)) state when
  // the blocker runs, since state updates haven't flushed yet, so without
  // this it would ask "Discard unsaved changes?" a second time right
  // after the Admin already confirmed the delete itself.
  const bypassBlockerRef = useRef(false);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the route's :id changes
  useEffect(() => {
    loadAttachedBackends();
    loadAllBackends();
  }, [id]);

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
  }

  async function handleDetach(backendId: string) {
    if (!detail) return;
    await fetch(`/api/admin/models/${detail.model.id}/backends/${backendId}`, {
      method: "DELETE",
    });
    loadAttachedBackends();
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
      const res = await fetch(`/api/admin/models/${detail.model.id}/modes`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: detail.model.version,
          modes: modesDraft.map(withoutKey),
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
    const created =
      newInputKind === "text"
        ? newTextInput()
        : newInputKind === "number"
          ? newNumberInput()
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

  const editingMode =
    editingModeIndex !== null ? (modesDraft?.[editingModeIndex] ?? null) : null;
  const editingPath =
    detail && editingMode && editingMode.outputNodeIds.length > 0
      ? computeModePath(detail.workflow, editingMode.outputNodeIds)
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
        disabled={togglingState}
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
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {attachedBackends.map((entry) => (
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
                    <button
                      type="button"
                      onClick={() => void handleDetach(entry.backend.id)}
                    >
                      Detach
                    </button>
                  </td>
                </tr>
              ))}
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
        <h3>Modes</h3>
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
            <button type="button" onClick={() => removeMode(index)}>
              Remove Mode
            </button>
          </fieldset>
        ))}

        <button type="button" onClick={addMode}>
          Add Mode
        </button>
        <button
          type="button"
          disabled={savingModes || !modesDirty}
          onClick={() => void handleSaveModes()}
        >
          Save Modes
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
        <h3>Inputs</h3>
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
        </select>
        <button type="button" onClick={addInput}>
          Add Input
        </button>
        <button
          type="button"
          disabled={savingInputs || !inputsDirty}
          onClick={() => void handleSaveInputs()}
        >
          Save Inputs
        </button>
        {inputsSaveError && <p role="alert">{inputsSaveError}</p>}
      </section>

      <section>
        <h3>Workflow</h3>
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
