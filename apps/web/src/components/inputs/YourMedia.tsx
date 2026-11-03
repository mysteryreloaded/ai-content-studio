import { Fragment } from "react";
import type { ElementType } from "react";
import type {
  MediaUploadInput,
  TrimRange,
  UploadState,
  VideoUploadInput,
} from "./types.js";

const VIDEO_ACCEPT = ".mp4,.mov,.webm,.mkv";
const AUDIO_ACCEPT = ".wav,.mp3,.flac,.ogg,.opus,.m4a,.aac";

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

/** The Workbench's Video/Audio Upload Inputs (issue #51): pick a file, watch it upload, then optionally trim it on a local player. */
export function YourMedia({
  inputs,
  uploads,
  trimRangeByInputId,
  onTrimRangeChange,
  issuesByInputId,
  onPick,
  bare = false,
}: {
  inputs: MediaUploadInput[];
  uploads: Record<string, UploadState>;
  trimRangeByInputId: Record<string, TrimRange>;
  onTrimRangeChange: (inputId: string, range: TrimRange) => void;
  issuesByInputId: Record<string, string>;
  onPick: (input: MediaUploadInput, file: File) => void;
  bare?: boolean;
}) {
  if (inputs.length === 0) return null;
  const Wrapper: ElementType = bare ? Fragment : "fieldset";
  return (
    <Wrapper>
      {!bare && <legend>Your media</legend>}
      {inputs.map((input) => {
        const upload = uploads[input.id];
        const issue =
          upload?.status === "error"
            ? upload.message
            : upload?.status === "uploading"
              ? undefined
              : issuesByInputId[input.id];
        const issueId = issue ? `input-issue-${input.id}` : undefined;
        const isVideo = input.kind === "video_upload";
        const range = trimRangeByInputId[input.id];
        const canTrim =
          input.trimmable &&
          upload?.status === "complete" &&
          upload.durationMs !== null &&
          upload.browserPlayable !== false;
        return (
          <div key={input.id}>
            <label htmlFor={`input-${input.id}`}>{input.label}</label>
            {input.help && <p>{input.help}</p>}
            <input
              id={`input-${input.id}`}
              type="file"
              accept={isVideo ? VIDEO_ACCEPT : AUDIO_ACCEPT}
              required
              aria-describedby={issueId}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPick(input, file);
              }}
            />
            <p>
              {isVideo
                ? "MP4, MOV, WebM or MKV"
                : "WAV, MP3, FLAC, OGG/Opus or M4A/AAC"}
              , up to {input.maxSizeMb} MB, {formatSeconds(input.minDurationMs)}
              –{formatSeconds(input.maxDurationMs)}s
              {isVideo &&
                (input as VideoUploadInput).maxLongSide !== null &&
                `, at most ${(input as VideoUploadInput).maxLongSide} px on its long side`}
              .
            </p>
            {upload?.status === "uploading" && (
              <progress
                aria-label={`Uploading ${upload.name}`}
                max={1}
                value={upload.progress}
              />
            )}
            {upload?.status === "complete" && (
              <div>
                <p>{upload.name}</p>
                {upload.browserPlayable === false ? (
                  <p>
                    This browser can't preview this file, so it's used as
                    uploaded, untrimmed.
                  </p>
                ) : isVideo ? (
                  // biome-ignore lint/a11y/useMediaCaption: a user's own upload has no captions to offer.
                  <video
                    controls
                    src={`/api/uploads/${upload.uploadId}`}
                    className="workbench-thumb"
                  />
                ) : (
                  // biome-ignore lint/a11y/useMediaCaption: a user's own upload has no captions to offer.
                  <audio controls src={`/api/uploads/${upload.uploadId}`} />
                )}
                {canTrim && range && (
                  <div>
                    <label htmlFor={`input-trim-start-${input.id}`}>
                      Start (s)
                    </label>
                    <input
                      id={`input-trim-start-${input.id}`}
                      type="number"
                      min={0}
                      max={formatSeconds(range.endMs)}
                      step={0.1}
                      value={formatSeconds(range.startMs)}
                      onChange={(event) => {
                        const startMs = Math.round(
                          Number(event.target.value) * 1000,
                        );
                        if (Number.isFinite(startMs)) {
                          onTrimRangeChange(input.id, { ...range, startMs });
                        }
                      }}
                    />
                    <label htmlFor={`input-trim-end-${input.id}`}>
                      End (s)
                    </label>
                    <input
                      id={`input-trim-end-${input.id}`}
                      type="number"
                      min={formatSeconds(range.startMs)}
                      max={formatSeconds(upload.durationMs ?? 0)}
                      step={0.1}
                      value={formatSeconds(range.endMs)}
                      onChange={(event) => {
                        const endMs = Math.round(
                          Number(event.target.value) * 1000,
                        );
                        if (Number.isFinite(endMs)) {
                          onTrimRangeChange(input.id, { ...range, endMs });
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            {issue && (
              <p id={issueId} role="alert">
                {issue}
              </p>
            )}
          </div>
        );
      })}
    </Wrapper>
  );
}
