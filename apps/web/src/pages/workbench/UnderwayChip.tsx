import type { RefObject } from "react";

/** Issue #195's AC (story 49): a phone-only floating chip that jumps to the feed. */
export function UnderwayChip({
  count,
  feedRef,
}: {
  count: number;
  feedRef: RefObject<HTMLElement | null>;
}) {
  if (count <= 0) return null;

  return (
    <button
      type="button"
      className="fixed top-[60px] right-4 z-[24] hidden max-[860px]:inline-flex items-center gap-2 rounded-full border border-input bg-card px-3 py-1.5 font-semibold shadow-md"
      onClick={() => {
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        feedRef.current?.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
        });
      }}
    >
      <span className="size-2 rounded-full bg-primary animate-pulse" />
      {count} under way
    </button>
  );
}
