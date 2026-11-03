import {
  TERMS_MAX_LENGTH,
  siteTermsFieldsSchema,
} from "@ai-content-studio/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { AdminSection } from "../components/admin/AdminSection.js";
import { MarkdownEditor } from "../components/admin/MarkdownEditor.js";
import { StaleSaveAlert } from "../components/admin/StaleSaveAlert.js";
import { Button } from "../components/ui/button.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { ApiError, api, ok } from "../lib/api.js";
import { describeSaveError, mapApiError, zodResolver } from "../lib/form.js";
import {
  type AdminSiteSettings,
  siteSettingsQueryKey,
} from "./site-settings-shared.js";

type FormValues = z.input<typeof siteTermsFieldsSchema>;

function defaultValuesFrom(settings: AdminSiteSettings): FormValues {
  return { body: settings.termsBody, askAgain: false };
}

function versionLine(settings: AdminSiteSettings): string {
  if (settings.termsBody === "") {
    return "No terms are set: everyone can use the studio without accepting anything.";
  }
  return `Current version ${settings.termsVersion}, effective ${
    settings.termsVersionCreatedAt
      ? new Date(settings.termsVersionCreatedAt).toLocaleDateString()
      : "unknown"
  }.`;
}

/** The Site terms section (issue #202, restyled from #60/#194): one shared `MarkdownEditor`, versioned saves. */
export function SiteTermsForm({
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
  const [termsRevision, setTermsRevision] = useState(settings.termsRevision);

  const {
    handleSubmit,
    watch,
    setValue,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(siteTermsFieldsSchema),
    defaultValues: defaultValuesFrom(settings),
  });

  const body = watch("body") ?? "";
  const askAgain = watch("askAgain") ?? false;

  const isFirstTime = settings.termsBody === "" && body !== "";
  const isChanged = settings.termsBody !== "" && body !== settings.termsBody;

  const { mutate, isPending } = useMutation({
    mutationFn: (values: z.infer<typeof siteTermsFieldsSchema>) =>
      ok<AdminSiteSettings>(
        api.api.admin["site-settings"].terms.$put({
          json: { revision: termsRevision, ...values },
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(siteSettingsQueryKey, updated);
      reset(defaultValuesFrom(updated));
      setStaleSave(false);
      setSaveError(null);
      setTermsRevision(updated.termsRevision);
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
      setTermsRevision(fresh.termsRevision);
    }
  }

  return (
    <AdminSection
      id="site-terms"
      title="Site terms"
      description={versionLine(settings)}
    >
      <form
        noValidate
        className="flex flex-col gap-fields"
        onSubmit={handleSubmit((values) => {
          setJustSaved(false);
          setSaveError(null);
          mutate(siteTermsFieldsSchema.parse(values));
        })}
      >
        <MarkdownEditor
          id="terms-body"
          label="Terms (Markdown)"
          value={body}
          onChange={(value) =>
            setValue("body", value, { shouldDirty: true, shouldValidate: true })
          }
          maxLength={TERMS_MAX_LENGTH}
          error={errors.body?.message}
        />

        {isFirstTime && (
          <p className="rounded-md bg-muted px-[11px] py-[9px] text-[13px] text-muted-foreground">
            Everyone will be asked to accept these terms at their next visit.
          </p>
        )}

        {isChanged && (
          // biome-ignore lint/a11y/noLabelWithoutControl: wraps the Radix Checkbox (role="checkbox"), not a native labelable element
          <label className="flex items-start gap-2">
            <Checkbox
              className="mt-0.5"
              checked={askAgain}
              onCheckedChange={(checked) =>
                setValue("askAgain", checked === true, { shouldDirty: true })
              }
            />
            <span className="flex flex-col">
              <span>Ask everyone to accept again</span>
              <span className="text-[12.5px] text-muted-foreground">
                Leave unticked for small fixes, such as a typo.
              </span>
            </span>
          </label>
        )}

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
          <Button type="submit" size="sm" disabled={isPending || isSubmitting}>
            Save
          </Button>
        </div>
      </form>
    </AdminSection>
  );
}
