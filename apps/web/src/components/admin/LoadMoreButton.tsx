import { Button } from "../ui/button.js";

/** A centred "load more" button (issue #200) that shows "Loading…" while its page is fetching. */
export function LoadMoreButton({
  label,
  isLoading,
  onClick,
}: {
  label: string;
  isLoading: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex justify-center">
      <Button
        type="button"
        variant="outline"
        disabled={isLoading}
        onClick={onClick}
      >
        {isLoading ? "Loading…" : label}
      </Button>
    </div>
  );
}
