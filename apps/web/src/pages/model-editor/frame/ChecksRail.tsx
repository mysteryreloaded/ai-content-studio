import type { ModelIssue } from "@ai-content-studio/shared";
/**
 * The Model's live rail (issue #49): every error and warning `checkModel`
 * currently finds, recomputed on each render against whatever's in the
 * Modes/Inputs drafts right now — before either is saved.
 */
export function ChecksRail({ issues }: { issues: ModelIssue[] }) {
  if (issues.length === 0) return null;
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  return (
    <section aria-label="Model checks">
      <h3>Checks</h3>
      {errors.length > 0 && (
        <ul role="alert">
          {errors.map((issue) => (
            <li key={issue.message}>Error: {issue.message}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul>
          {warnings.map((issue) => (
            <li key={issue.message}>Warning: {issue.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
