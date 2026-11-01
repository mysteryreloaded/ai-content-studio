import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";
import type { ApiError } from "./api.js";

export { zodResolver };

/** The shape of a zod v4 issue as the server sends it in a 400 body. */
export interface ServerIssue {
  path: readonly (string | number)[];
  message: string;
}

/**
 * Maps a server 400's `issues` (zod issues with a `path`, spec #33's
 * react-hook-form + shared-schema wiring) onto the form's fields via
 * `setError`: an issue with no path becomes the form-level `"root"`
 * error, and every other one becomes its dot-joined field name.
 */
export function mapServerIssues<T extends FieldValues>(
  setError: UseFormSetError<T>,
  issues: readonly ServerIssue[],
): void {
  for (const issue of issues) {
    if (issue.path.length === 0) {
      setError("root", { message: issue.message });
    } else {
      const field = issue.path.map(String).join(".");
      setError(field as FieldPath<T>, { message: issue.message });
    }
  }
}

/**
 * `mapServerIssues` for a caught `ApiError`: the server's 400 bodies are
 * `{ error, issues }`, so a non-400 or non-issues body sets nothing.
 */
export function mapApiError<T extends FieldValues>(
  setError: UseFormSetError<T>,
  error: ApiError,
): void {
  const body = error.body as { issues?: readonly ServerIssue[] } | null;
  if (body?.issues) mapServerIssues(setError, body.issues);
}
