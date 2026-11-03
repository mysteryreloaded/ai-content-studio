import { cn } from "cn";
import type { ReactNode } from "react";
import { PageContainer } from "../../RootLayout.js";

/**
 * The admin content slot every route except `/admin/models/:id` renders
 * in (issue #200): `RootLayout`'s own `PageContainer` (#188, docs/ui-sizes.md)
 * — the same frame the rest of the app uses — so admin pages read as one
 * app rather than a second shell. The Model editor route opts out of
 * this and sits in its own full-width, unpadded slot instead (see
 * `AdminShell`).
 */
export function AdminPage({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <PageContainer className={cn("flex flex-col gap-sections", className)}>
      {children}
    </PageContainer>
  );
}
