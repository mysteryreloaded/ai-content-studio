// The Generation detail dialog's body (issue #199): the player/placeholder
// column and the grouped settings column, as plain-props pieces so the
// Admin's read-only detail (#209) can reuse `GenerationMediaPanel` and
// `GenerationSettingsList` without the owner-only actions row.

import type { GenerationInputSetting } from "@ai-content-studio/shared";
import { resolvePointsFractions } from "@ai-content-studio/shared";
import { cn } from "cn";
import { AudioLines, Download } from "lucide-react";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { Button } from "../ui/button.js";
import { Pill } from "../ui/pill.js";
import { AssetPlayer } from "./AssetPlayer.js";
import { CopyButton } from "./CopyButton.js";
import { genStatus } from "./stateLabel.js";
import type { GenerationState, GenerationSummary } from "./types.js";

export interface GenerationAssetDetail {
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

export interface GenerationDetail {
  id: string;
  state: GenerationState;
  error: string | null;
  tries: number;
  submittedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  deletedAt: string | null;
  /** Issue #68: an Admin removed this Generation — a dismissable card, no reason, no Reuse. */
  removedAt: string | null;
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

export function formatSize(bytes: number): string {
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

/** The agreed duration form (issue #199's AC): one decimal under a minute ("5.0 s"), else "m:ss". */
export function formatDuration(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} s`;
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** "0:02.0" — minutes:seconds.tenths, for a trim range's own edges. */
function formatTrimTime(ms: number): string {
  const totalTenths = Math.round(ms / 100);
  const minutes = Math.floor(totalTenths / 600);
  const secondsTenths = totalTenths % 600;
  const seconds = Math.floor(secondsTenths / 10);
  const tenth = secondsTenths % 10;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenth}`;
}

export function assetFacts(asset: GenerationAssetDetail): string {
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

export function runTime(
  startedAt: string | null,
  endedAt: string | null,
): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return null;
  return formatDuration(ms);
}

/** The `.ph` placeholder: the state pill, and the failure message for a failed Generation. */
function MediaPlaceholder({ detail }: { detail: GenerationDetail }) {
  const status = genStatus(detail as unknown as GenerationSummary, {
    paused: false,
    progress: undefined,
  });
  const mainAsset = detail.assets[0];
  const ratio =
    mainAsset?.width && mainAsset?.height
      ? mainAsset.width / mainAsset.height
      : 16 / 9;
  return (
    <div
      className="relative max-h-[70vh] w-full overflow-hidden rounded-xl bg-media"
      style={{ aspectRatio: `${ratio}` }}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-2.5 text-center text-media-foreground">
        <Pill tone={status.tone}>{status.pill}</Pill>
        {detail.state === "failed" && detail.error && (
          <p className="max-w-[26ch] text-[13px]">{detail.error}</p>
        )}
      </div>
    </div>
  );
}

/** The player or placeholder, Download + the AI note, facts, other Assets and Attribution (issue #199's AC). */
export function GenerationMediaPanel({ detail }: { detail: GenerationDetail }) {
  const mainAsset = detail.assets[0];
  const hasPlayableMain = detail.state === "succeeded" && !!mainAsset;

  return (
    <>
      {hasPlayableMain && mainAsset ? (
        <div className="max-h-[70vh] overflow-hidden rounded-xl">
          <AssetPlayer asset={mainAsset} />
        </div>
      ) : (
        <MediaPlaceholder detail={detail} />
      )}
      {hasPlayableMain && mainAsset && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`${assetSrc(mainAsset)}?download=1`} download>
                <Download />
                Download
              </a>
            </Button>
            <span className="text-[12.5px] text-muted-foreground">
              AI-generated: say so when you share it.
            </span>
          </div>
          <p className="text-[12.5px] text-muted-foreground tabular-nums">
            {assetFacts(mainAsset)}
          </p>
        </>
      )}
      {detail.assets.length > 1 && (
        <ul className="flex flex-col gap-1.5">
          {detail.assets.slice(1).map((asset) => (
            <li key={asset.id} className="flex items-center gap-2">
              <Button asChild variant="outline" size="xs">
                <a href={`${assetSrc(asset)}?download=1`} download>
                  <Download />
                  Download
                </a>
              </Button>
              <span className="text-[12.5px] text-muted-foreground tabular-nums">
                {assetFacts(asset)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {detail.modelAttribution && (
        <p className="text-[12.5px] text-muted-foreground">
          {detail.modelAttribution}
        </p>
      )}
    </>
  );
}

function UploadThumbLink({
  uploadId,
  thumbnailKey,
  children,
}: {
  uploadId: string;
  thumbnailKey: string | null;
  children: React.ReactNode;
}) {
  return (
    <a
      href={`/api/uploads/${uploadId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-nowrap items-center gap-2"
    >
      {thumbnailKey ? (
        <img
          src={`/api/uploads/${uploadId}/thumb`}
          alt=""
          className="size-9 rounded-md bg-muted object-cover"
        />
      ) : (
        <span className="flex size-9 items-center justify-center rounded-md bg-muted">
          <AudioLines className="size-4" />
        </span>
      )}
      {children}
    </a>
  );
}

function UploadValue({
  upload,
}: {
  upload: Extract<GenerationInputSetting, { kind: "upload" }>["upload"];
}) {
  if (!upload) return <span className="text-faint">None</span>;
  if (upload.removed) {
    return <span>Removed by an administrator</span>;
  }

  const metaParts: string[] = [formatSize(upload.size)];
  if (upload.width && upload.height) {
    metaParts.push(`${upload.width}×${upload.height}`);
  }
  if (upload.durationMs) metaParts.push(formatDuration(upload.durationMs));
  if (upload.trimmedFromName) {
    metaParts.push(
      upload.trimStartMs !== null && upload.trimEndMs !== null
        ? `trimmed from ${upload.trimmedFromName}, ${formatTrimTime(upload.trimStartMs)}–${formatTrimTime(upload.trimEndMs)}`
        : `trimmed from ${upload.trimmedFromName}`,
    );
  } else if (upload.trimStartMs !== null && upload.trimEndMs !== null) {
    metaParts.push(
      `trimmed ${formatTrimTime(upload.trimStartMs)}–${formatTrimTime(upload.trimEndMs)}`,
    );
  }

  return (
    <UploadThumbLink uploadId={upload.id} thumbnailKey={upload.thumbnailKey}>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{upload.name}</span>
        <span className="text-[12.5px] text-muted-foreground">
          {metaParts.join(" · ")}
        </span>
      </span>
    </UploadThumbLink>
  );
}

/** Points drawn on their video Upload's first frame (issue #199's AC); falls back to the text display when that frame isn't available. */
function PointsValue({
  setting,
  detail,
}: {
  setting: Extract<GenerationInputSetting, { kind: "points" }>;
  detail: GenerationDetail;
}) {
  const videoSetting = detail.settings.find(
    (s): s is Extract<GenerationInputSetting, { kind: "upload" }> =>
      s.kind === "upload" && s.inputId === setting.videoInputId,
  );
  const upload = videoSetting?.upload;

  if (
    !upload ||
    upload.removed ||
    !upload.thumbnailKey ||
    !upload.width ||
    !upload.height ||
    setting.frameWidth === null ||
    setting.frameHeight === null
  ) {
    return <span className="text-faint">{setting.display}</span>;
  }

  const fractions = resolvePointsFractions(
    setting.points,
    upload.width,
    upload.height,
    setting.frameWidth,
    setting.frameHeight,
  );

  return (
    <div
      className="relative block w-40 overflow-hidden rounded-sm"
      style={{ aspectRatio: `${upload.width}/${upload.height}` }}
    >
      <img
        src={`/api/uploads/${upload.id}/thumb`}
        alt=""
        className="size-full object-cover"
      />
      {fractions.map((point, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: points have no other stable identity.
          key={i}
          className="absolute size-2.5 -ml-[5px] -mt-[5px] rounded-full bg-[#2bd97a] shadow-[0_0_0_2px_#fff,0_2px_6px_rgb(0_0_0/0.5)]"
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
        />
      ))}
    </div>
  );
}

function SettingValue({
  setting,
  detail,
}: {
  setting: GenerationInputSetting;
  detail: GenerationDetail;
}) {
  switch (setting.kind) {
    case "text":
      return (
        <span
          className={cn(
            "whitespace-pre-wrap",
            setting.display !== setting.value && "text-faint",
          )}
        >
          {setting.display}
        </span>
      );
    case "number":
      return (
        <span
          className={cn(
            setting.display !== String(setting.value) && "text-faint",
          )}
        >
          {setting.display}
        </span>
      );
    case "select":
      return (
        <span
          className={cn(
            setting.display.startsWith("Default (") && "text-faint",
          )}
        >
          {setting.display}
        </span>
      );
    case "seed":
      return <span className="font-mono tabular-nums">{setting.display}</span>;
    case "upload":
      return <UploadValue upload={setting.upload} />;
    case "points":
      return <PointsValue setting={setting} detail={detail} />;
    default:
      return null;
  }
}

const SETTING_GROUPS: {
  title: string;
  kinds: GenerationInputSetting["kind"][];
}[] = [
  { title: "Your files", kinds: ["upload", "points"] },
  { title: "Describe it", kinds: ["text"] },
  { title: "Settings", kinds: ["number", "select", "seed"] },
];

/** Grouped settings `dl`s, then the meta `dl` (issue #199's AC). */
export function GenerationSettingsList({
  detail,
}: { detail: GenerationDetail }) {
  const ended =
    detail.state === "succeeded" ||
    detail.state === "failed" ||
    detail.state === "cancelled";

  return (
    <>
      {SETTING_GROUPS.map((group) => {
        const items = detail.settings.filter((s) =>
          group.kinds.includes(s.kind),
        );
        if (items.length === 0) return null;
        return (
          <div key={group.title} className="flex flex-col gap-2">
            <h3 className="text-[11px] leading-[1.2] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {group.title}
            </h3>
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-2 text-[13px]">
              {items.map((setting) => (
                <Fragment key={setting.inputId}>
                  <dt className="text-muted-foreground">{setting.label}</dt>
                  <dd className="min-w-0">
                    <SettingValue setting={setting} detail={detail} />
                  </dd>
                </Fragment>
              ))}
            </dl>
          </div>
        );
      })}

      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-2 border-t border-border pt-2.5 text-[13px]">
        <dt className="text-muted-foreground">Model</dt>
        <dd className="min-w-0">
          {detail.modelDeleted ? (
            detail.modelName
          ) : (
            <Link
              to={`/models/${detail.modelSlug}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {detail.modelName}
            </Link>
          )}
        </dd>
        <dt className="text-muted-foreground">Mode</dt>
        <dd className="min-w-0">{detail.modeName}</dd>
        <dt className="text-muted-foreground">Submitted</dt>
        <dd className="min-w-0">
          {new Date(detail.submittedAt).toLocaleString([], {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </dd>
        {ended && runTime(detail.startedAt, detail.endedAt) && (
          <>
            <dt className="text-muted-foreground">Ran for</dt>
            <dd className="min-w-0">
              {runTime(detail.startedAt, detail.endedAt)}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Generation</dt>
        <dd className="flex min-w-0 items-center gap-1">
          <span className="font-mono text-[12.5px] [overflow-wrap:anywhere]">
            {detail.id}
          </span>
          <CopyButton text={detail.id} label="Copy Generation id" />
        </dd>
      </dl>
    </>
  );
}
