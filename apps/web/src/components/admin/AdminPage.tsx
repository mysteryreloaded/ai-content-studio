import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * The admin content slot every route except `/admin/models/:id` renders
 * in (issue #200): the same 1280px/16px/22px frame the user-facing pages
 * use, so admin pages read as one app rather than a second shell. The
 * Model editor route opts out of this and sits in its own full-width,
 * unpadded slot instead (see `AdminShell`).
 */
export function AdminPage({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-320 flex-col gap-4 px-4 py-[22px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
