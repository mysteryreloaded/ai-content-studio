// The Gallery's data layer (issue #198): paged through `useInfiniteQuery`,
// kept live by the same per-user SSE stream as the Workbench
// (`useEventStream`), and the card/block actions as `useMutation`s.
// Mirrors `pages/workbench/useWorkbenchFeed.ts`, except updates from the
// stream are applied to every cached `["gallery", model, state]` entry
// (not just this hook's own), since several filter combinations can sit
// in the cache at once after the user has switched filters.

import {
  type QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { mergeGeneration } from "../../components/generations/submissionCache.js";
import type {
  GenerationProgress,
  GenerationSummary,
  SubmissionSummary,
} from "../../components/generations/types.js";
import { api, ok } from "../../lib/api.js";
import { useEventStream } from "../../lib/sse.js";
import {
  markOwnCancel,
  markOwnCancelGeneration,
} from "../../notifications/ownCancel.js";
import {
  type RawGalleryPage,
  type StateFilter,
  cursorFrom,
  galleryQueryParams,
  insertSubmission,
  matchesStateFilter,
  toSubmissionSummary,
} from "./galleryLogic.js";

interface GalleryQueryPage {
  submissions: SubmissionSummary[];
  hasMore: boolean;
}

type GalleryCursor = { submittedAt: string; submissionId: string } | null;

interface GalleryInfiniteData {
  pages: GalleryQueryPage[];
  pageParams: unknown[];
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

/** Every `["gallery", modelFilter, stateFilter]` entry currently in the cache. */
function galleryQueries(queryClient: QueryClient) {
  return queryClient.getQueryCache().findAll({ queryKey: ["gallery"] });
}

function flatten(data: GalleryInfiniteData | undefined): {
  submissions: SubmissionSummary[];
  hasMore: boolean;
} {
  const pages = data?.pages ?? [];
  return {
    submissions: pages.flatMap((p) => p.submissions),
    hasMore: pages[pages.length - 1]?.hasMore ?? false,
  };
}

/** Issue #198's AC: a "change" event updates a Submission already in a cached page in place, or inserts an unseen one at its sorted position when it matches that page's own filters. */
function applyChange(queryClient: QueryClient, generation: GenerationSummary) {
  for (const query of galleryQueries(queryClient)) {
    const [, modelFilter, stateFilter] = query.queryKey as [
      string,
      string | null,
      StateFilter,
    ];
    queryClient.setQueryData<GalleryInfiniteData>(query.queryKey, (current) => {
      if (!current) return current;
      const { submissions, hasMore } = flatten(current);
      const index = submissions.findIndex(
        (s) => s.submissionId === generation.submissionId,
      );

      let next: SubmissionSummary[];
      if (index !== -1) {
        const submission = submissions[index] as SubmissionSummary;
        const genIndex = submission.generations.findIndex(
          (g) => g.id === generation.id,
        );
        const generations =
          genIndex === -1
            ? [...submission.generations, generation]
            : submission.generations.map((g, i) =>
                i === genIndex ? mergeGeneration(g, generation) : g,
              );
        next = [...submissions];
        next[index] = { ...submission, generations };
      } else {
        if (modelFilter && generation.modelId !== modelFilter) return current;
        if (!matchesStateFilter(generation.state, stateFilter)) return current;
        const newSubmission: SubmissionSummary = {
          submissionId: generation.submissionId,
          modeId: generation.modeId,
          modeName: generation.modeName,
          submittedAt: generation.submittedAt,
          generations: [generation],
        };
        next = insertSubmission(submissions, newSubmission, hasMore);
        if (next === submissions) return current;
      }
      return { pages: [{ submissions: next, hasMore }], pageParams: [null] };
    });
  }
}

/** A "snapshot" event only refreshes Generations a cached page already has (issue #198's AC: never inserts). */
function applySnapshot(
  queryClient: QueryClient,
  generations: GenerationSummary[],
) {
  if (generations.length === 0) return;
  const byId = new Map(generations.map((g) => [g.id, g]));
  for (const query of galleryQueries(queryClient)) {
    queryClient.setQueryData<GalleryInfiniteData>(query.queryKey, (current) => {
      if (!current) return current;
      const { submissions, hasMore } = flatten(current);
      let changed = false;
      const next = submissions.map((submission) => {
        let subChanged = false;
        const nextGenerations = submission.generations.map((g) => {
          const incoming = byId.get(g.id);
          if (!incoming) return g;
          subChanged = true;
          return mergeGeneration(g, incoming);
        });
        if (!subChanged) return submission;
        changed = true;
        return { ...submission, generations: nextGenerations };
      });
      if (!changed) return current;
      return { pages: [{ submissions: next, hasMore }], pageParams: [null] };
    });
  }
}

export function useGalleryFeed({
  modelFilter,
  stateFilter,
}: {
  modelFilter: string | null;
  stateFilter: StateFilter;
}) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["gallery", modelFilter, stateFilter] as const,
    [modelFilter, stateFilter],
  );

  const {
    data,
    isPending,
    isError,
    fetchNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteQuery({
    queryKey,
    initialPageParam: null as GalleryCursor,
    queryFn: ({ pageParam }) =>
      ok<RawGalleryPage>(
        api.api.gallery.$get({
          query: galleryQueryParams(modelFilter, stateFilter, pageParam),
        }),
      ).then((page) => ({
        submissions: page.submissions.map(toSubmissionSummary),
        hasMore: page.hasMore,
      })),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? cursorFrom(lastPage.submissions) : undefined,
  });

  const { submissions, hasMore } = flatten(data);

  const setSubmissions = useCallback(
    (
      update:
        | SubmissionSummary[]
        | ((current: SubmissionSummary[]) => SubmissionSummary[]),
    ) => {
      queryClient.setQueryData<GalleryInfiniteData>(queryKey, (current) => {
        const { submissions: currentSubmissions, hasMore: currentHasMore } =
          flatten(current);
        const next =
          typeof update === "function" ? update(currentSubmissions) : update;
        return {
          pages: [{ submissions: next, hasMore: currentHasMore }],
          pageParams: [null],
        };
      });
    },
    [queryClient, queryKey],
  );

  useEventStream("/api/generations/stream", {
    snapshot: (qc, raw) => {
      const body = raw as { generations: GenerationSummary[] };
      applySnapshot(qc, body.generations);
    },
    change: (qc, raw) => {
      applyChange(qc, raw as GenerationSummary);
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

  const { data: progressById = new Map<string, GenerationProgress>() } =
    useQuery<Map<string, GenerationProgress>>({
      queryKey: PROGRESS_KEY,
      queryFn: () =>
        queryClient.getQueryData(PROGRESS_KEY) ??
        new Map<string, GenerationProgress>(),
      enabled: false,
    });

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
      markOwnCancel(submissionId);
    } catch {
      setCancelErrorSubmissionId(submissionId);
    } finally {
      setCancellingSubmissionIds((current) => {
        const next = new Set(current);
        next.delete(submissionId);
        return next;
      });
    }
  }, []);

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
          current.filter((s) => s.submissionId !== submissionId),
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
    isPending,
    isError,
    loadMoreError: isFetchNextPageError,
    isFetchingNextPage,
    fetchNextPage: () => void fetchNextPage(),
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
