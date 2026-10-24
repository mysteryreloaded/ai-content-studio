// A Generation's own detail, for an Admin (issue #68): read-only, plus
// Remove with a required reason. Unlike the owner's detail dialog, this
// never offers Reuse, and keeps the values/prompt/Upload links visible
// even once it's been removed (only a Tombstone empties them).

import type { GenerationInputSetting } from "@ai-content-studio/shared";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

interface AdminGenerationAsset {
  id: string;
  nodeId: string;
  sortOrder: number;
  kind: string;
  contentType: string;
  size: number;
}

interface AdminGenerationDetail {
  id: string;
  state: string;
  error: string | null;
  tries: number;
  submittedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  deletedAt: string | null;
  removedAt: string | null;
  removedReason: string | null;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  modelId: string;
  modelSlug: string;
  modelName: string;
  modelAttribution: string;
  modelDeleted: boolean;
  modeId: string;
  modeName: string;
  assets: AdminGenerationAsset[];
  settings: GenerationInputSetting[];
}

function settingValue(setting: GenerationInputSetting): string {
  if (setting.kind === "upload") {
    if (!setting.upload) return "None";
    if (setting.upload.removed) return "Removed by an administrator";
    return `${setting.upload.name} (${setting.upload.id})`;
  }
  return setting.display;
}

/** The Admin Generations page's read-only detail (issue #68). */
export function AdminGenerationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AdminGenerationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function load() {
    if (!id) return;
    fetch(`/api/admin/generations/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<AdminGenerationDetail>;
      })
      .then((body) => {
        setDetail(body);
        setLoadError(null);
      })
      .catch(() => setLoadError("could not load this Generation"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is re-created each render, id is the actual dependency
  useEffect(load, [id]);

  async function handleRemove() {
    if (!id) return;
    setRemoveError(null);
    if (reason.trim().length === 0) {
      setRemoveError("a reason is required");
      return;
    }
    setRemoving(true);
    try {
      const res = await fetch(`/api/admin/generations/${id}/remove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error(`unexpected status ${res.status}`);
      load();
      setReason("");
    } catch {
      setRemoveError("could not remove this Generation");
    } finally {
      setRemoving(false);
    }
  }

  if (loadError) return <p role="alert">{loadError}</p>;
  if (!detail) return <p>Loading…</p>;

  const canRemove = !detail.deletedAt && !detail.removedAt;

  return (
    <section>
      <button type="button" onClick={() => navigate(-1)}>
        ← Back
      </button>
      <h2>
        {detail.modelName} · {detail.modeName}
      </h2>
      {detail.modelAttribution && <p>{detail.modelAttribution}</p>}

      <dl>
        <dt>Owner</dt>
        <dd>
          <Link to={`/admin/users/${detail.ownerId}`}>
            {detail.ownerName} ({detail.ownerEmail})
          </Link>
        </dd>
        <dt>State</dt>
        <dd>
          {detail.deletedAt
            ? "deleted"
            : detail.removedAt
              ? "removed"
              : detail.state}
        </dd>
        {detail.error && (
          <>
            <dt>Error</dt>
            <dd role="alert">{detail.error}</dd>
          </>
        )}
        <dt>Submitted</dt>
        <dd>{new Date(detail.submittedAt).toLocaleString()}</dd>
        {detail.endedAt && (
          <>
            <dt>Ended</dt>
            <dd>{new Date(detail.endedAt).toLocaleString()}</dd>
          </>
        )}
        <dt>Id</dt>
        <dd>
          <code>{detail.id}</code>
        </dd>
        {detail.removedAt && (
          <>
            <dt>Removed</dt>
            <dd>
              {new Date(detail.removedAt).toLocaleString()} —{" "}
              {detail.removedReason}
            </dd>
          </>
        )}
      </dl>

      {detail.deletedAt ? (
        <p>
          This Generation was deleted by its owner; nothing is left to show.
        </p>
      ) : (
        <>
          {detail.assets.length > 0 && (
            <section>
              <h3>Assets</h3>
              <ul>
                {detail.assets.map((asset) => (
                  <li key={asset.id}>
                    <a href={`/api/assets/${asset.id}?download=1`}>
                      {asset.kind} ({asset.contentType}, {asset.size} bytes)
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail.settings.length > 0 && (
            <section>
              <h3>Settings</h3>
              <dl>
                {detail.settings.map((setting) => (
                  <div key={setting.inputId}>
                    <dt>{setting.label}</dt>
                    <dd>{settingValue(setting)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </>
      )}

      {canRemove && (
        <section>
          <h3>Remove this Generation</h3>
          <label htmlFor="admin-generation-remove-reason">
            Reason (required, up to 500 characters)
          </label>
          <textarea
            id="admin-generation-remove-reason"
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={removing}
          >
            Remove
          </button>
          {removeError && <p role="alert">{removeError}</p>}
        </section>
      )}
    </section>
  );
}
