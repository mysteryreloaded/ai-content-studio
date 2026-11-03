import { Link } from "react-router-dom";
import type { WorkbenchModel } from "./types.js";

export function WorkbenchHeader({
  model,
  reuseNotice,
  onShowTerms,
}: {
  model: WorkbenchModel;
  reuseNotice: string | null;
  onShowTerms: () => void;
}) {
  return (
    <header className="workbench-header">
      <h1>{model.name}</h1>
      {model.description && <p>{model.description}</p>}
      {model.attribution && <p>{model.attribution}</p>}
      {reuseNotice && (
        <output className="workbench-reuse-notice">{reuseNotice}</output>
      )}
      <p>
        <Link to={`/gallery?model=${model.id}`}>View in Gallery</Link>
      </p>
      {model.terms && (
        <p>
          <button type="button" onClick={onShowTerms}>
            Model terms
          </button>
        </p>
      )}
    </header>
  );
}
