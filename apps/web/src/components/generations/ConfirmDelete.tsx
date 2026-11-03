import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button.js";

/**
 * The inline "Delete …?" confirm (issue #195's AC), replacing `window.confirm`:
 * a card's trash icon asks `"{label}?"` before calling `onConfirm`, as does a
 * Submission block's text "Delete all" button (`small={false}`).
 */
export function ConfirmDelete({
  label,
  onConfirm,
  pending = false,
  small = true,
}: {
  label: string;
  onConfirm: () => void;
  pending?: boolean;
  small?: boolean;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return small ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        onClick={() => setAsking(true)}
      >
        <Trash2 />
      </Button>
    ) : (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setAsking(true)}
      >
        <Trash2 />
        {label}
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-[13px]">
      <span>{label}?</span>
      <Button
        type="button"
        variant="danger"
        size="xs"
        disabled={pending}
        onClick={onConfirm}
      >
        Delete
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setAsking(false)}
      >
        Keep
      </Button>
    </span>
  );
}
