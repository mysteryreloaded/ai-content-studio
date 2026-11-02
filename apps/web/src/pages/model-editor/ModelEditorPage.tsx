import { ChecksRail } from "./frame/ChecksRail.js";
import { EditorHeader } from "./frame/EditorHeader.js";
import { BackendsSection } from "./sections/BackendsSection.js";
import { DetailsSection } from "./sections/DetailsSection.js";
import { InputsSection } from "./sections/InputsSection.js";
import { ModesSection } from "./sections/ModesSection.js";
import { OutsideServiceNotes } from "./sections/OutsideServiceNotes.js";
import { RevisionsSection } from "./sections/RevisionsSection.js";
import { TermsSection } from "./sections/TermsSection.js";
import { WorkflowSection } from "./sections/WorkflowSection.js";
import { useModelEditor } from "./useModelEditor.js";

export function ModelEditorPage() {
  const editor = useModelEditor();
  const { loadError, detail, form, modelIssues, handleDelete, deleteError } =
    editor;
  if (loadError) return <p role="alert">{loadError}</p>;
  if (!detail || !form) return <p>Loading…</p>;
  return (
    <section>
      <EditorHeader editor={editor} detail={detail} />
      <ChecksRail issues={modelIssues} />
      <RevisionsSection editor={editor} detail={detail} />
      <OutsideServiceNotes detail={detail} />
      <DetailsSection editor={editor} detail={detail} form={form} />
      <BackendsSection editor={editor} detail={detail} />
      <ModesSection editor={editor} detail={detail} />
      <TermsSection editor={editor} detail={detail} />
      <InputsSection editor={editor} detail={detail} />
      <WorkflowSection editor={editor} detail={detail} />
      <button type="button" onClick={() => void handleDelete()}>
        Delete
      </button>
      {deleteError && <p role="alert">{deleteError}</p>}
    </section>
  );
}
