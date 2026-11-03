import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";
import { ApiError } from "./api.js";

export { zodResolver };

/** The shape of a zod v4 issue as the server sends it in a 400 body. */
export interface ServerIssue {
  path: readonly (string | number)[];
  message: string;
}

/**
 * The shape of a `ValidationError` (backends/models `validation.ts`) as the
 * server sends it in a 400 body's `errors`: a flat field name rather than
 * `ServerIssue`'s path array.
 */
export interface ServerFieldError {
  field: string;
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
 * either `{ error, issues }` (zod) or `{ errors }` (a `ValidationError[]`,
 * e.g. the models/backends routes), so a body with neither sets nothing.
 */
export function mapApiError<T extends FieldValues>(
  setError: UseFormSetError<T>,
  error: ApiError,
): void {
  const body = error.body as {
    issues?: readonly ServerIssue[];
    errors?: readonly ServerFieldError[];
  } | null;
  if (body?.issues) mapServerIssues(setError, body.issues);
  if (body?.errors) {
    for (const fieldError of body.errors) {
      setError(fieldError.field as FieldPath<T>, {
        message: fieldError.message,
      });
    }
  }
}

/**
 * A message for a Save row after a failed mutation that isn't a 409
 * (those get `StaleSaveAlert` instead): the server's `error` string for
 * an `ApiError`, otherwise a generic fallback for a 401, a network
 * failure, or any other thrown value.
 */
export function describeSaveError(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { error?: string } | null;
    return body?.error ?? "Save failed";
  }
  return "Save failed";
}
