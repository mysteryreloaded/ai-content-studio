import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { ChecksRail } from "./frame/ChecksRail.js";
import { EditorHeader } from "./frame/EditorHeader.js";
import { SECTIONS } from "./frame/sections.js";
import { useEditorNavigation } from "./hooks/useEditorNavigation.js";
import { BackendsSection } from "./sections/BackendsSection.js";
import { DetailsSection } from "./sections/DetailsSection.js";
import { InputsSection } from "./sections/InputsSection.js";
import { ModesSection } from "./sections/ModesSection.js";
import { RevisionsSection } from "./sections/RevisionsSection.js";
import { TermsSection } from "./sections/TermsSection.js";
import { WorkflowSection } from "./sections/WorkflowSection.js";
import { IssueCount } from "./ui/ChecksList.js";
import { useModelEditor } from "./useModelEditor.js";

export function ModelEditorPage() {
  const editor = useModelEditor();
  const { loadError, detail, issuesBySection, blocker } = editor;
  const nav = useEditorNavigation({
    modelId: detail?.model.id,
    hasInputs: detail ? (detail.inputs ?? []).length > 0 : null,
  });

  if (loadError) return <p role="alert">{loadError}</p>;
  if (!detail) return <p>Loading…</p>;

  return (
    <div className="@container flex h-[calc(100vh-var(--app-header-h))] flex-col">
      <EditorHeader editor={editor} detail={detail} nav={nav} />
      <div className="grid flex-1 grid-cols-[200px_minmax(0,1fr)_300px] overflow-auto @max-[1180px]:grid-cols-[180px_minmax(0,1fr)] @max-[760px]:grid-cols-1">
        <nav
          aria-label="Model editor sections"
          className="bg-card border-r border-border px-2 py-3.5 flex flex-col gap-0.5 @max-[760px]:flex-row @max-[760px]:overflow-x-auto @max-[760px]:border-r-0 @max-[760px]:border-b @max-[760px]:p-2"
        >
          {SECTIONS.map((section) => {
            const counts = issuesBySection[section.id];
            return (
              <button
                key={section.id}
                type="button"
                aria-current={nav.section === section.id}
                onClick={() => nav.setSection(section.id)}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left font-medium text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=true]:bg-accent-soft aria-[current=true]:text-foreground"
              >
                <span>{section.label}</span>
                <IssueCount count={counts.errors} tone="err" />
                <IssueCount count={counts.warnings} tone="warn" />
              </button>
            );
          })}
        </nav>

        <main className="flex min-w-0 flex-col gap-4 p-5">
          <div className="flex min-w-0 flex-col gap-4 overflow-x-auto">
            {nav.section === "details" && (
              <DetailsSection editor={editor} detail={detail} />
            )}
            {nav.section === "workflow" && (
              <WorkflowSection editor={editor} detail={detail} nav={nav} />
            )}
            {nav.section === "inputs" && (
              <InputsSection editor={editor} detail={detail} nav={nav} />
            )}
            {nav.section === "modes" && (
              <ModesSection editor={editor} detail={detail} nav={nav} />
            )}
            {nav.section === "backends" && (
              <BackendsSection editor={editor} detail={detail} />
            )}
            {nav.section === "terms" && (
              <TermsSection editor={editor} detail={detail} />
            )}
            {nav.section === "test" && (
              <p className="text-muted-foreground">
                Run a Test from a Mode's sheet, in Modes.
              </p>
            )}
            {nav.section === "revisions" && (
              <RevisionsSection editor={editor} detail={detail} />
            )}
          </div>
        </main>

        <ChecksRail editor={editor} detail={detail} nav={nav} />
      </div>

      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              Leaving now throws away what hasn't been saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (blocker.state === "blocked") blocker.reset();
              }}
            >
              Stay
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (blocker.state === "blocked") blocker.proceed();
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
