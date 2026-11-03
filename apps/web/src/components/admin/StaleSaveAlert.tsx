import { Button } from "../ui/button.js";

/**
 * The prototype's `.callout.warn` (issue #200): shown when an admin save
 * of a Model, Backend, user or Site settings was refused because the
 * form was loaded before someone else's save.
 */
export function StaleSaveAlert({ onReload }: { onReload: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-r-md border border-l-[3px] border-border border-l-warn bg-card px-3 py-[9px] text-[13px]"
    >
      <span>changed by someone else, reload</span>
      <Button type="button" variant="outline" size="sm" onClick={onReload}>
        Reload
      </Button>
    </div>
  );
}
