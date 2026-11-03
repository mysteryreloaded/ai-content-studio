import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  AssetSummary,
  GenerationState,
  GenerationSummary,
  SubmissionSummary,
} from "../components/generations/types.js";
import { api, ok } from "../lib/api.js";
import { usePauseNotice } from "../usePauseNotice.js";
import { useSession } from "../useSession.js";
import { GenerationDetailOverlay } from "./GenerationDetailOverlay.js";
import {
  type GalleryModelOption,
  dayLabel,
  groupByDay,
  timeLabel,
  toStateFilter,
} from "./gallery/galleryLogic.js";
import { useGalleryFeed } from "./gallery/useGalleryFeed.js";

export { dayLabel };

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
      {generation.isTest && <span className="gallery-card-test">Test</span>}
      {generation.removedAt ? (
        <div className="gallery-card-state">
          <span role="alert">Removed by an administrator</span>
        </div>
      ) : generation.state === "succeeded" && mainAsset ? (
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

function SubmissionBlock({
  submission,
  paused,
  onOpen,
}: {
  submission: SubmissionSummary;
  paused: boolean;
  onOpen: (id: string) => void;
}) {
  const first = submission.generations[0];

  return (
    <section className="gallery-submission" aria-label={submission.modeName}>
      <header className="gallery-submission-header">
        {first && (
          <Link to={`/models/${first.modelSlug}`}>{first.modelName}</Link>
        )}
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

/** A user's own Gallery (issue #56): every Generation they've made, across every Model, grouped by day, filterable, live. */
export function GalleryPage() {
  const { session } = useSession();
  const { paused } = usePauseNotice();
  const [searchParams, setSearchParams] = useSearchParams();
  const modelFilter = searchParams.get("model");
  const stateFilter = toStateFilter(searchParams.get("state"));
  const { id: openGenerationId } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  const { data: modelsData } = useQuery({
    queryKey: ["gallery-models"],
    queryFn: () =>
      ok<{ models: GalleryModelOption[] }>(api.api.gallery.models.$get()),
  });
  const models = modelsData?.models ?? null;

  const {
    submissions,
    hasMore,
    isPending,
    isError,
    isFetchingNextPage,
    fetchNextPage,
    handleDismissGeneration,
  } = useGalleryFeed({ modelFilter, stateFilter });

  const now = useMemo(() => new Date(), []);
  const groups = useMemo(
    () => groupByDay(submissions, now),
    [submissions, now],
  );

  /** Every loaded Generation id in display order (issue #57's AC: ←/→ between Generations). Only this tab's already-loaded page, not the whole Gallery. */
  const orderedIds = useMemo(
    () =>
      submissions.flatMap((submission) =>
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
          onDeleted={handleDismissGeneration}
          onDismissed={handleDismissGeneration}
        />
      )}
      <main className="gallery">
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
                const value = event.target.value;
                if (value === "all") next.delete("state");
                else next.set("state", value);
                setSearchParams(next);
              }}
            >
              <option value="all">All</option>
              <option value="underway">Under way</option>
              <option value="finished">Finished</option>
              <option value="failed">Failed or cancelled</option>
            </select>
          </label>
        </form>

        {isError && <p role="alert">Could not load the Gallery.</p>}

        {isPending && !isError && <p>Loading…</p>}

        {!isPending && !isError && submissions.length === 0 && (
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

        {!isPending && submissions.length > 0 && !hasMore && (
          <p className="gallery-end">That's everything.</p>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={fetchNextPage}
            disabled={isFetchingNextPage}
          >
            Load more
          </button>
        )}
      </main>
    </>
  );
}
