import { renderMarkdown } from "@ai-content-studio/shared";
import { useEffect, useRef } from "react";
import type { ModelTerms } from "./types.js";

/**
 * The Model terms dialog (issue #61): blocking (no dismiss, no Escape)
 * the first time a user opens a Model with terms and again whenever
 * re-asked; otherwise dismissible, for viewing the terms any time via
 * the Workbench's own link.
 */
export function ModelTermsDialog({
  modelName,
  terms,
  blocking,
  accepting,
  error,
  onAccept,
  onClose,
}: {
  modelName: string;
  terms: ModelTerms;
  blocking: boolean;
  accepting: boolean;
  error: string | null;
  onAccept: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        if (blocking) event.preventDefault();
      }}
      onClose={onClose}
    >
      <h2>{modelName}'s terms</h2>
      <div
        // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images
        dangerouslySetInnerHTML={{ __html: renderMarkdown(terms.body) }}
      />
      {terms.licenseUrl && (
        <p>
          <a href={terms.licenseUrl} target="_blank" rel="noopener noreferrer">
            License
          </a>
        </p>
      )}

      {!terms.accepted && (
        <button type="button" disabled={accepting} onClick={onAccept}>
          Accept
        </button>
      )}
      {!blocking && (
        <button type="button" onClick={() => dialogRef.current?.close()}>
          Close
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
