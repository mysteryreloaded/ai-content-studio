import {
  MODEL_ATTRIBUTION_MAX_LENGTH,
  MODEL_TERMS_MAX_LENGTH,
  isValidModelLicenseUrl,
  renderMarkdown,
} from "@ai-content-studio/shared";
import type { ModelDetail } from "../types.js";
import type { ModelEditor } from "../useModelEditor.js";
export function TermsSection({
  editor,
  detail,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const { askAgain, setAskAgain, setTermsForm, termsForm, termsPreviewHtml } =
    editor;
  return (
    <>
      {termsForm && (
        <div>
          <h3>Terms and attribution</h3>
          <p>
            <a
              href="https://github.com/mysteryreloaded/ai-content-studio/blob/main/docs/licensing.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              Licensing docs
            </a>
          </p>
          <label htmlFor="model-terms-body">Model terms (Markdown)</label>
          <textarea
            id="model-terms-body"
            rows={10}
            value={termsForm.termsBody}
            maxLength={MODEL_TERMS_MAX_LENGTH}
            onChange={(event) =>
              setTermsForm({ ...termsForm, termsBody: event.target.value })
            }
          />
          <h4>Preview</h4>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown (shared) strips raw HTML and images */}
          <div dangerouslySetInnerHTML={{ __html: termsPreviewHtml }} />
          <label htmlFor="model-license-url">License URL</label>
          <input
            id="model-license-url"
            value={termsForm.licenseUrl}
            onChange={(event) =>
              setTermsForm({ ...termsForm, licenseUrl: event.target.value })
            }
          />
          {!isValidModelLicenseUrl(termsForm.licenseUrl) && (
            <p role="alert">Must be an http(s) URL, or blank</p>
          )}
          <label htmlFor="model-attribution">Attribution</label>
          <input
            id="model-attribution"
            value={termsForm.attribution}
            maxLength={MODEL_ATTRIBUTION_MAX_LENGTH}
            onChange={(event) =>
              setTermsForm({ ...termsForm, attribution: event.target.value })
            }
          />
          <p>
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
          <label>
            <input
              type="checkbox"
              checked={askAgain}
              onChange={(event) => setAskAgain(event.target.checked)}
            />
            Ask everyone to accept again
          </label>
        </div>
      )}
    </>
  );
}
