/** The one shared query key for a slug's Workbench Model (issue #194), so `useModelTerms` and `useGenerate`'s own cache writes land on the same entry `WorkbenchPage`'s `useQuery` reads. */
export function workbenchModelQueryKey(slug: string): readonly unknown[] {
  return ["workbench-model", slug];
}
