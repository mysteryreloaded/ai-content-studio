import type { ReactNode } from "react";

/**
 * The admin page header (the prototype's `.va-head` content, issue
 * #200): a small "Admin / Section" breadcrumb, the page title with
 * optional status pills beside it, an optional description and a
 * right-aligned actions row that wraps under the title on phones.
 */
export function AdminPageHeader({
  crumb,
  title,
  pills,
  description,
  actions,
}: {
  crumb?: string;
  title: string;
  pills?: ReactNode;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {crumb && <p className="text-muted-foreground">{crumb}</p>}
      <div className="flex flex-wrap items-baseline gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1>{title}</h1>
          {pills}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {actions}
          </div>
        )}
      </div>
      {description && (
        <p className="max-w-[66ch] text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
