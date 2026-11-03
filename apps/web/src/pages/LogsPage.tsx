// The Admin Logs page (issue #210): Errors, warnings and notices from
// the studio and its Backends, newest first, filterable and filtered by
// the URL so links from the Backends page, the Overview and a
// Generation's detail open it filtered.

import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AdminPageHeader } from "../components/admin/AdminPageHeader.js";
import { EmptyState } from "../components/admin/EmptyState.js";
import { FilterBar } from "../components/admin/FilterBar.js";
import { FormField } from "../components/admin/FormField.js";
import { LoadError } from "../components/admin/LoadError.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Pill } from "../components/ui/pill.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group.js";
import { api, ok } from "../lib/api.js";
import { formatWhen } from "../lib/format.js";

type LogLevel = "error" | "warning" | "info";
type LogSource = "backend" | "app";

interface LogEntry {
  id: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  details: string | null;
  backendId: string | null;
  backendName: string | null;
  userId: string | null;
  userEmail: string | null;
  modelId: string | null;
  generationId: string | null;
  createdAt: string;
}

interface LogsResponse {
  entries: LogEntry[];
}

interface AdminBackendOption {
  id: string;
  name: string;
}

interface AdminModelOption {
  id: string;
  name: string;
}

interface AdminUser {
  id: string;
  name: string;
}

interface FilterState {
  level: LogLevel | "";
  source: LogSource | "";
  backendId: string;
  modelId: string;
  userId: string;
  generationId: string;
  from: string;
  to: string;
  q: string;
}

const BLANK_FILTERS: FilterState = {
  level: "",
  source: "",
  backendId: "",
  modelId: "",
  userId: "",
  generationId: "",
  from: "",
  to: "",
  q: "",
};

const LEVEL_TONE = {
  error: "err",
  warning: "warn",
  info: "neutral",
} as const;

const LEVEL_ICON = {
  error: TriangleAlert,
  warning: CircleAlert,
  info: Info,
} as const;

const LEVEL_LABEL: Record<LogLevel, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

function LevelPill({ level }: { level: LogLevel }) {
  const Icon = LEVEL_ICON[level];
  return (
    <Pill tone={LEVEL_TONE[level]} className="shrink-0">
      <Icon className="size-3" />
      {LEVEL_LABEL[level]}
    </Pill>
  );
}

function sourceLabel(entry: Pick<LogEntry, "source" | "backendName">): string {
  return entry.source === "app" ? "App" : (entry.backendName ?? "Backend");
}

function isoToLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function filtersFromParams(params: URLSearchParams): FilterState {
  const level = params.get("level") ?? "";
  const source = params.get("source") ?? "";
  return {
    level:
      level === "error" || level === "warning" || level === "info" ? level : "",
    source: source === "backend" || source === "app" ? source : "",
    backendId: params.get("backendId") ?? "",
    modelId: params.get("modelId") ?? "",
    userId: params.get("userId") ?? "",
    generationId: params.get("generationId") ?? "",
    from: isoToLocalInputValue(params.get("from") ?? ""),
    to: isoToLocalInputValue(params.get("to") ?? ""),
    q: params.get("q") ?? "",
  };
}

function queryParamsFrom(filters: FilterState): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    if (key === "from" || key === "to") {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) continue;
      params[key] = date.toISOString();
    } else {
      params[key] = value;
    }
  }
  return params;
}

const DEFAULT_LIMIT = 100;

function EntryRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-start gap-2 border-b border-border px-2.5 py-[7px] text-left text-[13px] last:border-b-0 hover:bg-muted"
      >
        <LevelPill level={entry.level} />
        <span className="w-24 shrink-0 truncate text-muted-foreground">
          {sourceLabel(entry)}
        </span>
        <span className={cn("min-w-0 flex-1", !expanded && "truncate")}>
          {entry.message}
        </span>
        <span className="shrink-0 text-[12.5px] text-muted-foreground tabular-nums">
          {formatWhen(entry.createdAt)}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 border-b border-border bg-background px-3 py-2.5 last:border-b-0">
          {entry.details ? (
            <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-[12.5px] whitespace-pre-wrap break-all">
              {entry.details}
            </pre>
          ) : (
            <p className="text-muted-foreground">No details.</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {entry.generationId && (
              <Link
                to={`/admin/generations/${entry.generationId}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Generation
              </Link>
            )}
            {entry.modelId && (
              <Link
                to={`/admin/models/${entry.modelId}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Model
              </Link>
            )}
            {entry.backendId && (
              <Link
                to="/admin/backends"
                className="text-primary underline-offset-4 hover:underline"
              >
                Backend
              </Link>
            )}
            {entry.userId && (
              <Link
                to={`/admin/users/${entry.userId}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                User
              </Link>
            )}
            {entry.userEmail && (
              <span className="text-muted-foreground">{entry.userEmail}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The admin Logs page: filters in the URL, level pills, expandable rows with links (issue #210). */
export function LogsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedKey = searchParams.toString();
  const applied = filtersFromParams(searchParams);
  const [draft, setDraft] = useState<FilterState>(applied);

  // biome-ignore lint/correctness/useExhaustiveDependencies: applied is derived from appliedKey, the actual dependency
  useEffect(() => {
    setDraft(applied);
  }, [appliedKey]);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["admin-logs", appliedKey],
    queryFn: () =>
      ok<LogsResponse>(
        api.api.admin.logs.$get({ query: queryParamsFrom(applied) }),
      ),
  });

  const { data: backendOptions } = useQuery({
    queryKey: ["admin-logs-backends"],
    queryFn: () =>
      ok<{ backends: AdminBackendOption[] }>(api.api.admin.backends.$get()),
  });

  const { data: modelOptions } = useQuery({
    queryKey: ["admin-logs-models"],
    queryFn: () =>
      ok<{ models: AdminModelOption[] }>(api.api.admin.models.$get()),
  });

  const { data: filterUser } = useQuery({
    queryKey: ["admin-logs-user", draft.userId],
    enabled: draft.userId.length > 0,
    queryFn: async () => {
      const res = await api.api.admin.users[":id"].$get({
        param: { id: draft.userId },
      });
      if (res.status === 404) return null;
      return ok<AdminUser>(res);
    },
  });

  const backends = backendOptions?.backends ?? [];
  const models = modelOptions?.models ?? [];

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

  const entries = data?.entries ?? [];
  const sourceValue =
    draft.source === "backend" ? draft.backendId : draft.source || "any";

  return (
    <div className="flex flex-col gap-sections">
      <AdminPageHeader
        title="Logs"
        description="Errors, warnings and notices from the studio and its Backends, newest first. Kept 30 days."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
          >
            Refresh
          </Button>
        }
      />

      <form onSubmit={handleSubmit}>
        <FilterBar onClear={handleClear} onApply={applyFilters}>
          <FormField label="Level" htmlFor="log-level-any">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={draft.level || "any"}
              onValueChange={(value) =>
                setDraft({
                  ...draft,
                  level: value === "any" || !value ? "" : (value as LogLevel),
                })
              }
            >
              <ToggleGroupItem id="log-level-any" value="any">
                Any
              </ToggleGroupItem>
              <ToggleGroupItem value="error">Error</ToggleGroupItem>
              <ToggleGroupItem value="warning">Warning</ToggleGroupItem>
              <ToggleGroupItem value="info">Info</ToggleGroupItem>
            </ToggleGroup>
          </FormField>

          <FormField label="Source" htmlFor="log-source">
            <Select
              value={sourceValue}
              onValueChange={(value) => {
                if (value === "any") {
                  setDraft({ ...draft, source: "", backendId: "" });
                } else if (value === "app") {
                  setDraft({ ...draft, source: "app", backendId: "" });
                } else {
                  setDraft({ ...draft, source: "backend", backendId: value });
                }
              }}
            >
              <SelectTrigger id="log-source" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any source</SelectItem>
                <SelectItem value="app">App</SelectItem>
                {backends.map((backend) => (
                  <SelectItem key={backend.id} value={backend.id}>
                    Backend: {backend.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Model" htmlFor="log-model">
            <Select
              value={draft.modelId || "any"}
              onValueChange={(value) =>
                setDraft({ ...draft, modelId: value === "any" ? "" : value })
              }
            >
              <SelectTrigger id="log-model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any Model</SelectItem>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="User" htmlFor="log-user">
            <div className="flex items-center gap-1.5">
              <Input
                id="log-user"
                className="font-mono"
                placeholder="User id"
                value={draft.userId}
                onChange={(event) =>
                  setDraft({ ...draft, userId: event.target.value })
                }
              />
              {draft.userId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Clear User"
                  onClick={() => setDraft({ ...draft, userId: "" })}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
            {draft.userId && (
              <p className="text-muted-foreground">
                {filterUser ? filterUser.name : "Deleted user"}
              </p>
            )}
          </FormField>

          <FormField label="Generation" htmlFor="log-generation">
            <div className="flex items-center gap-1.5">
              <Input
                id="log-generation"
                className="font-mono"
                placeholder="Generation id"
                value={draft.generationId}
                onChange={(event) =>
                  setDraft({ ...draft, generationId: event.target.value })
                }
              />
              {draft.generationId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Clear Generation"
                  onClick={() => setDraft({ ...draft, generationId: "" })}
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
            {draft.generationId && (
              <p className="text-muted-foreground">
                Generation {draft.generationId.slice(0, 8)}
              </p>
            )}
          </FormField>

          <FormField label="From" htmlFor="log-from">
            <Input
              id="log-from"
              type="datetime-local"
              value={draft.from}
              onChange={(event) =>
                setDraft({ ...draft, from: event.target.value })
              }
            />
          </FormField>

          <FormField label="To" htmlFor="log-to">
            <Input
              id="log-to"
              type="datetime-local"
              value={draft.to}
              onChange={(event) =>
                setDraft({ ...draft, to: event.target.value })
              }
            />
          </FormField>

          <FormField label="Text" htmlFor="log-text">
            <Input
              id="log-text"
              placeholder="Search message or details"
              value={draft.q}
              onChange={(event) =>
                setDraft({ ...draft, q: event.target.value })
              }
            />
          </FormField>
        </FilterBar>
      </form>

      {isError && (
        <LoadError
          message="could not load Log entries"
          onRetry={() => refetch()}
        />
      )}

      {isPending && <p className="text-muted-foreground">Loading…</p>}

      {!isPending && !isError && entries.length === 0 && (
        <EmptyState>No Log entries match these filters.</EmptyState>
      )}

      {entries.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {entries.length === DEFAULT_LIMIT && (
        <EmptyState>
          Showing the latest 100 entries. Narrow the filters to see older ones.
        </EmptyState>
      )}
    </div>
  );
}
