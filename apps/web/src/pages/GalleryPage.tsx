import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { FormField } from "../components/admin/FormField.js";
import { SubmissionBlock } from "../components/generations/SubmissionBlock.js";
import { Alert } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group.js";
import { api, ok } from "../lib/api.js";
import { useEnabledModels } from "../lib/models.js";
import { useMediaQuery } from "../lib/useMediaQuery.js";
import { usePauseNotice } from "../usePauseNotice.js";
import { useSession } from "../useSession.js";
import { GenerationDetailOverlay } from "./GenerationDetailOverlay.js";
import {
  type GalleryModelOption,
  STATE_LABELS,
  type StateFilter,
  dayLabel,
  filterRemovedForState,
  groupByDay,
  toStateFilter,
} from "./gallery/galleryLogic.js";
import { useGalleryFeed } from "./gallery/useGalleryFeed.js";

export { dayLabel };

const STATE_FILTER_ORDER: StateFilter[] = [
  "all",
  "underway",
  "finished",
  "failed",
];

/** The segmented control / select pair driving `?model=<id>&state=…` (issue #198): segmented from 640px, two labelled selects below it. */
function GalleryFilters({
  models,
  modelFilter,
  stateFilter,
  onModelChange,
  onStateChange,
}: {
  models: GalleryModelOption[];
  modelFilter: string | null;
  stateFilter: StateFilter;
  onModelChange: (modelId: string | null) => void;
  onStateChange: (state: StateFilter) => void;
}) {
  const isDesktop = useMediaQuery("(min-width: 640px)");
  const itemClassName =
    "px-[9px] py-1 text-[12.5px] text-muted-foreground data-[state=on]:bg-accent-soft data-[state=on]:font-semibold data-[state=on]:text-foreground";

  if (isDesktop) {
    return (
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Model"
          value={modelFilter ?? ""}
          onValueChange={(value) => {
            if (!value && modelFilter === null) return;
            onModelChange(value || null);
          }}
        >
          <ToggleGroupItem value="" className={itemClassName}>
            All Models
          </ToggleGroupItem>
          {models.map((model) => (
            <ToggleGroupItem
              key={model.id}
              value={model.id}
              className={itemClassName}
            >
              {model.name}
              {model.deleted ? " (deleted)" : ""}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="State"
          value={stateFilter}
          onValueChange={(value) => {
            if (!value) return;
            onStateChange(value as StateFilter);
          }}
        >
          {STATE_FILTER_ORDER.map((key) => (
            <ToggleGroupItem key={key} value={key} className={itemClassName}>
              {STATE_LABELS[key]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    );
  }

  return (
    <div className="grid w-full grid-cols-2 gap-2">
      <FormField label="Model" htmlFor="gallery-model">
        <Select
          value={modelFilter ?? "all"}
          onValueChange={(value) =>
            onModelChange(value === "all" ? null : value)
          }
        >
          <SelectTrigger id="gallery-model" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Models</SelectItem>
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.name}
                {model.deleted ? " (deleted)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="State" htmlFor="gallery-state">
        <Select
          value={stateFilter}
          onValueChange={(value) => onStateChange(value as StateFilter)}
        >
          <SelectTrigger id="gallery-state" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATE_FILTER_ORDER.map((key) => (
              <SelectItem key={key} value={key}>
                {STATE_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
    </div>
  );
}

const CARDS_CLASS_NAME = "grid grid-cols-2 gap-2.5 sm:grid-cols-4";

/** A user's own Gallery (issue #56/#198): every Generation they've made, across every Model, grouped by day, filterable, live. */
export function GalleryPage() {
  const { session } = useSession();
  const { paused } = usePauseNotice();
  const [searchParams, setSearchParams] = useSearchParams();
  const modelFilter = searchParams.get("model");
  const stateFilter = toStateFilter(searchParams.get("state"));
  const { id: openGenerationId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { models: enabledModels } = useEnabledModels();

  const { data: modelsData } = useQuery({
    queryKey: ["gallery-models"],
    queryFn: () =>
      ok<{ models: GalleryModelOption[] }>(api.api.gallery.models.$get()),
  });
  const models = modelsData?.models ?? [];

  const {
    submissions: loadedSubmissions,
    hasMore,
    isPending,
    isError,
    loadMoreError,
    isFetchingNextPage,
    fetchNextPage,
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
  } = useGalleryFeed({ modelFilter, stateFilter });

  // Removed cards show under "All" only (issue #198's AC).
  const submissions = useMemo(
    () => filterRemovedForState(loadedSubmissions, stateFilter),
    [loadedSubmissions, stateFilter],
  );

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

  function setModelFilter(modelId: string | null) {
    const next = new URLSearchParams(searchParams);
    if (modelId) next.set("model", modelId);
    else next.delete("model");
    setSearchParams(next);
  }

  function setStateFilter(state: StateFilter) {
    const next = new URLSearchParams(searchParams);
    if (state === "all") next.delete("state");
    else next.set("state", state);
    setSearchParams(next);
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
      <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1>Gallery</h1>
          <GalleryFilters
            models={models}
            modelFilter={modelFilter}
            stateFilter={stateFilter}
            onModelChange={setModelFilter}
            onStateChange={setStateFilter}
          />
        </div>

        {isError && (
          <Alert variant="destructive">Could not load the Gallery.</Alert>
        )}

        {isPending && !isError && (
          <p className="text-muted-foreground">Loading…</p>
        )}

        {!isPending &&
          !isError &&
          submissions.length === 0 &&
          (hasActiveFilters ? (
            <p className="py-6 text-muted-foreground">
              No Generations match.{" "}
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </p>
          ) : (
            <div className="flex flex-col gap-3 py-6 text-muted-foreground">
              <p>Nothing here yet</p>
              <div className="flex flex-wrap gap-3">
                {enabledModels.map((model) => (
                  <Link key={model.id} to={`/models/${model.slug}`}>
                    {model.name}
                  </Link>
                ))}
              </div>
            </div>
          ))}

        <div className="flex flex-col gap-3.5">
          {groups.map((group) => (
            <div
              key={group.submissions[0]?.submissionId ?? group.label}
              className="flex flex-col gap-3.5"
            >
              <h2 className="mt-1.5 text-sm text-muted-foreground">
                {group.label}
              </h2>
              {group.submissions.map((submission) => (
                <SubmissionBlock
                  key={submission.submissionId}
                  submission={submission}
                  progressById={progressById}
                  paused={paused}
                  now={now}
                  showModel
                  timeStyle="clock"
                  cardMedia="thumbnail"
                  cardsClassName={CARDS_CLASS_NAME}
                  cancellingSubmission={cancellingSubmissionIds.has(
                    submission.submissionId,
                  )}
                  deletingSubmission={deletingSubmissionIds.has(
                    submission.submissionId,
                  )}
                  cancelSubmissionError={
                    cancelErrorSubmissionId === submission.submissionId
                  }
                  deleteSubmissionError={
                    deleteErrorSubmissionId === submission.submissionId
                  }
                  cancellingGenerationIds={cancellingGenerationIds}
                  deletingGenerationIds={deletingGenerationIds}
                  onCancelSubmission={() =>
                    handleCancelSubmission(submission.submissionId)
                  }
                  onDeleteSubmission={() =>
                    handleDeleteSubmission(submission.submissionId)
                  }
                  onCancelGeneration={handleCancelGeneration}
                  onDeleteGeneration={handleDeleteGeneration}
                  onOpenDetails={openGeneration}
                  onDismissGeneration={handleDismissGeneration}
                />
              ))}
            </div>
          ))}
        </div>

        {loadMoreError && (
          <Alert variant="destructive">Could not load more.</Alert>
        )}

        {!isPending && submissions.length > 0 && !hasMore && (
          <p className="text-center text-[12.5px] text-faint">
            That's everything.
          </p>
        )}

        {hasMore && (
          <Button
            type="button"
            variant="outline"
            className="mx-auto"
            onClick={fetchNextPage}
            disabled={isFetchingNextPage}
          >
            Load more
          </Button>
        )}
      </main>
    </>
  );
}
