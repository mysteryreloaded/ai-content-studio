// Shared `Range: bytes=start-end` parsing (ADR 0007): both `/api/assets/:id`
// and `/api/uploads/:id` serve 206 partial content off this so a browser can
// seek, and iPhone Safari (which refuses to play a <video> that never gets a
// 206) can play at all.

/** Parses a single-range `Range: bytes=start-end` header; anything else (absent, multi-range, unsatisfiable) is ignored, falling back to the whole file. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return null;

  let start: number;
  let end: number;
  if (startStr === "") {
    const suffixLength = Number(endStr);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? size - 1 : Number(endStr);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end >= size || start > end) return null;
  return { start, end };
}
