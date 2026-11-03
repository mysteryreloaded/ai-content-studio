import {
  SITE_CAP_MAX,
  SITE_CAP_MIN,
  siteCapsFieldsSchema,
} from "@ai-content-studio/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { StaleSaveAlert } from "../components/admin/StaleSaveAlert.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { ApiError, api, ok } from "../lib/api.js";
import { mapApiError, zodResolver } from "../lib/form.js";
import {
  type AdminSiteSettings,
  siteSettingsQueryKey,
} from "./site-settings-shared.js";

interface FormValues {
  dailyCap: number;
  concurrentCap: number;
}

function defaultValuesFrom(settings: AdminSiteSettings): FormValues {
  return {
    dailyCap: settings.dailyCap,
    concurrentCap: settings.concurrentCap,
  };
}

/**
 * Default Caps (issue #53, restyled #201): its own save, shown inside the
 * "Sign-up and Caps" section next to the Sign-up option cards.
 */
export function CapsForm({
  settings,
  onReload,
}: {
  settings: AdminSiteSettings;
  onReload: () => Promise<AdminSiteSettings | undefined>;
}) {
  const queryClient = useQueryClient();
  const [staleSave, setStaleSave] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(siteCapsFieldsSchema),
    defaultValues: defaultValuesFrom(settings),
  });

  const { mutate, isPending } = useMutation({
    mutationFn: (values: FormValues) =>
      ok<AdminSiteSettings>(
        api.api.admin["site-settings"].caps.$put({
          json: {
            revision: settings.capsRevision,
            dailyCap: values.dailyCap,
            concurrentCap: values.concurrentCap,
          },
        }),
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(siteSettingsQueryKey, updated);
      reset(defaultValuesFrom(updated));
      setStaleSave(false);
      setJustSaved(true);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        setStaleSave(true);
        return;
      }
      if (error instanceof ApiError) {
        mapApiError(setError, error);
      }
    },
  });

  async function handleReload() {
    const fresh = await onReload();
    if (fresh) {
      reset(defaultValuesFrom(fresh));
      setStaleSave(false);
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-fields border-t border-border pt-4"
      onSubmit={handleSubmit((values) => {
        setJustSaved(false);
        mutate(values);
      })}
    >
      <p className="text-muted-foreground">
        Site-wide defaults for how many Generations a user can run per day
        (rolling 24h, excluding failures) and at once. Whole numbers between{" "}
        {SITE_CAP_MIN} and {SITE_CAP_MAX.toLocaleString()}.
      </p>

      <div className="fields grid gap-fields sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="caps-daily">Daily cap</Label>
          <Input
            id="caps-daily"
            type="number"
            min={SITE_CAP_MIN}
            max={SITE_CAP_MAX}
            aria-invalid={errors.dailyCap ? true : undefined}
            {...register("dailyCap", { valueAsNumber: true })}
          />
          {errors.dailyCap ? (
            <p className="text-err">{errors.dailyCap.message}</p>
          ) : (
            <p className="text-muted-foreground">
              Per user, rolling 24 hours; failures don&apos;t count. Default 20.
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="caps-concurrent">Concurrent cap</Label>
          <Input
            id="caps-concurrent"
            type="number"
            min={SITE_CAP_MIN}
            max={SITE_CAP_MAX}
            aria-invalid={errors.concurrentCap ? true : undefined}
            {...register("concurrentCap", { valueAsNumber: true })}
          />
          {errors.concurrentCap ? (
            <p className="text-err">{errors.concurrentCap.message}</p>
          ) : (
            <p className="text-muted-foreground">
              Per user, at once. Default 4.
            </p>
          )}
        </div>
      </div>

      {staleSave && <StaleSaveAlert onReload={() => void handleReload()} />}

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
