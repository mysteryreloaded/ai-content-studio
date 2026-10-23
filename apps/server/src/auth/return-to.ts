const DEFAULT_RETURN_TO = "/models";

/**
 * Only a same-origin relative path is ever honoured, so a visitor
 * returns where they started and sign-in can never redirect off-site.
 */
export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value) return DEFAULT_RETURN_TO;
  if (!value.startsWith("/")) return DEFAULT_RETURN_TO;
  if (value.startsWith("//")) return DEFAULT_RETURN_TO;
  if (value.includes("\\")) return DEFAULT_RETURN_TO;
  try {
    // A relative path with a scheme-like prefix (e.g. "/\t/evil.com")
    // resolves off-origin when the browser normalizes it; reject if
    // parsing against a dummy origin changes the origin.
    const resolved = new URL(value, "http://same-origin.invalid");
    if (resolved.origin !== "http://same-origin.invalid")
      return DEFAULT_RETURN_TO;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return DEFAULT_RETURN_TO;
  }
}
