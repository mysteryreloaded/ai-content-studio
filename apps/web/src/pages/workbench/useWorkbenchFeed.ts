import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { upsertGeneration } from "../../components/generations/submissionCache.js";
import {
  DONE_STATES,
  type GenerationProgress,
  type GenerationSummary,
  type SubmissionSummary,
} from "../../components/generations/types.js";
import { api, ok } from "../../lib/api.js";
import { useEventStream } from "../../lib/sse.js";
import {
  markOwnCancel,
  markOwnCancelGeneration,
} from "../../notifications/ownCancel.js";
import type { WorkbenchModel } from "./types.js";

interface SubmissionsPage {
  submissions: SubmissionSummary[];
  hasMore: boolean;
}

const PROGRESS_KEY = ["generations", "progress"] as const;

function removeGeneration(
  current: SubmissionSummary[],
  generationId: string,
): SubmissionSummary[] {
  return current
    .map((submission) => ({
      ...submission,
      generations: submission.generations.filter((g) => g.id !== generationId),
    }))
    .filter((submission) => submission.generations.length > 0);
}

export function useWorkbenchFeed({
  model,
  slug,
  refreshCaps,
}: {
  model: WorkbenchModel | null;
  slug: string;
  refreshCaps: () => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["workbench-submissions", slug] as const,
    [slug],
  );
  // `useEventStream`'s handlers are bound once per mount (issue #195 QA
  // round 3): a Workbench that's reused across a slug change (AppHeader's
  // Model links don't remount `/models/:slug`) would otherwise keep
  // writing a stale slug's query key from the handlers' first-render
  // closure. Reading the latest slug/key through a ref at call time fixes
  // that without needing the stream itself to re-subscribe.
  const slugRef = useRef(slug);
  slugRef.current = slug;
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  const { data } = useQuery({
    queryKey,
    queryFn: () =>
      ok<SubmissionsPage>(
        api.api.models[":slug"].generations.$get({ param: { slug } }),
      ),
    enabled: model !== null,
  });
  const submissions = data?.submissions ?? [];
  const hasMore = data?.hasMore ?? false;

  const setSubmissions = useCallback(
    (
      update:
        | SubmissionSummary[]
        | ((current: SubmissionSummary[]) => SubmissionSummary[]),
    ) => {
      queryClient.setQueryData<SubmissionsPage>(
        queryKeyRef.current,
        (current) => {
          const currentSubmissions = current?.submissions ?? [];
          const next =
            typeof update === "function" ? update(currentSubmissions) : update;
          return { submissions: next, hasMore: current?.hasMore ?? false };
        },
      );
    },
    [queryClient],
  );

  useEventStream("/api/generations/stream", {
    snapshot: (_qc, raw) => {
      const body = raw as { generations: GenerationSummary[] };
      const forThisModel = body.generations.filter(
        (g) => g.modelSlug === slugRef.current,
      );
      setSubmissions((current) =>
        forThisModel.reduce(upsertGeneration, current),
      );
    },
    change: (_qc, raw) => {
      const generation = raw as GenerationSummary;
      // A Generation finishing (or starting) moves the concurrent Cap's own
      // count, so the foot's "more at once" needs a fresh read.
      if (DONE_STATES.has(generation.state)) refreshCaps();
      if (generation.modelSlug !== slugRef.current) return;
      setSubmissions((current) => upsertGeneration(current, generation));
    },
    progress: (qc, raw) => {
      const progress = raw as GenerationProgress;
      qc.setQueryData<Map<string, GenerationProgress>>(
        PROGRESS_KEY,
        (current) => {
          const next = new Map(current ?? []);
          next.set(progress.generationId, progress);
          return next;
        },
      );
    },
  });

  // Reads (and reactively re-renders on) the shared progress cache without
  // ever fetching it itself — `useEventStream`'s `progress` handler above is
  // the only writer.
  const { data: progressById = new Map<string, GenerationProgress>() } =
    useQuery<Map<string, GenerationProgress>>({
      queryKey: PROGRESS_KEY,
      queryFn: () =>
        queryClient.getQueryData(PROGRESS_KEY) ??
        new Map<string, GenerationProgress>(),
      enabled: false,
    });

  /** Issue #54: disables a Submission's own Cancel button while its request is in flight. */
  const [cancellingSubmissionIds, setCancellingSubmissionIds] = useState<
    Set<string>
  >(new Set());
  const [cancelErrorSubmissionId, setCancelErrorSubmissionId] = useState<
    string | null
  >(null);
  const [deletingSubmissionIds, setDeletingSubmissionIds] = useState<
    Set<string>
  >(new Set());
  const [deleteErrorSubmissionId, setDeleteErrorSubmissionId] = useState<
    string | null
  >(null);

  /** Issue #189/#195: a card's own Cancel while the server confirms. */
  const [cancellingGenerationIds, setCancellingGenerationIds] = useState<
    Set<string>
  >(new Set());
  const [deletingGenerationIds, setDeletingGenerationIds] = useState<
    Set<string>
  >(new Set());

  const handleCancelSubmission = useCallback(async (submissionId: string) => {
    setCancellingSubmissionIds((current) => new Set(current).add(submissionId));
    setCancelErrorSubmissionId(null);
    try {
      await ok(
        api.api.submissions[":submissionId"].cancel.$post({
          param: { submissionId },
        }),
      );
      // Issue #58: a cancel this tab made itself never raises a
      // Notification, in this tab or any other.
      markOwnCancel(submissionId);
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
  const handleDeleteSubmission = useCallback(
    async (submissionId: string) => {
      setDeletingSubmissionIds((current) => new Set(current).add(submissionId));
      setDeleteErrorSubmissionId(null);
      try {
        await ok(
          api.api.submissions[":submissionId"].$delete({
            param: { submissionId },
          }),
        );
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
    },
    [setSubmissions],
  );

  const handleCancelGeneration = useCallback(async (id: string) => {
    setCancellingGenerationIds((current) => new Set(current).add(id));
    try {
      await ok(api.api.generations[":id"].cancel.$post({ param: { id } }));
      markOwnCancelGeneration(id);
    } catch {
      // The SSE stream carries the real outcome either way.
    } finally {
      setCancellingGenerationIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const handleDeleteGeneration = useCallback(
    async (id: string) => {
      setDeletingGenerationIds((current) => new Set(current).add(id));
      try {
        await ok(api.api.generations[":id"].$delete({ param: { id } }));
        setSubmissions((current) => removeGeneration(current, id));
      } catch {
        // Left enabled so the owner can retry.
      } finally {
        setDeletingGenerationIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [setSubmissions],
  );

  const handleDismissGeneration = useCallback(
    (id: string) => {
      setSubmissions((current) => removeGeneration(current, id));
    },
    [setSubmissions],
  );

  return {
    submissions,
    hasMore,
    setSubmissions,
    progressById,
    cancellingSubmissionIds,
    cancelErrorSubmissionId,
    deletingSubmissionIds,
    deleteErrorSubmissionId,
    cancellingGenerationIds,
    deletingGenerationIds,
    handleCancelSubmission,
    handleDeleteSubmission,
    handleCancelGeneration,
    handleDeleteGeneration,
    handleDismissGeneration,
  };
}
