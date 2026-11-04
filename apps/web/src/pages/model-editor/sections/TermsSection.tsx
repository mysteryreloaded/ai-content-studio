import {
  MODEL_ATTRIBUTION_MAX_LENGTH,
  MODEL_TERMS_MAX_LENGTH,
  isValidModelLicenseUrl,
} from "@ai-content-studio/shared";
import { MarkdownEditor } from "../../../components/admin/MarkdownEditor.js";
import { Checkbox } from "../../../components/ui/checkbox.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
import type { ModelDetail } from "../types.js";
import { Section } from "../ui/Section.js";
import type { ModelEditor } from "../useModelEditor.js";

export function TermsSection({
  editor,
  detail,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const { askAgain, setAskAgain, setTermsForm, termsForm } = editor;
  if (!termsForm) return null;

  const licenseUrlInvalid = !isValidModelLicenseUrl(termsForm.licenseUrl);
  const firstTimeTerms =
    detail.model.termsBody === "" && termsForm.termsBody !== "";
  const existingTermsChanged =
    detail.model.termsBody !== "" &&
    detail.model.termsBody !== termsForm.termsBody;

  return (
    <Section
      title="Terms and attribution"
      sub="Optional. What users acknowledge, and the credit shown with the Model."
    >
      <MarkdownEditor
        id="model-terms-body"
        label="Model terms"
        hint="Optional. Users acknowledge them before their first use of this Model."
        value={termsForm.termsBody}
        maxLength={MODEL_TERMS_MAX_LENGTH}
        onChange={(value) => setTermsForm({ ...termsForm, termsBody: value })}
      />

      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor="model-license-url">License URL</Label>
        <Input
          id="model-license-url"
          className="font-mono"
          placeholder="https://…"
          value={termsForm.licenseUrl}
          aria-invalid={licenseUrlInvalid || undefined}
          onChange={(event) =>
            setTermsForm({ ...termsForm, licenseUrl: event.target.value })
          }
        />
        {licenseUrlInvalid ? (
          <p className="text-err">Must be an http(s) URL, or blank</p>
        ) : (
          <p className="text-muted-foreground">
            Linked from the terms. See{" "}
            <a
              href="https://github.com/mysteryreloaded/ai-content-studio/blob/main/docs/licensing.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Model licenses and AI rules
            </a>{" "}
            for what each license asks of an Operator.
          </p>
        )}
      </div>

      <p className="text-muted-foreground">
        {detail.model.termsBody === ""
          ? "No terms are set: anyone can use this Model without accepting anything."
          : `Current version ${detail.model.termsVersion}, effective ${
              detail.model.termsVersionCreatedAt
                ? new Date(
                    detail.model.termsVersionCreatedAt,
                  ).toLocaleDateString()
                : "unknown"
            }.`}
      </p>

      {firstTimeTerms && (
        <p className="text-muted-foreground">
          Users will be asked to accept these terms before their next use.
        </p>
      )}
      {existingTermsChanged && (
        // biome-ignore lint/a11y/noLabelWithoutControl: wraps the Radix Checkbox (role="checkbox"), not a native labelable element
        <label className="flex items-start gap-2">
          <Checkbox
            className="mt-0.5"
            checked={askAgain}
            onCheckedChange={(checked) => setAskAgain(checked === true)}
          />
          <span className="flex flex-col">
            <span>Ask everyone to accept again</span>
            <span className="text-muted-foreground">
              Leave unticked for small fixes, such as a typo.
            </span>
          </span>
        </label>
      )}

      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor="model-attribution">Attribution</Label>
        <Input
          id="model-attribution"
          placeholder="Powered by …"
          maxLength={MODEL_ATTRIBUTION_MAX_LENGTH}
          value={termsForm.attribution}
          onChange={(event) =>
            setTermsForm({ ...termsForm, attribution: event.target.value })
          }
        />
        <p className="text-muted-foreground">
          Shown under the Model's name and in each Generation's detail.
        </p>
      </div>

      <div className="rounded-r-md border border-border border-l-[3px] border-l-info px-3 py-2 text-[13px]">
        The studio adds no visible "AI-generated" label and runs no classifier
        on outputs. If you want either, put ComfyUI's{" "}
        <code className="font-mono">TextOverlay</code> node or a classifier node
        in the Workflow.
      </div>
    </Section>
  );
}
