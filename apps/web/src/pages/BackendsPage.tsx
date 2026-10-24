import { type FormEvent, useEffect, useState } from "react";

type AuthKind = "none" | "basic" | "header";
type Reachability = "unknown" | "reachable" | "unreachable";

interface BackendHealth {
  reachability: Reachability;
  comfyuiVersion: string | null;
  vramTotal: number | null;
  vramFree: number | null;
  credentialsError: boolean;
}

interface AdminBackend {
  id: string;
  name: string;
  baseUrl: string;
  auth: AuthKind;
  headerName: string | null;
  version: number;
  health: BackendHealth;
}

interface BackendsResponse {
  backends: AdminBackend[];
  disabledBanner: string | null;
}

interface FormState {
  id: string | null;
  version: number | null;
  name: string;
  baseUrl: string;
  auth: AuthKind;
  basicUser: string;
  basicPass: string;
  headerName: string;
  headerValue: string;
}

const BLANK_FORM: FormState = {
  id: null,
  version: null,
  name: "",
  baseUrl: "",
  auth: "none",
  basicUser: "",
  basicPass: "",
  headerName: "",
  headerValue: "",
};

function formatVram(bytes: number | null): string {
  if (bytes === null) return "–";
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

function healthLabel(backend: AdminBackend): string {
  const { health } = backend;
  if (health.credentialsError) return "re-enter credentials";
  return health.reachability;
}

/** The Backends admin page: register, health and History (issue #39). */
export function BackendsPage() {
  const [data, setData] = useState<BackendsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    fetch("/api/admin/backends")
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<BackendsResponse>;
      })
      .then((body) => {
        setData(body);
        setLoadError(null);
      })
      .catch(() => setLoadError("could not load Backends"));
  }

  useEffect(load, []);

  function startAdd() {
    setForm(BLANK_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function startEdit(backend: AdminBackend) {
    setForm({
      id: backend.id,
      version: backend.version,
      name: backend.name,
      baseUrl: backend.baseUrl,
      auth: backend.auth,
      basicUser: "",
      basicPass: "",
      headerName: backend.headerName ?? "",
      headerValue: "",
    });
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    const body: Record<string, unknown> = {
      name: form.name,
      baseUrl: form.baseUrl,
      auth: form.auth,
    };
    if (form.auth === "basic") {
      if (form.basicUser) body.basicUser = form.basicUser;
      if (form.basicPass) body.basicPass = form.basicPass;
    }
    if (form.auth === "header") {
      if (form.headerName) body.headerName = form.headerName;
      if (form.headerValue) body.headerValue = form.headerValue;
    }

    const isEdit = form.id !== null;
    if (isEdit) body.version = form.version;

    try {
      const res = await fetch(
        isEdit ? `/api/admin/backends/${form.id}` : "/api/admin/backends",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (res.status === 409) {
        const payload = await res
          .json()
          .catch(() => ({ error: "changed by someone else, reload" }));
        setFormError(payload.error ?? "changed by someone else, reload");
        return;
      }
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

      setFormOpen(false);
      setForm(BLANK_FORM);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(backend: AdminBackend) {
    const res = await fetch(
      `/api/admin/backends/${backend.id}?version=${backend.version}`,
      {
        method: "DELETE",
      },
    );
    if (res.status === 409) {
      setLoadError("changed by someone else, reload");
      return;
    }
    load();
  }

  return (
    <section>
      <h2>Backends</h2>

      {data?.disabledBanner && <p role="alert">{data.disabledBanner}</p>}
      {loadError && <p role="alert">{loadError}</p>}

      {!data && !loadError && <p>Loading…</p>}

      {data && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Base URL</th>
              <th>Health</th>
              <th>ComfyUI version</th>
              <th>VRAM</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.backends.map((backend) => (
              <tr key={backend.id}>
                <td>{backend.name}</td>
                <td>{backend.baseUrl}</td>
                <td>{healthLabel(backend)}</td>
                <td>{backend.health.comfyuiVersion ?? "–"}</td>
                <td>{formatVram(backend.health.vramFree)}</td>
                <td>
                  <button type="button" onClick={() => startEdit(backend)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(backend)}
                  >
                    Delete
                  </button>
                  <a href={`/api/admin/backends/${backend.id}/history`}>
                    History
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!formOpen && (
        <button type="button" onClick={startAdd}>
          Add Backend
        </button>
      )}

      {formOpen && (
        <form onSubmit={(event) => void handleSubmit(event)}>
          <h3>{form.id ? "Edit Backend" : "Add Backend"}</h3>

          <label htmlFor="backend-name">Name</label>
          <input
            id="backend-name"
            value={form.name}
            maxLength={60}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />

          <label htmlFor="backend-base-url">Base URL</label>
          <input
            id="backend-base-url"
            value={form.baseUrl}
            onChange={(event) =>
              setForm({ ...form, baseUrl: event.target.value })
            }
          />

          <fieldset>
            <legend>Auth</legend>
            {(["none", "basic", "header"] as const).map((kind) => (
              <label key={kind}>
                <input
                  type="radio"
                  name="auth"
                  value={kind}
                  checked={form.auth === kind}
                  onChange={() => setForm({ ...form, auth: kind })}
                />
                {kind}
              </label>
            ))}
          </fieldset>

          {form.auth === "basic" && (
            <>
              <label htmlFor="backend-basic-user">Username</label>
              <input
                id="backend-basic-user"
                placeholder={form.id ? "(unchanged)" : ""}
                value={form.basicUser}
                onChange={(event) =>
                  setForm({ ...form, basicUser: event.target.value })
                }
              />
              <label htmlFor="backend-basic-pass">Password</label>
              <input
                id="backend-basic-pass"
                type="password"
                placeholder={form.id ? "(unchanged)" : ""}
                value={form.basicPass}
                onChange={(event) =>
                  setForm({ ...form, basicPass: event.target.value })
                }
              />
            </>
          )}

          {form.auth === "header" && (
            <>
              <label htmlFor="backend-header-name">Header name</label>
              <input
                id="backend-header-name"
                value={form.headerName}
                onChange={(event) =>
                  setForm({ ...form, headerName: event.target.value })
                }
              />
              <label htmlFor="backend-header-value">Header value</label>
              <input
                id="backend-header-value"
                type="password"
                placeholder={form.id ? "(unchanged)" : ""}
                value={form.headerValue}
                onChange={(event) =>
                  setForm({ ...form, headerValue: event.target.value })
                }
              />
            </>
          )}

          <button type="submit" disabled={saving}>
            Save
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
