// The Generation detail dialog (issue #57, restyled for #199): opened at
// `/generations/<id>`, over the Gallery when the link is pasted, or over
// the Workbench via the background-location modal pattern (`main.tsx`).
// Shows the player, Download, facts, the Model/Mode/Attribution/times/id,
// the settings it ran with, and lets the owner reuse them on the
// Workbench, cancel it under way, or delete it once ended. A missing id
// or someone else's Generation both read as "not found" — the API itself
// 404s either way, so this dialog never learns which.

import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDelete } from "../components/generations/ConfirmDelete.js";
import {
  type GenerationDetail,
  GenerationMediaPanel,
  GenerationSettingsList,
} from "../components/generations/GenerationDetailBody.js";
import {
  CANCELLABLE_STATES,
  DONE_STATES,
} from "../components/generations/types.js";
import { Button } from "../components/ui/button.js";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog.js";
import { type ApiError, api, ok } from "../lib/api.js";
import { useEventStream } from "../lib/sse.js";
import { markOwnCancelGeneration } from "../notifications/ownCancel.js";

const IGNORE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "VIDEO", "AUDIO"]);

/** ← / → are ignored while a focused control (incl. a player seeking) or a modifier key would otherwise hijack them (issue #199's AC). */
function shouldIgnoreArrowKey(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return true;
  }
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (IGNORE_TAGS.has(target.tagName)) return true;
  return target.isContentEditable;
}

export function GenerationDetailOverlay({
  id,
  prevId,
  nextId,
  onClose,
  onNavigate,
  onDeleted,
  onDismissed,
}: {
  id: string;
  prevId: string | null;
  nextId: string | null;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onDeleted: (id: string) => void;
  onDismissed?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const queryKey = ["generation", id];

  const { data: detail, error } = useQuery<GenerationDetail, ApiError>({
    queryKey,
    queryFn: () =>
      ok<GenerationDetail>(api.api.generations[":id"].$get({ param: { id } })),
  });
  const notFound = !!error;

  // `useEventStream` binds its handlers once per mount of the shared
  // `/api/generations/stream` connection (`sse.ts`) — this component
  // itself is never remounted on ←/→ (same dialog, new `id` prop), so a
  // handler closing directly over `id` would keep checking the id this
  // dialog opened with. Read the current id through a ref instead.
  const idRef = useRef(id);
  idRef.current = id;

  useEventStream("/api/generations/stream", {
    change: (queryClient, data) => {
      const changedId = (data as { id: string }).id;
      if (changedId === idRef.current) {
        void queryClient.invalidateQueries({
          queryKey: ["generation", changedId],
        });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => ok(api.api.generations[":id"].$delete({ param: { id } })),
    onSuccess: () => {
      onDeleted(id);
      onClose();
    },
  });

  const dismissMutation = useMutation({
    mutationFn: () =>
      ok(
        api.api.generations[":id"]["dismiss-removed"].$post({
          param: { id },
        }),
      ),
    onSuccess: () => {
      onDismissed?.(id);
      onClose();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      ok(api.api.generations[":id"].cancel.$post({ param: { id } })),
    onSuccess: () => markOwnCancelGeneration(id),
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreArrowKey(event)) return;
      if (event.key === "ArrowLeft" && prevId) onNavigate(prevId);
      else if (event.key === "ArrowRight" && nextId) onNavigate(nextId);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [prevId, nextId, onNavigate]);

  const ended = !!detail && DONE_STATES.has(detail.state);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100vh-48px)] w-full flex-col gap-0 rounded-2xl border border-border bg-card p-0 shadow-md sm:max-w-[980px] max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0"
      >
        <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <DialogTitle className="min-w-0 flex-1 truncate font-heading text-lg">
            {detail ? (
              <>
                {detail.modeName}{" "}
                <span className="text-muted-foreground">
                  · {detail.modelName}
                </span>
              </>
            ) : (
              "Generation"
            )}
          </DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Previous Generation"
            disabled={!prevId}
            onClick={() => prevId && onNavigate(prevId)}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Next Generation"
            disabled={!nextId}
            onClick={() => nextId && onNavigate(nextId)}
          >
            <ChevronRight />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={onClose}
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 overflow-y-auto p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          {notFound && <p role="alert">Not found.</p>}
          {!notFound && !detail && <p>Loading…</p>}

          {detail?.deletedAt && <p>Deleted.</p>}

          {detail && !detail.deletedAt && detail.removedAt && (
            <div className="flex flex-col gap-2">
              <p role="alert">Removed by an administrator.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={dismissMutation.isPending}
                onClick={() => dismissMutation.mutate()}
              >
                Dismiss
              </Button>
              {dismissMutation.isError && (
                <p role="alert">Could not dismiss this card.</p>
              )}
            </div>
          )}

          {detail && !detail.deletedAt && !detail.removedAt && (
            <div className="grid grid-cols-1 gap-[18px] min-[1100px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-3">
                <GenerationMediaPanel detail={detail} />
              </div>
              <div className="flex flex-col gap-3">
                <GenerationSettingsList detail={detail} />
                <div className="flex flex-wrap items-center gap-2">
                  {ended && !detail.modelDeleted && (
                    <Button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/models/${detail.modelSlug}?reuse=${detail.id}`,
                        )
                      }
                    >
                      <RotateCcw />
                      Reuse these settings
                    </Button>
                  )}
                  {CANCELLABLE_STATES.has(detail.state) && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate()}
                    >
                      Cancel
                    </Button>
                  )}
                  {ended && (
                    <ConfirmDelete
                      label="Delete this Generation"
                      small={false}
                      pending={deleteMutation.isPending}
                      onConfirm={() => deleteMutation.mutate()}
                    />
                  )}
                </div>
                {deleteMutation.isError && (
                  <p role="alert">Could not delete this Generation.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
