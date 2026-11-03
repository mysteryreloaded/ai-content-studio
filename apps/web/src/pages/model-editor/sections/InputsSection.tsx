import type { InputDefinition } from "@ai-content-studio/shared";
import { InputCard } from "../inputs/InputCard.js";
import type { ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";

export function InputsSection({
  editor,
  detail,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const {
    addInput,
    handleSaveInputs,
    inputsDirty,
    inputsDraft,
    inputsHeadingRef,
    inputsSaveError,
    mustDisableToSave,
    newInputKind,
    savingInputs,
    setNewInputKind,
  } = editor;
  return (
    <section>
      <h3 ref={inputsHeadingRef}>Inputs</h3>
      {inputsDraft?.map((input, index) => (
        <InputCard
          key={input.id}
          input={input}
          index={index}
          editor={editor}
          detail={detail}
        />
      ))}

      <label htmlFor="new-input-kind">New Input kind</label>
      <select
        id="new-input-kind"
        value={newInputKind}
        onChange={(event) =>
          setNewInputKind(event.target.value as InputDefinition["kind"])
        }
      >
        <option value="text">Text</option>
        <option value="number">Number</option>
        <option value="select">Select</option>
        <option
          value="seed"
          disabled={inputsDraft?.some((i) => i.kind === "seed")}
        >
          Seed
        </option>
        <option value="image_upload">Image upload</option>
        <option value="video_upload">Video upload</option>
        <option value="audio_upload">Audio upload</option>
        <option value="points">Points</option>
      </select>
      <button type="button" onClick={addInput}>
        Add Input
      </button>
      <button
        type="button"
        disabled={savingInputs || !inputsDirty}
        onClick={() => void handleSaveInputs()}
      >
        {mustDisableToSave ? "Save and disable" : "Save Inputs"}
      </button>
      {inputsSaveError && <p role="alert">{inputsSaveError}</p>}
    </section>
  );
}
