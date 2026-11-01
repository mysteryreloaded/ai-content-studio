import type { FieldPath, FieldValues, UseFormReturn } from "react-hook-form";

/** One entry of a server 400's `issues`: a zod issue's `path` and `message`. */
export interface ServerIssue {
  path: ReadonlyArray<string | number>;
  message: string;
}

/**
 * Maps a server 400's `issues` onto the form's fields via `setError`
 * (spec #33): each issue becomes a field error under type "server",
 * so a field's error message is the server's own. An issue with an
 * empty `path` (the whole body failed) has no field to attach to and
 * is skipped.
 */
export function setServerIssues<T extends FieldValues>(
  form: UseFormReturn<T>,
  issues: ReadonlyArray<ServerIssue>,
): void {
  for (const issue of issues) {
    if (issue.path.length === 0) continue;
    form.setError(issue.path.join(".") as FieldPath<T>, {
      type: "server",
      message: issue.message,
    });
  }
}
