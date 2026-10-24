import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";

export interface AdminModel {
  id: string;
  name: string;
  slug: string;
  state: "enabled" | "disabled";
  sortOrder: number;
  currentRevision: number;
  version: number;
}

async function readFileAsJson(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}

/** The Models admin list: Admin order with up/down, state and revision, plus "New Model" (issue #40). */
export function ModelsPage() {
  const [models, setModels] = useState<AdminModel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function load() {
    fetch("/api/admin/models")
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ models: AdminModel[] }>;
      })
      .then((body) => {
        setModels(body.models);
        setLoadError(null);
      })
      .catch(() => setLoadError("could not load Models"));
  }

  useEffect(load, []);

  async function move(id: string, direction: "up" | "down") {
    const res = await fetch(`/api/admin/models/${id}/move-${direction}`, {
      method: "POST",
    });
    if (res.ok) {
      const body = (await res.json()) as { models: AdminModel[] };
      setModels(body.models);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setFormError("choose a Workflow file");
      return;
    }
    setSaving(true);
    setFormError(null);
    setNotes([]);

    try {
      let workflow: unknown;
      try {
        workflow = await readFileAsJson(file);
      } catch {
        setFormError("that file isn't valid JSON");
        return;
      }

      const res = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, workflow }),
      });

      if (!res.ok) {
        const payload = await res
          .json()
          .catch(() => ({ error: "save failed" }));
        const issues = Array.isArray(payload.errors)
          ? payload.errors
              .map(
                (e: { field: string; message: string }) =>
                  `${e.field}: ${e.message}`,
              )
              .join(", ")
          : null;
        setFormError(issues ?? payload.error ?? "save failed");
        return;
      }

      const body = (await res.json()) as {
        outsideServiceNotes: { classType: string; keySet: boolean }[];
      };
      setNotes(
        body.outsideServiceNotes
          .filter((note) => !note.keySet)
          .map(
            (note) =>
              `${note.classType} has no key set in the Workflow; set it on the Backend instead`,
          ),
      );

      setFormOpen(false);
      setName("");
      setFile(null);
      load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2>Models</h2>

      {loadError && <p role="alert">{loadError}</p>}
      {!models && !loadError && <p>Loading…</p>}

      {models && (
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Name</th>
              <th>State</th>
              <th>Revision</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model, index) => (
              <tr key={model.id}>
                <td>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => void move(model.id, "up")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === models.length - 1}
                    onClick={() => void move(model.id, "down")}
                  >
                    ↓
                  </button>
                </td>
                <td>
                  <Link to={`/admin/models/${model.id}`}>{model.name}</Link>
                </td>
                <td>{model.state}</td>
                <td>{model.currentRevision}</td>
                <td>
                  <Link to={`/admin/models/${model.id}`}>Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {notes.length > 0 && (
        <ul>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {!formOpen && (
        <button type="button" onClick={() => setFormOpen(true)}>
          New Model
        </button>
      )}

      {formOpen && (
        <form onSubmit={(event) => void handleSubmit(event)}>
          <h3>New Model</h3>

          <label htmlFor="model-name">Name</label>
          <input
            id="model-name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />

          <label htmlFor="model-workflow">Workflow (API format JSON)</label>
          <input
            id="model-workflow"
            type="file"
            accept="application/json"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />

          <button type="submit" disabled={saving}>
            Create
          </button>
          <button type="button" onClick={() => setFormOpen(false)}>
            Cancel
          </button>
          {formError && <p role="alert">{formError}</p>}
        </form>
      )}
    </section>
  );
}
