import { type Dispatch, type SetStateAction, useState } from "react";
import type { TermsDialogState, WorkbenchModel } from "./types.js";

/** The Model terms' own state (issue #61): whether the dialog is open, whether it's accepting, and the handler both the page and the 409 `model_terms_required` branch share. */
export function useModelTerms({
  model,
  setModel,
}: {
  model: WorkbenchModel | null;
  setModel: Dispatch<SetStateAction<WorkbenchModel | null>>;
}) {
  const [termsDialog, setTermsDialog] = useState<TermsDialogState | null>(null);
  const [accepting, setAccepting] = useState(false);

  async function handleAcceptTerms() {
    if (!model) return;
    setAccepting(true);
    try {
      const res = await fetch(`/api/models/${model.slug}/terms/accept`, {
        method: "POST",
      });
      if (!res.ok) {
        setTermsDialog({
          blocking: true,
          error: "Could not record your acceptance. Please try again.",
        });
        return;
      }
      setModel((current) =>
        current?.terms
          ? { ...current, terms: { ...current.terms, accepted: true } }
          : current,
      );
      setTermsDialog(null);
    } finally {
      setAccepting(false);
    }
  }

  const handleTermsClose = () => setTermsDialog(null);

  return {
    termsDialog,
    setTermsDialog,
    accepting,
    handleAcceptTerms,
    handleTermsClose,
  };
}
