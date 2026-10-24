import { computeModePath } from "@ai-content-studio/shared";
import type { Workflow } from "@ai-content-studio/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router-dom";

interface ModelNode {
  id: string;
  classType: string;
  title: string | null;
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
  };
  workflowHash: string;
  workflow: Workflow;
  nodes: ModelNode[];
  outsideServiceNotes: OutsideServiceNote[];
  modes: ModeRecord[];
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
  const [stateError, setStateError] = useState<string[] | null>(null);
  const [togglingState, setTogglingState] = useState(false);
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
        setStateError(null);
        setLoadError(null);
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

  const editingMode =
    editingModeIndex !== null ? (modesDraft?.[editingModeIndex] ?? null) : null;
  const editingPath =
    detail && editingMode && editingMode.outputNodeIds.length > 0
      ? computeModePath(detail.workflow, editingMode.outputNodeIds)
      : null;

  useEffect(() => {
    if (!dirty && !modesDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, modesDirty]);

  // Catches every in-app navigation away from the editor while dirty: the
  // "Back to Models" button, AdminShell's nav links, and the browser's
  // own Back/Forward (issue #40 follow-up: beforeunload alone misses all
  // three since they never unload the page).
  useBlocker(({ currentLocation, nextLocation }) => {
    if (
      bypassBlockerRef.current ||
      (!dirty && !modesDirty) ||
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
      </section>

      <button type="button" onClick={() => void handleDelete()}>
        Delete
      </button>
      {deleteError && <p role="alert">{deleteError}</p>}
    </section>
  );
}
