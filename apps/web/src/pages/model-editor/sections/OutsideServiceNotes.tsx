import type { ModelDetail } from "../types.js";

/** Issue #214: moved from above Details into the Workflow section, restyled as the prototype's `.note`s. */
export function OutsideServiceNotes({ detail }: { detail: ModelDetail }) {
  const empty = detail.outsideServiceNotes.filter((note) => !note.keySet);
  if (empty.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {empty.map((note) => (
        <li
          key={note.nodeId}
          className="rounded-md bg-muted px-[11px] py-[9px] text-[13px] text-muted-foreground"
        >
          {note.classType} (node {note.nodeId}) has no key set in the Workflow;
          set it on the Backend instead.
        </li>
      ))}
    </ul>
  );
}
