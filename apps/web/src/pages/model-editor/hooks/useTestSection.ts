// The Test section's own data (issue #259): the last 5 Tests as a
// `useQuery`, kept live by the shared `/api/generations/stream`
// (`useEventStream`, issue #74's AC — a run started before leaving the
// editor shows its live state on return), one upload per Input mirroring
// the Workbench's own `startUpload`/trim-then-submit sequence (CEO
// review on #74), and the `/test` submission itself as a `useMutation`.
//
// Issue #266: called from `ModelEditorPage`, not from the Test section,
// so the form's state — the picked Mode, its values, the Backend pick,
// the uploads and the trim ranges — stays alive for the whole editor
// session, surviving a section leave-and-return (a new Mode pick still
// resets it, and an in-flight Upload is only aborted when the editor
// itself closes — otherwise it finishes into the kept form).

import type {
  AudioUploadInputDefinition,
  InputDefinition,
  VideoUploadInputDefinition,
} from "@ai-content-studio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
  return [err instanceof Error ? err.message : "test failed"];
}

/** The server's own refusal text for a failed Cancel (issue #266): the response body's `error`, or the fallback when there isn't one. */
function cancelErrorFromApiError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | null;
    return body?.error ?? fallback;
  }
  return fallback;
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
  detail: ModelDetail | undefined,
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
  // Issue #266: a refused Cancel's own text (its `error`, or the
  // fallback), tied to the run it belongs to (its `generationId`) so a
  // later Run test (a new run) doesn't show a stale alert; cleared by
  // the next Cancel attempt and by `resetForm`.
  const [cancelError, setCancelError] = useState<{
    generationId: string;
    message: string;
  } | null>(null);

  // The hook is page-level now (issue #266), so "unmount" means the
  // whole editor closing: abort an in-flight Upload then (it would
  // otherwise keep chunking into a form no one can see), while a
  // section leave-and-return leaves it alone and it finishes into the
  // kept form.
  useEffect(() => {
    return () => {
      for (const running of runningUploadsRef.current.values()) {
        running.controller.abort();
      }
    };
  }, []);

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
    setCancelError(null);
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
    // The section only ever renders with a loaded `detail` (issue
    // #266's page-level call); the guard keeps an upload from starting
    // without one.
    const modelId = detail?.model.id;
    if (!modelId) return;
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
          hint: { modelId, inputId: input.id },
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
      // Same guard as `onPick`'s: the button can't actually be reached
      // without a loaded `detail`, but the page-level hook (issue
      // #266) exists before the Model's own load settles.
      if (!detail) throw new Error("this Model's detail is still loading");
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
    // Issue #266: a refused Cancel (e.g. a 409 "already finished") must
    // not reject out of here (the caller `void`s it — the old
    // try/finally left that as an unhandled rejection): catch it and
    // keep the server's own `error` to show next to the result panel.
    // The `finally` below still re-enables the Cancel button either way.
    setCancelError(null);
    setCancellingIds((current) => new Set(current).add(generationId));
    try {
      await ok(
        api.api.generations[":id"].cancel.$post({
          param: { id: generationId },
        }),
      );
    } catch (err) {
      setCancelError({
        generationId,
        message: cancelErrorFromApiError(err, "Could not cancel this test"),
      });
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
    cancelError,
  };
}

export type TestSectionData = ReturnType<typeof useTestSection>;
