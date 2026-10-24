// The Generation detail dialog (issue #57): opened at `/generations/<id>`,
// over the Gallery when the link is pasted. Shows the player, Download,
// facts, the Model/Mode/Attribution/times/id, the settings it ran with,
// and lets the owner reuse them on the Workbench or delete it. A missing
// id or someone else's Generation both read as "not found" — the API
// itself 404s either way, so this dialog never learns which.

import type { GenerationInputSetting } from "@ai-content-studio/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

interface GenerationAssetDetail {
  id: string;
  nodeId: string;
  sortOrder: number;
  kind: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
}

interface GenerationDetail {
  id: string;
  state: string;
  error: string | null;
  tries: number;
  submittedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  deletedAt: string | null;
  modelId: string;
  modelSlug: string;
  modelName: string;
  modelAttribution: string;
  modelDeleted: boolean;
  modeId: string;
  modeName: string;
  assets: GenerationAssetDetail[];
  settings: GenerationInputSetting[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function assetFacts(asset: GenerationAssetDetail): string {
  const parts: string[] = [];
  if (asset.width && asset.height) parts.push(`${asset.width}×${asset.height}`);
  if (asset.durationMs) parts.push(formatDuration(asset.durationMs));
  if (asset.fps) parts.push(`${Math.round(asset.fps)} fps`);
  parts.push(formatSize(asset.size));
  return parts.join(" · ");
}

function assetSrc(asset: GenerationAssetDetail): string {
  return `/api/assets/${asset.id}`;
}

function AssetPlayer({ asset }: { asset: GenerationAssetDetail }) {
  if (asset.kind === "video") {
    return (
      // biome-ignore lint/a11y/useMediaCaption: a generated Asset has no captions to offer.
      <video
        controls
        poster={`/api/assets/${asset.id}/poster`}
        src={assetSrc(asset)}
        className="generation-detail-player"
      />
    );
  }
  if (asset.kind === "audio") {
    return (
      // biome-ignore lint/a11y/useMediaCaption: a generated Asset has no captions to offer.
      <audio
        controls
        src={assetSrc(asset)}
        className="generation-detail-player"
      />
    );
  }
  return (
    <img src={assetSrc(asset)} alt="" className="generation-detail-player" />
  );
}

function PointsPreview({
  setting,
}: {
  setting: Extract<GenerationInputSetting, { kind: "points" }>;
}) {
  const width = setting.frameWidth ?? 1;
  const height = setting.frameHeight ?? 1;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="generation-detail-points"
      role="img"
      aria-label={`${setting.points.length} points drawn on the frame`}
    >
      <rect x={0} y={0} width={width} height={height} />
      {setting.points.map((point, i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: points have no other stable identity.
          key={i}
          cx={point.x}
          cy={point.y}
          r={Math.max(width, height) * 0.01}
        />
      ))}
    </svg>
  );
}

function SettingRow({ setting }: { setting: GenerationInputSetting }) {
  return (
    <div className="generation-detail-setting">
      <span className="generation-detail-setting-label">{setting.label}</span>
      {setting.kind === "upload" ? (
        setting.upload ? (
          <span className="generation-detail-setting-value">
            {setting.upload.thumbnailKey && (
              <img
                src={`/api/uploads/${setting.upload.id}/thumb`}
                alt=""
                className="generation-detail-upload-thumb"
              />
            )}
            {setting.upload.name} · {formatSize(setting.upload.size)}
            {setting.upload.durationMs
              ? ` · ${formatDuration(setting.upload.durationMs)}`
              : ""}
            {setting.upload.width && setting.upload.height
              ? ` · ${setting.upload.width}×${setting.upload.height}`
              : ""}
            {setting.upload.trimmedFromName
              ? ` · trimmed from ${setting.upload.trimmedFromName}`
              : null}
          </span>
        ) : (
          <span className="generation-detail-setting-value">None</span>
        )
      ) : setting.kind === "points" ? (
        <span className="generation-detail-setting-value">
          <PointsPreview setting={setting} />
          {setting.display}
        </span>
      ) : (
        <span className="generation-detail-setting-value">
          {setting.display}
        </span>
      )}
    </div>
  );
}

function runTime(
  startedAt: string | null,
  endedAt: string | null,
): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return null;
  return formatDuration(ms);
}

export function GenerationDetailOverlay({
  id,
  prevId,
  nextId,
  onClose,
  onNavigate,
  onDeleted,
}: {
  id: string;
  prevId: string | null;
  nextId: string | null;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<GenerationDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setDetail(null);
    setNotFound(false);
    setCopied(false);
    setDeleteError(null);
    let cancelled = false;
    fetch(`/api/generations/${id}`)
      .then((res) => {
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<GenerationDetail>;
      })
      .then((body) => {
        if (!cancelled && body) setDetail(body);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft" && prevId) onNavigate(prevId);
      else if (event.key === "ArrowRight" && nextId) onNavigate(nextId);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [prevId, nextId, onNavigate]);

  async function handleDelete() {
    if (!window.confirm("Delete this Generation? This can't be undone.")) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/generations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`unexpected status ${res.status}`);
      onDeleted(id);
      onClose();
    } catch {
      setDeleteError("Could not delete this Generation.");
    } finally {
      setDeleting(false);
    }
  }

  function handleCopyId() {
    navigator.clipboard?.writeText(id).then(
      () => setCopied(true),
      () => {},
    );
  }

  const mainAsset = detail?.assets[0];
  const ended =
    detail &&
    !["queued", "starting", "running", "saving", "cancelling"].includes(
      detail.state,
    );

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="generation-detail-dialog"
    >
      <style>{GENERATION_DETAIL_STYLE}</style>
      <div className="generation-detail-nav">
        <button
          type="button"
          disabled={!prevId}
          onClick={() => prevId && onNavigate(prevId)}
          aria-label="Previous Generation"
        >
          ←
        </button>
        <button
          type="button"
          disabled={!nextId}
          onClick={() => nextId && onNavigate(nextId)}
          aria-label="Next Generation"
        >
          →
        </button>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close"
          className="generation-detail-close"
        >
          ×
        </button>
      </div>

      {notFound && <p role="alert">Not found.</p>}
      {!notFound && !detail && <p>Loading…</p>}

      {detail && (
        <>
          <header className="generation-detail-header">
            <h2>
              <Link to={`/models/${detail.modelSlug}`}>{detail.modelName}</Link>
              {" · "}
              {detail.modeName}
            </h2>
            {detail.modelAttribution && <p>{detail.modelAttribution}</p>}
          </header>

          {detail.deletedAt ? (
            <p>Deleted.</p>
          ) : (
            <>
              {detail.state === "succeeded" && mainAsset ? (
                <>
                  <AssetPlayer asset={mainAsset} />
                  <p className="generation-detail-download">
                    <a href={`/api/assets/${mainAsset.id}?download=1`}>
                      Download
                    </a>{" "}
                    <span className="generation-detail-ai-reminder">
                      AI-generated: say so when you share it.
                    </span>
                  </p>
                  <p>{assetFacts(mainAsset)}</p>
                  {detail.assets.length > 1 && (
                    <ul className="generation-detail-extra-assets">
                      {detail.assets.slice(1).map((asset) => (
                        <li key={asset.id}>
                          <a href={`/api/assets/${asset.id}?download=1`}>
                            Download
                          </a>{" "}
                          {assetFacts(asset)}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : detail.state === "failed" ? (
                <p role="alert">{detail.error ?? "This Generation failed."}</p>
              ) : (
                <p>{detail.state}</p>
              )}

              <dl className="generation-detail-facts">
                <dt>Submitted</dt>
                <dd>{new Date(detail.submittedAt).toLocaleString()}</dd>
                {ended && (
                  <>
                    <dt>Run time</dt>
                    <dd>{runTime(detail.startedAt, detail.endedAt) ?? "—"}</dd>
                  </>
                )}
                <dt>Id</dt>
                <dd>
                  <code>{detail.id}</code>{" "}
                  <button type="button" onClick={handleCopyId}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </dd>
              </dl>

              {detail.settings.length > 0 && (
                <section>
                  <h3>Settings</h3>
                  {detail.settings.map((setting) => (
                    <SettingRow key={setting.inputId} setting={setting} />
                  ))}
                </section>
              )}

              <div className="generation-detail-actions">
                {ended && !detail.modelDeleted && (
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/models/${detail.modelSlug}?reuse=${detail.id}`)
                    }
                  >
                    Reuse these settings
                  </button>
                )}
                {ended && (
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                  >
                    Delete
                  </button>
                )}
              </div>
              {deleteError && <p role="alert">{deleteError}</p>}
            </>
          )}
        </>
      )}
    </dialog>
  );
}

const GENERATION_DETAIL_STYLE = `
.generation-detail-dialog {
  width: min(640px, 100vw);
  max-height: 90vh;
  overflow-y: auto;
}
.generation-detail-nav {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}
.generation-detail-close {
  margin-left: auto;
}
.generation-detail-player {
  width: 100%;
  max-height: 60vh;
  object-fit: contain;
  display: block;
}
.generation-detail-ai-reminder {
  opacity: 0.7;
  font-size: 0.85rem;
}
.generation-detail-facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.25rem 0.75rem;
}
.generation-detail-setting {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}
.generation-detail-upload-thumb {
  width: 2rem;
  height: 2rem;
  object-fit: cover;
  vertical-align: middle;
  margin-right: 0.25rem;
}
.generation-detail-points {
  width: 3rem;
  height: 3rem;
  vertical-align: middle;
  background: rgba(128, 128, 128, 0.15);
  margin-right: 0.25rem;
}
.generation-detail-points rect {
  fill: none;
  stroke: currentColor;
  opacity: 0.3;
}
.generation-detail-points circle {
  fill: red;
}
.generation-detail-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}
@media (max-width: 640px) {
  .generation-detail-dialog {
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    max-width: 100vw;
    margin: 0;
    border-radius: 0;
  }
}
`;
