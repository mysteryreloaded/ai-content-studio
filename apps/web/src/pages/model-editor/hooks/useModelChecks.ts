import { hasBlockingErrors } from "@ai-content-studio/shared";
import type { ModelIssue } from "@ai-content-studio/shared";
import { useMemo } from "react";
import type { SectionId } from "../frame/sections.js";

/**
 * Where a `ModelIssue` without an id (a Backend-count or Seed-count
 * check) belongs in the section nav (issue #213's mapping table).
 */
function sectionForMessage(message: string): SectionId {
  if (message.includes("needs at least one attached Backend")) {
    return "backends";
  }
  if (message.includes("a Model can have at most one Seed Input")) {
    return "inputs";
  }
  return "modes";
}

/** Maps one `ModelIssue` onto the section nav item it should count against. */
export function sectionForIssue(issue: ModelIssue): SectionId {
  if (issue.backendId) return "backends";
  if (issue.inputId && !issue.modeId) return "inputs";
  if (issue.modeId) return "modes";
  return sectionForMessage(issue.message);
}

export interface SectionCounts {
  errors: number;
  warnings: number;
}

/**
 * `modelIssues`, `issuesBySection` (every section's error/warning
 * count, plus the Details/Terms field-error counts folded in) and
 * `mustDisableToSave` (issue #213's hook layout).
 */
export function useModelChecks({
  modelIssues,
  pendingWorkflowIssues,
  detailsErrorCount,
  termsErrorCount,
  enabled,
}: {
  modelIssues: ModelIssue[];
  pendingWorkflowIssues: ModelIssue[];
  detailsErrorCount: number;
  termsErrorCount: number;
  enabled: boolean;
}) {
  const issuesBySection = useMemo(() => {
    const counts: Record<SectionId, SectionCounts> = {
      details: { errors: detailsErrorCount, warnings: 0 },
      workflow: { errors: 0, warnings: 0 },
      inputs: { errors: 0, warnings: 0 },
      modes: { errors: 0, warnings: 0 },
      backends: { errors: 0, warnings: 0 },
      terms: { errors: termsErrorCount, warnings: 0 },
      test: { errors: 0, warnings: 0 },
      revisions: { errors: 0, warnings: 0 },
    };
    for (const issue of modelIssues) {
      const section = sectionForIssue(issue);
      if (issue.severity === "error") counts[section].errors += 1;
      else counts[section].warnings += 1;
    }
    for (const issue of pendingWorkflowIssues) {
      if (issue.severity === "error") counts.workflow.errors += 1;
      else counts.workflow.warnings += 1;
    }
    return counts;
  }, [modelIssues, pendingWorkflowIssues, detailsErrorCount, termsErrorCount]);

  const modelHasErrors = hasBlockingErrors(modelIssues);
  const mustDisableToSave = enabled && modelHasErrors;

  return { issuesBySection, modelHasErrors, mustDisableToSave };
}
