import {
  NOTICE_MAX_LENGTH,
  STANDARD_PAUSE_NOTICE,
  type SiteNoticeFields,
  siteNoticeFieldsSchema,
} from "@ai-content-studio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/** `PauseControl`/`NoticeForm`'s fallback query, used when a caller (e.g. the Overview) renders either alone, with no `settings` prop. */
function useOwnSettings(
  settings: AdminSiteSettings | undefined,
): AdminSiteSettings | undefined {
  const { data } = useQuery({
    queryKey: siteSettingsQueryKey,
    queryFn: () => ok<AdminSiteSettings>(api.api.admin["site-settings"].$get()),
    enabled: settings === undefined,
  });
  return settings ?? data;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWhen(date: Date, now: Date): string {
  const isToday = date.toDateString() === now.toDateString();
  return isToday ? formatTime(date) : date.toLocaleString();
}

/**
 * The Pause/Resume status block (issue #202, split from the old
 * `PauseNoticeForm` so the Overview, #203, can place it on its own).
 */
export function PauseControl({
  settings,
}: {
  settings?: AdminSiteSettings;
}) {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const resolved = useOwnSettings(settings);

  const { mutate: pause, isPending: isPausing } = useMutation({
    mutationFn: () =>
      ok<AdminSiteSettings>(api.api.admin["site-settings"].pause.$post()),
    onSuccess: (updated) => {
      queryClient.setQueryData(siteSettingsQueryKey, updated);
      queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
      setConflict(false);
      setActionError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        setActionError(null);
        return;
      }
      setActionError(describeSaveError(error));
    },
  });

  const { mutate: resume, isPending: isResuming } = useMutation({
    mutationFn: () =>
      ok<AdminSiteSettings>(api.api.admin["site-settings"].resume.$post()),
    onSuccess: (updated) => {
      queryClient.setQueryData(siteSettingsQueryKey, updated);
      queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
      setConflict(false);
      setActionError(null);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        setActionError(null);
        return;
      }
      setActionError(describeSaveError(error));
    },
  });

  async function handleReload() {
    const fresh = await queryClient.fetchQuery({
      queryKey: siteSettingsQueryKey,
      queryFn: () =>
        ok<AdminSiteSettings>(api.api.admin["site-settings"].$get()),
    });
    queryClient.setQueryData(siteSettingsQueryKey, fresh);
    setConflict(false);
    setActionError(null);
  }

  if (!resolved) return <p className="text-muted-foreground">Loading…</p>;

  const isPending = isPausing || isResuming;

  return (
    <div className="flex flex-col gap-fields">
      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-r-md border border-l-[3px] border-border border-l-warn bg-card px-3 py-[9px]"
        >
          <span>
            Someone else already did that. Reload to see the current state.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleReload()}
          >
            Reload
          </Button>
        </div>
      )}

      {!conflict && !resolved.paused && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-1">
            <p>Generating is running normally.</p>
            <p className="text-muted-foreground">
              Stops new Generations studio-wide. Running ones finish, queued
              ones wait, test Generations still run.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button
              type="button"
              className="border-warn bg-warn text-card hover:bg-warn/90"
              disabled={isPending}
              onClick={() => pause()}
            >
              Pause
            </Button>
            {actionError && <p className="text-err">{actionError}</p>}
          </div>
        </div>
      )}

      {!conflict && resolved.paused && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-r-md border border-l-[3px] border-border border-l-warn bg-card px-3 py-[9px]">
          <span>
            Paused since{" "}
            {resolved.pausedAt
              ? formatWhen(new Date(resolved.pausedAt), new Date())
              : "unknown"}{" "}
            by {resolved.pausedByName}
          </span>
          <div className="flex flex-col items-end gap-1">
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={() => resume()}
            >
              Resume
            </Button>
            {actionError && <p className="text-err">{actionError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function defaultValuesFrom(settings: AdminSiteSettings): SiteNoticeFields {
  return { text: settings.notice };
}

/**
 * The Notice form (issue #202, split from the old `PauseNoticeForm` so
 * the Overview, #203, can place it on its own).
 */
export function NoticeForm({ settings }: { settings?: AdminSiteSettings }) {
  const resolved = useOwnSettings(settings);

  if (!resolved) return <p className="text-muted-foreground">Loading…</p>;

  return <NoticeFormFields settings={resolved} />;
}

function NoticeFormFields({ settings }: { settings: AdminSiteSettings }) {
  const queryClient = useQueryClient();
  const [staleSave, setStaleSave] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [noticeRevision, setNoticeRevision] = useState(settings.noticeRevision);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<SiteNoticeFields>({
    resolver: zodResolver(siteNoticeFieldsSchema),
    defaultValues: defaultValuesFrom(settings),
  });

  const text = watch("text") ?? "";

  const { mutate, isPending } = useMutation({
    mutationFn: (values: SiteNoticeFields) =>
      ok<AdminSiteSettings>(
        api.api.admin["site-settings"].notice.$put({
          json: { revision: noticeRevision, ...values },
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(siteSettingsQueryKey, updated);
      reset(defaultValuesFrom(updated));
      setStaleSave(false);
      setSaveError(null);
      setNoticeRevision(updated.noticeRevision);
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
    const fresh = await queryClient.fetchQuery({
      queryKey: siteSettingsQueryKey,
      queryFn: () =>
        ok<AdminSiteSettings>(api.api.admin["site-settings"].$get()),
    });
    queryClient.setQueryData(siteSettingsQueryKey, fresh);
    reset(defaultValuesFrom(fresh));
    setStaleSave(false);
    setSaveError(null);
    setNoticeRevision(fresh.noticeRevision);
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-fields"
      onSubmit={handleSubmit((values) => {
        setJustSaved(false);
        setSaveError(null);
        mutate(values);
      })}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor="site-notice">Notice</Label>
        <Textarea
          id="site-notice"
          placeholder={STANDARD_PAUSE_NOTICE}
          aria-invalid={errors.text ? true : undefined}
          {...register("text")}
        />
        <div className="flex items-baseline justify-between gap-2">
          {errors.text ? (
            <p className="text-err">{errors.text.message}</p>
          ) : (
            <p className="text-muted-foreground">
              Shown as a banner on every page, signed in or out. Plain text.
              While Paused, a blank Notice shows the standard text above.
            </p>
          )}
          <span className="ml-auto shrink-0 text-muted-foreground">
            {text.length} / {NOTICE_MAX_LENGTH}
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
        <Button type="submit" size="sm" disabled={isPending || isSubmitting}>
          Save
        </Button>
      </div>
    </form>
  );
}

/**
 * The Notice and Pause section (issue #202): `NoticeForm` and
 * `PauseControl` together, for `SiteSettingsPage`. The Overview (#203)
 * places each on its own instead.
 */
export function PauseNoticeForm({
  settings,
}: {
  settings?: AdminSiteSettings;
}) {
  return (
    <AdminSection
      id="notice-pause"
      title="Notice and Pause"
      description="A banner shown to everyone, and a studio-wide switch that stops new Generations."
    >
      <div className="flex flex-col gap-sections">
        <NoticeForm settings={settings} />
        <div className="border-t border-border pt-4">
          <PauseControl settings={settings} />
        </div>
      </div>
    </AdminSection>
  );
}
