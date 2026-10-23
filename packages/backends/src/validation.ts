// Validation shared by the form and the server, per issue #39's acceptance
// criteria for adding/editing a Backend.

export type AuthKind = "none" | "basic" | "header";

export interface BackendInput {
  name: string;
  baseUrl: string;
  auth: AuthKind;
  /** Only present when the auth kind needs it; blank/absent keeps existing credentials on edit. */
  basicUser?: string;
  basicPass?: string;
  headerName?: string;
  headerValue?: string;
}

export type ValidationError = { field: string; message: string };

export class ValidationFailed extends Error {
  constructor(public readonly errors: ValidationError[]) {
    super(errors.map((e) => `${e.field}: ${e.message}`).join("; "));
  }
}

// RFC 7230 token: a valid HTTP header field name.
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function validateName(name: string): ValidationError | null {
  if (name.length < 1 || name.length > 60) {
    return { field: "name", message: "must be 1-60 characters" };
  }
  return null;
}

export function validateBaseUrl(baseUrl: string): ValidationError | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { field: "baseUrl", message: "must be a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { field: "baseUrl", message: "must be http or https" };
  }
  if (url.search !== "") {
    return { field: "baseUrl", message: "must not include a query string" };
  }
  if (url.hash !== "") {
    return { field: "baseUrl", message: "must not include a fragment" };
  }
  if (url.username !== "" || url.password !== "") {
    return { field: "baseUrl", message: "must not include user:pass@" };
  }
  return null;
}

export interface ValidationContext {
  /** True on an edit where this auth kind already has stored credentials, so a blank field keeps them. */
  hasExistingCredentials?: boolean;
}

export function validateAuth(input: BackendInput, ctx: ValidationContext = {}): ValidationError[] {
  const errors: ValidationError[] = [];
  const hasExisting = ctx.hasExistingCredentials ?? false;

  if (input.auth === "header") {
    const headerName = input.headerName ?? "";
    if (headerName === "") {
      errors.push({ field: "headerName", message: "is required for header auth" });
    } else if (!HEADER_NAME_RE.test(headerName)) {
      errors.push({ field: "headerName", message: "must be a valid header name" });
    }
    if (!input.headerValue && !hasExisting) {
      errors.push({ field: "headerValue", message: "is required for header auth" });
    }
  }

  if (input.auth === "basic") {
    if ((!input.basicUser || !input.basicPass) && !hasExisting) {
      errors.push({ field: "basicUser", message: "username and password are required for basic auth" });
    }
  }

  return errors;
}

/**
 * Validates a Backend's own fields (not uniqueness of name, which needs the
 * database and is checked by the repository).
 */
export function validateBackendInput(input: BackendInput, ctx: ValidationContext = {}): ValidationError[] {
  const errors: ValidationError[] = [];
  const nameError = validateName(input.name);
  if (nameError) errors.push(nameError);
  const urlError = validateBaseUrl(input.baseUrl);
  if (urlError) errors.push(urlError);
  errors.push(...validateAuth(input, ctx));
  return errors;
}
