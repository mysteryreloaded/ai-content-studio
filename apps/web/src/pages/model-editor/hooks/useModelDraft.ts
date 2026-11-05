import {
  type ModelDetailsFormValues,
  isValidModelLicenseUrl,
  modelDetailsSchema,
} from "@ai-content-studio/shared";
import type { InputDefinition } from "@ai-content-studio/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { ApiError, api, ok } from "../../../lib/api.js";
import { zodResolver } from "../../../lib/form.js";
import type { SectionId } from "../frame/sections.js";
import type { DraftMode, ModelDetail, TermsForm } from "../types.js";
import { useSaveDraftMutation } from "./useWorkflowSection.js";

/**
 * The Details draft (react-hook-form + the shared zod schema) and the
 * one Save (issue #218): Details, Terms, a re-uploaded Workflow (if
 * any), Inputs and Modes, all in one `PUT …/draft` — replacing the
 * chain of separate per-section PUTs this used to send (#213), each of
 * which made its own revision.
 *
 * The Inputs/Modes/Terms/Workflow drafts themselves still live in
 * `useModelEditor` (their own sections' tickets own that markup), so
 * this hook takes them — and how to reset them — as arguments.
 */
export function useModelDraft({
  id,
  detail,
  inputsDraft,
  inputsDirty,
  modesDraft,
  modesDirty,
  termsForm,
  termsDirty,
  askAgain,
  pendingWorkflow,
  rebindMap,
  resetInputsDraft,
  resetModesDraft,
  resetTermsForm,
  resetWorkflowPicker,
}: {
  id: string | undefined;
  detail: ModelDetail | undefined;
  inputsDraft: InputDefinition[] | null;
  inputsDirty: boolean;
  modesDraft: DraftMode[] | null;
  modesDirty: boolean;
  termsForm: TermsForm | null;
  termsDirty: boolean;
  /** Issue #264: what goes out in the draft PUT — the tick, but only while the terms text still differs from the saved text. */
  askAgain: boolean;
  /** A re-uploaded Workflow file, parsed client-side (issue #71), or `null` while none is picked. */
  pendingWorkflow: unknown | null;
  /** Issue #71's rebind picker: old node id -> the picked Workflow's node id it's repointed onto. */
  rebindMap: Record<string, string>;
  resetInputsDraft: (inputs: InputDefinition[]) => void;
  resetModesDraft: (detail: ModelDetail) => void;
  resetTermsForm: (detail: ModelDetail) => void;
  /** Issue #241 CEO review: Discard and Reload must also drop a picked-but-unsaved Workflow file, its name and the rebind picker, not just the four section drafts. */
  resetWorkflowPicker: () => void;
}) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [staleSave, setStaleSave] = useState(false);

  const form = useForm<ModelDetailsFormValues>({
    resolver: zodResolver(modelDetailsSchema),
    // Issue #241 CEO review: the Details nav count must be live, not
    // just updated on Save — `onChange` revalidates on every keystroke.
    mode: "onChange",
    values: detail
      ? {
          name: detail.model.name,
          slug: detail.model.slug,
          description: detail.model.description,
          maxRunTimeMinutes: detail.model.maxRunTimeMinutes,
        }
      : undefined,
  });

  const detailsDirty = form.formState.isDirty;
  const workflowDirty = pendingWorkflow !== null;
  const anyDraftDirty =
    detailsDirty || inputsDirty || modesDirty || termsDirty || workflowDirty;

  const saveDraftMutation = useSaveDraftMutation(id);

  function discard() {
    if (!detail) return;
    form.reset({
      name: detail.model.name,
      slug: detail.model.slug,
      description: detail.model.description,
      maxRunTimeMinutes: detail.model.maxRunTimeMinutes,
    });
    resetInputsDraft(detail.inputs);
    resetModesDraft(detail);
    resetTermsForm(detail);
    resetWorkflowPicker();
    setSaveError(null);
    setStaleSave(false);
  }

  async function refetchModel(): Promise<ModelDetail> {
    return queryClient.fetchQuery({
      queryKey: ["admin-model", id],
      queryFn: () =>
        ok<ModelDetail>(
          api.api.admin.models[":id"].$get({ param: { id: id as string } }),
        ),
    });
  }

  /** The server's own refusal (issue #214: "Show a server refusal's own text if one still comes back"): `errors` is a `ValidationFailed`'s field/message list (e.g. the draft endpoint's own structural checks), `error` is every other refusal's plain text. */
  function messageFromApiError(err: unknown, fallback: string): string {
    if (err instanceof ApiError) {
      const body = err.body as {
        error?: string;
        errors?: { field: string; message: string }[];
        reasons?: string[];
      } | null;
      const issues = body?.errors
        ?.map((e) => `${e.field}: ${e.message}`)
        .join(", ");
      if (issues) return issues;
      if (body?.reasons && body.reasons.length > 0) {
        return body.reasons.join(", ");
      }
      return body?.error ?? fallback;
    }
    return fallback;
  }

  /** The server's own text for an optimistic-concurrency conflict (issue #213's header `StaleSaveAlert`) — a 409 for another reason (a taken slug, unfinished Generations, ...) is shown as a plain error instead. */
  function isStaleSaveError(err: unknown): boolean {
    if (!(err instanceof ApiError) || err.status !== 409) return false;
    const body = err.body as { error?: string } | null;
    return body?.error === "changed by someone else, reload";
  }

  /**
   * Save: one `PUT …/draft` with the whole draft — Details, Terms, a
   * re-uploaded Workflow (if any), Inputs and Modes — whatever changed
   * (issue #218, replacing the old chain of per-section PUTs, #213,
   * each of which made its own revision). Issue #241 CEO review's
   * up-front checks still apply: Details' zod errors and the Terms
   * license URL are checked (`form.trigger()`, which `getValues()`
   * alone never ran) before anything is sent — an invalid value sends
   * nothing and reports which section to open.
   */
  async function save(
    disable: boolean,
  ): Promise<{ ok: boolean; invalidSection?: SectionId }> {
    if (!id || !detail) return { ok: false };
    const inputs = inputsDraft ?? [];
    const modes = modesDraft ?? [];
    const terms = termsForm ?? {
      termsBody: "",
      licenseUrl: "",
      attribution: "",
    };
    setSaving(true);
    setSaveError(null);
    setStaleSave(false);

    try {
      const detailsValid = await form.trigger();
      if (!detailsValid) return { ok: false, invalidSection: "details" };
      if (!isValidModelLicenseUrl(terms.licenseUrl)) {
        return { ok: false, invalidSection: "terms" };
      }

      const currentInputIds = new Set(inputs.map((input) => input.id));
      const rebind = Object.entries(rebindMap).map(([nodeId, newNodeId]) => ({
        nodeId,
        newNodeId,
      }));

      try {
        await saveDraftMutation.mutateAsync({
          version: detail.model.version,
          details: form.getValues(),
          terms: { ...terms, askAgain },
          ...(pendingWorkflow !== null
            ? {
                workflow: {
                  json: pendingWorkflow,
                  ...(rebind.length > 0 ? { rebind } : {}),
                },
              }
            : {}),
          inputs,
          modes: modes.map(({ key, ...mode }) => ({
            ...mode,
            inputSettings: mode.inputSettings.filter((s) =>
              currentInputIds.has(s.inputId),
            ),
          })),
          disable,
        });
      } catch (err) {
        if (isStaleSaveError(err)) setStaleSave(true);
        setSaveError(messageFromApiError(err, "save failed"));
        return { ok: false };
      }

      const fresh = await refetchModel();
      discardFor(fresh);

      return { ok: true };
    } finally {
      setSaving(false);
    }
  }

  async function reload() {
    const fresh = await refetchModel();
    discardFor(fresh);
  }

  function discardFor(fresh: ModelDetail) {
    form.reset({
      name: fresh.model.name,
      slug: fresh.model.slug,
      description: fresh.model.description,
      maxRunTimeMinutes: fresh.model.maxRunTimeMinutes,
    });
    resetInputsDraft(fresh.inputs);
    resetModesDraft(fresh);
    resetTermsForm(fresh);
    resetWorkflowPicker();
    setSaveError(null);
    setStaleSave(false);
  }

  // Re-syncs the "clean" baseline whenever a fresh Model loads in from
  // elsewhere (e.g. after Replace Workflow's own `load()`), without
  // clobbering an in-progress edit: `values` above already keeps the
  // form synced to `detail` while it isn't dirty.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on id change
  useEffect(() => {
    setSaveError(null);
    setStaleSave(false);
  }, [id]);

  return {
    form,
    detailsDirty,
    anyDraftDirty,
    saving,
    saveError,
    staleSave,
    discard,
    save,
    reload,
  };
}

export type ModelDraft = ReturnType<typeof useModelDraft>;
