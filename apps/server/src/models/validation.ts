// Validation shared by the Model editor's Details form and the server
// (issue #40's acceptance criteria).

export const MAX_WORKFLOW_BYTES = 10 * 1024 * 1024;

export interface ModelDetailsInput {
  name: string;
  slug: string;
  description: string;
  maxRunTimeMinutes: number;
}

export type ValidationError = { field: string; message: string };

export class ValidationFailed extends Error {
  constructor(public readonly errors: ValidationError[]) {
    super(errors.map((e) => `${e.field}: ${e.message}`).join("; "));
  }
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateModelName(name: string): ValidationError | null {
  if (name.length < 1 || name.length > 80) {
    return { field: "name", message: "must be 1-80 characters" };
  }
  return null;
}

export function validateSlug(slug: string): ValidationError | null {
  if (slug.length < 1 || slug.length > 80 || !SLUG_RE.test(slug)) {
    return {
      field: "slug",
      message: "must be 1-80 characters: lowercase letters, digits and hyphens",
    };
  }
  return null;
}

export function validateMaxRunTimeMinutes(
  value: number,
): ValidationError | null {
  if (!Number.isInteger(value) || value < 1 || value > 240) {
    return { field: "maxRunTimeMinutes", message: "must be 1-240" };
  }
  return null;
}

export function validateModelDetails(
  input: ModelDetailsInput,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const nameError = validateModelName(input.name);
  if (nameError) errors.push(nameError);
  const slugError = validateSlug(input.slug);
  if (slugError) errors.push(slugError);
  const maxRunTimeError = validateMaxRunTimeMinutes(input.maxRunTimeMinutes);
  if (maxRunTimeError) errors.push(maxRunTimeError);
  return errors;
}

/** Turns a Model name into a starting slug; the repository appends `-2`, `-3`, ... if it's taken. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug.slice(0, 80) : "model";
}
