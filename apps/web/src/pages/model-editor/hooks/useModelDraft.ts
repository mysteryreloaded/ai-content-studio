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

/**
 * The Details draft (react-hook-form + the shared zod schema) and the
 * one Save sequence (issue #213): Details, then Inputs, then Modes
 * (its `inputSettings` filtered to the Inputs that survived step 2),
 * then Terms, chaining each step's `version`/`revision` from a refetch
 * of the Model. Stops at the first refusal; the steps already saved
 * become clean.
 *
 * The Inputs/Modes/Terms drafts themselves still live in
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
  askAgain: boolean;
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
  const anyDraftDirty = detailsDirty || inputsDirty || modesDirty || termsDirty;

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

  function messageFromApiError(err: unknown, fallback: string): string {
    if (err instanceof ApiError) {
      const body = err.body as { error?: string } | null;
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
   * Save: only the dirty parts, in order, chaining `version` from a
   * refetch (issue #213). Issue #241 CEO review: Details' zod errors
   * and the Terms license URL are checked (`form.trigger()`, which
   * `getValues()` alone never ran) before anything is sent — an
   * invalid value sends nothing and reports which section to open.
   */
  async function save(
    disable: boolean,
  ): Promise<{ ok: boolean; invalidSection?: SectionId }> {
    if (!id || !detail) return { ok: false };
    setSaving(true);
    setSaveError(null);
    setStaleSave(false);
    let disableSent = !disable;

    try {
      const detailsValid = await form.trigger();
      if (!detailsValid) return { ok: false, invalidSection: "details" };
      if (termsForm && !isValidModelLicenseUrl(termsForm.licenseUrl)) {
        return { ok: false, invalidSection: "terms" };
      }

      let current = detail;

      if (detailsDirty) {
        const values = form.getValues();
        try {
          current = await ok(
            api.api.admin.models[":id"].$put({
              param: { id },
              json: { ...values, version: current.model.version },
            }),
          );
          current = await refetchModel();
          form.reset(values);
        } catch (err) {
          if (isStaleSaveError(err)) setStaleSave(true);
          setSaveError(messageFromApiError(err, "save failed"));
          return { ok: false };
        }
      }

      if (inputsDirty && inputsDraft) {
        try {
          await ok(
            api.api.admin.models[":id"].inputs.$put({
              param: { id },
              json: {
                version: current.model.version,
                inputs: inputsDraft,
                ...(!disableSent ? { disable: true } : {}),
              },
            }),
          );
          disableSent = true;
          current = await refetchModel();
          resetInputsDraft(inputsDraft);
        } catch (err) {
          if (isStaleSaveError(err)) setStaleSave(true);
          setSaveError(messageFromApiError(err, "save failed"));
          return { ok: false };
        }
      }

      if (modesDirty && modesDraft) {
        const currentInputIds = new Set(
          (current.inputs ?? []).map((input) => input.id),
        );
        try {
          await ok(
            api.api.admin.models[":id"].modes.$put({
              param: { id },
              json: {
                version: current.model.version,
                modes: modesDraft.map(({ key, ...mode }) => ({
                  ...mode,
                  inputSettings: mode.inputSettings.filter((s) =>
                    currentInputIds.has(s.inputId),
                  ),
                })),
                ...(!disableSent ? { disable: true } : {}),
              },
            }),
          );
          disableSent = true;
          current = await refetchModel();
          resetModesDraft(current);
        } catch (err) {
          if (isStaleSaveError(err)) setStaleSave(true);
          setSaveError(messageFromApiError(err, "save failed"));
          return { ok: false };
        }
      }

      if (termsDirty && termsForm) {
        try {
          await ok(
            api.api.admin.models[":id"].terms.$put({
              param: { id },
              json: {
                revision: current.model.termsRevision,
                ...termsForm,
                askAgain,
              },
            }),
          );
          current = await refetchModel();
          resetTermsForm(current);
        } catch (err) {
          if (isStaleSaveError(err)) setStaleSave(true);
          setSaveError(messageFromApiError(err, "save failed"));
          return { ok: false };
        }
      }

      // Issue #241 CEO review: "Save and disable" with only Details
      // and/or Terms dirty never runs Inputs/Modes, so `disable` was
      // never sent — explicitly disable now with the latest version.
      if (disable && !disableSent) {
        try {
          await ok(
            api.api.admin.models[":id"].disable.$post({
              param: { id },
              json: { version: current.model.version },
            }),
          );
          await refetchModel();
        } catch (err) {
          if (isStaleSaveError(err)) setStaleSave(true);
          setSaveError(messageFromApiError(err, "save failed"));
          return { ok: false };
        }
      }

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
