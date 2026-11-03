// A Generation's own detail, for an Admin (issue #68, restyled for
// #209): read-only, plus Remove with a required reason. Unlike the
// owner's detail dialog, this never offers Reuse, and keeps the
// values/prompt/Upload links visible even once it's been removed (only
// a Tombstone empties them).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AdminPageHeader } from "../components/admin/AdminPageHeader.js";
import { AdminSection } from "../components/admin/AdminSection.js";
import {
  GenerationStatePill,
  TestPill,
} from "../components/admin/GenerationStatePill.js";
import { HistoryLink } from "../components/admin/HistoryLink.js";
import { LoadError } from "../components/admin/LoadError.js";
import { RemoveDialog } from "../components/admin/RemoveDialog.js";
import {
  type GenerationDetail,
  GenerationMediaPanel,
  GenerationSettingsGroups,
  runTime,
} from "../components/generations/GenerationDetailBody.js";
import { Button } from "../components/ui/button.js";
import { api, ok } from "../lib/api.js";
import { formatWhen } from "../lib/format.js";

interface AdminGenerationDetail extends GenerationDetail {
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  removedReason: string | null;
  isTest: boolean;
}

function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/** The Admin Generations page's read-only detail (issue #68). */
export function AdminGenerationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [removeOpen, setRemoveOpen] = useState(false);
  const queryKey = ["admin", "generation", id];

  const {
    data: detail,
    error,
    refetch,
  } = useQuery<AdminGenerationDetail>({
    queryKey,
    enabled: !!id,
    queryFn: () =>
      ok<AdminGenerationDetail>(
        api.api.admin.generations[":id"].$get({ param: { id: id as string } }),
      ),
  });

  const removeMutation = useMutation({
    mutationFn: (reason: string) =>
      ok<AdminGenerationDetail>(
        api.api.admin.generations[":id"].remove.$post({
          param: { id: id as string },
          json: { reason },
        }),
      ),
    onSuccess: (body) => {
      queryClient.setQueryData(queryKey, body);
      setRemoveOpen(false);
    },
  });

  if (error) {
    return (
      <LoadError
        message="could not load this Generation"
        onRetry={() => void refetch()}
      />
    );
  }
  if (!detail) return <p>Loading…</p>;

  const canRemove = !detail.deletedAt && !detail.removedAt;

  return (
    <div className="flex flex-col gap-sections">
      <AdminPageHeader
        crumb={
          <Link
            to="/admin/generations"
            className="underline-offset-4 hover:underline"
          >
            Admin / Generations
          </Link>
        }
        title={`${detail.modelName} · ${detail.modeName}`}
        pills={
          <>
            <GenerationStatePill
              state={detail.state}
              deletedAt={detail.deletedAt}
              removedAt={detail.removedAt}
            />
            {detail.isTest && <TestPill />}
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/logs?generationId=${detail.id}`}>
                Log entries
              </Link>
            </Button>
            <HistoryLink targetType="generation" targetId={detail.id} />
            {canRemove && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => setRemoveOpen(true)}
              >
                Remove…
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-3">
          {detail.deletedAt ? (
            <p className="rounded-md bg-muted px-[11px] py-[9px] text-muted-foreground">
              This Generation was deleted by its owner; nothing is left to show.
            </p>
          ) : detail.removedAt ? (
            <div
              role="alert"
              className="rounded-r-md border border-l-[3px] border-border border-l-err bg-card px-3 py-[9px] text-err"
            >
              Removed {formatWhen(detail.removedAt)} — {detail.removedReason}
            </div>
          ) : (
            <GenerationMediaPanel detail={detail} />
          )}

          {!detail.deletedAt && detail.settings.length > 0 && (
            <AdminSection title="Settings">
              <GenerationSettingsGroups detail={detail} />
            </AdminSection>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-[13px]">
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3.5 gap-y-2">
            <dt className="text-muted-foreground">Owner</dt>
            <dd className="min-w-0">
              <Link
                to={`/admin/users/${detail.ownerId}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {detail.ownerName}
              </Link>{" "}
              <span className="text-muted-foreground">{detail.ownerEmail}</span>
            </dd>
            <dt className="text-muted-foreground">Model</dt>
            <dd className="min-w-0">
              {detail.modelDeleted ? (
                detail.modelName
              ) : (
                <Link
                  to={`/admin/models/${detail.modelId}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {detail.modelName}
                </Link>
              )}
            </dd>
            <dt className="text-muted-foreground">Mode</dt>
            <dd className="min-w-0">{detail.modeName}</dd>
            {detail.modelAttribution && (
              <>
                <dt className="text-muted-foreground">Attribution</dt>
                <dd className="min-w-0">{detail.modelAttribution}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Submitted</dt>
            <dd className="min-w-0">{formatWhen(detail.submittedAt)}</dd>
            {runTime(detail.startedAt, detail.endedAt) && (
              <>
                <dt className="text-muted-foreground">Run time</dt>
                <dd className="min-w-0">
                  {runTime(detail.startedAt, detail.endedAt)}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Tries</dt>
            <dd className="min-w-0 tabular-nums">{detail.tries}</dd>
            <dt className="text-muted-foreground">Id</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <span className="font-mono text-[12.5px] [overflow-wrap:anywhere]">
                {detail.id}
              </span>
            </dd>
          </dl>
          <CopyIdButton id={detail.id} />
        </div>
      </div>

      <RemoveDialog
        kind="Generation"
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        onRemove={async (reason) => {
          await removeMutation.mutateAsync(reason);
        }}
      />
    </div>
  );
}
