import { renderMarkdown } from "@ai-content-studio/shared";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "../../components/ui/dialog.js";
import type { ModelTerms } from "./types.js";

/**
 * The Model terms dialog (prototype `TermsDialog`, issue #61/#194):
 * blocking (no dismiss, no Escape) the first time a user opens a Model
 * with terms and again whenever re-asked; otherwise dismissible, for
 * viewing the terms any time via the Workbench's own link.
 */
export function ModelTermsDialog({
  modelName,
  attribution,
  terms,
  blocking,
  accepting,
  error,
  onAccept,
  onClose,
  onBackToModels,
}: {
  modelName: string;
  attribution: string;
  terms: ModelTerms;
  blocking: boolean;
  accepting: boolean;
  error: string | null;
  onAccept: () => void;
  onClose: () => void;
  onBackToModels: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !blocking) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!blocking}
        className="sm:max-w-[560px]"
        onEscapeKeyDown={(event) => {
          if (blocking) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (blocking) event.preventDefault();
        }}
      >
        <DialogTitle>
          {blocking
            ? `Before you use ${modelName}`
            : `${modelName}: Model terms`}
        </DialogTitle>
        <div className="flex flex-col gap-3 text-sm">
          <div
            // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images
            dangerouslySetInnerHTML={{ __html: renderMarkdown(terms.body) }}
          />
          {terms.licenseUrl && (
            <p>
              <a
                href={terms.licenseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                Read the model license
              </a>
            </p>
          )}
          {attribution && (
            <p className="text-muted-foreground">{attribution}</p>
          )}
          {blocking && (
            <p className="text-muted-foreground">
              You agree once. If these terms change, we'll ask again.
            </p>
          )}
          {error && (
            <p role="alert" className="text-err">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          {blocking ? (
            <>
              <Button type="button" variant="outline" onClick={onBackToModels}>
                Back to Models
              </Button>
              <Button type="button" disabled={accepting} onClick={onAccept}>
                I agree
              </Button>
            </>
          ) : (
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
