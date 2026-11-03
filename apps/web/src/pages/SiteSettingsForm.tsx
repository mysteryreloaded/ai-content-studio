import {
  ACCENT_PALETTES,
  BACKGROUND_MAX_BYTES,
  CONTACT_MAX_LENGTH,
  FOOTER_LINKS_MAX_COUNT,
  FOOTER_LINK_LABEL_MAX_LENGTH,
  LANDING_TEXT_MAX_LENGTH,
  LOGO_MAX_BYTES,
  type SignUpMode,
  type SiteSettingsFields,
  TITLE_MAX_LENGTH,
  isAllowedImageContentType,
  siteSettingsFieldsSchema,
} from "@ai-content-studio/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import type { z } from "zod";
import { AdminSection } from "../components/admin/AdminSection.js";
import { StaleSaveAlert } from "../components/admin/StaleSaveAlert.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group.js";
import { Textarea } from "../components/ui/textarea.js";
import { ApiError, api, ok } from "../lib/api.js";
import { describeSaveError, mapApiError, zodResolver } from "../lib/form.js";
import {
  type AdminSiteSettings,
  siteSettingsQueryKey,
} from "./site-settings-shared.js";

type FormValues = z.input<typeof siteSettingsFieldsSchema>;

function defaultValuesFrom(settings: AdminSiteSettings): FormValues {
  return {
    title: settings.title,
    landingText: settings.landingText,
    accent: settings.accent,
    signUpMode: settings.signUpMode,
    contact: settings.contact,
    footerLinks: settings.footerLinks.map((link) => ({ ...link })),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateImage(
  file: File | null,
  which: "logo" | "background",
): string | null {
  if (!file) return null;
  if (!isAllowedImageContentType(file.type)) {
    return `${which} must be a PNG, JPEG or WebP image`;
  }
  const max = which === "logo" ? LOGO_MAX_BYTES : BACKGROUND_MAX_BYTES;
  if (file.size > max) {
    return `${which} must be ${Math.floor(max / (1024 * 1024))} MB or smaller`;
  }
  return null;
}

function ImagePicker({
  id,
  label,
  chooseLabel,
  hint,
  current,
  file,
  error,
  preview,
  onPick,
}: {
  id: string;
  label: string;
  chooseLabel: string;
  hint: string;
  current: { contentType: string; hash: string; size: number } | null;
  file: File | null;
  error: string | null;
  preview: ReactNode;
  onPick: (file: File | null) => void;
}) {
  const filled = Boolean(file) || Boolean(current);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <label
        htmlFor={id}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-md border-[1.5px] border-dashed border-input bg-muted px-3 py-2.5 text-[13px] text-muted-foreground",
          filled && "border-solid bg-card text-foreground",
        )}
      >
        {preview}
        <span className="flex min-w-0 flex-col">
          <span className="truncate">
            {file ? file.name : current ? "Current image" : chooseLabel}
          </span>
          {file && (
            <span className="text-muted-foreground">
              {formatBytes(file.size)}
            </span>
          )}
        </span>
        {filled && (
          <span className="ml-auto shrink-0 font-medium text-foreground">
            Change…
          </span>
        )}
      </label>
      <input
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => onPick(event.target.files?.[0] ?? null)}
      />
      {error ? (
        <p className="text-err">{error}</p>
      ) : (
        <p className="text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/**
 * The Site settings branding form (issue #201): Branding, Accent colour,
 * Sign-up (the rest of "Sign-up and Caps" is `capsSlot`, the Caps form —
 * its own Save) and Contact and footer, all one react-hook-form instance
 * saving the one multipart PUT.
 */
export function SiteSettingsForm({
  settings,
  capsSlot,
  onReload,
}: {
  settings: AdminSiteSettings;
  capsSlot: ReactNode;
  onReload: () => Promise<AdminSiteSettings | undefined>;
}) {
  const queryClient = useQueryClient();
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [backgroundPreviewUrl, setBackgroundPreviewUrl] = useState<
    string | null
  >(null);
  const [staleSave, setStaleSave] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The lock token this form sends on its own save: set on mount, on its
  // own save and on its own Reload — never from the shared settings
  // cache, which another admin's save can move out from under us.
  const [version, setVersion] = useState(settings.version);

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setError,
    setValue,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(siteSettingsFieldsSchema),
    defaultValues: defaultValuesFrom(settings),
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "footerLinks",
  });

  const title = watch("title") ?? "";
  const landingText = watch("landingText") ?? "";
  const accent = watch("accent") ?? settings.accent;
  const signUpMode = watch("signUpMode") ?? settings.signUpMode;

  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  useEffect(() => {
    if (!backgroundFile) {
      setBackgroundPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(backgroundFile);
    setBackgroundPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [backgroundFile]);

  const { mutate, isPending } = useMutation({
    mutationFn: async (values: SiteSettingsFields) => {
      const body = new FormData();
      body.set("version", String(version));
      body.set("title", values.title);
      body.set("landingText", values.landingText);
      body.set("accent", values.accent);
      body.set("signUpMode", values.signUpMode);
      body.set("contact", values.contact);
      body.set("footerLinks", JSON.stringify(values.footerLinks));
      if (logoFile) body.set("logo", logoFile);
      if (backgroundFile) body.set("background", backgroundFile);

      return ok<AdminSiteSettings>(
        api.api.admin["site-settings"].$put(undefined, {
          init: { body },
        }),
      );
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(siteSettingsQueryKey, updated);
      reset(defaultValuesFrom(updated));
      setLogoFile(null);
      setBackgroundFile(null);
      setStaleSave(false);
      setSaveError(null);
      setVersion(updated.version);
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

  function onPickLogo(file: File | null) {
    setLogoError(validateImage(file, "logo"));
    setLogoFile(file);
  }

  function onPickBackground(file: File | null) {
    setBackgroundError(validateImage(file, "background"));
    setBackgroundFile(file);
  }

  function onSubmit(values: FormValues) {
    if (logoError || backgroundError) return;
    setJustSaved(false);
    setSaveError(null);
    mutate(siteSettingsFieldsSchema.parse(values));
  }

  async function handleReload() {
    const fresh = await onReload();
    if (fresh) {
      reset(defaultValuesFrom(fresh));
      setLogoFile(null);
      setBackgroundFile(null);
      setLogoError(null);
      setBackgroundError(null);
      setStaleSave(false);
      setSaveError(null);
      setVersion(fresh.version);
    }
  }

  const dirty = isDirty || logoFile !== null || backgroundFile !== null;
  const saveDisabled =
    isPending || isSubmitting || Boolean(logoError) || Boolean(backgroundError);

  const saveStatus = staleSave ? null : dirty ? (
    <span className="text-muted-foreground">Unsaved changes</span>
  ) : justSaved ? (
    <span className="text-ok">Saved</span>
  ) : null;

  return (
    <>
      <AdminSection
        id="branding"
        title="Branding"
        description="The title, logo, background image and landing text shown across the studio."
      >
        <div className="fields grid gap-fields sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="site-title">Title</Label>
            <Input
              id="site-title"
              maxLength={TITLE_MAX_LENGTH}
              aria-invalid={errors.title ? true : undefined}
              {...register("title")}
            />
            <div className="flex items-baseline justify-between gap-2">
              {errors.title ? (
                <p className="text-err">{errors.title.message}</p>
              ) : (
                <p className="text-muted-foreground">
                  Shown in the header, the landing page and the browser tab. 1–
                  {TITLE_MAX_LENGTH} characters.
                </p>
              )}
              <span className="shrink-0 text-muted-foreground">
                {title.length} / {TITLE_MAX_LENGTH}
              </span>
            </div>
          </div>

          <ImagePicker
            id="site-logo"
            label="Logo"
            chooseLabel="Choose a logo…"
            hint="Also the favicon. PNG, JPEG or WebP, up to 1 MB."
            current={settings.logo}
            file={logoFile}
            error={logoError}
            onPick={onPickLogo}
            preview={
              logoPreviewUrl ? (
                <img
                  src={logoPreviewUrl}
                  alt=""
                  width={48}
                  height={48}
                  className="size-12 shrink-0 rounded-md object-cover"
                />
              ) : settings.logo ? (
                <img
                  src={`/api/site-settings/logo?v=${settings.version}`}
                  alt=""
                  width={48}
                  height={48}
                  className="size-12 shrink-0 rounded-md object-cover"
                />
              ) : null
            }
          />

          <ImagePicker
            id="site-background"
            label="Background image"
            chooseLabel="Choose a background…"
            hint="Shown behind the landing page. PNG, JPEG or WebP, up to 5 MB. Without one, the landing page uses a soft tint of the accent."
            current={settings.background}
            file={backgroundFile}
            error={backgroundError}
            onPick={onPickBackground}
            preview={
              backgroundPreviewUrl ? (
                <img
                  src={backgroundPreviewUrl}
                  alt=""
                  width={160}
                  height={90}
                  className="aspect-video w-40 shrink-0 rounded-md object-cover"
                />
              ) : settings.background ? (
                <img
                  src={`/api/site-settings/background?v=${settings.version}`}
                  alt=""
                  width={160}
                  height={90}
                  className="aspect-video w-40 shrink-0 rounded-md object-cover"
                />
              ) : null
            }
          />

          <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
            <Label htmlFor="landing-text">Landing text</Label>
            <Textarea
              id="landing-text"
              maxLength={LANDING_TEXT_MAX_LENGTH}
              {...register("landingText")}
            />
            <div className="flex items-baseline justify-between gap-2">
              {errors.landingText ? (
                <p className="text-err">{errors.landingText.message}</p>
              ) : (
                <p className="text-muted-foreground">
                  Shown on the landing page under the title. Leave blank for the
                  default.
                </p>
              )}
              <span className="shrink-0 text-muted-foreground">
                {landingText.length} / {LANDING_TEXT_MAX_LENGTH}
              </span>
            </div>
          </div>
        </div>
      </AdminSection>

      <AdminSection
        id="accent"
        title="Accent colour"
        description="One accent for the whole studio: buttons, links, focus rings and more."
      >
        <RadioGroup
          aria-label="Accent colour"
          value={accent}
          onValueChange={(value) =>
            setValue("accent", value, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          {ACCENT_PALETTES.map((palette) => {
            const selected = accent === palette.key;
            return (
              // biome-ignore lint/a11y/noLabelWithoutControl: wraps a Radix RadioGroupItem (role="radio"), not a native labelable element
              <label
                key={palette.key}
                className={cn(
                  "flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-2.5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                  selected && "ring-2 ring-ring",
                )}
              >
                <RadioGroupItem value={palette.key} className="sr-only" />
                <span className="flex items-center justify-between gap-1 font-medium">
                  {palette.label}
                  {selected && <CheckIcon className="size-4 text-primary" />}
                </span>
                <span className="grid grid-cols-2 gap-1.5">
                  {(["light", "dark"] as const).map((mode) => {
                    const colors = palette[mode];
                    return (
                      <span
                        key={mode}
                        style={
                          {
                            "--sw-accent": colors.accent,
                            "--sw-on-accent": colors.onAccent,
                          } as CSSProperties
                        }
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-md p-1.5",
                          mode === "light" ? "bg-[#f4f6f5]" : "bg-[#101513]",
                        )}
                      >
                        <span className="rounded-md bg-(--sw-accent) px-2 py-0.5 text-(--sw-on-accent) text-xs">
                          Button
                        </span>
                        <span className="text-(--sw-accent) text-xs underline">
                          Link
                        </span>
                        <span
                          className={cn(
                            "text-[11px]",
                            mode === "light"
                              ? "text-black/60"
                              : "text-white/60",
                          )}
                        >
                          {mode === "light" ? "Light" : "Dark"}
                        </span>
                      </span>
                    );
                  })}
                </span>
              </label>
            );
          })}
        </RadioGroup>
        <p className="text-muted-foreground">
          Colours buttons, links, focus rings and the active nav item
          everywhere. Success, warning and error colours don&apos;t change. Open
          pages pick it up when reloaded.
        </p>
      </AdminSection>

      <AdminSection
        id="signup-caps"
        title="Sign-up and Caps"
        description="Whether new users need approval, and the default Generation caps."
      >
        <div className="flex flex-col gap-content">
          <RadioGroup
            aria-label="Sign-up"
            value={signUpMode}
            onValueChange={(value) =>
              setValue("signUpMode", value as SignUpMode, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            className="grid gap-2 sm:grid-cols-2"
          >
            {(
              [
                {
                  value: "approval",
                  label: "Approval",
                  hint: "new users wait for an Admin",
                },
                {
                  value: "open",
                  label: "Open",
                  hint: "new users are active right away",
                },
              ] as const
            ).map((option) => (
              // biome-ignore lint/a11y/noLabelWithoutControl: wraps a Radix RadioGroupItem (role="radio"), not a native labelable element
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-card p-3",
                  signUpMode === option.value && "ring-2 ring-ring",
                )}
              >
                <RadioGroupItem value={option.value} className="mt-0.5" />
                <span className="flex flex-col">
                  <span className="font-medium">{option.label}</span>
                  <span className="text-muted-foreground">{option.hint}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <p className="text-muted-foreground">
            Switching to Open doesn&apos;t approve anyone already waiting.
          </p>

          {capsSlot}
        </div>
      </AdminSection>

      <AdminSection
        id="contact-footer"
        title="Contact and footer"
        description="The contact shown in every footer, and up to three extra footer links."
      >
        <form
          noValidate
          className="flex flex-col gap-fields"
          onSubmit={handleSubmit(onSubmit)}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="site-contact">
              Contact for reports and account questions
            </Label>
            <Input
              id="site-contact"
              placeholder="support@example.com or https://example.com/contact"
              maxLength={CONTACT_MAX_LENGTH}
              aria-invalid={errors.contact ? true : undefined}
              {...register("contact")}
            />
            {errors.contact ? (
              <p className="text-err">{errors.contact.message}</p>
            ) : (
              <p className="text-muted-foreground">
                Shown as &quot;Contact · Report abuse&quot; in every footer and
                on the waiting and disabled pages. Hidden while blank.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Footer links</Label>
            {fields.map((field, index) => {
              const label = watch(`footerLinks.${index}.label`) ?? "";
              return (
                <div
                  key={field.id}
                  className="fields grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <Label htmlFor={`footer-link-label-${field.id}`}>
                      Label
                    </Label>
                    <Input
                      id={`footer-link-label-${field.id}`}
                      maxLength={FOOTER_LINK_LABEL_MAX_LENGTH}
                      aria-invalid={
                        errors.footerLinks?.[index]?.label ? true : undefined
                      }
                      {...register(`footerLinks.${index}.label`)}
                    />
                    <div className="flex items-baseline justify-between gap-2">
                      {errors.footerLinks?.[index]?.label && (
                        <p className="text-err">
                          {errors.footerLinks[index]?.label?.message}
                        </p>
                      )}
                      <span className="ml-auto shrink-0 text-muted-foreground">
                        {label.length} / {FOOTER_LINK_LABEL_MAX_LENGTH}
                      </span>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <Label htmlFor={`footer-link-url-${field.id}`}>URL</Label>
                    <Input
                      id={`footer-link-url-${field.id}`}
                      className="font-mono"
                      placeholder="https://example.com/imprint"
                      aria-invalid={
                        errors.footerLinks?.[index]?.url ? true : undefined
                      }
                      {...register(`footerLinks.${index}.url`)}
                    />
                    {errors.footerLinks?.[index]?.url && (
                      <p className="text-err">
                        {errors.footerLinks[index]?.url?.message}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-end"
                    onClick={() => remove(index)}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
            {fields.length < FOOTER_LINKS_MAX_COUNT && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => append({ label: "", url: "" })}
              >
                Add a footer link
              </Button>
            )}
            <p className="text-muted-foreground">
              Up to {FOOTER_LINKS_MAX_COUNT}, shown after Privacy, Terms and the
              contact.
            </p>
          </div>

          {staleSave && <StaleSaveAlert onReload={() => void handleReload()} />}
          {!staleSave && (errors.root?.message || saveError) && (
            <p className="text-err">{errors.root?.message ?? saveError}</p>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] text-muted-foreground">
              {saveStatus}
            </span>
            <Button type="submit" size="sm" disabled={saveDisabled}>
              Save
            </Button>
          </div>
        </form>
      </AdminSection>

      {dirty && !staleSave && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 border-t border-border bg-card px-4 py-2.5 shadow-md">
          <span className="text-[12.5px] text-muted-foreground">
            Unsaved branding changes
          </span>
          <Button
            type="button"
            size="sm"
            disabled={saveDisabled}
            onClick={() => void handleSubmit(onSubmit)()}
          >
            Save
          </Button>
        </div>
      )}
    </>
  );
}
