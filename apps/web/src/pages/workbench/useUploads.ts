import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import { issueFor } from "../../components/inputs/issueFor.js";
import type {
  ImageUploadInput,
  MediaUploadInput,
  TrimRange,
  UploadState,
} from "../../components/inputs/types.js";
import { httpUploadApi, uploadResumable } from "../../lib/chunkedUpload.js";
import type { WorkbenchModel } from "./types.js";

export function useUploads({
  modelRef,
  valuesRef,
  maxUploadMb,
  setValues,
  setIssuesByInputId,
}: {
  modelRef: RefObject<WorkbenchModel | null>;
  valuesRef: RefObject<Record<string, string>>;
  maxUploadMb: number | null;
  setValues: Dispatch<SetStateAction<Record<string, string>>>;
  setIssuesByInputId: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  // Issue #50: each running Upload, by Input id, so Generate can wait for
  // them and a new pick can cancel the one it replaces.
  const runningUploadsRef = useRef(
    new Map<string, { promise: Promise<void>; controller: AbortController }>(),
  );
  // Issue #51: the trim range picked on a Video/Audio Upload's local
  // player, by Input id; [0, durationMs] (the whole clip, no trim) until
  // the user drags it. One trim per Input covers every Generation in the
  // Submission, run once at Generate (not on every drag).
  const [trimRangeByInputId, setTrimRangeByInputId] = useState<
    Record<string, TrimRange>
  >({});

  const resetUploads = useCallback(() => {
    for (const running of runningUploadsRef.current.values()) {
      running.controller.abort();
    }
    runningUploadsRef.current.clear();
    setUploads({});
    setTrimRangeByInputId({});
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: modelRef/valuesRef and every setter are stable across renders (refs, or useState setters from the caller); the dependency array matches the Workbench component's own, unchanged by this extraction.
  const startUpload = useCallback(
    async (
      input: ImageUploadInput | MediaUploadInput,
      file: File,
      needsPlayableVideo = false,
    ) => {
      const current = modelRef.current;
      if (!current) return;
      runningUploadsRef.current.get(input.id)?.controller.abort();
      runningUploadsRef.current.delete(input.id);
      setValues((v) => ({ ...v, [input.id]: "" }));
      setTrimRangeByInputId((ranges) => {
        const { [input.id]: _, ...rest } = ranges;
        return rest;
      });

      const issue = await issueFor(
        input,
        file,
        maxUploadMb,
        needsPlayableVideo,
      );
      if (issue) {
        setUploads((u) => ({
          ...u,
          [input.id]: {
            status: "error",
            name: file.name,
            message: issue.prefixed
              ? `${file.name} ${issue.message}.`
              : issue.message,
          },
        }));
        return;
      }

      const controller = new AbortController();
      setUploads((u) => ({
        ...u,
        [input.id]: {
          status: "uploading",
          name: file.name,
          progress: 0,
          size: file.size,
          file,
        },
      }));
      const promise = uploadResumable(file, httpUploadApi(), {
        hint: { modelId: current.id, inputId: input.id },
        signal: controller.signal,
        onProgress: (progress) => {
          if (controller.signal.aborted) return;
          setUploads((u) => ({
            ...u,
            [input.id]: {
              status: "uploading",
              name: file.name,
              progress,
              size: file.size,
              file,
            },
          }));
        },
      })
        .then((done) => {
          if (controller.signal.aborted) return;
          valuesRef.current = { ...valuesRef.current, [input.id]: done.id };
          setValues((v) => ({ ...v, [input.id]: done.id }));
          setIssuesByInputId((issues) => {
            const { [input.id]: _, ...rest } = issues;
            return rest;
          });
          setUploads((u) => ({
            ...u,
            [input.id]: {
              status: "complete",
              name: file.name,
              uploadId: done.id,
              durationMs: done.durationMs,
              browserPlayable: done.browserPlayable,
              size: file.size,
              width: done.width,
              height: done.height,
            },
          }));
          if (done.durationMs !== null) {
            const maxDurationMs =
              input.kind === "image_upload" ? null : input.maxDurationMs;
            setTrimRangeByInputId((ranges) => ({
              ...ranges,
              [input.id]: {
                startMs: 0,
                endMs:
                  maxDurationMs !== null
                    ? Math.min(done.durationMs as number, maxDurationMs)
                    : (done.durationMs as number),
              },
            }));
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setUploads((u) => ({
            ...u,
            [input.id]: {
              status: "error",
              name: file.name,
              message: `${file.name} ${err instanceof Error ? err.message : "couldn't be uploaded"}.`,
            },
          }));
        })
        .finally(() => {
          if (
            runningUploadsRef.current.get(input.id)?.controller === controller
          ) {
            runningUploadsRef.current.delete(input.id);
          }
        });
      runningUploadsRef.current.set(input.id, { promise, controller });
    },
    [maxUploadMb],
  );

  /** Abort a running Upload and clear it, its trim range and (through the Points field's own clear-on-change effect) its points (issue #197's AC). */
  // biome-ignore lint/correctness/useExhaustiveDependencies: setValues is a stable setter from the caller, like startUpload's own dependency array above.
  const clearUpload = useCallback((inputId: string) => {
    runningUploadsRef.current.get(inputId)?.controller.abort();
    runningUploadsRef.current.delete(inputId);
    setValues((v) => ({ ...v, [inputId]: "" }));
    setUploads((u) => {
      const { [inputId]: _, ...rest } = u;
      return rest;
    });
    setTrimRangeByInputId((ranges) => {
      const { [inputId]: _, ...rest } = ranges;
      return rest;
    });
  }, []);

  return {
    uploads,
    trimRangeByInputId,
    setTrimRangeByInputId,
    runningUploadsRef,
    startUpload,
    clearUpload,
    resetUploads,
  };
}
