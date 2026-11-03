import {
  USER_CAP_OVERRIDE_MAX,
  USER_CAP_OVERRIDE_MIN,
} from "@ai-content-studio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon, LockIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { Avatar } from "../components/Avatar.js";
import { adminBadgeKeys } from "../components/admin/AdminNav.js";
import { AdminPageHeader } from "../components/admin/AdminPageHeader.js";
import { AdminSection } from "../components/admin/AdminSection.js";
import { EmptyState } from "../components/admin/EmptyState.js";
import { FormField } from "../components/admin/FormField.js";
import { HistoryLink } from "../components/admin/HistoryLink.js";
import { LoadError } from "../components/admin/LoadError.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Pill } from "../components/ui/pill.js";
import { Textarea } from "../components/ui/textarea.js";
import { type ApiError, api, ok } from "../lib/api.js";
import { mapApiError, zodResolver } from "../lib/form.js";
import { formatWhen } from "../lib/format.js";
import { useSession } from "../useSession.js";

type Role = "user" | "admin";
type Status = "pending" | "active" | "disabled";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: Role;
  status: Status;
  pinned: boolean;
  dailyCapOverride: number | null;
  concurrentCapOverride: number | null;
  disabledReason: string | null;
  disabledAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

/** The Site's default Caps, from Site settings (the caps' placeholders). */
interface SiteCaps {
  dailyCap: number;
  concurrentCap: number;
}

const DISABLE_REASON_MAX_LENGTH = 500;

/** Blank, or a whole number in the shared 0–1,000 range (userCapOverrideSchema's). */
const capOverrideInput = z.string().refine(
  (raw) => {
    const trimmed = raw.trim();
    if (trimmed === "") return true;
    const value = Number(trimmed);
    return (
      Number.isInteger(value) &&
      value >= USER_CAP_OVERRIDE_MIN &&
      value <= USER_CAP_OVERRIDE_MAX
    );
  },
  {
    message: `Blank, or a whole number between ${USER_CAP_OVERRIDE_MIN} and ${USER_CAP_OVERRIDE_MAX.toLocaleString()}.`,
  },
);

const capsSchema = z.object({
  dailyCapOverride: capOverrideInput,
  concurrentCapOverride: capOverrideInput,
});

type CapsFormValues = z.infer<typeof capsSchema>;

/** Blank becomes null (the Site default); anything else is a whole number. */
function parseOverride(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return Number(trimmed);
}

const statusTone: Record<Status, "warn" | "ok" | "err"> = {
  pending: "warn",
  active: "ok",
  disabled: "err",
};

/**
 * One user's page (issue #207): a profile header with the 48px shared
 * avatar, name, role/pinned/status pills and the email, the History link
 * and the allowed actions (Approve, Promote to Admin / Demote to user,
 * Enable, Disable in a confirm dialog with the Admin-only reason, Delete
 * account in a confirm dialog that navigates back to the Users list), a
 * Profile panel, the Cap overrides form (Site defaults as placeholders, a
 * 0 flagged as "Blocked from generating"), and a Work and files section.
 * No server route or data shape changes.
 */
export function UserPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useSession();
  const queryClient = useQueryClient();

  const [disableOpen, setDisableOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [disableReason, setDisableReason] = useState("");
  const [deleteReason, setDeleteReason] = useState("");

  const userQuery = useQuery({
    queryKey: ["admin", "users", id],
    enabled: id !== "",
    queryFn: ({ signal }) =>
      ok<AdminUser>(
        api.api.admin.users[":id"].$get(
          { param: { id } },
          { init: { signal } },
        ),
      ),
  });

  const siteCapsQuery = useQuery({
    queryKey: ["admin", "site-settings"],
    queryFn: ({ signal }) =>
      ok<SiteCaps>(api.api.admin["site-settings"].$get({ init: { signal } })),
  });
  const siteDaily = siteCapsQuery.data?.dailyCap;
  const siteConcurrent = siteCapsQuery.data?.concurrentCap;

  const user = userQuery.data;
  const isSelf = session.status === "signed-in" && session.user.id === user?.id;
  // A "Deleted user" row (deletedAt set) offers no action: the server
  // refuses all of them, the same as a pinned or self-targeted row.
  const canAct = user ? !user.pinned && !isSelf && !user.deletedAt : false;

  // Every action that changes a user invalidates the list, this page and
  // the nav's pending badge (issue #207's AC: approving refreshes it).
  const invalidateUserAndBadge = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    void queryClient.invalidateQueries({ queryKey: adminBadgeKeys.pending });
  };

  const approveMutation = useMutation({
    mutationFn: () =>
      ok<AdminUser>(
        api.api.admin.users[":id"].approve.$post({ param: { id } }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(["admin", "users", id], data);
      invalidateUserAndBadge();
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ action }: { action: "promote" | "demote" }) =>
      action === "promote"
        ? ok<AdminUser>(
            api.api.admin.users[":id"].promote.$post({ param: { id } }),
          )
        : ok<AdminUser>(
            api.api.admin.users[":id"].demote.$post({ param: { id } }),
          ),
    onSuccess: (data) => {
      queryClient.setQueryData(["admin", "users", id], data);
      invalidateUserAndBadge();
    },
  });

  const enableMutation = useMutation({
    mutationFn: () =>
      ok<AdminUser>(api.api.admin.users[":id"].enable.$post({ param: { id } })),
    onSuccess: (data) => {
      queryClient.setQueryData(["admin", "users", id], data);
      invalidateUserAndBadge();
    },
  });

  const disableMutation = useMutation({
    mutationFn: ({ reason }: { reason: string }) =>
      ok<AdminUser>(
        api.api.admin.users[":id"].disable.$post({
          param: { id },
          json: { reason: reason.trim() || undefined },
        }),
      ),
    onSuccess: (data) => {
      setDisableOpen(false);
      setDisableReason("");
      queryClient.setQueryData(["admin", "users", id], data);
      invalidateUserAndBadge();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ reason }: { reason: string }) =>
      ok<{ ok: boolean }>(
        api.api.admin.users[":id"].$delete({
          param: { id },
          json: { reason: reason.trim() || undefined },
        }),
      ),
    onSuccess: () => {
      invalidateUserAndBadge();
      navigate("/admin/users");
    },
  });

  const capsForm = useForm<CapsFormValues>({
    resolver: zodResolver(capsSchema),
    defaultValues: { dailyCapOverride: "", concurrentCapOverride: "" },
  });

  // The inputs start from the saved overrides, and settle back on them
  // after a save (the original page re-populated from the reload). The
  // narrow overrides (not the whole user object) are the real
  // dependencies, so a refetch with equal values does not re-populate.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the overrides are the effect's real dependencies, not the whole user object
  useEffect(() => {
    if (!user) return;
    capsForm.reset({
      dailyCapOverride:
        user.dailyCapOverride === null ? "" : String(user.dailyCapOverride),
      concurrentCapOverride:
        user.concurrentCapOverride === null
          ? ""
          : String(user.concurrentCapOverride),
    });
  }, [user?.dailyCapOverride, user?.concurrentCapOverride]);

  const capsMutation = useMutation({
    mutationFn: ({
      dailyCapOverride,
      concurrentCapOverride,
    }: {
      dailyCapOverride: number | null;
      concurrentCapOverride: number | null;
    }) =>
      ok<AdminUser>(
        api.api.admin.users[":id"].caps.$put({
          param: { id },
          json: { dailyCapOverride, concurrentCapOverride },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(["admin", "users", id], data);
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      capsForm.reset({
        dailyCapOverride:
          data.dailyCapOverride === null ? "" : String(data.dailyCapOverride),
        concurrentCapOverride:
          data.concurrentCapOverride === null
            ? ""
            : String(data.concurrentCapOverride),
      });
    },
    onError: (error) => {
      mapApiError(capsForm.setError, error as ApiError);
    },
  });

  const dailyValue = capsForm.watch("dailyCapOverride");
  const concurrentValue = capsForm.watch("concurrentCapOverride");

  if (userQuery.isError && !user) {
    return (
      <>
        <AdminPageHeader
          crumb={
            <>
              Admin /{" "}
              <Link to="/admin/users" className="hover:underline">
                Users
              </Link>
            </>
          }
          title="User"
        />
        <LoadError
          message="could not load this user"
          onRetry={() => void userQuery.refetch()}
        />
      </>
    );
  }

  if (!user) {
    return (
      <>
        <AdminPageHeader
          crumb={
            <>
              Admin /{" "}
              <Link to="/admin/users" className="hover:underline">
                Users
              </Link>
            </>
          }
          title="User"
        />
        <p>Loading…</p>
      </>
    );
  }

  const displayName = user.name || user.email || user.id;

  return (
    <>
      <AdminPageHeader
        crumb={
          <>
            Admin /{" "}
            <Link to="/admin/users" className="hover:underline">
              Users
            </Link>
          </>
        }
        title={
          <>
            <Avatar name={displayName} picture={user.picture} size={48} />
            {displayName}
          </>
        }
        pills={
          <>
            {user.role === "admin" ? (
              <Pill tone="accent">Admin</Pill>
            ) : (
              <Pill tone="neutral">User</Pill>
            )}
            {user.pinned ? (
              <Pill
                tone="neutral"
                className="border border-input bg-transparent"
              >
                <LockIcon className="size-3" aria-hidden="true" />
                pinned
              </Pill>
            ) : null}
            {user.deletedAt ? (
              <Pill tone="neutral">Deleted user</Pill>
            ) : (
              <Pill tone={statusTone[user.status]}>{user.status}</Pill>
            )}
          </>
        }
        description={user.email || null}
        actions={
          <>
            <HistoryLink targetType="user" targetId={user.id} />
            {canAct && user.status === "pending" ? (
              <Button
                size="sm"
                disabled={approveMutation.isPending}
                onClick={() => void approveMutation.mutate()}
              >
                Approve
              </Button>
            ) : null}
            {canAct && user.role === "user" && user.status === "active" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={roleMutation.isPending}
                onClick={() => void roleMutation.mutate({ action: "promote" })}
              >
                Promote to Admin
              </Button>
            ) : null}
            {canAct && user.role === "admin" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={roleMutation.isPending}
                onClick={() => void roleMutation.mutate({ action: "demote" })}
              >
                Demote to user
              </Button>
            ) : null}
            {canAct && user.status === "disabled" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={enableMutation.isPending}
                onClick={() => void enableMutation.mutate()}
              >
                Enable
              </Button>
            ) : null}
            {canAct && user.status !== "disabled" ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDisableOpen(true)}
              >
                Disable
              </Button>
            ) : null}
            {canAct ? (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setDeleteOpen(true)}
              >
                Delete account
              </Button>
            ) : null}
          </>
        }
      />

      {!canAct && !user.deletedAt ? (
        <EmptyState>
          {user.pinned
            ? "Pinned Admin: listed in the Operator's ADMIN_EMAILS, so it can't be demoted, disabled or deleted here."
            : "This is your own account: nobody changes their own role or status."}
        </EmptyState>
      ) : null}

      <AdminSection title="Profile">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Role</dt>
            <dd>
              <div className="flex flex-wrap items-center gap-1.5">
                {user.role === "admin" ? "Admin" : "User"}
                {user.pinned ? " (pinned)" : ""}
              </div>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Status</dt>
            <dd>{user.deletedAt ? "Deleted user" : user.status}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Joined</dt>
            <dd>{formatWhen(user.createdAt)}</dd>
          </div>
          {user.status === "disabled" && !user.deletedAt ? (
            <>
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground">Disabled</dt>
                <dd>{user.disabledAt ? formatWhen(user.disabledAt) : "—"}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-muted-foreground">Reason (Admin-only)</dt>
                <dd>{user.disabledReason ?? "No reason given"}</dd>
              </div>
            </>
          ) : null}
          {user.deletedAt ? (
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Deleted</dt>
              <dd>{formatWhen(user.deletedAt)}</dd>
            </div>
          ) : null}
        </dl>
      </AdminSection>

      {!user.deletedAt ? (
        <AdminSection
          title="Cap overrides"
          description={`Blank uses the Site default; 0 blocks this user from generating. Whole numbers between ${USER_CAP_OVERRIDE_MIN} and ${USER_CAP_OVERRIDE_MAX.toLocaleString()}.`}
        >
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={capsForm.handleSubmit((values) => {
              void capsMutation.mutate({
                dailyCapOverride: parseOverride(values.dailyCapOverride),
                concurrentCapOverride: parseOverride(
                  values.concurrentCapOverride,
                ),
              });
            })}
          >
            <div className="flex flex-col gap-1.5">
              <FormField
                label="Daily cap override"
                htmlFor="daily-cap-override"
                error={
                  capsForm.formState.errors.dailyCapOverride?.message ||
                  undefined
                }
              >
                <Input
                  id="daily-cap-override"
                  type="number"
                  min={USER_CAP_OVERRIDE_MIN}
                  max={USER_CAP_OVERRIDE_MAX}
                  placeholder={
                    siteDaily !== undefined
                      ? `Default (${siteDaily})`
                      : "Site default"
                  }
                  {...capsForm.register("dailyCapOverride")}
                />
              </FormField>
              {dailyValue.trim() === "0" ? (
                <Pill tone="err">Blocked from generating</Pill>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <FormField
                label="Concurrent cap override"
                htmlFor="concurrent-cap-override"
                error={
                  capsForm.formState.errors.concurrentCapOverride?.message ||
                  undefined
                }
              >
                <Input
                  id="concurrent-cap-override"
                  type="number"
                  min={USER_CAP_OVERRIDE_MIN}
                  max={USER_CAP_OVERRIDE_MAX}
                  placeholder={
                    siteConcurrent !== undefined
                      ? `Default (${siteConcurrent})`
                      : "Site default"
                  }
                  {...capsForm.register("concurrentCapOverride")}
                />
              </FormField>
              {concurrentValue.trim() === "0" ? (
                <Pill tone="err">Blocked from generating</Pill>
              ) : null}
            </div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Button type="submit" size="sm" disabled={capsMutation.isPending}>
                Save
              </Button>
              {capsMutation.isSuccess ? (
                <span className="text-ok">Saved.</span>
              ) : null}
              {capsMutation.error &&
              !capsForm.formState.errors.dailyCapOverride &&
              !capsForm.formState.errors.concurrentCapOverride ? (
                <p role="alert" className="text-err">
                  could not save the Cap overrides
                </p>
              ) : null}
            </div>
          </form>
        </AdminSection>
      ) : null}

      <AdminSection
        title="Work and files"
        description="Read-only. Remove abusive content from a Generation's or Upload's own page."
      >
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Link
            to={`/admin/generations?user=${user.id}`}
            className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted"
          >
            Generations
            <ChevronRightIcon
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </Link>
          <Link
            to={`/admin/users/${user.id}/uploads`}
            className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-sm hover:bg-muted"
          >
            Uploads
            <ChevronRightIcon
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </Link>
        </div>
      </AdminSection>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{`Disable ${displayName}?`}</DialogTitle>
            <DialogDescription>
              Their sessions end now and queued or running Generations are
              cancelled; files stay for review. It lasts until an Admin enables
              the account again.
            </DialogDescription>
          </DialogHeader>
          <FormField
            label="Reason (optional, Admin-only)"
            htmlFor="disable-reason"
          >
            <Textarea
              id="disable-reason"
              maxLength={DISABLE_REASON_MAX_LENGTH}
              value={disableReason}
              onChange={(event) => setDisableReason(event.target.value)}
              className="min-h-24"
            />
          </FormField>
          <p className="text-right text-xs text-muted-foreground">
            {disableReason.length} / {DISABLE_REASON_MAX_LENGTH}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDisableOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={disableMutation.isPending}
              onClick={() =>
                void disableMutation.mutate({ reason: disableReason })
              }
            >
              Confirm disable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{`Delete ${displayName}'s account?`}</DialogTitle>
            <DialogDescription>
              This scrubs {displayName}'s account like a self-delete.
              {user.status === "disabled" && !user.deletedAt
                ? " Their Google account will also be blocked from signing up again."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <FormField
            label="Blocked-account reason (optional)"
            htmlFor="delete-reason"
          >
            <Textarea
              id="delete-reason"
              maxLength={DISABLE_REASON_MAX_LENGTH}
              value={deleteReason}
              onChange={(event) => setDeleteReason(event.target.value)}
              className="min-h-24"
            />
          </FormField>
          <p className="text-right text-xs text-muted-foreground">
            {deleteReason.length} / {DISABLE_REASON_MAX_LENGTH}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={deleteMutation.isPending}
              onClick={() =>
                void deleteMutation.mutate({ reason: deleteReason })
              }
            >
              Confirm delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
