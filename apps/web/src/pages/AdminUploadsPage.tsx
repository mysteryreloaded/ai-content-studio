// A user's own Uploads, for an Admin (issue #68's AC): read-only, plus
// Remove with a required reason.

import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

interface AdminUpload {
  id: string;
  originalName: string;
  size: number;
  kind: string | null;
  contentType: string | null;
  createdAt: string;
  removedAt: string | null;
  removedReason: string | null;
}

/** `/admin/users/:id/uploads` (issue #68). */
export function AdminUploadsPage() {
  const { id: userId } = useParams<{ id: string }>();
  const [uploads, setUploads] = useState<AdminUpload[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [removeError, setRemoveError] = useState<string | null>(null);

  function load() {
    if (!userId) return;
    fetch(`/api/admin/uploads?user=${userId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ uploads: AdminUpload[] }>;
      })
      .then((body) => {
        setUploads(body.uploads);
        setLoadError(null);
      })
      .catch(() => setLoadError("could not load Uploads"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is re-created each render, userId is the actual dependency
  useEffect(load, [userId]);

  async function handleRemove(event: FormEvent, uploadId: string) {
    event.preventDefault();
    setRemoveError(null);
    const reason = (reasonById[uploadId] ?? "").trim();
    if (!reason) {
      setRemoveError("a reason is required");
      return;
    }
    const res = await fetch(`/api/admin/uploads/${uploadId}/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      setRemoveError("could not remove this Upload");
      return;
    }
    load();
  }

  if (loadError) return <p role="alert">{loadError}</p>;
  if (!uploads) return <p>Loading…</p>;

  return (
    <section>
      <h2>Uploads</h2>
      {removeError && <p role="alert">{removeError}</p>}
      {uploads.length === 0 && <p>This user has no Uploads.</p>}
      {uploads.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Size</th>
              <th>Uploaded</th>
              <th>Status</th>
              <th>Remove</th>
            </tr>
          </thead>
          <tbody>
            {uploads.map((upload) => (
              <tr key={upload.id}>
                <td>{upload.originalName}</td>
                <td>{upload.kind ?? "—"}</td>
                <td>{upload.size} bytes</td>
                <td>{new Date(upload.createdAt).toLocaleString()}</td>
                <td>
                  {upload.removedAt ? `Removed: ${upload.removedReason}` : "—"}
                </td>
                <td>
                  {!upload.removedAt && (
                    <form
                      onSubmit={(event) => void handleRemove(event, upload.id)}
                    >
                      <label htmlFor={`upload-reason-${upload.id}`}>
                        Reason
                      </label>
                      <input
                        id={`upload-reason-${upload.id}`}
                        maxLength={500}
                        value={reasonById[upload.id] ?? ""}
                        onChange={(event) =>
                          setReasonById({
                            ...reasonById,
                            [upload.id]: event.target.value,
                          })
                        }
                      />
                      <button type="submit">Remove</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
