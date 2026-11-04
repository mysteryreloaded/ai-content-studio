import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
import { Pill } from "../../../components/ui/pill.js";
import { formatWhen } from "../../../lib/format.js";
import type { ModelDetail, RevisionSummary } from "../types.js";
import { Section } from "../ui/Section.js";
import type { ModelEditor } from "../useModelEditor.js";

/** "revision 7 · 22 Oct 21:57 · Workflow, Modes changed" (issue #259): the API's `RevisionSummary` only carries `workflowHash`/`modeCount`/`inputCount`, so the author and a real "Inputs changed" can't be shown yet — left out until the API provides them. */
function changeSummary(
  revision: RevisionSummary,
  olderRevision: RevisionSummary | undefined,
): string | null {
  if (!olderRevision) return null;
  return revision.workflowHash !== olderRevision.workflowHash
    ? "Workflow changed"
    : null;
}

function RestoreDialog({
  revisionNumber,
  open,
  onOpenChange,
  dirty,
  onConfirm,
}: {
  revisionNumber: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dirty: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore revision {revisionNumber}?</DialogTitle>
          {dirty && (
            <p className="text-err">Your unsaved changes will be discarded.</p>
          )}
          <DialogDescription>
            This saves revision {revisionNumber}'s Workflow, Inputs and Modes as
            a new revision.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {dirty ? "Discard and restore" : "Restore"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevisionRow({
  revision,
  olderRevision,
  isCurrent,
  modelId,
  anyDraftDirty,
  restoringRevision,
  restoreError,
  modelEnabled,
  onRestore,
}: {
  revision: RevisionSummary;
  olderRevision: RevisionSummary | undefined;
  isCurrent: boolean;
  modelId: string;
  anyDraftDirty: boolean;
  restoringRevision: number | null;
  restoreError: string | undefined;
  modelEnabled: boolean;
  onRestore: (revisionNumber: number, disable: boolean) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const change = changeSummary(revision, olderRevision);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-2 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">
            revision {revision.revisionNumber}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            {formatWhen(revision.createdAt)}
          </span>
          {change && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{change}</span>
            </>
          )}
          {isCurrent && <Pill tone="accent">current</Pill>}
        </div>
        <p className="text-muted-foreground">
          {revision.modeCount} Mode{revision.modeCount === 1 ? "" : "s"} ·{" "}
          {revision.inputCount} Input{revision.inputCount === 1 ? "" : "s"}
        </p>
        {restoreError && (
          <div className="flex flex-col gap-1">
            <p role="alert" className="text-err">
              {restoreError}
            </p>
            {modelEnabled && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-fit border border-[color-mix(in_srgb,var(--warn)_45%,var(--line))] text-warn hover:bg-warn-soft"
                disabled={restoringRevision !== null}
                onClick={() => onRestore(revision.revisionNumber, true)}
              >
                Restore and disable
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="ghost" size="sm" asChild>
          <a
            href={`/api/admin/models/${modelId}/revisions/${revision.revisionNumber}/export`}
          >
            Export
          </a>
        </Button>
        {!isCurrent && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={restoringRevision !== null}
            onClick={() => setConfirmOpen(true)}
          >
            Restore
          </Button>
        )}
      </div>
      <RestoreDialog
        revisionNumber={revision.revisionNumber}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        dirty={anyDraftDirty}
        onConfirm={() => onRestore(revision.revisionNumber, false)}
      />
    </div>
  );
}

export function RevisionsSection({
  editor,
  detail,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const {
    anyDraftDirty,
    handleRestoreRevision,
    restoreErrors,
    restoringRevision,
    revisions,
    revisionsLoadError,
  } = editor;

  return (
    <Section
      title="Revisions"
      sub="Every saved version of this Model, newest first. Test runs aren't listed."
    >
      {revisionsLoadError && <p className="text-err">{revisionsLoadError}</p>}
      {revisions && revisions.length === 0 && (
        <p className="text-muted-foreground">No revisions yet.</p>
      )}
      {revisions && revisions.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {revisions.map((revision, index) => (
            <RevisionRow
              key={revision.revisionNumber}
              revision={revision}
              olderRevision={revisions[index + 1]}
              isCurrent={
                revision.revisionNumber === detail.model.currentRevision
              }
              modelId={detail.model.id}
              anyDraftDirty={anyDraftDirty}
              restoringRevision={restoringRevision}
              restoreError={restoreErrors[revision.revisionNumber]}
              modelEnabled={detail.model.state === "enabled"}
              onRestore={(revisionNumber, disable) =>
                void handleRestoreRevision(revisionNumber, disable)
              }
            />
          ))}
        </div>
      )}

      <Link
        to={`/admin/audit?targetType=model&targetId=${detail.model.id}`}
        className="text-primary underline"
      >
        See who changed what in History
      </Link>
    </Section>
  );
}
