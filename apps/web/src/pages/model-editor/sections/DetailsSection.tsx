import type { DetailsForm, ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";

export function DetailsSection({
  editor,
  detail,
  form,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
  form: DetailsForm;
}) {
  const { dirty, handleSubmit, saveError, saving, setForm } = editor;
  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <h3>Details</h3>

      <label htmlFor="model-name">Name</label>
      <input
        id="model-name"
        value={form.name}
        maxLength={80}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
      />

      <label htmlFor="model-slug">Slug</label>
      <input
        id="model-slug"
        value={form.slug}
        maxLength={80}
        onChange={(event) => setForm({ ...form, slug: event.target.value })}
      />

      <label htmlFor="model-description">Description</label>
      <textarea
        id="model-description"
        value={form.description}
        onChange={(event) =>
          setForm({ ...form, description: event.target.value })
        }
      />

      <label htmlFor="model-max-run-time">Max run time (minutes)</label>
      <input
        id="model-max-run-time"
        type="number"
        min={1}
        max={240}
        value={form.maxRunTimeMinutes}
        onChange={(event) =>
          setForm({
            ...form,
            maxRunTimeMinutes: Number(event.target.value),
          })
        }
      />

      <button type="submit" disabled={saving || !dirty}>
        Save
      </button>
      {saveError && <p role="alert">{saveError}</p>}
    </form>
  );
}
