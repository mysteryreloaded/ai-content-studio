import {
  PRIVACY_MAX_LENGTH,
  type SitePrivacyFields,
  sitePrivacyFieldsSchema,
} from "@ai-content-studio/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AdminSection } from "../components/admin/AdminSection.js";
import { MarkdownEditor } from "../components/admin/MarkdownEditor.js";
import { StaleSaveAlert } from "../components/admin/StaleSaveAlert.js";
import { Button } from "../components/ui/button.js";
import { ApiError, api, ok } from "../lib/api.js";
import { describeSaveError, mapApiError, zodResolver } from "../lib/form.js";
import {
  type AdminSiteSettings,
  siteSettingsQueryKey,
} from "./site-settings-shared.js";

function defaultValuesFrom(settings: AdminSiteSettings): SitePrivacyFields {
  return { body: settings.privacyBody };
}

function descriptionFor(settings: AdminSiteSettings): string {
  const base =
    "This is the Operator's own part of /privacy, shown before a studio-written section nobody here can edit.";
  return settings.privacyUpdatedAt
    ? `${base} Last updated ${new Date(settings.privacyUpdatedAt).toLocaleDateString()}.`
    : base;
}

/** The Privacy policy section (issue #202, restyled from #65/#194): one shared `MarkdownEditor`. */
export function SitePrivacyForm({
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
  const [privacyRevision, setPrivacyRevision] = useState(
    settings.privacyRevision,
  );

  const {
    handleSubmit,
    watch,
    setValue,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<SitePrivacyFields>({
    resolver: zodResolver(sitePrivacyFieldsSchema),
    defaultValues: defaultValuesFrom(settings),
  });

  const body = watch("body") ?? "";

  const { mutate, isPending } = useMutation({
    mutationFn: (values: SitePrivacyFields) =>
      ok<AdminSiteSettings>(
        api.api.admin["site-settings"].privacy.$put({
          json: { revision: privacyRevision, ...values },
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(siteSettingsQueryKey, updated);
      reset(defaultValuesFrom(updated));
      setStaleSave(false);
      setSaveError(null);
      setPrivacyRevision(updated.privacyRevision);
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
      setPrivacyRevision(fresh.privacyRevision);
    }
  }

  return (
    <AdminSection
      id="privacy-policy"
      title="Privacy policy"
      description={descriptionFor(settings)}
    >
      <form
        noValidate
        className="flex flex-col gap-fields"
        onSubmit={handleSubmit((values) => {
          setJustSaved(false);
          setSaveError(null);
          mutate(values);
        })}
      >
        <MarkdownEditor
          id="privacy-body"
          label="Privacy notice (Markdown)"
          value={body}
          onChange={(value) =>
            setValue("body", value, { shouldDirty: true, shouldValidate: true })
          }
          maxLength={PRIVACY_MAX_LENGTH}
          error={errors.body?.message}
        />

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
