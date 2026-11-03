import { Button } from "../../components/ui/button.js";
import type { WorkbenchModel } from "./types.js";

/**
 * The Model intro (prototype `ModelIntro`, issue #194 story 18): name,
 * description, then Attribution and the "Model terms" link joined by
 * " · " on one line.
 */
export function ModelIntro({
  model,
  onShowTerms,
}: {
  model: WorkbenchModel;
  onShowTerms: () => void;
}) {
  const both = Boolean(model.attribution) && Boolean(model.terms);
  return (
    <div className="flex flex-col gap-1">
      <h1>{model.name}</h1>
      {model.description && (
        <p className="text-muted-foreground">{model.description}</p>
      )}
      {(model.attribution || model.terms) && (
        <p className="text-xs text-faint">
          {model.attribution}
          {both ? " · " : ""}
          {model.terms && (
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-xs underline underline-offset-2"
              onClick={onShowTerms}
            >
              Model terms
            </Button>
          )}
        </p>
      )}
    </div>
  );
}
