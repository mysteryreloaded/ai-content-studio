import { useEffect, useRef } from "react";
import { LoadError } from "./LoadError.js";
import { LoadMoreButton } from "./LoadMoreButton.js";

/**
 * The footer of a list loaded on scroll (issue #211): an
 * IntersectionObserver sentinel fetches the next page as the last row
 * nears the viewport, the same "Load more" button is the fallback for
 * keyboard users and for browsers without an observer, "Loading…" is
 * shown while the next page fetches, and "That's everything." ends the
 * list. Render only once the list has at least one row, so an empty
 * list still shows its own message.
 */
export function InfiniteList({
  hasMore,
  isLoading,
  onLoadMore,
  label = "Load more",
  error = null,
}: {
  hasMore: boolean;
  /** True while the next page is fetching, by the sentinel or the button. */
  isLoading: boolean;
  /** Loads the next page; doubles as the retry for a failed page. */
  onLoadMore: () => void;
  label?: string;
  /** A failed page: its message and a retry, instead of the button. */
  error?: string | null;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Keep the latest callback in a ref so the observer is (re)created only
  // when its gating props change, not on every render of the page.
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    if (!hasMore || isLoading || error) return;
    if (typeof IntersectionObserver === "undefined") return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) loadMoreRef.current();
        }
      },
      // Start the next fetch a little before the sentinel scrolls into
      // view, so the page keeps up while the user reads the last rows.
      { rootMargin: "320px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoading, error]);

  if (error) {
    return <LoadError message={error} onRetry={onLoadMore} />;
  }
  if (!hasMore) {
    return (
      <p className="text-center text-muted-foreground">That's everything.</p>
    );
  }
  return (
    <div className="flex flex-col">
      {/* The sentinel: a thin line just below the last row. */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      <LoadMoreButton
        label={label}
        isLoading={isLoading}
        onClick={onLoadMore}
      />
    </div>
  );
}
