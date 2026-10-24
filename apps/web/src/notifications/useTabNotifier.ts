import { useCallback, useEffect, useRef } from "react";
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
 * Mounted once, globally (`main.tsx`'s `RootLayout`): the tab title/favicon
 * cue and the browser Notification pipeline for issue #58. It keeps its
 * own `/api/generations/stream` subscription — every open tab already
 * does this independently (`WorkbenchPage.tsx`, `GalleryPage.tsx`), so a
 * third independent one here follows the existing pattern rather than
 * plumbing a new shared context through both pages.
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

  const siteTitleRef = useRef<string>(originalTitleRef.current);
  const logoUrlRef = useRef<string | null>(null);
  siteTitleRef.current = siteSettings?.title ?? originalTitleRef.current;
  logoUrlRef.current = siteSettings?.hasLogo ? "/api/site-settings/logo" : null;

  const refreshTabCue = useCallback(() => {
    if (!hiddenRef.current) {
      document.title = originalTitleRef.current;
      setFaviconDot(null, logoUrlRef.current);
      return;
    }

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

    if (underwayCount > 0) {
      document.title = underwayTitle(
        { count: underwayCount, modelName: lastUnderwayModelName },
        siteTitleRef.current,
      );
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
        showNotification(
          { ...content, icon: logoUrlRef.current ?? undefined },
          () => {
            if (targetId) window.location.assign(`/generations/${targetId}`);
          },
        );
      }

      decidedRef.current.add(submissionId);
      trackedRef.current.delete(submissionId);
      refreshTabCue();
    },
    [refreshTabCue],
  );

  // The SSE subscription: snapshot on connect, then "change" events.
  // Issue #58's AC: a Submission dropped from a snapshot without this tab
  // having seen its own "change" event (a missed heartbeat, a frozen
  // background tab) is resolved by fetching its own id.
  useEffect(() => {
    if (session.status !== "signed-in") return;
    const source = new EventSource("/api/generations/stream");

    source.addEventListener("snapshot", (event) => {
      const body = JSON.parse((event as MessageEvent).data) as {
        generations: GenerationSummary[];
      };
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
    });

    source.addEventListener("change", (event) => {
      const generation = JSON.parse(
        (event as MessageEvent).data,
      ) as GenerationSummary;
      if (UNDERWAY_STATES.has(generation.state))
        activeIdsRef.current.add(generation.id);
      else activeIdsRef.current.delete(generation.id);

      upsertTracked(trackedRef.current, generation);
      resolveSubmissionEnd(generation.submissionId);
      refreshTabCue();
    });

    return () => source.close();
  }, [session.status, refreshTabCue, resolveSubmissionEnd]);

  // Own visibility + every other tab's, shared over BroadcastChannel, plus
  // the Notifier election over Web Locks (issue #58's AC).
  useEffect(() => {
    const tabId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    const visibleTabs = new Map<string, number>();

    function recomputeAnyVisible() {
      const now = Date.now();
      for (const [id, at] of visibleTabs) {
        if (now - at > VISIBILITY_STALE_MS) visibleTabs.delete(id);
      }
      anyTabVisibleRef.current = !hiddenRef.current || visibleTabs.size > 0;
    }

    function broadcastVisibility() {
      postTabMessage({ type: "visibility", tabId, visible: !document.hidden });
    }

    const unsubscribe = subscribeTabChannel((message) => {
      if (message.type !== "visibility") return;
      if (message.visible) visibleTabs.set(message.tabId, Date.now());
      else visibleTabs.delete(message.tabId);
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
  }, [refreshTabCue]);

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
