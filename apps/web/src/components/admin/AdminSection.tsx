import type { ReactNode } from "react";

/**
 * The prototype's `Section` helper (issue #200): a titled group with an
 * optional description and a right-aligned actions row.
 */
export function AdminSection({
  title,
  description,
  actions,
  id,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="max-w-[66ch] text-muted-foreground">{description}</p>
        )}
        {actions && (
          <div className="flex items-center gap-2 sm:ml-auto">{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}
