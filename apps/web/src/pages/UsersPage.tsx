import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LockIcon } from "lucide-react";
import { adminBadgeKeys } from "../components/admin/AdminNav.js";
import { AdminPageHeader } from "../components/admin/AdminPageHeader.js";
import {
  AdminTable,
  adminHeadCell,
  adminRowClickable,
} from "../components/admin/AdminTable.js";
import { AdminTabs, userSectionTabs } from "../components/admin/AdminTabs.js";
import { EmptyState } from "../components/admin/EmptyState.js";
import { FilterBar } from "../components/admin/FilterBar.js";
import { FormField } from "../components/admin/FormField.js";
import { LoadError } from "../components/admin/LoadError.js";
import { LoadMoreButton } from "../components/admin/LoadMoreButton.js";
import { Avatar } from "../components/Avatar.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Pill } from "../components/ui/pill.js";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { api, ok } from "../lib/api.js";
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
  /** A scrubbed "Deleted user" row (ADR 0008) sets this. */
  deletedAt?: string | null;
  createdAt: string;
}

interface UsersResponse {
  users: AdminUser[];
  hasMore: boolean;
}

const PAGE_SIZE = 50;

type ListAction = "approve" | "promote" | "demote";

/** The status pill's tone (the prototype's `.pill` variants). */
const statusTone: Record<Status, "warn" | "ok" | "err"> = {
  pending: "warn",
  active: "ok",
  disabled: "err",
};

/** Only the keys the caller has, so the URL never carries empty values. */
function listQueryParams(
  q: string,
  status: string,
  role: string,
  cursor?: { createdAt: string; id: string } | null,
): Record<string, string> {
  const query: Record<string, string> = {};
  if (q) query.q = q;
  if (status) query.status = status;
  if (role) query.role = role;
  if (cursor) {
    query.beforeCreatedAt = cursor.createdAt;
    query.beforeId = cursor.id;
  }
  query.limit = String(PAGE_SIZE);
  return query;
}

/**
 * The admin's Users list (issue #207): newest first, with "Load older"
 * paging by keyset cursor, search by email or name, and status and role
 * filters kept in the URL. Each row shows the shared 24px avatar, the
 * name (a "Deleted user" when scrubbed), email, role pill with a pinned
 * marker, status pill, created date, and the row's actions; the whole
 * row links to the user's page. Users and Blocked accounts are one
 * section: the tabs live under the shared "Users" header.
 */
export function UsersPage() {
  const { session } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // The filters live in the URL (spec #207): ?q=&status=&role= — a link
  // such as /admin/users?status=pending opens already filtered.
  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "";
  const role = searchParams.get("role") ?? "";

  // The FilterBar edits a draft; "Apply" commits it to the URL,
  // "Clear filters" empties both.
  const [draft, setDraft] = useState({
    q,
    role: role as Role | "",
    status: status as Status | "",
  });

  const filterKey = `${q}|${status}|${role}`;

  const listQuery = useQuery({
    queryKey: ["admin", "users", q, status, role],
    queryFn: ({ signal }) =>
      ok<UsersResponse>(
        api.api.admin.users.$get(
          { query: listQueryParams(q, status, role) },
          { init: { signal } },
        ),
      ),
  });

  // "Load older": a keyset cursor over the last visible row; fetched
  // pages accumulate in state, the newest page lives in this query.
  const [cursor, setCursor] = useState<{
    createdAt: string;
    id: string;
  } | null>(null);
  const [older, setOlder] = useState<AdminUser[]>([]);
  const olderQuery = useQuery({
    queryKey: [
      "admin",
      "users",
      "older",
      q,
      status,
      role,
      cursor?.createdAt ?? "",
      cursor?.id ?? "",
    ],
    enabled: cursor !== null,
    queryFn: ({ signal }) =>
      ok<UsersResponse>(
        api.api.admin.users.$get(
          { query: listQueryParams(q, status, role, cursor) },
          { init: { signal } },
        ),
      ),
  });

  // A new filter starts the list over, page and all.
  useEffect(() => {
    setOlder([]);
    setCursor(null);
  }, [filterKey]);

  // Append the fetched older page once per cursor.
  const appended = useRef<string | null>(null);
  useEffect(() => {
    if (!cursor || !olderQuery.data) return;
    const key = `${cursor.createdAt}|${cursor.id}`;
    if (appended.current !== key) {
      appended.current = key;
      setOlder((prev) => [...prev, ...olderQuery.data.users]);
    }
  }, [cursor, olderQuery.data]);

  // Row actions (approve / promote / demote) invalidate the list and the
  // nav's pending badge (issue #207's AC: approving refreshes it).
  const invalidateListAndBadge = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    void queryClient.invalidateQueries({ queryKey: adminBadgeKeys.pending });
  };

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: ListAction }) =>
      action === "approve"
        ? ok<AdminUser>(api.api.admin.users[":id"].approve.$post({ param: { id } }))
        : action === "promote"
          ? ok<AdminUser>(
              api.api.admin.users[":id"].promote.$post({ param: { id } }),
            )
          : ok<AdminUser>(
              api.api.admin.users[":id"].demote.$post({ param: { id } }),
            ),
    onSuccess: invalidateListAndBadge,
  });

  const selfId = session.status === "signed-in" ? session.user.id : null;
  const page1 = listQuery.data?.users ?? [];
  const users = [...page1, ...older];
  const hasMore = cursor
    ? (olderQuery.data?.hasMore ?? false)
    : (listQuery.data?.hasMore ?? false);
  const loadingOlder = cursor !== null && (olderQuery.isPending || olderQuery.isFetching);

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
        title="Users"
      />
      <AdminTabs tabs={userSectionTabs} />
      <FilterBar
        onApply={() => {
          const next = new URLSearchParams();
          if (draft.q) next.set("q", draft.q);
          if (draft.status) next.set("status", draft.status);
          if (draft.role) next.set("role", draft.role);
          setSearchParams(next, { replace: true });
        }}
        onClear={() => {
          setDraft({ q: "", role: "", status: "" });
          setSearchParams(new URLSearchParams(), { replace: true });
        }}
      >
        <FormField label="Search" htmlFor="users-q">
          <Input
            id="users-q"
            type="search"
            placeholder="Name or email"
            value={draft.q}
            onChange={(event) =>
              setDraft((d) => ({ ...d, q: event.target.value }))
            }
          />
        </FormField>
        <FormField label="Status" htmlFor="users-status">
          <Select
            value={draft.status}
            onValueChange={(value) =>
              setDraft((d) => ({ ...d, status: (value ?? "") as Status | "" }))
            }
          >
            <SelectTrigger id="users-status">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Role" htmlFor="users-role">
          <Select
            value={draft.role}
            onValueChange={(value) =>
              setDraft((d) => ({ ...d, role: (value ?? "") as Role | "" }))
            }
          >
            <SelectTrigger id="users-role">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </FilterBar>

      {listQuery.isError && !listQuery.data ? (
        <LoadError
          message="could not load the users list"
          onRetry={() => void listQuery.refetch()}
        />
      ) : listQuery.isPending ? (
        <p>Loading…</p>
      ) : users.length === 0 ? (
        <EmptyState>No users match these filters.</EmptyState>
      ) : (
        <AdminTable>
          <TableHeader>
            <TableRow>
              <TableHead className={adminHeadCell}>User</TableHead>
              <TableHead className={adminHeadCell}>Email</TableHead>
              <TableHead className={adminHeadCell}>Role</TableHead>
              <TableHead className={adminHeadCell}>Status</TableHead>
              <TableHead className={adminHeadCell}>Created</TableHead>
              <TableHead className={adminHeadCell}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const isSelf = user.id === selfId;
              const canAct = !user.pinned && !isSelf && !user.deletedAt;
              return (
                <TableRow
                  key={user.id}
                  className={adminRowClickable}
                  onClick={() => navigate(`/admin/users/${user.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar
                        name={user.name || user.email}
                        picture={user.picture ?? null}
                        size={24}
                      />
                      <Link
                        to={`/admin/users/${user.id}`}
                        className="min-w-0 truncate font-medium hover:underline"
                      >
                        {user.deletedAt ? "Deleted user" : user.name || user.email}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-60 truncate">{user.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
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
                    </div>
                  </TableCell>
                  <TableCell>
                    {user.deletedAt ? (
                      <Pill tone="neutral">Deleted user</Pill>
                    ) : (
                      <Pill tone={statusTone[user.status]}>{user.status}</Pill>
                    )}
                  </TableCell>
                  <TableCell>{formatWhen(user.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      {actionMutation.error ? (
                        <p
                          role="alert"
                          className="text-err"
                        >{`could not ${actionMutation.variables.action} this user`}</p>
                      ) : null}
                      {canAct && user.status === "pending" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionMutation.isPending}
                          onClick={(event) => {
                            event.stopPropagation();
                            void actionMutation.mutate({
                              id: user.id,
                              action: "approve",
                            });
                          }}
                        >
                          Approve
                        </Button>
                      ) : null}
                      {canAct && user.role === "user" && user.status === "active" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionMutation.isPending}
                          onClick={(event) => {
                            event.stopPropagation();
                            void actionMutation.mutate({
                              id: user.id,
                              action: "promote",
                            });
                          }}
                        >
                          Promote
                        </Button>
                      ) : null}
                      {canAct && user.role === "admin" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionMutation.isPending}
                          onClick={(event) => {
                            event.stopPropagation();
                            void actionMutation.mutate({
                              id: user.id,
                              action: "demote",
                            });
                          }}
                        >
                          Demote
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </AdminTable>
      )}

      {hasMore ? (
        <LoadMoreButton
          label="Load older"
          isLoading={loadingOlder}
          onClick={() => {
            const last = users[users.length - 1];
            if (last) setCursor({ createdAt: last.createdAt, id: last.id });
          }}
        />
      ) : null}
    </>
  );
}

