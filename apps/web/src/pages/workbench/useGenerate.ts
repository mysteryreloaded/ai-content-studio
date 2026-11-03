import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import { upsertGeneration } from "../../components/generations/submissionCache.js";
import type {
  GenerationSummary,
  SubmissionSummary,
} from "../../components/generations/types.js";
import type {
  MediaUploadInput,
  TrimRange,
  UploadState,
} from "../../components/inputs/types.js";
import { trimUpload } from "../../lib/chunkedUpload.js";
import { carryValuesFor, liveIssuesFor, valuesPayload } from "./formValues.js";
import type {
  InputIssue,
  SubmitState,
  TermsDialogState,
  WorkbenchModel,
} from "./types.js";

export function useGenerate({
  modelRef,
  valuesRef,
  runningUploadsRef,
  selectedModeId,
  count,
  uploads,
  trimRangeByInputId,
  setValues,
  setIssuesByInputId,
  setModel,
  setSelectedModeId,
  setTermsDialog,
  refreshCaps,
  setSubmissions,
}: {
  modelRef: RefObject<WorkbenchModel | null>;
  valuesRef: RefObject<Record<string, string>>;
  runningUploadsRef: RefObject<
    Map<string, { promise: Promise<void>; controller: AbortController }>
  >;
  selectedModeId: string | null;
  count: number;
  uploads: Record<string, UploadState>;
  trimRangeByInputId: Record<string, TrimRange>;
  setValues: (
    update: (current: Record<string, string>) => Record<string, string>,
  ) => void;
  setIssuesByInputId: (
    update: (current: Record<string, string>) => Record<string, string>,
  ) => void;
  setModel: Dispatch<SetStateAction<WorkbenchModel | null>>;
  setSelectedModeId: Dispatch<SetStateAction<string | null>>;
  setTermsDialog: Dispatch<SetStateAction<TermsDialogState | null>>;
  refreshCaps: () => void;
  setSubmissions: Dispatch<SetStateAction<SubmissionSummary[]>>;
}) {
  const [submitState, setSubmitState] = useState<SubmitState>({
    status: "idle",
  });
  const waitRef = useRef<{ cancelled: boolean } | null>(null);

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
      setSubmitState({ status: "trimming" });
      try {
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
        values = { ...values, ...updates };
        valuesRef.current = values;
        setValues((v) => ({ ...v, ...updates }));
      } catch (err) {
        setSubmitState({
          status: "error",
          message: err instanceof Error ? err.message : "couldn't be trimmed",
        });
        return;
      }
    }

    setSubmitState({ status: "submitting" });
    setIssuesByInputId({});

    try {
      const res = await fetch(`/api/models/${current.slug}/generations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modeId: mode.id,
          revision: current.revision,
          values: valuesPayload(mode, values),
          ...(mode.inputs.some((input) => input.kind === "seed")
            ? { count }
            : {}),
        }),
      });

      if (res.status === 409) {
        const body = (await res.json()) as {
          error: string;
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
          setModel(body.model);
          const stillSelected = body.model.modes.find(
            (m) => m.id === selectedModeId,
          );
          const nextMode = stillSelected ?? body.model.modes[0] ?? mode;
          setSelectedModeId(nextMode.id);
          setValues((current) => carryValuesFor(nextMode, current, true));
          setIssuesByInputId({});
          setSubmitState({
            status: "error",
            message:
              "This Model changed; reloaded. Check your Mode and try again.",
          });
          return;
        }
        if (body.error === "model_terms_required") {
          // Re-fetch so the dialog shows the current (possibly re-asked)
          // terms version; the submit itself queued nothing (issue #61).
          const refreshed = await fetch(`/api/models/${current.slug}`)
            .then((r) =>
              r.ok ? (r.json() as Promise<{ model: WorkbenchModel }>) : null,
            )
            .catch(() => null);
          if (refreshed) setModel(refreshed.model);
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

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          issues?: InputIssue[];
        };
        if (body.error === "invalid" && body.issues) {
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
            body.message ?? body.error ?? `unexpected status ${res.status}`,
        });
        return;
      }

      // The 201 carries this Submission's own prompt (issue #47 AC); SSE's
      // `change` events, which have no prompt, would otherwise leave it
      // blank until a reload.
      const created = (await res.json()) as {
        generations: GenerationSummary[];
        prompt: string | null;
      };
      if (created.generations.length > 0) {
        const submissionId = created.generations[0]?.submissionId;
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
    } catch {
      setSubmitState({ status: "error", message: "could not submit" });
    }
  }, [selectedModeId, count, uploads, trimRangeByInputId, refreshCaps]);

  const cancelWaiting = useCallback(() => {
    if (waitRef.current) waitRef.current.cancelled = true;
    waitRef.current = null;
    setSubmitState({ status: "idle" });
  }, []);

  return { submitState, handleGenerate, cancelWaiting };
}
