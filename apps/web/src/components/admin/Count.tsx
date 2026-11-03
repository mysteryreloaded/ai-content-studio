import { type VariantProps, cva } from "class-variance-authority";
import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * A small numeric badge (the prototype's `.count`) for the admin nav's
 * pending-users and 24h-error counts (issue #200). Each caller also
 * renders a visually hidden label so the link reads e.g. "Users, 3
 * pending" to a screen reader, since the badge itself is presentational.
 */
const countVariants = cva(
  "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] px-[5px] text-[11px] font-semibold tabular-nums",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        accent: "bg-primary text-primary-foreground",
        warn: "bg-warn-soft text-warn",
        err: "bg-err text-card",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export function Count({
  tone = "neutral",
  className,
  children,
}: VariantProps<typeof countVariants> & {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span aria-hidden="true" className={cn(countVariants({ tone, className }))}>
      {children}
    </span>
  );
}
