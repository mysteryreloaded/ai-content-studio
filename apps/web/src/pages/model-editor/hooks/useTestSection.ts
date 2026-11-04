// The Test section's own data (issue #259): the last 5 Tests as a
// `useQuery`, kept live by the shared `/api/generations/stream`
// (`useEventStream`, issue #74's AC — a run started before leaving the
// editor shows its live state on return), one upload per Input mirroring
// the Workbench's own `startUpload`/trim-then-submit sequence (CEO
// review on #74), and the `/test` submission itself as a `useMutation`.

import type {
  AudioUploadInputDefinition,
  InputDefinition,
  VideoUploadInputDefinition,
} from "@ai-content-studio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { GenerationProgress } from "../../../components/generations/types.js";
import { issueFor } from "../../../components/inputs/issueFor.js";
import type {
  ImageUploadInput,
  MediaUploadInput,
  TrimRange,
  UploadState,
} from "../../../components/inputs/types.js";
import { ApiError, api, ok } from "../../../lib/api.js";
import {
  httpUploadApi,
  trimUpload,
  uploadResumable,
} from "../../../lib/chunkedUpload.js";
import { useEventStream } from "../../../lib/sse.js";
import { sortedTestRuns } from "../helpers/testRuns.js";
import type { DraftMode, ModelDetail, TestRun } from "../types.js";

/** The server's several error-body shapes for `/test`'s refusals (issue #74), flattened into one reason list. */
function testErrorReasons(err: unknown): string[] {
  if (err instanceof ApiError) {
    const body = err.body as {
      reasons?: string[];
      message?: string;
      error?: string;
      issues?: { message: string }[];
    } | null;
    return (
      body?.reasons ??
      body?.issues?.map((issue) => issue.message) ??
      (body?.message || body?.error
        ? [body.message ?? body.error ?? "test failed"]
        : ["test failed"])
    );
  }
  return ["test failed"];
}

/** The Test submit payload (mirrors WorkbenchPage's own `valuesPayload`): blank values are left out, a number/seed is parsed, not sent as the raw typed string. */
function testValuesPayload(
  inputs: InputDefinition[],
  values: Record<string, string>,
): Record<string, string | number> {
  const byId = new Map(inputs.map((input) => [input.id, input]));
  const payload: Record<string, string | number> = {};
  for (const [id, raw] of Object.entries(values)) {
    if (raw === "") continue;
    const input = byId.get(id);
    payload[id] =
      input?.kind === "number" || input?.kind === "seed" ? Number(raw) : raw;
  }
  return payload;
}

export function useTestSection(
  id: string | undefined,
  detail: ModelDetail,
  maxUploadMb: number | null,
) {
  const queryClient = useQueryClient();
  const testsKey = ["admin-model-tests", id] as const;
  const progressKey = ["admin-model-test-progress", id] as const;

  const testsQuery = useQuery({
    queryKey: testsKey,
    queryFn: () =>
      ok<{ tests: TestRun[] }>(
        api.api.admin.models[":id"].tests.$get({
          param: { id: id as string },
        }),
      ).then((body) => sortedTestRuns(body.tests)),
    enabled: Boolean(id),
  });

  useEventStream(
    "/api/generations/stream",
    {
      change: (qc, data) => {
        const generation = data as TestRun;
        if (!generation.isTest || generation.modelId !== id) return;
        qc.setQueryData<TestRun[]>(testsKey, (current) =>
          sortedTestRuns([
            generation,
            ...(current ?? []).filter((run) => run.id !== generation.id),
          ]),
        );
      },
      progress: (qc, data) => {
        const progress = data as GenerationProgress;
        qc.setQueryData<Map<string, GenerationProgress>>(
          progressKey,
          (current) => {
            const next = new Map(current ?? []);
            next.set(progress.generationId, progress);
            return next;
          },
        );
      },
    },
    { enabled: Boolean(id) },
  );

  const { data: progressById = new Map<string, GenerationProgress>() } =
    useQuery<Map<string, GenerationProgress>>({
      queryKey: progressKey,
      queryFn: () =>
        queryClient.getQueryData(progressKey) ??
        new Map<string, GenerationProgress>(),
      enabled: false,
    });

  // Issue #74 CEO review: an Upload or Points Input on the Mode under
  // test reuses the Workbench's own picker/trim bookkeeping, scoped to
  // the Test form instead of a real Submission; reset whenever the
  // picked Mode changes (`selectMode`).
  const [modeKey, setModeKey] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [backendId, setBackendId] = useState("");
  const [error, setError] = useState<string[] | null>(null);
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [trimRangeByInputId, setTrimRangeByInputId] = useState<
    Record<string, TrimRange>
  >({});
  const runningUploadsRef = useRef(
    new Map<string, { promise: Promise<void>; controller: AbortController }>(),
  );
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());

  function resetForm() {
    for (const running of runningUploadsRef.current.values()) {
      running.controller.abort();
    }
    runningUploadsRef.current.clear();
    setValues({});
    setUploads({});
    setTrimRangeByInputId({});
    setBackendId("");
    setError(null);
  }

  /** The Mode select's `onChange` (issue #259): picking a different Mode resets its draft values, uploads and Backend pick, same as the old per-Mode toggle did. */
  function selectMode(key: string) {
    if (key === modeKey) return;
    setModeKey(key);
    resetForm();
  }

  /** Mirrors WorkbenchPage's own `startUpload`. */
  function onPick(
    input: ImageUploadInput | MediaUploadInput,
    file: File,
    needsPlayableVideo = false,
  ) {
    runningUploadsRef.current.get(input.id)?.controller.abort();
    runningUploadsRef.current.delete(input.id);
    setValues((v) => ({ ...v, [input.id]: "" }));
    setUploads((u) => {
      const { [input.id]: _, ...rest } = u;
      return rest;
    });
    setTrimRangeByInputId((ranges) => {
      const { [input.id]: _, ...rest } = ranges;
      return rest;
    });

    const controller = new AbortController();
    const promise = issueFor(input, file, maxUploadMb, needsPlayableVideo).then(
      (issue) => {
        if (controller.signal.aborted) return;
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
        return uploadResumable(file, httpUploadApi(), {
          hint: { modelId: detail.model.id, inputId: input.id },
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
            setValues((v) => ({ ...v, [input.id]: done.id }));
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
          });
      },
    );
    runningUploadsRef.current.set(input.id, { promise, controller });
  }

  /** Mirrors WorkbenchPage's own `clearUpload`. */
  function onClear(input: ImageUploadInput | MediaUploadInput) {
    runningUploadsRef.current.get(input.id)?.controller.abort();
    runningUploadsRef.current.delete(input.id);
    setValues((v) => ({ ...v, [input.id]: "" }));
    setUploads((u) => {
      const { [input.id]: _, ...rest } = u;
      return rest;
    });
    setTrimRangeByInputId((ranges) => {
      const { [input.id]: _, ...rest } = ranges;
      return rest;
    });
  }

  function onTrimRangeChange(inputId: string, range: TrimRange) {
    setTrimRangeByInputId((ranges) => ({ ...ranges, [inputId]: range }));
  }

  const submitMutation = useMutation({
    mutationFn: async ({
      mode,
      inputs,
    }: {
      mode: DraftMode;
      inputs: InputDefinition[];
    }) => {
      // Issue #74 CEO review: Generate's own wait-for-Uploads-then-trim
      // steps (WorkbenchPage's handleGenerate), so a Test on a Mode with
      // a trimmable Video/Audio Input submits the trimmed range, not
      // whatever's still uploading or the untrimmed file.
      const running = [...runningUploadsRef.current.values()];
      if (running.length > 0) {
        await Promise.allSettled(running.map((r) => r.promise));
      }

      let currentValues = values;
      const mediaInputs = inputs.filter(
        (
          input,
        ): input is VideoUploadInputDefinition | AudioUploadInputDefinition =>
          input.kind === "video_upload" || input.kind === "audio_upload",
      );
      const toTrim = mediaInputs.filter((input) => {
        const upload = uploads[input.id];
        const range = trimRangeByInputId[input.id];
        return (
          upload?.status === "complete" &&
          upload.durationMs !== null &&
          range &&
          (range.startMs > 0 || range.endMs < upload.durationMs)
        );
      });
      const toTrimIds = new Set(toTrim.map((input) => input.id));
      const untrimmedUpdates = Object.fromEntries(
        mediaInputs
          .filter((input) => !toTrimIds.has(input.id))
          .map((input): readonly [string, string] | null => {
            const upload = uploads[input.id];
            return upload?.status === "complete"
              ? [input.id, upload.uploadId]
              : null;
          })
          .filter(
            (entry): entry is readonly [string, string] => entry !== null,
          ),
      );
      if (Object.keys(untrimmedUpdates).length > 0) {
        currentValues = { ...currentValues, ...untrimmedUpdates };
        setValues((v) => ({ ...v, ...untrimmedUpdates }));
      }

      if (toTrim.length > 0) {
        const trimmed = await Promise.all(
          toTrim.map(async (input) => {
            const upload = uploads[input.id];
            const range = trimRangeByInputId[input.id];
            if (upload?.status !== "complete" || !range) return null;
            const result = await trimUpload(
              upload.uploadId,
              range.startMs,
              range.endMs,
            );
            return [input.id, result.id] as const;
          }),
        );
        const updates = Object.fromEntries(
          trimmed.filter((t): t is readonly [string, string] => t !== null),
        );
        currentValues = { ...currentValues, ...updates };
        setValues((v) => ({ ...v, ...updates }));
      }

      const currentInputIds = new Set(inputs.map((input) => input.id));
      const { generation } = await ok<{ generation: TestRun }>(
        api.api.admin.models[":id"].test.$post({
          param: { id: detail.model.id },
          json: {
            mode: {
              name: mode.name,
              description: mode.description,
              outputNodeIds: mode.outputNodeIds,
              inputSettings: mode.inputSettings.filter((s) =>
                currentInputIds.has(s.inputId),
              ),
            },
            inputs,
            values: testValuesPayload(inputs, currentValues),
            backendId: backendId || null,
          },
        }),
      );
      return generation;
    },
    onSuccess: (generation) => {
      queryClient.setQueryData<TestRun[]>(testsKey, (current) =>
        sortedTestRuns([generation, ...(current ?? [])]),
      );
    },
  });

  async function handleSubmit(mode: DraftMode, inputs: InputDefinition[]) {
    setError(null);
    try {
      await submitMutation.mutateAsync({ mode, inputs });
    } catch (err) {
      setError(testErrorReasons(err));
    }
  }

  async function cancel(generationId: string) {
    setCancellingIds((current) => new Set(current).add(generationId));
    try {
      await ok(
        api.api.generations[":id"].cancel.$post({
          param: { id: generationId },
        }),
      );
    } finally {
      setCancellingIds((current) => {
        const next = new Set(current);
        next.delete(generationId);
        return next;
      });
    }
  }

  return {
    testRuns: testsQuery.data ?? [],
    testsLoadError: testsQuery.isError ? "could not load recent tests" : null,
    progressById,
    modeKey,
    selectMode,
    backendId,
    setBackendId,
    values,
    setValues,
    uploads,
    trimRangeByInputId,
    onTrimRangeChange,
    onPick,
    onClear,
    submitting: submitMutation.isPending,
    error,
    handleSubmit,
    cancel,
    cancellingIds,
  };
}

export type TestSectionData = ReturnType<typeof useTestSection>;
