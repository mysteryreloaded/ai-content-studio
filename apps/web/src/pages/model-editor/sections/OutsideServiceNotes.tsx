import type { ModelDetail } from "../types.js";

export function OutsideServiceNotes({ detail }: { detail: ModelDetail }) {
  return (
    <>
      {detail.outsideServiceNotes.length > 0 && (
        <ul>
          {detail.outsideServiceNotes.map((note) => (
            <li key={note.nodeId}>
              {note.classType} (node {note.nodeId}) has no key set in the
              Workflow; set it on the Backend instead.
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
