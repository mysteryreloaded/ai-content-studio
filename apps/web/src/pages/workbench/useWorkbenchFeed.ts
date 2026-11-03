import { upsertGeneration } from "../../components/generations/submissionCache.js";
import {
  DONE_STATES,
  type GenerationProgress,
  type GenerationState,
  type GenerationSummary,
  type SubmissionSummary,
} from "../../components/generations/types.js";
import { markOwnCancel } from "../../notifications/ownCancel.js";
import { useCallback, useEffect, useState } from "react";
import type { WorkbenchModel } from "./types.js";

export function useWorkbenchFeed({
  model,
  slug,
  refreshCaps,
}: {
  model: WorkbenchModel | null;
  slug: string;
  refreshCaps: () => void;
}) {
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [activeStates, setActiveStates] = useState<
    Map<string, GenerationState>
  >(new Map());
  const [progressById, setProgressById] = useState<
    Map<string, GenerationProgress>
  >(new Map());
  const activeCount = [...activeStates.values()].filter(
    (state) => !DONE_STATES.has(state),
  ).length;
  /** Issue #54: disables a Submission's own Cancel button while its request is in flight. */
  const [cancellingSubmissionIds, setCancellingSubmissionIds] = useState<
    Set<string>
  >(new Set());
  /** Issue #54: which Submission's Cancel request most recently failed, so the button's user sees why it's still enabled. */
  const [cancelErrorSubmissionId, setCancelErrorSubmissionId] = useState<
    string | null
  >(null);
  /** Issue #57's AC: disables a Submission's own Delete all button while its request is in flight. */
  const [deletingSubmissionIds, setDeletingSubmissionIds] = useState<
    Set<string>
  >(new Set());
  /** Issue #57's AC: which Submission's Delete all request most recently failed. */
  const [deleteErrorSubmissionId, setDeleteErrorSubmissionId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!model) return;
    let cancelled = false;

    fetch(`/api/models/${slug}/generations`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ submissions: SubmissionSummary[] }>;
      })
      .then((body) => {
        if (!cancelled) setSubmissions(body.submissions);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [model, slug]);

  useEffect(() => {
    const source = new EventSource("/api/generations/stream");

    source.addEventListener("snapshot", (event) => {
      const body = JSON.parse((event as MessageEvent).data) as {
        generations: GenerationSummary[];
      };
      setActiveStates(new Map(body.generations.map((g) => [g.id, g.state])));
      const forThisModel = body.generations.filter((g) => g.modelSlug === slug);
      setSubmissions((current) => {
        let next = current;
        for (const generation of forThisModel) {
          next = upsertGeneration(next, generation);
        }
        return next;
      });
    });

    source.addEventListener("change", (event) => {
      const generation = JSON.parse(
        (event as MessageEvent).data,
      ) as GenerationSummary;
      setActiveStates((current) => {
        const next = new Map(current);
        next.set(generation.id, generation.state);
        return next;
      });
      // A Generation finishing (or starting) moves the concurrent Cap's
      // own count, so the foot's "more at once" needs a fresh read.
      if (DONE_STATES.has(generation.state)) refreshCaps();
      if (generation.modelSlug !== slug) return;
      setSubmissions((current) => upsertGeneration(current, generation));
    });

    source.addEventListener("progress", (event) => {
      const progress = JSON.parse(
        (event as MessageEvent).data,
      ) as GenerationProgress;
      setProgressById((current) => {
        const next = new Map(current);
        next.set(progress.generationId, progress);
        return next;
      });
    });

    return () => source.close();
  }, [slug, refreshCaps]);

  const handleCancelSubmission = useCallback(async (submissionId: string) => {
    setCancellingSubmissionIds((current) => new Set(current).add(submissionId));
    setCancelErrorSubmissionId(null);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/cancel`, {
        method: "POST",
      });
      if (res.ok) {
        // Issue #58: a cancel this tab made itself never raises a
        // Notification, in this tab or any other.
        markOwnCancel(submissionId);
      } else {
        setCancelErrorSubmissionId(submissionId);
      }
    } catch {
      // The SSE stream carries the real outcome either way; a failed
      // request here just means this button stays enabled to retry.
      setCancelErrorSubmissionId(submissionId);
    } finally {
      setCancellingSubmissionIds((current) => {
        const next = new Set(current);
        next.delete(submissionId);
        return next;
      });
    }
  }, []);

  /** "Delete all" (issue #57's AC): a whole Submission, once every one of its Generations has ended, into Tombstones. */
  const handleDeleteSubmission = useCallback(async (submissionId: string) => {
    if (!window.confirm("Delete this Submission? This can't be undone.")) {
      return;
    }
    setDeletingSubmissionIds((current) => new Set(current).add(submissionId));
    setDeleteErrorSubmissionId(null);
    try {
      const res = await fetch(`/api/submissions/${submissionId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`unexpected status ${res.status}`);
      setSubmissions((current) =>
        current.filter(
          (submission) => submission.submissionId !== submissionId,
        ),
      );
    } catch {
      setDeleteErrorSubmissionId(submissionId);
    } finally {
      setDeletingSubmissionIds((current) => {
        const next = new Set(current);
        next.delete(submissionId);
        return next;
      });
    }
  }, []);

  return {
    submissions,
    setSubmissions,
    activeStates,
    activeCount,
    progressById,
    cancellingSubmissionIds,
    cancelErrorSubmissionId,
    deletingSubmissionIds,
    deleteErrorSubmissionId,
    handleCancelSubmission,
    handleDeleteSubmission,
  };
}
