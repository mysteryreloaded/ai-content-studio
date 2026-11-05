import type { InputDefinition } from "@ai-content-studio/shared";
import type {
  DetailsForm,
  DraftMode,
  ErrorPayload,
  ModelDetail,
  TermsForm,
} from "../types.js";
export function draftsFrom(detail: ModelDetail): DraftMode[] {
  return detail.modes.map((mode) => ({
    key: mode.id,
    name: mode.name,
    description: mode.description,
    outputNodeIds: mode.outputNodes.map((node) => node.nodeId),
    inputSettings: mode.inputSettings,
  }));
}
export function withoutKey(draft: DraftMode) {
  const { key, ...rest } = draft;
  void key;
  return rest;
}
export function sameModes(a: DraftMode[], b: DraftMode[]): boolean {
  return (
    JSON.stringify(a.map(withoutKey)) === JSON.stringify(b.map(withoutKey))
  );
}
export function sameInputs(
  a: InputDefinition[],
  b: InputDefinition[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export async function readFileAsJson(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}
export function detailsFrom(detail: ModelDetail): DetailsForm {
  return {
    name: detail.model.name,
    slug: detail.model.slug,
    description: detail.model.description,
    maxRunTimeMinutes: detail.model.maxRunTimeMinutes,
  };
}
export function sameDetails(a: DetailsForm, b: DetailsForm): boolean {
  return (
    a.name === b.name &&
    a.slug === b.slug &&
    a.description === b.description &&
    a.maxRunTimeMinutes === b.maxRunTimeMinutes
  );
}
export function termsFrom(detail: ModelDetail): TermsForm {
  return {
    termsBody: detail.model.termsBody,
    licenseUrl: detail.model.licenseUrl,
    attribution: detail.model.attribution,
  };
}
export function sameTerms(a: TermsForm, b: TermsForm): boolean {
  return (
    a.termsBody === b.termsBody &&
    a.licenseUrl === b.licenseUrl &&
    a.attribution === b.attribution
  );
}
/** Issue #264: the same trim the server applies before it compares and saves a terms body, so text that differs only in surrounding whitespace is not a real change. */
export function sameTermsText(a: string, b: string): boolean {
  return a.trim() === b.trim();
}
/** The message for a failed save: field errors, then the server's own `error` (a stale version, a taken name/slug, ...), else a fallback. */
export async function messageFrom(
  res: Response,
  fallback: string,
): Promise<string> {
  const payload: ErrorPayload = await res.json().catch(() => ({}));
  const issues = payload.errors
    ?.map((e) => `${e.field}: ${e.message}`)
    .join(", ");
  return issues ?? payload.error ?? fallback;
}
