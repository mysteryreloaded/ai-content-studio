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
  nodes: ModelNode[];
  outsideServiceNotes: OutsideServiceNote[];
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
        setLoadError(null);
      })
      .catch(() => setLoadError("could not load this Model"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the route's :id changes
  useEffect(load, [id]);

  const dirty = Boolean(
    detail && form && !sameDetails(detailsFrom(detail), form),
  );

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Catches every in-app navigation away from the editor while dirty: the
  // "Back to Models" button, AdminShell's nav links, and the browser's
  // own Back/Forward (issue #40 follow-up: beforeunload alone misses all
  // three since they never unload the page).
  useBlocker(({ currentLocation, nextLocation }) => {
    if (
      bypassBlockerRef.current ||
      !dirty ||
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
        <h3>Workflow</h3>
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
            </tr>
          </thead>
          <tbody>
            {filteredNodes.map((node) => (
              <tr key={node.id}>
                <td>{node.id}</td>
                <td>{node.classType}</td>
                <td>{node.title ?? ""}</td>
              </tr>
            ))}
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
