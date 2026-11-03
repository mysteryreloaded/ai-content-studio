import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, type UseFormSetError, useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
import { AdminPageHeader } from "../components/admin/AdminPageHeader.js";
import { EmptyState } from "../components/admin/EmptyState.js";
import { FormField } from "../components/admin/FormField.js";
import { HistoryLink } from "../components/admin/HistoryLink.js";
import { LoadError } from "../components/admin/LoadError.js";
import { StaleSaveAlert } from "../components/admin/StaleSaveAlert.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { Pill } from "../components/ui/pill.js";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet.js";
import { Switch } from "../components/ui/switch.js";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group.js";
import { ApiError, api, ok } from "../lib/api.js";
import { zodResolver } from "../lib/form.js";
import { formatTime, formatWhen } from "../lib/format.js";

type AuthKind = "none" | "basic" | "header";
type Reachability = "unknown" | "reachable" | "unreachable";

interface BackendHealth {
  reachability: Reachability;
  comfyuiVersion: string | null;
  vramTotal: number | null;
  vramFree: number | null;
  credentialsError: boolean;
}

export interface AdminBackend {
  id: string;
  name: string;
  baseUrl: string;
  auth: AuthKind;
  headerName: string | null;
  enabled: boolean;
  /** Issue #55: takes no new Generations but finishes what it has, unlike `enabled` which also drops what's in flight. */
  draining: boolean;
  version: number;
  health: BackendHealth;
  unreachableSince: string | null;
}

interface BackendsResponse {
  backends: AdminBackend[];
  disabledBanner: string | null;
}

interface BackendWireBody {
  name: string;
  baseUrl: string;
  auth: AuthKind;
  basicUser?: string;
  basicPass?: string;
  headerName?: string;
  headerValue?: string;
}

interface RecentLogEntry {
  id: string;
  level: "error" | "warning" | "info";
  message: string;
  createdAt: string;
}

const RECENT_LOGS_LIMIT = 10;

/** The ComfyUI version this project's node knowledge was tested against (docs/ops/backend-kit.md). */
export const TESTED_COMFYUI_VERSION = "0.26.2";

function versionParts(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** A pure comparison against `TESTED_COMFYUI_VERSION`; `version` may carry an optional leading "v". */
export function isOlderThanTested(version: string): boolean {
  const a = versionParts(version);
  const b = versionParts(TESTED_COMFYUI_VERSION);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

function gib(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const AUTH_KINDS = ["none", "basic", "header"] as const;

function backendFormSchema(requireCredentials: boolean) {
  return z
    .object({
      name: z
        .string()
        .min(1, "must be 1-60 characters")
        .max(60, "must be 1-60 characters"),
      baseUrl: z.string().min(1, "must be a valid address"),
      auth: z.enum(AUTH_KINDS),
      basicUser: z.string().optional(),
      basicPass: z.string().optional(),
      headerName: z.string().optional(),
      headerValue: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      let url: URL | null = null;
      try {
        url = new URL(data.baseUrl);
      } catch {
        url = null;
      }
      if (
        !url ||
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        url.search !== "" ||
        url.hash !== "" ||
        url.username !== "" ||
        url.password !== ""
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["baseUrl"],
          message: "must be a valid http(s) address",
        });
      }

      if (data.auth === "header") {
        if (!data.headerName) {
          ctx.addIssue({
            code: "custom",
            path: ["headerName"],
            message: "is required for header auth",
          });
        } else if (!HEADER_NAME_RE.test(data.headerName)) {
          ctx.addIssue({
            code: "custom",
            path: ["headerName"],
            message: "must be a valid header name",
          });
        }
        if (requireCredentials && !data.headerValue) {
          ctx.addIssue({
            code: "custom",
            path: ["headerValue"],
            message: "is required for header auth",
          });
        }
      }

      if (data.auth === "basic" && requireCredentials) {
        if (!data.basicUser || !data.basicPass) {
          ctx.addIssue({
            code: "custom",
            path: ["basicUser"],
            message: "username and password are required for basic auth",
          });
        }
      }
    });
}

type BackendFormValues = z.infer<ReturnType<typeof backendFormSchema>>;

const BLANK_VALUES: BackendFormValues = {
  name: "",
  baseUrl: "",
  auth: "none",
  basicUser: "",
  basicPass: "",
  headerName: "",
  headerValue: "",
};

function defaultValuesFor(backend: AdminBackend | null): BackendFormValues {
  if (!backend) return BLANK_VALUES;
  return {
    name: backend.name,
    baseUrl: backend.baseUrl,
    auth: backend.auth,
    basicUser: "",
    basicPass: "",
    headerName: backend.headerName ?? "",
    headerValue: "",
  };
}

/** Maps a save's 400 `{ errors: [{ field, message }] }` onto the form's fields (issue #39/#206). */
function mapBackendFieldErrors(
  setError: UseFormSetError<BackendFormValues>,
  body: unknown,
): boolean {
  const errors = (body as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return false;
  let mapped = false;
  for (const issue of errors) {
    if (
      issue &&
      typeof issue === "object" &&
      typeof (issue as { field?: unknown }).field === "string" &&
      typeof (issue as { message?: unknown }).message === "string"
    ) {
      setError((issue as { field: string }).field as keyof BackendFormValues, {
        message: (issue as { message: string }).message,
      });
      mapped = true;
    }
  }
  return mapped;
}

function healthPill(backend: AdminBackend): {
  tone: "ok" | "err" | "warn" | "neutral";
  label: string;
} {
  const { health } = backend;
  if (health.credentialsError) {
    return { tone: "warn", label: "Re-enter credentials" };
  }
  if (health.reachability === "unreachable") {
    const since = backend.unreachableSince
      ? formatTime(backend.unreachableSince)
      : "?";
    return { tone: "err", label: `Unreachable since ${since}` };
  }
  if (health.reachability === "reachable") {
    return { tone: "ok", label: "Healthy" };
  }
  return { tone: "neutral", label: "Checking…" };
}

function authSummary(backend: AdminBackend): string {
  let summary = `${backend.baseUrl} · auth ${backend.auth}`;
  if (backend.auth === "header" && backend.headerName) {
    summary += ` · header ${backend.headerName}`;
  }
  return summary;
}

function levelTone(level: RecentLogEntry["level"]): "err" | "warn" | "neutral" {
  if (level === "error") return "err";
  if (level === "warning") return "warn";
  return "neutral";
}

function RecentLogs({ backendId }: { backendId: string }) {
  const { data } = useQuery({
    queryKey: ["admin", "backend-logs", backendId],
    queryFn: () => {
      // `/api/admin/logs` reads its query params without a Hono
      // validator, so `$get`'s input type is `{}` — assigning the
      // call's args through a typed variable (rather than passing the
      // object literal straight to `$get`) sidesteps the resulting
      // excess-property check; the hc client reads `args.query` at
      // runtime regardless of what TS inferred for it.
      const args: { query: Record<string, string> } = {
        query: { backendId, limit: String(RECENT_LOGS_LIMIT) },
      };
      return ok<{ entries: RecentLogEntry[] }>(api.api.admin.logs.$get(args));
    },
  });
  const entries = data?.entries ?? [];

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2">
      {entries.length === 0 ? (
        <EmptyState>No recent Log entries for this Backend.</EmptyState>
      ) : (
        entries.map((entry) => (
          <div key={entry.id} className="flex flex-wrap items-baseline gap-2">
            <span className="shrink-0 text-[12.5px] text-muted-foreground">
              {formatWhen(entry.createdAt)}
            </span>
            <Pill tone={levelTone(entry.level)}>{entry.level}</Pill>
            <span className="min-w-0 break-words text-[12.5px]">
              {entry.message}
            </span>
          </div>
        ))
      )}
      <Link
        to={`/admin/logs?backendId=${backendId}`}
        className="text-[12.5px] text-primary underline-offset-4 hover:underline"
      >
        All Log entries
      </Link>
    </div>
  );
}

function BackendFormFields({
  control,
  register,
  errors,
  watchAuth,
  showUnchangedHint,
  credentialFieldRef,
}: {
  control: ReturnType<typeof useForm<BackendFormValues>>["control"];
  register: ReturnType<typeof useForm<BackendFormValues>>["register"];
  errors: ReturnType<typeof useForm<BackendFormValues>>["formState"]["errors"];
  watchAuth: AuthKind;
  showUnchangedHint: boolean;
  credentialFieldRef: (el: HTMLInputElement | null) => void;
}) {
  const keptHint = "Leave blank to keep the saved one.";
  return (
    <div className="flex flex-col gap-fields">
      <FormField
        label="Name"
        htmlFor="backend-name"
        error={errors.name?.message}
      >
        <Input
          id="backend-name"
          placeholder="3090 #2"
          maxLength={60}
          aria-invalid={errors.name ? true : undefined}
          {...register("name")}
        />
      </FormField>

      <FormField
        label="Address"
        htmlFor="backend-base-url"
        error={errors.baseUrl?.message}
        hint={
          errors.baseUrl
            ? undefined
            : "The Backend's tailnet IP and port. MagicDNS names don't resolve inside the studio container."
        }
      >
        <Input
          id="backend-base-url"
          className="font-mono"
          placeholder="http://100.101.7.12:8190"
          aria-invalid={errors.baseUrl ? true : undefined}
          {...register("baseUrl")}
        />
      </FormField>

      <div className="flex min-w-0 flex-col gap-1">
        <Label>Authentication</Label>
        <Controller
          control={control}
          name="auth"
          render={({ field }) => (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              aria-label="Authentication"
              value={field.value}
              onValueChange={(value) => {
                if (value) field.onChange(value as AuthKind);
              }}
            >
              <ToggleGroupItem
                value="none"
                className="px-[9px] py-1 text-[12.5px] text-muted-foreground data-[state=on]:bg-accent-soft data-[state=on]:font-semibold data-[state=on]:text-foreground"
              >
                None
              </ToggleGroupItem>
              <ToggleGroupItem
                value="basic"
                className="px-[9px] py-1 text-[12.5px] text-muted-foreground data-[state=on]:bg-accent-soft data-[state=on]:font-semibold data-[state=on]:text-foreground"
              >
                Basic
              </ToggleGroupItem>
              <ToggleGroupItem
                value="header"
                className="px-[9px] py-1 text-[12.5px] text-muted-foreground data-[state=on]:bg-accent-soft data-[state=on]:font-semibold data-[state=on]:text-foreground"
              >
                Header
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        />
      </div>

      {watchAuth === "basic" && (
        <>
          <FormField
            label="Username"
            htmlFor="backend-basic-user"
            error={errors.basicUser?.message}
          >
            <Input
              id="backend-basic-user"
              placeholder={showUnchangedHint ? "(unchanged)" : undefined}
              aria-invalid={errors.basicUser ? true : undefined}
              ref={(el) => {
                register("basicUser").ref(el);
                credentialFieldRef(el);
              }}
              name="basicUser"
              onChange={register("basicUser").onChange}
              onBlur={register("basicUser").onBlur}
            />
          </FormField>
          <FormField
            label="Password"
            htmlFor="backend-basic-pass"
            error={errors.basicPass?.message}
            hint={
              showUnchangedHint
                ? keptHint
                : "Write-only: stored encrypted, never shown again."
            }
          >
            <Input
              id="backend-basic-pass"
              type="password"
              placeholder={showUnchangedHint ? "(unchanged)" : undefined}
              aria-invalid={errors.basicPass ? true : undefined}
              {...register("basicPass")}
            />
          </FormField>
        </>
      )}

      {watchAuth === "header" && (
        <>
          <FormField
            label="Header name"
            htmlFor="backend-header-name"
            error={errors.headerName?.message}
          >
            <Input
              id="backend-header-name"
              className="font-mono"
              placeholder="Authorization"
              aria-invalid={errors.headerName ? true : undefined}
              {...register("headerName")}
            />
          </FormField>
          <FormField
            label="Header value"
            htmlFor="backend-header-value"
            error={errors.headerValue?.message}
            hint={showUnchangedHint ? keptHint : "Write-only."}
          >
            <Input
              id="backend-header-value"
              type="password"
              placeholder={showUnchangedHint ? "(unchanged)" : undefined}
              aria-invalid={errors.headerValue ? true : undefined}
              ref={(el) => {
                register("headerValue").ref(el);
                credentialFieldRef(el);
              }}
              name="headerValue"
              onChange={register("headerValue").onChange}
              onBlur={register("headerValue").onBlur}
            />
          </FormField>
        </>
      )}
    </div>
  );
}

function BackendFormSheet({
  open,
  onOpenChange,
  backend,
  reenterCredentials,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backend: AdminBackend | null;
  reenterCredentials?: boolean;
  onAdded: (name: string) => void;
}) {
  const isEdit = backend !== null;
  const requireCredentials = !isEdit || !!reenterCredentials;
  const showUnchangedHint = isEdit && !reenterCredentials;
  const queryClient = useQueryClient();
  const [staleSave, setStaleSave] = useState(false);
  const firstCredentialRef = useRef<HTMLInputElement | null>(null);

  const {
    control,
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<BackendFormValues>({
    resolver: zodResolver(backendFormSchema(requireCredentials)),
    defaultValues: defaultValuesFor(backend),
  });
  const watchAuth = watch("auth");

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per mount — the sheet remounts (via its key) whenever its target changes
  useEffect(() => {
    if (open && reenterCredentials) {
      firstCredentialRef.current?.focus();
    }
  }, []);

  const { mutate } = useMutation({
    mutationFn: async (values: BackendFormValues) => {
      const body: BackendWireBody = {
        name: values.name,
        baseUrl: values.baseUrl,
        auth: values.auth,
      };
      if (values.auth === "basic") {
        if (values.basicUser) body.basicUser = values.basicUser;
        if (values.basicPass) body.basicPass = values.basicPass;
      }
      if (values.auth === "header") {
        if (values.headerName) body.headerName = values.headerName;
        if (values.headerValue) body.headerValue = values.headerValue;
      }

      if (isEdit && backend) {
        return ok<AdminBackend>(
          api.api.admin.backends[":id"].$put({
            param: { id: backend.id },
            json: { ...body, version: backend.version },
          }),
        );
      }
      return ok<AdminBackend>(api.api.admin.backends.$post({ json: body }));
    },
    onSuccess: (record) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "backends"] });
      onOpenChange(false);
      if (!isEdit) onAdded(record.name);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          const body = error.body as { error?: string } | null;
          if (body?.error === "a Backend with this name already exists") {
            setError("name", { message: body.error });
          } else {
            setStaleSave(true);
          }
          return;
        }
        if (error.status === 400) {
          const mapped = mapBackendFieldErrors(setError, error.body);
          if (!mapped) setError("root", { message: "save failed" });
          return;
        }
      }
      setError("root", { message: "save failed" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[560px]">
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={handleSubmit((values) => {
            setStaleSave(false);
            mutate(values);
          })}
        >
          <SheetHeader>
            <SheetTitle>
              {isEdit ? `Edit ${backend?.name}` : "New Backend"}
            </SheetTitle>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
            {reenterCredentials && (
              <div
                role="alert"
                className="rounded-r-md border border-l-[3px] border-border border-l-warn bg-card px-3 py-[9px] text-warn"
              >
                These credentials no longer decrypt. Enter them again.
              </div>
            )}
            {staleSave && (
              <StaleSaveAlert
                onReload={() => {
                  void queryClient.invalidateQueries({
                    queryKey: ["admin", "backends"],
                  });
                  onOpenChange(false);
                }}
              />
            )}
            {errors.root?.message && (
              <p role="alert" className="text-err">
                {errors.root.message}
              </p>
            )}
            <BackendFormFields
              control={control}
              register={register}
              errors={errors}
              watchAuth={watchAuth}
              showUnchangedHint={showUnchangedHint}
              credentialFieldRef={(el) => {
                firstCredentialRef.current = el;
              }}
            />
          </div>

          <SheetFooter className="flex-row justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Save
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function DeleteBackendDialog({
  backend,
  onOpenChange,
}: {
  backend: AdminBackend;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      // `DELETE /:id` reads `version` without a Hono validator (see the
      // `logs.$get` comment above for why this goes through a variable).
      const args: { param: { id: string }; query: Record<string, string> } = {
        param: { id: backend.id },
        query: { version: String(backend.version) },
      };
      return ok<null>(api.api.admin.backends[":id"].$delete(args));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "backends"] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { error?: string } | null;
        setError(body?.error ?? "changed by someone else, reload");
        return;
      }
      setError("delete failed");
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {backend.name}?</DialogTitle>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-err">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={isPending}
            onClick={() => mutate()}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SheetTarget {
  backend: AdminBackend | null;
  reenterCredentials?: boolean;
}

function BackendRow({
  backend,
  expanded,
  onToggleLogs,
  onEdit,
  onReenterCredentials,
  onDelete,
}: {
  backend: AdminBackend;
  expanded: boolean;
  onToggleLogs: () => void;
  onEdit: () => void;
  onReenterCredentials: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const pill = healthPill(backend);
  const olderVersion =
    backend.health.reachability === "reachable" &&
    backend.health.comfyuiVersion &&
    isOlderThanTested(backend.health.comfyuiVersion)
      ? backend.health.comfyuiVersion
      : null;
  const [staleToggle, setStaleToggle] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const onToggleError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 409) {
      setStaleToggle(true);
      return;
    }
    setToggleError("could not update");
  };
  const onToggleMutate = () => {
    setStaleToggle(false);
    setToggleError(null);
  };

  const { mutate: setEnabled } = useMutation({
    mutationFn: (enabled: boolean) => {
      // `/enabled` reads its body without a Hono validator (see the
      // `logs.$get` comment above for why this goes through a variable).
      const args: { param: { id: string }; json: Record<string, unknown> } = {
        param: { id: backend.id },
        json: { enabled, version: backend.version },
      };
      return ok<AdminBackend>(
        api.api.admin.backends[":id"].enabled.$patch(args),
      );
    },
    onMutate: onToggleMutate,
    onError: onToggleError,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["admin", "backends"] }),
  });
  const { mutate: setDraining } = useMutation({
    mutationFn: (draining: boolean) => {
      const args: { param: { id: string }; json: Record<string, unknown> } = {
        param: { id: backend.id },
        json: { draining, version: backend.version },
      };
      return ok<AdminBackend>(
        api.api.admin.backends[":id"].draining.$patch(args),
      );
    },
    onMutate: onToggleMutate,
    onError: onToggleError,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["admin", "backends"] }),
  });

  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-2.5 py-[7px] last:border-b-0">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{backend.name}</span>
            <Pill tone={pill.tone}>{pill.label}</Pill>
            {!backend.enabled && <Pill tone="neutral">Disabled</Pill>}
            {backend.draining && <Pill tone="warn">Draining</Pill>}
            {backend.health.reachability === "reachable" &&
              backend.health.comfyuiVersion && (
                <span className="text-[12.5px] text-muted-foreground">
                  ComfyUI v{backend.health.comfyuiVersion}
                  {backend.health.vramFree !== null &&
                  backend.health.vramTotal !== null
                    ? ` · ${gib(backend.health.vramFree)} of ${gib(backend.health.vramTotal)} GiB free`
                    : null}
                </span>
              )}
          </div>
          <span className="break-all font-mono text-[12.5px] text-muted-foreground">
            {authSummary(backend)}
          </span>
          {olderVersion && (
            <p className="text-[12.5px] text-warn">
              ComfyUI v{olderVersion} is older than the tested v
              {TESTED_COMFYUI_VERSION}.
            </p>
          )}
          {backend.health.credentialsError && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[12.5px] text-warn">
                These credentials no longer decrypt.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onReenterCredentials}
              >
                Re-enter credentials
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex min-h-9 items-center gap-1.5">
            <Switch
              id={`backend-${backend.id}-enabled`}
              checked={backend.enabled}
              onCheckedChange={(checked) => setEnabled(checked)}
            />
            <Label htmlFor={`backend-${backend.id}-enabled`}>Enabled</Label>
          </div>
          <div className="flex min-h-9 items-center gap-1.5">
            <Switch
              id={`backend-${backend.id}-draining`}
              checked={backend.draining}
              onCheckedChange={(checked) => setDraining(checked)}
            />
            <Label htmlFor={`backend-${backend.id}-draining`}>Drain</Label>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onToggleLogs}
          >
            {expanded ? "Hide logs" : "Recent logs"}
          </Button>
          <HistoryLink targetType="backend" targetId={backend.id} />
          <Button type="button" variant="danger" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>

      {staleToggle && (
        <StaleSaveAlert
          onReload={() => {
            setStaleToggle(false);
            void queryClient.invalidateQueries({
              queryKey: ["admin", "backends"],
            });
          }}
        />
      )}
      {toggleError && (
        <p role="alert" className="text-err">
          {toggleError}
        </p>
      )}

      {expanded && <RecentLogs backendId={backend.id} />}
    </div>
  );
}

/** The Backends admin page: register, health, Enabled/Drain and History (issue #39, restyled #206). */
export function BackendsPage() {
  const queryClient = useQueryClient();
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminBackend | null>(null);
  const [expandedLogsFor, setExpandedLogsFor] = useState<string | null>(null);
  const [addedNote, setAddedNote] = useState<string | null>(null);

  const { data, error, refetch } = useQuery({
    queryKey: ["admin", "backends"],
    queryFn: () => ok<BackendsResponse>(api.api.admin.backends.$get()),
    refetchInterval: 30_000,
  });

  return (
    <>
      <AdminPageHeader
        title="Backends"
        description="ComfyUI servers the studio runs Generations on. Backends are shared between Models; each runs one Generation at a time."
        actions={
          <Button onClick={() => setSheetTarget({ backend: null })}>
            <Plus data-icon="inline-start" />
            New Backend
          </Button>
        }
      />

      {data?.disabledBanner && (
        <div
          role="alert"
          className="rounded-r-md border border-l-[3px] border-border border-l-warn bg-card px-3 py-[9px] text-warn"
        >
          {data.disabledBanner}
        </div>
      )}

      {error && (
        <LoadError
          message="could not load Backends"
          onRetry={() => void refetch()}
        />
      )}

      {addedNote && (
        <p className="rounded-md bg-muted px-[11px] py-[9px] text-muted-foreground">
          {addedNote}
        </p>
      )}

      {!data && !error && <p>Loading…</p>}

      {data &&
        (data.backends.length === 0 ? (
          <EmptyState>No Backends yet. Add one above.</EmptyState>
        ) : (
          <div className="rounded-xl border border-border bg-card">
            {data.backends.map((backend) => (
              <BackendRow
                key={backend.id}
                backend={backend}
                expanded={expandedLogsFor === backend.id}
                onToggleLogs={() =>
                  setExpandedLogsFor((current) =>
                    current === backend.id ? null : backend.id,
                  )
                }
                onEdit={() => setSheetTarget({ backend })}
                onReenterCredentials={() =>
                  setSheetTarget({ backend, reenterCredentials: true })
                }
                onDelete={() => setDeleteTarget(backend)}
              />
            ))}
          </div>
        ))}

      <BackendFormSheet
        key={
          sheetTarget
            ? `${sheetTarget.backend?.id ?? "new"}:${sheetTarget.reenterCredentials ?? false}`
            : "closed"
        }
        open={sheetTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSheetTarget(null);
        }}
        backend={sheetTarget?.backend ?? null}
        reenterCredentials={sheetTarget?.reenterCredentials}
        onAdded={(name) => {
          setAddedNote(
            `Added ${name}. Health, ComfyUI version and VRAM appear within about 30 seconds.`,
          );
          void queryClient.invalidateQueries({
            queryKey: ["admin", "backends"],
          });
        }}
      />

      {deleteTarget && (
        <DeleteBackendDialog
          backend={deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        />
      )}
    </>
  );
}
