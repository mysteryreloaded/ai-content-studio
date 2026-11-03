import { useState } from "react";
import { Link } from "react-router-dom";
import { StaleSaveAlert } from "../../../components/admin/StaleSaveAlert.js";
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
import type { EditorNavigation } from "../hooks/useEditorNavigation.js";
import type { ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";

/**
 * The sticky header (issue #213, prototype variant A `.va-head`): the
 * "Admin / Models" eyebrow link, the Model's name/state/revision, a
 * status text, and the one Export/Discard/Save.
 */
export function EditorHeader({
  editor,
  detail,
  nav,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
  nav: EditorNavigation;
}) {
  const { draft, mustDisableToSave } = editor;
  const enabled = detail.model.state === "enabled";
  const dirty = draft.anyDraftDirty;
  // Issue #241 CEO review: Reload (from the stale-save alert) must ask
  // "Discard unsaved changes?" first when there's something to lose,
  // same as leaving the page.
  const [confirmReloadOpen, setConfirmReloadOpen] = useState(false);

  async function handleSave() {
    const result = await draft.save(mustDisableToSave);
    if (!result.ok && result.invalidSection)
      nav.setSection(result.invalidSection);
  }

  function handleReloadClick() {
    if (dirty) {
      setConfirmReloadOpen(true);
      return;
    }
    void draft.reload();
  }

  return (
    <header className="sticky top-[var(--app-header-h)] z-20 flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2.5">
      <div className="flex flex-col gap-1">
        <Link
          to="/admin/models"
          className="text-[12.5px] text-muted-foreground hover:underline"
        >
          Admin / Models
        </Link>
        <div className="flex items-center gap-2">
          <h1>{detail.model.name}</h1>
          <Pill tone={enabled ? "ok" : "neutral"}>
            {enabled ? "Enabled" : "Disabled"}
          </Pill>
          <Pill tone="neutral" className="border border-input bg-transparent">
            revision {detail.model.currentRevision}
          </Pill>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-muted-foreground">
          {dirty
            ? "Unsaved changes"
            : `Saved · revision ${detail.model.currentRevision}`}
        </span>
        <Button asChild variant="outline" size="sm">
          <a href={`/api/admin/models/${detail.model.id}/export`}>Export</a>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!dirty}
          onClick={() => draft.discard()}
        >
          Discard
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!dirty || draft.saving}
          title={
            mustDisableToSave
              ? "Errors keep an enabled Model from saving as is, so this saves it disabled"
              : undefined
          }
          className={
            mustDisableToSave ? "bg-warn text-card hover:bg-warn/90" : undefined
          }
          onClick={() => void handleSave()}
        >
          {mustDisableToSave ? "Save and disable" : "Save"}
        </Button>
      </div>

      {draft.staleSave && (
        <div className="w-full">
          <StaleSaveAlert onReload={handleReloadClick} />
        </div>
      )}
      {!draft.staleSave && draft.saveError && (
        <p role="alert" className="w-full text-err">
          {draft.saveError}
        </p>
      )}

      <Dialog open={confirmReloadOpen} onOpenChange={setConfirmReloadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              Reloading throws away what hasn't been saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmReloadOpen(false)}
            >
              Stay
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmReloadOpen(false);
                void draft.reload();
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
