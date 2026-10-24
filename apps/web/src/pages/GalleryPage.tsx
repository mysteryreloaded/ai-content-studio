import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Footer } from "../Footer.js";
import { usePauseNotice } from "../usePauseNotice.js";
import { useSession } from "../useSession.js";
import { GenerationDetailOverlay } from "./GenerationDetailOverlay.js";

type GenerationState =
  | "queued"
  | "starting"
  | "running"
  | "saving"
  | "succeeded"
  | "failed"
  | "cancelling"
  | "cancelled";

type StateFilter = "all" | "underway" | "finished" | "failed";

const STATE_BUCKETS: Record<Exclude<StateFilter, "all">, GenerationState[]> = {
  underway: ["queued", "starting", "running", "saving", "cancelling"],
  finished: ["succeeded"],
  // "Failed or cancelled" (issue #54): a cancelled Generation never
  // produced anything to show either, so it buckets with "failed".
  failed: ["failed", "cancelled"],
};

const STATE_LABELS: Record<StateFilter, string> = {
  all: "All",
  underway: "Under way",
  finished: "Finished",
  failed: "Failed or cancelled",
};

/** An unrecognised `?state=` (a stale link, a typo) reads as "all" rather than throwing later when a bucket lookup misses. */
function toStateFilter(value: string | null): StateFilter {
  return value !== null && value in STATE_LABELS
    ? (value as StateFilter)
    : "all";
}

function matchesStateFilter(
  state: GenerationState,
  filter: StateFilter,
): boolean {
  return filter === "all" || STATE_BUCKETS[filter].includes(state);
}

interface AssetSummary {
  id: string;
  nodeId: string;
  sortOrder: number;
  kind: string;
  contentType: string;
}

interface GenerationSummary {
  id: string;
  modelId: string;
  modeId: string;
  modeName: string;
  submissionId: string;
  state: GenerationState;
  error: string | null;
  submittedAt: string;
  assets: AssetSummary[];
}

interface GallerySubmission {
  submissionId: string;
  modelId: string;
  modelSlug: string;
  modelName: string;
  modeId: string;
  modeName: string;
  submittedAt: string;
  generations: GenerationSummary[];
}

interface GalleryModelOption {
  id: string;
  slug: string;
  name: string;
  deleted: boolean;
}

const PAGE_LIMIT = 24;

function stateLabel(state: GenerationState, paused: boolean): string {
  switch (state) {
    case "queued":
      if (paused) return "Queued · paused";
      return "Queued";
    case "starting":
      return "Starting…";
    case "running":
      return "Running…";
    case "saving":
      return "Saving…";
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelling":
      return "Cancelling…";
    case "cancelled":
      return "Cancelled";
    default:
      return state;
  }
}

/** The thumbnail src for a card's main (first) Asset: the small `/thumb` for an image, the `/poster` frame for a video, or nothing for audio. */
function thumbSrcFor(asset: AssetSummary): string | null {
  if (asset.kind === "image") return `/api/assets/${asset.id}/thumb`;
  if (asset.kind === "video") return `/api/assets/${asset.id}/poster`;
  return null;
}

function GenerationCard({
  generation,
  paused,
  onOpen,
}: {
  generation: GenerationSummary;
  paused: boolean;
  onOpen: (id: string) => void;
}) {
  const mainAsset = generation.assets[0];
  const extra = generation.assets.length - 1;
  const thumb = mainAsset ? thumbSrcFor(mainAsset) : null;

  return (
    <li className="gallery-card">
      <button
        type="button"
        className="gallery-card-button"
        onClick={() => onOpen(generation.id)}
        aria-label={`Open Generation ${generation.id}`}
      />
      {generation.state === "succeeded" && mainAsset ? (
        <>
          {thumb ? (
            <img src={thumb} alt="" className="gallery-card-thumb" />
          ) : (
            <div
              className="gallery-card-thumb gallery-card-audio"
              aria-hidden="true"
            >
              ♪
            </div>
          )}
          {extra > 0 && <span className="gallery-card-badge">+{extra}</span>}
        </>
      ) : (
        <div className="gallery-card-state">
          <span>{stateLabel(generation.state, paused)}</span>
          {generation.state === "failed" && generation.error && (
            <span role="alert">{generation.error}</span>
          )}
        </div>
      )}
    </li>
  );
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The day header label, in the browser's own time zone (issue #56): Today, Yesterday, or "Wednesday 21 October", the year appended when it isn't the current one. */
export function dayLabel(date: Date, now: Date): string {
  const atMidnight = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round(
    (atMidnight(now) - atMidnight(date)) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  const label = `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear()
    ? label
    : `${label} ${date.getFullYear()}`;
}

function timeLabel(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

interface DayGroup {
  label: string;
  submissions: GallerySubmission[];
}

/** Groups `submissions` (already newest first) into consecutive same-day runs, each with its own day header. */
function groupByDay(submissions: GallerySubmission[], now: Date): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const submission of submissions) {
    const label = dayLabel(new Date(submission.submittedAt), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.submissions.push(submission);
    } else {
      groups.push({ label, submissions: [submission] });
    }
  }
  return groups;
}

function SubmissionBlock({
  submission,
  paused,
  onOpen,
}: {
  submission: GallerySubmission;
  paused: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="gallery-submission" aria-label={submission.modeName}>
      <header className="gallery-submission-header">
        <Link to={`/models/${submission.modelSlug}`}>
          {submission.modelName}
        </Link>
        <span>{submission.modeName}</span>
        <time dateTime={submission.submittedAt}>
          {timeLabel(new Date(submission.submittedAt))}
        </time>
      </header>
      <ul className="gallery-card-grid">
        {submission.generations.map((generation) => (
          <GenerationCard
            key={generation.id}
            generation={generation}
            paused={paused}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
}

/** Whether `a` sorts no later than `b` in the Gallery's own (submittedAt desc, submissionId desc) order — i.e. `a` is newer, or equally new with a "greater" id. */
function sortsNoLaterThan(
  a: { submittedAt: string; submissionId: string },
  b: { submittedAt: string; submissionId: string },
): boolean {
  if (a.submittedAt !== b.submittedAt) return a.submittedAt > b.submittedAt;
  return a.submissionId >= b.submissionId;
}

/**
 * Inserts a newly-seen Submission at its (submittedAt, id) position
 * rather than always on top (QA round 1): an SSE event can arrive for an
 * older Submission (one that just failed, or just moved into a state
 * filter's bucket). When `hasMore` is true and it sorts at or after the
 * last loaded page's end, its real position is in a page this tab
 * hasn't fetched yet, so it's dropped instead of risking a wrong
 * position or a duplicate once "Load more" reaches it.
 */
function insertSubmission(
  current: GallerySubmission[],
  submission: GallerySubmission,
  hasMore: boolean,
): GallerySubmission[] {
  const last = current[current.length - 1];
  if (hasMore && last && sortsNoLaterThan(last, submission)) return current;

  const index = current.findIndex(
    (existing) => !sortsNoLaterThan(existing, submission),
  );
  if (index === -1) return [...current, submission];
  return [...current.slice(0, index), submission, ...current.slice(index)];
}

function queryFor(
  modelId: string | null,
  state: StateFilter,
  cursor: { submittedAt: string; submissionId: string } | null,
): string {
  const params = new URLSearchParams();
  if (modelId) params.set("model", modelId);
  if (state !== "all") params.set("state", state);
  params.set("limit", String(PAGE_LIMIT));
  if (cursor) {
    params.set("afterSubmittedAt", cursor.submittedAt);
    params.set("afterSubmissionId", cursor.submissionId);
  }
  return params.toString();
}

/** A user's own Gallery (issue #56): every Generation they've made, across every Model, grouped by day, filterable, live. */
export function GalleryPage() {
  const { session } = useSession();
  const { paused } = usePauseNotice();
  const [searchParams, setSearchParams] = useSearchParams();
  const modelFilter = searchParams.get("model");
  const stateFilter = toStateFilter(searchParams.get("state"));
  const { id: openGenerationId } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  const [models, setModels] = useState<GalleryModelOption[] | null>(null);
  const [submissions, setSubmissions] = useState<GallerySubmission[] | null>(
    null,
  );
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/gallery/models")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { models: GalleryModelOption[] } | null) => {
        if (body) setModels(body.models);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSubmissions(null);
    setLoadError(null);

    fetch(`/api/gallery?${queryFor(modelFilter, stateFilter, null)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{
          submissions: GallerySubmission[];
          hasMore: boolean;
        }>;
      })
      .then((body) => {
        if (cancelled) return;
        setSubmissions(body.submissions);
        setHasMore(body.hasMore);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load the Gallery.");
      });

    return () => {
      cancelled = true;
    };
  }, [modelFilter, stateFilter]);

  // Tracked in a ref (not just the closure's captured values) so an
  // in-flight request can tell, once it resolves, whether the filters it
  // was sent for are still the active ones (QA round 1: a filter change
  // mid-request must drop that page rather than append it under the new
  // filters).
  const filtersRef = useRef({ modelFilter, stateFilter });
  filtersRef.current = { modelFilter, stateFilter };
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

  const handleLoadMore = useCallback(async () => {
    const current = submissions;
    const last = current?.[current.length - 1];
    if (!last) return;
    const requestFilters = { modelFilter, stateFilter };
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/gallery?${queryFor(modelFilter, stateFilter, {
          submittedAt: last.submittedAt,
          submissionId: last.submissionId,
        })}`,
      );
      if (!res.ok) throw new Error(`unexpected status ${res.status}`);
      const body = (await res.json()) as {
        submissions: GallerySubmission[];
        hasMore: boolean;
      };
      if (
        filtersRef.current.modelFilter !== requestFilters.modelFilter ||
        filtersRef.current.stateFilter !== requestFilters.stateFilter
      ) {
        // The filters changed while this page was in flight; the effect
        // above already started a fresh load under the new ones.
        return;
      }
      setSubmissions((prev) => {
        const seen = new Set((prev ?? []).map((s) => s.submissionId));
        const fresh = body.submissions.filter((s) => !seen.has(s.submissionId));
        return [...(prev ?? []), ...fresh];
      });
      setHasMore(body.hasMore);
    } catch {
      setLoadError("Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  }, [submissions, modelFilter, stateFilter]);

  useEffect(() => {
    const source = new EventSource("/api/generations/stream");

    source.addEventListener("change", (event) => {
      const generation = JSON.parse(
        (event as MessageEvent).data,
      ) as GenerationSummary & {
        modelSlug: string;
        modelName: string;
      };

      setSubmissions((current) => {
        if (current === null) return current;
        const index = current.findIndex(
          (s) => s.submissionId === generation.submissionId,
        );
        if (index !== -1) {
          const submission = current[index] as GallerySubmission;
          const genIndex = submission.generations.findIndex(
            (g) => g.id === generation.id,
          );
          const generations =
            genIndex === -1
              ? [...submission.generations, generation]
              : submission.generations.map((g, i) =>
                  i === genIndex ? generation : g,
                );
          const next = [...current];
          next[index] = { ...submission, generations };
          return next;
        }

        const { modelFilter: activeModel, stateFilter: activeState } =
          filtersRef.current;
        if (activeModel && generation.modelId !== activeModel) return current;
        if (!matchesStateFilter(generation.state, activeState)) return current;

        const newSubmission: GallerySubmission = {
          submissionId: generation.submissionId,
          modelId: generation.modelId,
          modelSlug: generation.modelSlug,
          modelName: generation.modelName,
          modeId: generation.modeId,
          modeName: generation.modeName,
          submittedAt: generation.submittedAt,
          generations: [generation],
        };
        return insertSubmission(current, newSubmission, hasMoreRef.current);
      });
    });

    return () => source.close();
  }, []);

  const now = useMemo(() => new Date(), []);
  const groups = useMemo(
    () => (submissions ? groupByDay(submissions, now) : []),
    [submissions, now],
  );

  /** Every loaded Generation id in display order (issue #57's AC: ←/→ between Generations). Only this tab's already-loaded page, not the whole Gallery. */
  const orderedIds = useMemo(
    () =>
      (submissions ?? []).flatMap((submission) =>
        submission.generations.map((generation) => generation.id),
      ),
    [submissions],
  );

  function openGeneration(id: string) {
    navigate(`/generations/${id}?${searchParams.toString()}`);
  }

  function closeOverlay() {
    navigate(`/gallery?${searchParams.toString()}`);
  }

  function handleDeleted(deletedId: string) {
    setSubmissions((current) =>
      (current ?? [])
        .map((submission) => ({
          ...submission,
          generations: submission.generations.filter(
            (generation) => generation.id !== deletedId,
          ),
        }))
        .filter((submission) => submission.generations.length > 0),
    );
  }

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;

  const hasActiveFilters = !!modelFilter || stateFilter !== "all";

  function clearFilters() {
    setSearchParams({});
  }

  return (
    <>
      {openGenerationId && (
        <GenerationDetailOverlay
          id={openGenerationId}
          prevId={orderedIds[orderedIds.indexOf(openGenerationId) - 1] ?? null}
          nextId={orderedIds[orderedIds.indexOf(openGenerationId) + 1] ?? null}
          onClose={closeOverlay}
          onNavigate={openGeneration}
          onDeleted={handleDeleted}
        />
      )}
      <main className="gallery">
        <style>{GALLERY_STYLE}</style>
        <h1>Gallery</h1>

        <form className="gallery-filters" aria-label="Filters">
          <label>
            Model
            <select
              value={modelFilter ?? ""}
              onChange={(event) => {
                const next = new URLSearchParams(searchParams);
                if (event.target.value) next.set("model", event.target.value);
                else next.delete("model");
                setSearchParams(next);
              }}
            >
              <option value="">All Models</option>
              {models?.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                  {model.deleted ? " (deleted)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            State
            <select
              value={stateFilter}
              onChange={(event) => {
                const next = new URLSearchParams(searchParams);
                const value = event.target.value as StateFilter;
                if (value === "all") next.delete("state");
                else next.set("state", value);
                setSearchParams(next);
              }}
            >
              {(Object.keys(STATE_LABELS) as StateFilter[]).map((key) => (
                <option key={key} value={key}>
                  {STATE_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </form>

        {loadError && <p role="alert">{loadError}</p>}

        {submissions === null && !loadError && <p>Loading…</p>}

        {submissions !== null && submissions.length === 0 && (
          <p>
            {hasActiveFilters ? (
              <>
                No Generations match.{" "}
                <button type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              </>
            ) : (
              "Nothing here yet"
            )}
          </p>
        )}

        {groups.map((group) => (
          <div
            key={group.submissions[0]?.submissionId ?? group.label}
            className="gallery-day"
          >
            <h2>{group.label}</h2>
            {group.submissions.map((submission) => (
              <SubmissionBlock
                key={submission.submissionId}
                submission={submission}
                paused={paused}
                onOpen={openGeneration}
              />
            ))}
          </div>
        ))}

        {submissions !== null && submissions.length > 0 && !hasMore && (
          <p className="gallery-end">That's everything.</p>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
          >
            Load more
          </button>
        )}
      </main>
      <Footer />
    </>
  );
}

const GALLERY_STYLE = `
.gallery {
  max-width: 1100px;
  margin: 0 auto;
}
.gallery-filters {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  margin: 1rem 0;
}
.gallery-day h2 {
  margin-top: 2rem;
}
.gallery-submission {
  margin: 1rem 0;
}
.gallery-submission-header {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  flex-wrap: wrap;
}
.gallery-card-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
  list-style: none;
  padding: 0;
  margin: 0.5rem 0;
}
.gallery-card {
  position: relative;
  aspect-ratio: 1;
  background: var(--gallery-card-background, rgba(128, 128, 128, 0.15));
  border-radius: 0.25rem;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gallery-card-button {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.gallery-card-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.gallery-card-audio {
  font-size: 1.5rem;
}
.gallery-card-badge {
  position: absolute;
  bottom: 0.25rem;
  right: 0.25rem;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: 0.75rem;
  padding: 0.1rem 0.4rem;
  border-radius: 0.5rem;
}
.gallery-card-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  font-size: 0.85rem;
  padding: 0.5rem;
}
.gallery-end {
  opacity: 0.7;
  text-align: center;
}
@media (max-width: 640px) {
  .gallery-card-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
`;
