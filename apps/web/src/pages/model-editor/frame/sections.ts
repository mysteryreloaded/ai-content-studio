/** The Model editor's eight sections, in the agreed order (issue #213). */
export const SECTIONS = [
  { id: "details", label: "Details" },
  { id: "workflow", label: "Workflow" },
  { id: "inputs", label: "Inputs" },
  { id: "modes", label: "Modes" },
  { id: "backends", label: "Backends" },
  { id: "terms", label: "Terms and attribution" },
  { id: "test", label: "Test" },
  { id: "revisions", label: "Revisions" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export function isSectionId(value: string | null): value is SectionId {
  return SECTIONS.some((section) => section.id === value);
}
