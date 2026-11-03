import {
  type CapsStatus,
  LOW_DAILY_REMAINING_THRESHOLD,
  capsFooterParts,
} from "@ai-content-studio/shared";
import { cn } from "cn";
import { useEffect, useState } from "react";

/** The foot's Caps line (issue #196, prototype `.caps`): bold numbers, a faint "·" separator, warn-coloured numbers once low. Re-renders once a minute so "next slot frees in …" stays current. */
export function CapsLine({ status }: { status: CapsStatus }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { daily, dailyCap, concurrent, nextSlot } = capsFooterParts(
    status,
    now,
  );
  const warn = daily <= LOW_DAILY_REMAINING_THRESHOLD || concurrent === 0;

  return (
    <p
      className={cn(
        "text-[12.5px] text-muted-foreground tabular-nums",
        warn && "[&_strong]:text-warn",
      )}
    >
      <strong>{daily}</strong>
      {" of "}
      {dailyCap}
      {" left today "}
      <span className="text-faint">·</span> <strong>{concurrent}</strong>
      {" more at once"}
      {nextSlot && (
        <>
          {" · "}
          {nextSlot}
        </>
      )}
    </p>
  );
}
