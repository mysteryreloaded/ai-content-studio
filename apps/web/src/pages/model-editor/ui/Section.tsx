import type { ReactNode } from "react";

/** The prototype's `.section-head`: an `h2` title, a muted sub (max 66ch) and optional actions (issue #213). */
export function Section({
  title,
  sub,
  actions,
  children,
}: {
  title: string;
  sub?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2>{title}</h2>
          {sub && <p className="max-w-[66ch] text-muted-foreground">{sub}</p>}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}
