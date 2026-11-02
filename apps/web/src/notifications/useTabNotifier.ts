import { useCallback, useEffect, useRef } from "react";
import { useEventStream } from "../lib/sse.js";
import { useSession } from "../useSession.js";
import { useSiteSettings } from "../useSiteSettings.js";
import {
  getNotificationPermission,
  showNotification,
} from "./browserNotification.js";
import {
  electNotifier,
  postTabMessage,
  subscribeTabChannel,
} from "./crossTab.js";
import { FAILURE_DOT_COLOR, setFaviconDot } from "./favicon.js";
import {
  buildNotificationContent,
  notificationClickTarget,
  shouldNotify,
} from "./notificationDecision.js";
import { isOwnCancelled } from "./ownCancel.js";
import { readNotificationsEnabled } from "./preference.js";
import { outcomeCounts } from "./submissionOutcome.js";
import { endedTitle, faviconDotFor, underwayTitle } from "./tabTitle.js";
import { TERMINAL_STATES, UNDERWAY_STATES } from "./types.js";
import type { GenerationState, TrackedSubmission } from "./types.js";

interface GenerationSummary {
  id: string;
  modelName: string;
  modeName: string;
  submissionId: string;
  state: GenerationState;
}

const VISIBILITY_HEARTBEAT_MS = 4_000;
const VISIBILITY_STALE_MS = 10_000;

function upsertTracked(
  tracked: Map<string, TrackedSubmission>,
  generation: GenerationSummary,
): void {
  const existing = tracked.get(generation.submissionId);
  if (!existing) {
    tracked.set(generation.submissionId, {
      submissionId: generation.submissionId,
      modelName: generation.modelName,
      modeName: generation.modeName,
      generations: [{ id: generation.id, state: generation.state }],
    });
    return;
  }
  const index = existing.generations.findIndex((g) => g.id === generation.id);
  if (index === -1) {
    existing.generations.push({ id: generation.id, state: generation.state });
  } else {
    existing.generations[index] = {
      id: generation.id,
      state: generation.state,
    };
  }
}

/**
 * Mounted once, globally (`RootLayout`): the tab title/favicon cue and the
 * browser Notification pipeline for issue #58. Since issue #188 it no
 * longer opens its own `/api/generations/stream` — it registers
 * `snapshot`/`change` handlers on the shell's shared stream, the same
 * `EventSource` per tab that `useActiveGenerations` (and the pages' own
 * subscriptions, `WorkbenchPage.tsx` and `GalleryPage.tsx`) shares through
 * `useEventStream` (#59). The shell adds no connection, and the tab
 * title's N and the nav's live count always agree. The subscription is
 * gated on the session: a pending user or a signed-out visitor opens no
 * generations stream at all (issue #188's AC), and a disabled user no
 * longer 403s into the peek's reconnect loop.
 */
export function useTabNotifier(): void {
  const { session } = useSession();
  const siteSettings = useSiteSettings();

  const trackedRef = useRef<Map<string, TrackedSubmission>>(new Map());
  const activeIdsRef = useRef<Set<string>>(new Set());
  const decidedRef = useRef<Set<string>>(new Set());
  const endedAccumulatorRef = useRef({ ready: 0, failed: 0 });
  const hiddenRef = useRef<boolean>(document.hidden);
  const anyTabVisibleRef = useRef<boolean>(!document.hidden);
  const isNotifierRef = useRef<boolean>(false);
  const originalTitleRef = useRef<string>(document.title);
  const visibleTabsRef = useRef<Map<string, number>>(new Map());

  const recomputeAnyVisible = useCallback(() => {
    const now = Date.now();
    for (const [id, at] of visibleTabsRef.current) {
      if (now - at > VISIBILITY_STALE_MS) visibleTabsRef.current.delete(id);
    }
    anyTabVisibleRef.current =
      !hiddenRef.current || visibleTabsRef.current.size > 0;
  }, []);

  const siteTitleRef = useRef<string>(originalTitleRef.current);
  const logoUrlRef = useRef<string | null>(null);
  siteTitleRef.current = siteSettings?.title ?? originalTitleRef.current;
  logoUrlRef.current = siteSettings?.hasLogo ? "/api/site-settings/logo" : null;

  const refreshTabCue = useCallback(() => {
    let underwayCount = 0;
    let lastUnderwayModelName = "";
    for (const submission of trackedRef.current.values()) {
      const generationsUnderway = submission.generations.filter(
        (g) => !g.removed && UNDERWAY_STATES.has(g.state),
      ).length;
      if (generationsUnderway > 0) {
        underwayCount += generationsUnderway;
        lastUnderwayModelName = submission.modelName;
      }
    }

    // Issue #58's AC 1: the underway count/Model cue shows whenever work is
    // under way, in the visible tab too — only the ✓/✕ summary and favicon
    // dot below are hidden-only.
    if (underwayCount > 0) {
      document.title = underwayTitle(
        { count: underwayCount, modelName: lastUnderwayModelName },
        siteTitleRef.current,
      );
      setFaviconDot(null, logoUrlRef.current);
      return;
    }

    if (!hiddenRef.current) {
      document.title = originalTitleRef.current;
      setFaviconDot(null, logoUrlRef.current);
      return;
    }

    const accumulator = endedAccumulatorRef.current;
    if (accumulator.ready + accumulator.failed > 0) {
      document.title = endedTitle(accumulator, siteTitleRef.current);
      const dot = faviconDotFor(accumulator);
      const accent = getComputedStyle(document.documentElement)
        .getPropertyValue("--accent")
        .trim();
      setFaviconDot(
        dot === "failure"
          ? FAILURE_DOT_COLOR
          : dot === "accent"
            ? accent || null
            : null,
        logoUrlRef.current,
      );
      return;
    }

    document.title = originalTitleRef.current;
    setFaviconDot(null, logoUrlRef.current);
  }, []);

  const resolveSubmissionEnd = useCallback(
    (submissionId: string) => {
      const submission = trackedRef.current.get(submissionId);
      if (!submission) return;
      const ended = submission.generations.every(
        (g) => g.removed || TERMINAL_STATES.has(g.state),
      );
      if (!ended) return;

      const counts = outcomeCounts(submission);
      const alreadyDecided = decidedRef.current.has(submissionId);
      const ownCancelled = isOwnCancelled(submissionId);

      // A lone notifier tab gets no incoming BroadcastChannel messages, so
      // prune stale `visibleTabs` entries right here too, not only when a
      // message arrives — otherwise a vanished tab stays "visible" forever.
      recomputeAnyVisible();

      if (
        !alreadyDecided &&
        hiddenRef.current &&
        counts.ready + counts.failed > 0
      ) {
        endedAccumulatorRef.current = {
          ready: endedAccumulatorRef.current.ready + counts.ready,
          failed: endedAccumulatorRef.current.failed + counts.failed,
        };
      }

      // Bookkeeping (decided/tracked/the tab cue) must happen regardless of
      // whether showNotification throws, so a throw there can't leave this
      // Submission re-decided or double-counted into the accumulator.
      decidedRef.current.add(submissionId);
      trackedRef.current.delete(submissionId);

      if (
        isNotifierRef.current &&
        readNotificationsEnabled() &&
        getNotificationPermission() === "granted" &&
        shouldNotify({
          submission,
          alreadyDecided,
          anyTabVisible: anyTabVisibleRef.current,
          ownCancelled,
        })
      ) {
        const content = buildNotificationContent(
          submission,
          siteTitleRef.current,
        );
        const targetId = notificationClickTarget(submission);
        try {
          showNotification(
            { ...content, icon: logoUrlRef.current ?? undefined },
            () => {
              if (targetId) window.location.assign(`/generations/${targetId}`);
            },
          );
        } catch {
          // Some browsers expose `Notification` but still throw on
          // construction; never let that skip the bookkeeping above.
        }
      }

      refreshTabCue();
    },
    [refreshTabCue, recomputeAnyVisible],
  );

  // The shared-stream subscription (issue #188): `useEventStream` opens the
  // tab's one `/api/generations/stream` `EventSource` and hands this hook
  // each event's already-parsed data. The snapshot on connect, then
  // "change" events. Issue #58's AC: a Submission dropped from a snapshot
  // without this tab having seen its own "change" event (a missed
  // heartbeat, a frozen background tab) is resolved by fetching its own
  // id (the one remaining `fetch(` in the shell).
  const enabled =
    session.status === "signed-in" && session.user.status === "active";
  useEventStream(
    "/api/generations/stream",
    {
      snapshot: (_queryClient, data) => {
        const body = data as { generations: GenerationSummary[] };
        const nextIds = new Set(body.generations.map((g) => g.id));
        const dropped = [...activeIdsRef.current].filter(
          (id) => !nextIds.has(id),
        );
        activeIdsRef.current = nextIds;

        for (const generation of body.generations)
          upsertTracked(trackedRef.current, generation);

        for (const id of dropped) {
          void fetch(`/api/generations/${id}`)
            .then((res) => (res.ok ? res.json() : null))
            .then(
              (
                detail: {
                  state: GenerationState;
                  deletedAt: string | null;
                } | null,
              ) => {
                for (const submission of trackedRef.current.values()) {
                  const generation = submission.generations.find(
                    (g) => g.id === id,
                  );
                  if (!generation) continue;
                  if (detail) {
                    generation.state = detail.state;
                    generation.removed = detail.deletedAt !== null;
                  } else {
                    generation.removed = true;
                  }
                  resolveSubmissionEnd(submission.submissionId);
                }
              },
            )
            .catch(() => {
              // Leave its last known state; a later snapshot retries the diff.
            });
        }

        refreshTabCue();
      },
      change: (_queryClient, data) => {
        const generation = data as GenerationSummary;
        if (UNDERWAY_STATES.has(generation.state))
          activeIdsRef.current.add(generation.id);
        else activeIdsRef.current.delete(generation.id);

        upsertTracked(trackedRef.current, generation);
        resolveSubmissionEnd(generation.submissionId);
        refreshTabCue();
      },
    },
    { enabled },
  );

  // Own visibility + every other tab's, shared over BroadcastChannel, plus
  // the Notifier election over Web Locks (issue #58's AC).
  useEffect(() => {
    const tabId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);

    function broadcastVisibility() {
      postTabMessage({ type: "visibility", tabId, visible: !document.hidden });
    }

    const unsubscribe = subscribeTabChannel((message) => {
      if (message.type !== "visibility") return;
      if (message.visible)
        visibleTabsRef.current.set(message.tabId, Date.now());
      else visibleTabsRef.current.delete(message.tabId);
      recomputeAnyVisible();
    });

    function onVisibilityChange() {
      hiddenRef.current = document.hidden;
      if (!document.hidden)
        endedAccumulatorRef.current = { ready: 0, failed: 0 };
      broadcastVisibility();
      recomputeAnyVisible();
      refreshTabCue();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    broadcastVisibility();
    const heartbeat = setInterval(broadcastVisibility, VISIBILITY_HEARTBEAT_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(heartbeat);
      unsubscribe();
    };
  }, [refreshTabCue, recomputeAnyVisible]);

  useEffect(() => {
    const release = electNotifier(() => {
      isNotifierRef.current = true;
    });
    return () => {
      isNotifierRef.current = false;
      release();
    };
  }, []);
}
