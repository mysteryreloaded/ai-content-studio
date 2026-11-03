// The Admin Audit page (issue #210): every recorded change, newest
// first, filterable by actor, target type, target, action and date, with
// a one-line summary that expands to a before/after diff.

import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AdminPageHeader } from "../components/admin/AdminPageHeader.js";
import { AdminTable, adminHeadCell } from "../components/admin/AdminTable.js";
import { EmptyState } from "../components/admin/EmptyState.js";
import { FilterBar } from "../components/admin/FilterBar.js";
import { FormField } from "../components/admin/FormField.js";
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
import { formatBytes, formatWhen } from "../lib/format.js";

interface AuditImage {
  key: string;
  hash: string;
  size: number;
}

interface AuditEntry {
  id: string;
  createdAt: string;
  actorType: string;
  actorName: string | null;
  targetType: string;
  targetId: string;
  targetName: string | null;
  action: string;
  before: unknown;
  after: unknown;
  images: AuditImage[] | null;
}

interface AuditResponse {
  entries: AuditEntry[];
  hasMore: boolean;
}

interface FilterState {
  actor: string;
  targetType: string;
  targetId: string;
  action: string;
  from: string;
  to: string;
}

const BLANK_FILTERS: FilterState = {
  actor: "",
  targetType: "",
  targetId: "",
  action: "",
  from: "",
  to: "",
};

const TARGET_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "model", label: "Model" },
  { value: "backend", label: "Backend" },
  { value: "user", label: "User" },
  { value: "site_settings", label: "Site settings" },
  { value: "generation", label: "Generation" },
  { value: "upload", label: "Upload" },
];

const TARGET_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TARGET_TYPE_OPTIONS.map((option) => [option.value, option.label]),
);

// The action keys actually recorded (grep for `action: "..."` under
// apps/server/src): a mix of snake_case, kebab-case and single words, not
// all matching issue #210's own action list verbatim.
const ACTION_OPTIONS = [
  "create",
  "update",
  "soft_delete",
  "admin-delete",
  "self-delete",
  "approve",
  "promote",
  "demote",
  "disable",
  "enable",
  "unblock",
  "caps",
  "pause",
  "resume",
  "remove",
  "import",
  "reorder",
  "upload_workflow",
  "update_inputs",
  "update_modes",
  "update_terms",
  "update-terms",
  "update-blocked-words",
  "update-caps",
  "update-notice",
  "update-privacy",
  "attach_backend",
  "detach_backend",
  "restore_revision",
  "admin-emails-sync",
  "tampered",
];

const ACTION_LABELS: Record<string, string> = {
  soft_delete: "deleted",
  "admin-delete": "deleted",
  "self-delete": "deleted their account",
  attach_backend: "attached a Backend",
  detach_backend: "detached a Backend",
  pause: "paused generating",
  resume: "resumed generating",
  upload_workflow: "uploaded a Workflow",
  restore_revision: "restored a revision",
  caps: "updated caps",
  // Terms are updated on both a Model (`update_terms`) and Site settings
  // (`update-terms`, the hyphenated spelling site-settings-store.ts uses).
  update_terms: "updated terms",
  "update-terms": "updated terms",
  "update-caps": "updated default caps",
  "update-blocked-words": "updated blocked words",
  "update-notice": "updated the pause notice",
  "update-privacy": "updated the Privacy page",
  "admin-emails-sync": "synced admin access",
};

/** A readable verb for an action key, per issue #210's agreed mapping. */
function actionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  if (action.includes("_") || action.includes("-")) {
    return action.replace(/[_-]/g, " ");
  }
  if (action.endsWith("ed")) return action;
  if (action.endsWith("e")) return `${action}d`;
  return `${action}ed`;
}

function actorLabel(
  entry: Pick<AuditEntry, "actorType" | "actorName">,
): string {
  if (entry.actorType === "system") return "System";
  return entry.actorName ?? "Deleted user";
}

function targetTypeLabel(targetType: string): string {
  return TARGET_TYPE_LABELS[targetType] ?? targetType;
}

/** "User Bob", "Backend 3f9a1c2e", "Site settings" alone for the singleton. */
function targetLabel(
  entry: Pick<AuditEntry, "targetType" | "targetId" | "targetName">,
): string {
  if (entry.targetType === "site_settings") return "Site settings";
  const typeLabel = targetTypeLabel(entry.targetType);
  if (entry.targetName) return `${typeLabel} ${entry.targetName}`;
  return `${typeLabel} ${entry.targetId.slice(0, 8)}`;
}

function targetHref(
  entry: Pick<AuditEntry, "targetType" | "targetId">,
): string | null {
  switch (entry.targetType) {
    case "model":
      return `/admin/models/${entry.targetId}`;
    case "backend":
      return "/admin/backends";
    case "user":
      return `/admin/users/${entry.targetId}`;
    case "generation":
      return `/admin/generations/${entry.targetId}`;
    case "site_settings":
      return "/admin/settings";
    default:
      return null;
  }
}

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in local time; the server's filter is an ISO string. */
function isoToLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function filtersFromParams(params: URLSearchParams): FilterState {
  return {
    actor: params.get("actor") ?? "",
    targetType: params.get("targetType") ?? "",
    targetId: params.get("targetId") ?? "",
    action: params.get("action") ?? "",
    from: isoToLocalInputValue(params.get("from") ?? ""),
    to: isoToLocalInputValue(params.get("to") ?? ""),
  };
}

function queryParamsFrom(filters: FilterState): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    if (key === "from" || key === "to") {
      // A bad or partial datetime-local value must never break the page:
      // skip it rather than let toISOString() throw.
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) continue;
      params[key] = date.toISOString();
    } else {
      params[key] = value;
    }
  }
  return params;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "–";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

interface DiffRow {
  field: string;
  before: string;
  after: string;
  changed: boolean;
}

/** A readable diff computed from the entry's before/after snapshots, not stored. */
function diffRows(before: unknown, after: unknown): DiffRow[] {
  const beforeObj =
    before && typeof before === "object"
      ? (before as Record<string, unknown>)
      : {};
  const afterObj =
    after && typeof after === "object"
      ? (after as Record<string, unknown>)
      : {};
  const keys = Array.from(
    new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]),
  ).sort();

  return keys.map((field) => {
    const beforeText = formatValue(beforeObj[field]);
    const afterText = formatValue(afterObj[field]);
    return {
      field,
      before: beforeText,
      after: afterText,
      changed: beforeText !== afterText,
    };
  });
}

function EntryDiff({ entry }: { entry: AuditEntry }) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const rows = diffRows(entry.before, entry.after);
  const changedRows = rows.filter((row) => row.changed);
  const unchangedRows = rows.filter((row) => !row.changed);
  const visibleRows = showUnchanged ? rows : changedRows;
  const hasImages = entry.images && entry.images.length > 0;

  if (rows.length === 0 && !hasImages) {
    return <EmptyState>No fields recorded.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-2">
      {visibleRows.length > 0 && (
        <AdminTable>
          <TableHeader>
            <TableRow>
              <TableHead className={adminHeadCell}>Field</TableHead>
              <TableHead className={adminHeadCell}>Before</TableHead>
              <TableHead className={adminHeadCell}>After</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow key={row.field}>
                <TableCell>{row.field}</TableCell>
                <TableCell
                  className={cn(
                    "font-mono text-[12.5px] break-all whitespace-pre-wrap",
                    row.changed && "bg-err-soft",
                  )}
                >
                  {row.before}
                </TableCell>
                <TableCell
                  className={cn(
                    "font-mono text-[12.5px] break-all whitespace-pre-wrap",
                    row.changed && "bg-ok-soft",
                  )}
                >
                  {row.changed ? row.after : row.before}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </AdminTable>
      )}
      {!showUnchanged && unchangedRows.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowUnchanged(true)}
          className="self-start"
        >
          Show {unchangedRows.length} unchanged fields
        </Button>
      )}
      {hasImages && (
        <ul className="flex flex-col gap-1">
          {entry.images?.map((image) => (
            <li key={image.key} className="font-mono text-[12.5px] break-all">
              {image.key} · {image.hash.slice(0, 12)} ·{" "}
              {formatBytes(image.size)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  const href = targetHref(entry);

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start gap-2 border-b border-border px-2.5 py-[7px] text-left text-[13px] last:border-b-0 hover:bg-muted"
      >
        <ChevronRight
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 break-words">
          {actorLabel(entry)} · {actionLabel(entry.action)} ·{" "}
          {targetLabel(entry)}
        </span>
        <span className="shrink-0 text-[12.5px] text-muted-foreground tabular-nums">
          {formatWhen(entry.createdAt)}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 border-b border-border bg-background px-3 py-2.5 last:border-b-0">
          {href && (
            <Link
              to={href}
              className="self-start text-primary underline-offset-4 hover:underline"
            >
              View {targetTypeLabel(entry.targetType)}
            </Link>
          )}
          <EntryDiff entry={entry} />
        </div>
      )}
    </div>
  );
}

/** The Admin Audit page: every recorded change, newest first, with filters and a diff (issue #210). */
export function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // The URL is the source of truth for the applied filters, so Back/
  // Forward and the nav "Audit" link (which clears the query string)
  // re-fetch instead of leaving the page showing a stale, filtered list.
  const appliedKey = searchParams.toString();
  const applied = filtersFromParams(searchParams);
  const [draft, setDraft] = useState<FilterState>(applied);
  const [olderEntries, setOlderEntries] = useState<AuditEntry[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: applied is derived from appliedKey, the actual dependency
  useEffect(() => {
    setDraft(applied);
  }, [appliedKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: appliedKey is the actual dependency
  useEffect(() => {
    setOlderEntries([]);
    setOlderHasMore(null);
    setLoadMoreError(null);
  }, [appliedKey]);

  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin-audit", appliedKey],
    queryFn: () =>
      ok<AuditResponse>(
        api.api.admin.audit.$get({ query: queryParamsFrom(applied) }),
      ),
  });

  const entries = [...(data?.entries ?? []), ...olderEntries];
  const hasMore = olderHasMore ?? data?.hasMore ?? false;

  function loadMore() {
    const last = entries[entries.length - 1];
    if (!last) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    ok<AuditResponse>(
      api.api.admin.audit.$get({
        query: {
          ...queryParamsFrom(applied),
          beforeCreatedAt: last.createdAt,
          beforeId: last.id,
        },
      }),
    )
      .then((body) => {
        setOlderEntries((current) => [...current, ...body.entries]);
        setOlderHasMore(body.hasMore);
      })
      .catch(() => setLoadMoreError("could not load older Audit entries"))
      .finally(() => setLoadingMore(false));
  }

  function applyFilters() {
    setSearchParams(queryParamsFrom(draft));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    applyFilters();
  }

  function handleClear() {
    setDraft(BLANK_FILTERS);
    setSearchParams({});
  }

  const historyTargetId = searchParams.get("targetId");
  const historyTargetType = searchParams.get("targetType");
  const historyEntry = entries.find(
    (entry) =>
      entry.targetId === historyTargetId &&
      entry.targetType === historyTargetType,
  );

  return (
    <div className="flex flex-col gap-sections">
      <AdminPageHeader
        title="Audit"
        description="Every change Admins (or the system) made, newest first. Kept forever."
      />

      {historyTargetId && historyTargetType && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-[11px] py-[9px] text-muted-foreground">
          <span>
            Showing History for{" "}
            {historyEntry
              ? targetLabel(historyEntry)
              : `${targetTypeLabel(historyTargetType)} ${historyTargetId.slice(0, 8)}`}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
            Show everything
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <FilterBar
          onClear={handleClear}
          onApply={applyFilters}
          onRefresh={() => refetch()}
        >
          <FormField label="Actor" htmlFor="audit-actor">
            <Input
              id="audit-actor"
              placeholder="Admin email, user id, or system"
              value={draft.actor}
              onChange={(event) =>
                setDraft({ ...draft, actor: event.target.value })
              }
            />
          </FormField>

          <FormField label="Target type" htmlFor="audit-target-type">
            <Select
              value={draft.targetType || "any"}
              onValueChange={(value) =>
                setDraft({ ...draft, targetType: value === "any" ? "" : value })
              }
            >
              <SelectTrigger id="audit-target-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                {TARGET_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Target" htmlFor="audit-target-id">
            <Input
              id="audit-target-id"
              className="font-mono"
              placeholder="Target id"
              value={draft.targetId}
              onChange={(event) =>
                setDraft({ ...draft, targetId: event.target.value })
              }
            />
          </FormField>

          <FormField label="Action" htmlFor="audit-action">
            <Input
              id="audit-action"
              list="audit-action-options"
              value={draft.action}
              onChange={(event) =>
                setDraft({ ...draft, action: event.target.value })
              }
            />
            <datalist id="audit-action-options">
              {ACTION_OPTIONS.map((action) => (
                <option key={action} value={action} />
              ))}
            </datalist>
          </FormField>

          <FormField label="From" htmlFor="audit-from">
            <Input
              id="audit-from"
              type="datetime-local"
              value={draft.from}
              onChange={(event) =>
                setDraft({ ...draft, from: event.target.value })
              }
            />
          </FormField>

          <FormField label="To" htmlFor="audit-to">
            <Input
              id="audit-to"
              type="datetime-local"
              value={draft.to}
              onChange={(event) =>
                setDraft({ ...draft, to: event.target.value })
              }
            />
          </FormField>
        </FilterBar>
      </form>

      {isError && (
        <LoadError
          message="could not load the Audit trail"
          onRetry={() => refetch()}
        />
      )}
      {loadMoreError && (
        <LoadError message={loadMoreError} onRetry={loadMore} />
      )}

      {isPending && <p className="text-muted-foreground">Loading…</p>}

      {!isPending && !isError && entries.length === 0 && (
        <EmptyState>No Audit entries match these filters.</EmptyState>
      )}

      {entries.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {hasMore && (
        <LoadMoreButton
          label="Load older"
          isLoading={loadingMore || isFetching}
          onClick={loadMore}
        />
      )}
    </div>
  );
}
