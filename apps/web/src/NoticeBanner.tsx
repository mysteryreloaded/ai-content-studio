import { effectiveNoticeText } from "@ai-content-studio/shared";
import { useState } from "react";
import { usePauseNotice } from "./usePauseNotice.js";

const DISMISSED_KEY = "ai-content-studio:notice-dismissed";

/** Self-contained, like `WorkbenchPage`'s own `<style>` (no shared global stylesheet exists). */
const NOTICE_BANNER_STYLE = `
.notice-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 0.5rem 1rem;
  background: var(--accent);
  color: var(--on-accent);
  text-align: center;
}
.notice-banner p {
  margin: 0;
}
`;

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
    <div role="status" className="notice-banner">
      <style>{NOTICE_BANNER_STYLE}</style>
      <p>{text}</p>
      {!paused && (
        <button
          type="button"
          onClick={() => {
            writeDismissed(text);
            setDismissed(text);
          }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
