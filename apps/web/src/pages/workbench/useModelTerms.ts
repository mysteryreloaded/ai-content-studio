import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ok } from "../../lib/api.js";
import type { TermsDialogState, WorkbenchModel } from "./types.js";
import { workbenchModelQueryKey } from "./workbenchModelQuery.js";

/** The Model terms' own state (issue #61): whether the dialog is open, whether it's accepting, and the handler both the page and the 409 `model_terms_required` branch share. */
export function useModelTerms({
  model,
  slug,
}: {
  model: WorkbenchModel | null;
  slug: string;
}) {
  const queryClient = useQueryClient();
  const [termsDialog, setTermsDialog] = useState<TermsDialogState | null>(null);

  const acceptMutation = useMutation({
    mutationFn: () => {
      if (!model) throw new Error("no Model");
      return ok<{ ok: true; version: number }>(
        api.api.models[":slug"].terms.accept.$post({
          param: { slug: model.slug },
        }),
      );
    },
    onSuccess: () => {
      queryClient.setQueryData<WorkbenchModel | null | undefined>(
        workbenchModelQueryKey(slug),
        (current) =>
          current?.terms
            ? { ...current, terms: { ...current.terms, accepted: true } }
            : current,
      );
      setTermsDialog(null);
    },
    onError: () => {
      setTermsDialog({
        blocking: true,
        error: "Could not record your acceptance. Please try again.",
      });
    },
  });

  const handleTermsClose = () => setTermsDialog(null);

  return {
    termsDialog,
    setTermsDialog,
    accepting: acceptMutation.isPending,
    handleAcceptTerms: () => acceptMutation.mutate(),
    handleTermsClose,
  };
}
