import type { ReactNode } from "react";

/**
 * The Workbench's full-width frame (prototype `.va-grid`/`.va-compose`,
 * issue #194 step 2): a sticky, panel-backed form column beside a
 * flexible feed column. `foot` sits under the form's scrolling body,
 * inside the same column (the current `GenerateBar`, unchanged; #196
 * restyles it). One column, form first, below 860px.
 */
export function WorkbenchLayout({
  modelName,
  body,
  foot,
  feed,
}: {
  modelName: string;
  body: ReactNode;
  foot: ReactNode;
  feed: ReactNode;
}) {
  return (
    <main className="grid min-h-[calc(100vh-140px)] grid-cols-[minmax(340px,460px)_minmax(0,1fr)] items-start gap-0 max-[860px]:grid-cols-1">
      <section
        aria-label={`Generate with ${modelName}`}
        className="sticky top-[49px] flex max-h-[calc(100dvh-49px)] flex-col border-r border-border bg-card max-[860px]:static max-[860px]:max-h-none max-[860px]:border-r-0 max-[860px]:border-b"
      >
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4.5 pt-4.5 pb-3 max-[860px]:px-4">
          {body}
        </div>
        {foot}
      </section>
      {feed}
    </main>
  );
}
