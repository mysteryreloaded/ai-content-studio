import { useQuery } from "@tanstack/react-query";
import { UNDERWAY_STATES } from "../notifications/types.js";
import type { GenerationState } from "../notifications/types.js";
import { useSession } from "../useSession.js";
import { useEventStream } from "./sse.js";

/**
 * One of the user's own Generations, as the shared stream's snapshot and
 * change events report it (a subset of the server's `GenerationSummary`).
 * `deletedAt` is set once the owner (or the account's deletion) tombstones
 * it — such a Generation no longer counts as under way, even though the
 * row's `state` may not be terminal yet; an Admin's removal (`removedAt`)
 * still counts. Both are ISO strings (or `null`) in the stream's JSON.
 */
export interface ActiveGenerationSummary {
  id: string;
  modelId: string;
  modelSlug: string;
  modelName: string;
  modeId: string;
  modeName: string;
  submissionId: string;
  state: GenerationState;
  deletedAt: string | null;
  removedAt: string | null;
}

/** The `["generations", "active"]` query-cache entry. */
export interface ActiveGenerations {
  generations: ActiveGenerationSummary[];
}

/** A Generation is under way while it sits in one of `UNDERWAY_STATES` and has not been tombstoned. */
export function isUnderway(generation: ActiveGenerationSummary): boolean {
  return UNDERWAY_STATES.has(generation.state) && generation.deletedAt === null;
}

/**
 * The user's Generations still under way: the same N as the tab title's
 * cue "(2) LTX 2.5 · My Studio" (issue #58) and the Gallery link's live
 * count (issue #188). Both call this, so they can never disagree.
 */
export function underwayCount(generations: ActiveGenerationSummary[]): number {
  return generations.filter(isUnderway).length;
}

/** One Model's Generations under way from the same set (issue #188; the Workbench's per-Model pill, #195, reads this). */
export function underwayCountFor(
  generations: ActiveGenerationSummary[],
  modelSlug: string,
): number {
  return generations.filter(
    (generation) =>
      isUnderway(generation) && generation.modelSlug === modelSlug,
  ).length;
}

const ACTIVE_KEY = ["generations", "active"] as const;
const EMPTY_ACTIVE: ActiveGenerations = { generations: [] };

/**
 * The one store of the user's Generations under way (issue #188): a
 * `["generations", "active"]` cache entry kept current by the shell's
 * single shared `/api/generations/stream` subscription (one
 * `EventSource` per URL per tab, via `useEventStream` — #59). The
 * Workbench's pill and phone chip (#195), the Gallery and the detail
 * dialog read this instead of keeping a copy of their own.
 *
 * A `snapshot` replaces the entry; a `change` upserts a Generation that
 * is still under way (in place, or prepended when it is new) and drops
 * one that reached a terminal state or was tombstoned. The stream route
 * is `active`-only, so the subscription is gated: signed in and
 * `status === "active"` — a signed-out visitor or a pending user opens
 * no generations stream from the shell at all, and a disabled user no
 * longer 403s into a reconnect loop either (`sse.ts` closes on a 401/403
 * peek).
 */
export function useActiveGenerations(): ActiveGenerations {
  const { session } = useSession();
  const enabled =
    session.status === "signed-in" && session.user.status === "active";

  useEventStream(
    "/api/generations/stream",
    {
      snapshot: (queryClient, data) => {
        const body = data as { generations: ActiveGenerationSummary[] };
        queryClient.setQueryData(ACTIVE_KEY, {
          generations: body.generations,
        });
      },
      change: (queryClient, data) => {
        const generation = data as ActiveGenerationSummary;
        const current = queryClient.getQueryData<ActiveGenerations>(ACTIVE_KEY);
        // The wire order is the snapshot first, then the buffered changes;
        // a change that arrives before any snapshot (a reconnection whose
        // snapshot is still in flight) is dropped — the next snapshot
        // settles the entry.
        if (!current) return;
        const generations = [...current.generations];
        const index = generations.findIndex((g) => g.id === generation.id);
        if (isUnderway(generation)) {
          if (index === -1) generations.unshift(generation);
          else generations[index] = generation;
        } else if (index !== -1) {
          generations.splice(index, 1);
        }
        queryClient.setQueryData(ACTIVE_KEY, { generations });
      },
    },
    { enabled },
  );

  // The stream always sends the current snapshot first, so the cache only
  // needs writing, never a refetch (the same pattern as `usePauseNotice`).
  const { data } = useQuery({
    queryKey: ACTIVE_KEY,
    queryFn: async () => EMPTY_ACTIVE,
    initialData: EMPTY_ACTIVE,
    staleTime: Number.POSITIVE_INFINITY,
  });

  return data ?? EMPTY_ACTIVE;
}
