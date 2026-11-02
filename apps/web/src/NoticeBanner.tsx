import { effectiveNoticeText } from "@ai-content-studio/shared";
import { useState } from "react";
import { Button } from "./components/ui/button.js";
import { usePauseNotice } from "./usePauseNotice.js";

const DISMISSED_KEY = "ai-content-studio:notice-dismissed";

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(text: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, text);
  } catch {
    /* per-browser convenience only; nothing breaks if it can't persist */
  }
}

/**
 * The Notice banner (issue #59): a short message on every page, signed
 * in or out. Dismissable per browser until its text changes, unless a
 * Pause is on, when it always shows (with the standard text when the
 * Admin's own Notice is blank) and can't be dismissed.
 */
export function NoticeBanner() {
  const { paused, notice } = usePauseNotice();
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  const text = effectiveNoticeText(paused, notice);
  if (!text) return null;
  if (!paused && dismissed === text) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: <output> is for a form's calculated result, not a banner with a Dismiss button
    <div
      role="status"
      className="flex items-center justify-center gap-4 bg-primary px-4 py-2 text-center text-primary-foreground"
    >
      <p className="m-0">{text}</p>
      {!paused && (
        // A bare <button>'s global focus outline is var(--accent) — the
        // same colour as this bar — so its focus ring is invisible
        // (issue #188's gap 5): the on-accent overrides make it show in
        // both themes.
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            writeDismissed(text);
            setDismissed(text);
          }}
          className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground focus-visible:border-primary-foreground focus-visible:ring-primary-foreground"
        >
          Dismiss
        </Button>
      )}
    </div>
  );
}
