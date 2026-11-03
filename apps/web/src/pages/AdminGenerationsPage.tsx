// The Admin Generations page (issue #68, restyled for #209): across
// every user, filterable by Model, Mode, user, state (including Deleted
// and Removed) and date, a jump-to box for a Generation or Asset id, and
// a read-only detail.

import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AdminPageHeader } from "../components/admin/AdminPageHeader.js";
import { AdminTable, adminHeadCell } from "../components/admin/AdminTable.js";
import { EmptyState } from "../components/admin/EmptyState.js";
import { FilterBar } from "../components/admin/FilterBar.js";
import { FormField } from "../components/admin/FormField.js";
import {
  GenerationStatePill,
  TestPill,
} from "../components/admin/GenerationStatePill.js";
import { LoadError } from "../components/admin/LoadError.js";
import { LoadMoreButton } from "../components/admin/LoadMoreButton.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { api, ok } from "../lib/api.js";
import { formatWhen } from "../lib/format.js";

interface AdminGenerationRow {
  id: string;
  modelId: string;
  modelName: string;
  modelSlug: string;
  modeId: string;
  modeName: string;
  userId: string;
  userEmail: string;
  userName: string;
  state:
    | "queued"
    | "starting"
    | "running"
    | "saving"
    | "succeeded"
    | "failed"
    | "cancelling"
    | "cancelled";
  isTest: boolean;
  deletedAt: string | null;
  removedAt: string | null;
  submittedAt: string;
  endedAt: string | null;
}

interface ListResponse {
  generations: AdminGenerationRow[];
  hasMore: boolean;
}

interface AdminModelOption {
  id: string;
  name: string;
}

interface AdminModeOption {
  id: string;
  name: string;
}

const STATE_OPTIONS: { value: string; label: string }[] = [
  { value: "queued", label: "Queued" },
  { value: "starting", label: "Starting" },
  { value: "running", label: "Running" },
  { value: "saving", label: "Saving" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "cancelling", label: "Cancelling" },
  { value: "cancelled", label: "Cancelled" },
  { value: "deleted", label: "Deleted" },
  { value: "removed", label: "Removed" },
];

function queryParams(filters: {
  modelId: string;
  modeId: string;
  userId: string;
  status: string;
  from: string;
  to: string;
  isTest: string;
  cursor?: { submittedAt: string; id: string };
}): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.modelId) params.model = filters.modelId;
  if (filters.modeId) params.mode = filters.modeId;
  if (filters.userId) params.user = filters.userId;
  if (filters.status) params.status = filters.status;
  if (filters.from) params.from = new Date(filters.from).toISOString();
  if (filters.to) params.to = new Date(filters.to).toISOString();
  if (filters.isTest) params.isTest = filters.isTest;
  if (filters.cursor) {
    params.beforeSubmittedAt = filters.cursor.submittedAt;
    params.beforeId = filters.cursor.id;
  }
  return params;
}

export function AdminGenerationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [jumpId, setJumpId] = useState("");
  const [jumpError, setJumpError] = useState<string | null>(null);
  const [olderRows, setOlderRows] = useState<AdminGenerationRow[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const modelId = searchParams.get("model") ?? "";
  const modeId = searchParams.get("mode") ?? "";
  const userId = searchParams.get("user") ?? "";
  const status = searchParams.get("status") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const isTest = searchParams.get("isTest") ?? "";
  const appliedKey = searchParams.toString();

  const { data: modelsData } = useQuery({
    queryKey: ["admin", "models"],
    queryFn: () =>
      ok<{ models: AdminModelOption[] }>(api.api.admin.models.$get()),
  });
  const models = modelsData?.models ?? [];

  const { data: modesData } = useQuery({
    queryKey: ["admin", "model", modelId, "modes"],
    enabled: !!modelId,
    queryFn: () =>
      ok<{ modes: AdminModeOption[] }>(
        api.api.admin.models[":id"].$get({ param: { id: modelId } }),
      ),
  });
  const modes = modelId ? (modesData?.modes ?? []) : [];

  const { data: userData } = useQuery({
    queryKey: ["admin", "user", userId],
    enabled: !!userId,
    queryFn: () =>
      ok<{ name: string }>(
        api.api.admin.users[":id"].$get({ param: { id: userId } }),
      ),
  });

  const {
    data: listData,
    error: listError,
    refetch,
  } = useQuery({
    queryKey: ["admin", "generations", appliedKey],
    queryFn: () =>
      ok<ListResponse>(
        api.api.admin.generations.$get({
          query: queryParams({
            modelId,
            modeId,
            userId,
            status,
            from,
            to,
            isTest,
          }),
        }),
      ),
  });

  const rows = [...(listData?.generations ?? []), ...olderRows];
  const hasMore = olderHasMore ?? listData?.hasMore ?? false;

  // biome-ignore lint/correctness/useExhaustiveDependencies: appliedKey is the actual dependency
  useEffect(() => {
    setOlderRows([]);
    setOlderHasMore(null);
    setLoadMoreError(null);
  }, [appliedKey]);

  function resetFilters(next: URLSearchParams) {
    setSearchParams(next);
  }

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "model") next.delete("mode");
    resetFilters(next);
  }

  function loadMore() {
    const last = rows[rows.length - 1];
    if (!last) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    ok<ListResponse>(
      api.api.admin.generations.$get({
        query: queryParams({
          modelId,
          modeId,
          userId,
          status,
          from,
          to,
          isTest,
          cursor: { submittedAt: last.submittedAt, id: last.id },
        }),
      }),
    )
      .then((body) => {
        setOlderRows((current) => [...current, ...body.generations]);
        setOlderHasMore(body.hasMore);
      })
      .catch(() => setLoadMoreError("could not load more"))
      .finally(() => setLoadingMore(false));
  }

  async function handleJump(event: FormEvent) {
    event.preventDefault();
    setJumpError(null);
    const id = jumpId.trim();
    if (!id) return;
    try {
      const body = await ok<{ generationId: string }>(
        api.api.admin.generations.resolve[":id"].$get({ param: { id } }),
      );
      navigate(`/admin/generations/${body.generationId}`);
    } catch {
      setJumpError("No Generation or Asset with that id.");
    }
  }

  return (
    <div className="flex flex-col gap-sections">
      <AdminPageHeader
        title="Generations"
        description="Every user's Generations, newest first. Removal needs a reason only Admins see."
      />

      <div className="rounded-xl border border-border bg-card px-3 py-2.5">
        <form
          className="flex flex-col gap-1"
          onSubmit={(event) => void handleJump(event)}
        >
          <FormField
            label="Jump to a Generation or Asset id"
            htmlFor="admin-generations-jump"
          >
            <div className="flex gap-2">
              <Input
                id="admin-generations-jump"
                className="font-mono"
                placeholder="Generation or Asset id"
                value={jumpId}
                onChange={(event) => setJumpId(event.target.value)}
              />
              <Button type="submit" variant="outline">
                Go
              </Button>
            </div>
          </FormField>
          {jumpError && <p className="text-err">{jumpError}</p>}
        </form>
      </div>

      <FilterBar onClear={() => resetFilters(new URLSearchParams())}>
        <FormField label="Model" htmlFor="admin-generations-model">
          <Select
            value={modelId || "all"}
            onValueChange={(value) =>
              setFilter("model", value === "all" ? "" : value)
            }
          >
            <SelectTrigger id="admin-generations-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Models</SelectItem>
              {models.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="Mode" htmlFor="admin-generations-mode">
          <Select
            value={modeId || "all"}
            disabled={!modelId}
            onValueChange={(value) =>
              setFilter("mode", value === "all" ? "" : value)
            }
          >
            <SelectTrigger id="admin-generations-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modes</SelectItem>
              {modes.map((mode) => (
                <SelectItem key={mode.id} value={mode.id}>
                  {mode.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="User id" htmlFor="admin-generations-user">
          {userId ? (
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between"
              onClick={() => setFilter("user", "")}
            >
              Filtered to {userData?.name ?? userId} ×
            </Button>
          ) : (
            <Input
              id="admin-generations-user"
              placeholder="User id"
              value={userId}
              onChange={(event) => setFilter("user", event.target.value)}
            />
          )}
        </FormField>

        <FormField label="State" htmlFor="admin-generations-status">
          <Select
            value={status || "all"}
            onValueChange={(value) =>
              setFilter("status", value === "all" ? "" : value)
            }
          >
            <SelectTrigger id="admin-generations-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {STATE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="From" htmlFor="admin-generations-from">
          <Input
            id="admin-generations-from"
            type="datetime-local"
            value={from}
            onChange={(event) => setFilter("from", event.target.value)}
          />
        </FormField>

        <FormField label="To" htmlFor="admin-generations-to">
          <Input
            id="admin-generations-to"
            type="datetime-local"
            value={to}
            onChange={(event) => setFilter("to", event.target.value)}
          />
        </FormField>
      </FilterBar>

      {listError && (
        <LoadError
          message="could not load Generations"
          onRetry={() => void refetch()}
        />
      )}
      {loadMoreError && (
        <LoadError message={loadMoreError} onRetry={loadMore} />
      )}

      {!listData && !listError && <p>Loading…</p>}

      {listData &&
        (rows.length === 0 ? (
          <EmptyState>No Generations match these filters.</EmptyState>
        ) : (
          <AdminTable>
            <TableHeader>
              <TableRow>
                <TableHead className={adminHeadCell}>Submitted</TableHead>
                <TableHead className={adminHeadCell}>User</TableHead>
                <TableHead className={adminHeadCell}>Model</TableHead>
                <TableHead className={adminHeadCell}>Mode</TableHead>
                <TableHead className={adminHeadCell}>State</TableHead>
                <TableHead className={adminHeadCell}>Ended</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted"
                  onClick={() => navigate(`/admin/generations/${row.id}`)}
                >
                  <TableCell>
                    <Link
                      to={`/admin/generations/${row.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {formatWhen(row.submittedAt)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/admin/users/${row.userId}`}
                      className="text-primary underline-offset-4 hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {row.userName}
                    </Link>
                  </TableCell>
                  <TableCell
                    className={
                      row.deletedAt
                        ? "text-muted-foreground line-through"
                        : undefined
                    }
                  >
                    {row.modelName}
                  </TableCell>
                  <TableCell
                    className={
                      row.deletedAt
                        ? "text-muted-foreground line-through"
                        : undefined
                    }
                  >
                    {row.modeName}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <GenerationStatePill
                        state={row.state}
                        deletedAt={row.deletedAt}
                        removedAt={row.removedAt}
                      />
                      {row.isTest && <TestPill />}
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.endedAt ? formatWhen(row.endedAt) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </AdminTable>
        ))}

      {hasMore && (
        <LoadMoreButton
          label="Load more"
          isLoading={loadingMore}
          onClick={loadMore}
        />
      )}
    </div>
  );
}
