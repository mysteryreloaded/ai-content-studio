import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AdminPageHeader } from "../components/admin/AdminPageHeader.js";
import { AdminSection } from "../components/admin/AdminSection.js";
import { AdminTable, adminHeadCell } from "../components/admin/AdminTable.js";
import { AdminTabs, userSectionTabs } from "../components/admin/AdminTabs.js";
import { EmptyState } from "../components/admin/EmptyState.js";
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
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { api, ok } from "../lib/api.js";
import { formatWhen } from "../lib/format.js";

interface BlockedAccount {
  id: string;
  userId: string;
  disabledAt: string | null;
  reason: string | null;
  /** When the entry was created (the Admin delete that blocked the account). */
  createdAt: string;
}

interface BlockedAccountsResponse {
  blockedAccounts: BlockedAccount[];
}

/** The original page's explanation, kept as the section's description (issue #207). */
const DESCRIPTION =
  "A Google account an Admin deleted while it was disabled, kept here so it can't simply sign up again. Clearing an entry lets that account sign up as a brand-new user.";

/**
 * The blocked accounts of the Users section (issue #207): the Google
 * accounts an Admin delete blocked from signing up again, and clearing
 * one off the list. Users and Blocked accounts share the "Users" header
 * and its tabs; clearing asks first.
 */
export function BlockedAccountsPage() {
  const queryClient = useQueryClient();
  const [clearing, setClearing] = useState<BlockedAccount | null>(null);

  const listQuery = useQuery({
    queryKey: ["admin", "blocked-accounts"],
    queryFn: ({ signal }) =>
      ok<BlockedAccountsResponse>(
        api.api.admin["blocked-accounts"].$get({ init: { signal } }),
      ),
  });

  const clearMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      ok<{ ok: boolean }>(
        api.api.admin["blocked-accounts"][":id"].$delete({ param: { id } }),
      ),
    onSuccess: () => {
      setClearing(null);
      void queryClient.invalidateQueries({
        queryKey: ["admin", "blocked-accounts"],
      });
    },
  });

  const rows = listQuery.data?.blockedAccounts ?? [];

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
      <AdminSection title="Blocked accounts" description={DESCRIPTION}>
        {listQuery.isError && listQuery.data === undefined ? (
          <LoadError
            message="could not load the blocked accounts"
            onRetry={() => void listQuery.refetch()}
          />
        ) : listQuery.isPending ? (
          <p>Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState>No blocked accounts.</EmptyState>
        ) : (
          <AdminTable>
            <TableHeader>
              <TableRow>
                <TableHead className={adminHeadCell}>User</TableHead>
                <TableHead className={adminHeadCell}>Disabled</TableHead>
                <TableHead className={adminHeadCell}>Deleted</TableHead>
                <TableHead className={adminHeadCell}>Reason</TableHead>
                <TableHead className={adminHeadCell}>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-60 truncate font-mono text-xs">
                    <Link
                      to={`/admin/users/${row.userId}`}
                      className="hover:underline"
                    >
                      {row.userId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {row.disabledAt ? formatWhen(row.disabledAt) : "—"}
                  </TableCell>
                  <TableCell>{formatWhen(row.createdAt)}</TableCell>
                  <TableCell className="max-w-80">
                    {row.reason || "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setClearing(row)}
                    >
                      Clear
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </AdminTable>
        )}
      </AdminSection>

      <Dialog
        open={clearing !== null}
        onOpenChange={(open) => {
          if (!open) setClearing(null);
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Clear this block?</DialogTitle>
            <DialogDescription>
              That Google account can then sign up again as a brand-new user.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClearing(null)}>
              Cancel
            </Button>
            <Button
              disabled={clearMutation.isPending}
              onClick={() => {
                if (clearing) {
                  void clearMutation.mutate({ id: clearing.id });
                }
              }}
            >
              Clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
