import { useMutation } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { upsertGeneration } from "../../components/generations/submissionCache.js";
import type { GenerationSummary } from "../../components/generations/types.js";
import type { MediaUploadInput } from "../../components/inputs/types.js";
import { ApiError, api, ok } from "../../lib/api.js";
import { UploadError, trimUpload } from "../../lib/chunkedUpload.js";
import { carryValuesFor, liveIssuesFor, valuesPayload } from "./formValues.js";
import type {
  InputIssue,
  SubmitState,
  UseGenerateOptions,
  WorkbenchModel,
} from "./types.js";
import { workbenchModelQueryKey } from "./workbenchModelQuery.js";

/** A trim failure (issue #196's AC), carrying the Input id its message belongs on. */
class TrimFailure extends Error {
  constructor(
    readonly inputId: string,
    message: string,
  ) {
    super(message);
  }
}

export function useGenerate({
  modelRef,
  valuesRef,
  runningUploadsRef,
  slug,
  queryClient,
  selectedModeId,
  count,
  uploads,
  trimRangeByInputId,
  setValues,
  setIssuesByInputId,
  setSelectedModeId,
  setTermsDialog,
  setBanner,
  refreshCaps,
  setSubmissions,
  setLastOwnSubmissionId,
}: UseGenerateOptions) {
  const [submitState, setSubmitState] = useState<SubmitState>({
    status: "idle",
  });
  const waitRef = useRef<{ cancelled: boolean } | null>(null);

  const submitMutation = useMutation({
    mutationFn: (payload: {
      modeId: string;
      revision: number;
      values: Record<string, string | number>;
      count?: number;
    }) =>
      ok<{ generations: GenerationSummary[]; prompt: string | null }>(
        api.api.models[":slug"].generations.$post({
          param: { slug },
          json: payload,
        }),
      ),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: modelRef/valuesRef/runningUploadsRef and every setter are stable across renders (refs, or useState setters from the caller); the dependency array matches the Workbench component's own, unchanged by this extraction.
  const handleGenerate = useCallback(async () => {
    // Issue #50: pressed early, Generate waits for running Uploads, then
    // submits, unless "Don't start" is pressed meanwhile.
    const running = [...runningUploadsRef.current.values()];
    if (running.length > 0) {
      const wait = { cancelled: false };
      waitRef.current = wait;
      setSubmitState({ status: "waiting" });
      await Promise.allSettled(running.map((r) => r.promise));
      if (wait.cancelled) return;
      waitRef.current = null;
    }

    const current = modelRef.current;
    const mode = current?.modes.find((m) => m.id === selectedModeId);
    if (!current || !mode) return;
    let values = valuesRef.current;

    const issues = liveIssuesFor(current.revision, mode, values);
    if (Object.keys(issues).length > 0) {
      setIssuesByInputId(issues);
      setSubmitState({
        status: "error",
        message: "Check the highlighted fields.",
      });
      return;
    }

    // Issue #51's AC: one trim, covering every Generation this Submission
    // creates, run here (not on every drag of the range) and only for a
    // range that actually cuts something.
    const mediaInputs = mode.inputs.filter(
      (input): input is MediaUploadInput =>
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
    // CEO review round 6: a Video/Audio Input not being trimmed this time
    // (its range was set back to the whole clip after an earlier trimmed
    // Generate) must submit its own Upload id, not whatever trimmed id
    // `values[id]` still holds from that earlier Generate.
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
        .filter((entry): entry is readonly [string, string] => entry !== null),
    );
    if (Object.keys(untrimmedUpdates).length > 0) {
      values = { ...values, ...untrimmedUpdates };
      valuesRef.current = values;
      setValues((v) => ({ ...v, ...untrimmedUpdates }));
    }

    if (toTrim.length > 0) {
      const kind = toTrim.some((input) => input.kind === "video_upload")
        ? "video"
        : "audio";
      setSubmitState({ status: "trimming", kind });
      try {
        const trimmed = await Promise.all(
          toTrim.map(async (input) => {
            const upload = uploads[input.id];
            const range = trimRangeByInputId[input.id];
            if (upload?.status !== "complete" || !range) return null;
            try {
              const result = await trimUpload(
                upload.uploadId,
                range.startMs,
                range.endMs,
              );
              return [input.id, result.id] as const;
            } catch (err) {
              throw new TrimFailure(
                input.id,
                err instanceof UploadError && err.fromServer
                  ? err.message
                  : "Your Upload couldn't be processed. Try another file.",
              );
            }
          }),
        );
        const updates = Object.fromEntries(
          trimmed.filter((t): t is readonly [string, string] => t !== null),
        );
        values = { ...values, ...updates };
        valuesRef.current = values;
        setValues((v) => ({ ...v, ...updates }));
      } catch (err) {
        if (err instanceof TrimFailure) {
          setIssuesByInputId((issues) => ({
            ...issues,
            [err.inputId]: err.message,
          }));
        }
        setSubmitState({
          status: "error",
          message: "Check the highlighted fields.",
        });
        return;
      }
    }

    setSubmitState({ status: "submitting" });
    setIssuesByInputId({});

    try {
      // The 201 carries this Submission's own prompt (issue #47 AC); SSE's
      // `change` events, which have no prompt, would otherwise leave it
      // blank until a reload.
      const created = await submitMutation.mutateAsync({
        modeId: mode.id,
        revision: current.revision,
        values: valuesPayload(mode, values),
        ...(mode.hasSeed ? { count } : {}),
      });
      if (created.generations.length > 0) {
        const submissionId = created.generations[0]?.submissionId;
        // Issue #195's AC: the notifications offer shows inside this tab's
        // own just-created block only.
        setLastOwnSubmissionId(submissionId ?? null);
        setSubmissions((current) => {
          const next = created.generations.reduce(upsertGeneration, current);
          return next.map((submission) =>
            submission.submissionId === submissionId
              ? { ...submission, prompt: created.prompt }
              : submission,
          );
        });
      }

      refreshCaps();
      setSubmitState({ status: "idle" });
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setSubmitState({
          status: "error",
          message: "Couldn't submit. Try again in a minute.",
        });
        return;
      }

      if (err.status === 409) {
        const body = (err.body ?? {}) as {
          error?: string;
          model?: WorkbenchModel;
          cap?: number;
          remaining?: number;
        };
        if (body.error === "daily_cap_exceeded") {
          refreshCaps();
          setSubmitState({
            status: "error",
            message: `You've reached today's Cap of ${body.cap}.`,
          });
          return;
        }
        if (body.error === "concurrent_cap_exceeded") {
          refreshCaps();
          setSubmitState({
            status: "error",
            message: `You already have ${body.cap} Generations at once; wait for one to finish.`,
          });
          return;
        }
        if (body.error === "model_changed" && body.model) {
          queryClient.setQueryData(workbenchModelQueryKey(slug), body.model);
          const stillSelected = body.model.modes.find(
            (m) => m.id === selectedModeId,
          );
          const nextMode = stillSelected ?? body.model.modes[0] ?? mode;
          setSelectedModeId(nextMode.id);
          setValues((current) => carryValuesFor(nextMode, current, true));
          setIssuesByInputId({});
          setBanner("This Model was updated, check your settings.");
          setSubmitState({ status: "idle" });
          return;
        }
        if (body.error === "model_terms_required") {
          // Re-fetch so the dialog shows the current (possibly re-asked)
          // terms version; the submit itself queued nothing (issue #61).
          await queryClient.refetchQueries({
            queryKey: workbenchModelQueryKey(slug),
          });
          setTermsDialog({
            blocking: true,
            error: "Accept this Model's terms to continue.",
          });
          setSubmitState({ status: "idle" });
          return;
        }
        setSubmitState({
          status: "error",
          message: "This Model is no longer available.",
        });
        return;
      }

      const body = err.body as {
        error?: string;
        message?: string;
        issues?: InputIssue[];
      } | null;
      if (body?.error === "invalid" && body.issues) {
        setIssuesByInputId(
          Object.fromEntries(
            body.issues.map((issue) => [issue.path, issue.message]),
          ),
        );
        setSubmitState({
          status: "error",
          message: "Check the highlighted fields.",
        });
        return;
      }
      setSubmitState({
        status: "error",
        message:
          body?.message ??
          body?.error ??
          "Couldn't submit. Try again in a minute.",
      });
    }
  }, [selectedModeId, count, uploads, trimRangeByInputId, refreshCaps]);

  const cancelWaiting = useCallback(() => {
    if (waitRef.current) waitRef.current.cancelled = true;
    waitRef.current = null;
    setSubmitState({ status: "idle" });
  }, []);

  return { submitState, handleGenerate, cancelWaiting };
}
