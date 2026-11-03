import {
  BLOCKED_WORDS_MAX_ENTRIES,
  BLOCKED_WORDS_MAX_ENTRY_LENGTH,
  type SiteBlockedWordsFields,
  parseBlockedWordsList,
  siteBlockedWordsFieldsSchema,
  validateBlockedWordsList,
} from "@ai-content-studio/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AdminSection } from "../components/admin/AdminSection.js";
import { StaleSaveAlert } from "../components/admin/StaleSaveAlert.js";
import { Button } from "../components/ui/button.js";
import { Label } from "../components/ui/label.js";
import { Textarea } from "../components/ui/textarea.js";
import { ApiError, api, ok } from "../lib/api.js";
import { describeSaveError, mapApiError, zodResolver } from "../lib/form.js";
import {
  type AdminSiteSettings,
  siteSettingsQueryKey,
} from "./site-settings-shared.js";

function defaultValuesFrom(
  settings: AdminSiteSettings,
): SiteBlockedWordsFields {
  return { text: settings.blockedWords.join("\n") };
}

/** The Blocked words section (issue #202, restyled from #66/#194). */
export function BlockedWordsForm({
  settings,
  onReload,
}: {
  settings: AdminSiteSettings;
  onReload: () => Promise<AdminSiteSettings | undefined>;
}) {
  const queryClient = useQueryClient();
  const [staleSave, setStaleSave] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [blockedWordsRevision, setBlockedWordsRevision] = useState(
    settings.blockedWordsRevision,
  );

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<SiteBlockedWordsFields>({
    resolver: zodResolver(siteBlockedWordsFieldsSchema),
    defaultValues: defaultValuesFrom(settings),
  });

  const text = watch("text") ?? "";
  const words = parseBlockedWordsList(text);
  const listError = validateBlockedWordsList(words);

  const { mutate, isPending } = useMutation({
    mutationFn: (values: SiteBlockedWordsFields) =>
      ok<AdminSiteSettings>(
        api.api.admin["site-settings"]["blocked-words"].$put({
          json: { revision: blockedWordsRevision, ...values },
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(siteSettingsQueryKey, updated);
      reset(defaultValuesFrom(updated));
      setStaleSave(false);
      setSaveError(null);
      setBlockedWordsRevision(updated.blockedWordsRevision);
      setJustSaved(true);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        setStaleSave(true);
        setSaveError(null);
        return;
      }
      if (error instanceof ApiError) {
        mapApiError(setError, error);
      }
      setSaveError(describeSaveError(error));
    },
  });

  async function handleReload() {
    const fresh = await onReload();
    if (fresh) {
      reset(defaultValuesFrom(fresh));
      setStaleSave(false);
      setSaveError(null);
      setBlockedWordsRevision(fresh.blockedWordsRevision);
    }
  }

  return (
    <AdminSection
      id="blocked-words"
      title="Blocked words"
      description="One word or phrase per line. A submitted prompt holding any of them, whole word and case-insensitive, is refused. Each refusal is logged as a warning with the user and the word."
    >
      <form
        noValidate
        className="flex flex-col gap-fields"
        onSubmit={handleSubmit((values) => {
          if (listError) return;
          setJustSaved(false);
          setSaveError(null);
          mutate(values);
        })}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="blocked-words-text">Blocked words and phrases</Label>
          <Textarea
            id="blocked-words-text"
            rows={16}
            aria-invalid={listError ? true : undefined}
            className="min-h-96 font-mono text-[12.5px]"
            {...register("text")}
          />
          <div className="flex items-baseline justify-between gap-2">
            {listError ? (
              <p className="text-err">{listError}</p>
            ) : (
              <p className="text-muted-foreground">
                Up to {BLOCKED_WORDS_MAX_ENTRIES.toLocaleString()} entries, each
                up to {BLOCKED_WORDS_MAX_ENTRY_LENGTH} characters.
              </p>
            )}
            <span className="ml-auto shrink-0 text-muted-foreground">
              {words.length.toLocaleString()} of{" "}
              {BLOCKED_WORDS_MAX_ENTRIES.toLocaleString()} entries
            </span>
          </div>
        </div>

        {staleSave && <StaleSaveAlert onReload={() => void handleReload()} />}
        {!staleSave && (errors.root?.message || saveError) && (
          <p className="text-err">{errors.root?.message ?? saveError}</p>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-[12.5px]">
            {!staleSave &&
              (isDirty ? (
                <span className="text-muted-foreground">Unsaved changes</span>
              ) : justSaved ? (
                <span className="text-ok">Saved.</span>
              ) : null)}
          </span>
          <Button
            type="submit"
            size="sm"
            disabled={isPending || isSubmitting || !!listError}
          >
            Save
          </Button>
        </div>
      </form>
    </AdminSection>
  );
}
