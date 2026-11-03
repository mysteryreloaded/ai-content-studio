import { Fragment } from "react";
import type { ElementType } from "react";
import type { ImageUploadInput, UploadState } from "./types.js";

/** The Workbench's Image Upload Inputs (issue #50), always required: pick a file, watch it upload, see its thumbnail. `bare` (issue #194) drops the own fieldset/legend for a shared "Your files" group. */
export function YourFiles({
  inputs,
  uploads,
  issuesByInputId,
  onPick,
  bare = false,
}: {
  inputs: ImageUploadInput[];
  uploads: Record<string, UploadState>;
  issuesByInputId: Record<string, string>;
  onPick: (input: ImageUploadInput, file: File) => void;
  bare?: boolean;
}) {
  if (inputs.length === 0) return null;
  const Wrapper: ElementType = bare ? Fragment : "fieldset";
  return (
    <Wrapper>
      {!bare && <legend>Your files</legend>}
      {inputs.map((input) => {
        const upload = uploads[input.id];
        const issue =
          upload?.status === "error"
            ? upload.message
            : upload?.status === "uploading"
              ? undefined
              : issuesByInputId[input.id];
        const issueId = issue ? `input-issue-${input.id}` : undefined;
        return (
          <div key={input.id}>
            <label htmlFor={`input-${input.id}`}>{input.label}</label>
            {input.help && <p>{input.help}</p>}
            <input
              id={`input-${input.id}`}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
              aria-describedby={issueId}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPick(input, file);
              }}
            />
            <p>
              PNG, JPEG or WebP, up to {input.maxSizeMb} MB
              {input.maxLongSide !== null &&
                `, at most ${input.maxLongSide} px on its long side`}
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
              <p>
                <img
                  src={`/api/uploads/${upload.uploadId}/thumb`}
                  alt=""
                  className="workbench-thumb"
                />{" "}
                {upload.name}
              </p>
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
