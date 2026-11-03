const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** "14:02", in the browser's own time zone. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * "22 Oct 21:57", in the browser's own time zone. The year is added only
 * when it differs from the current year ("22 Oct 2025 21:57"), so a
 * timestamp from an earlier year never reads as if it happened this year.
 */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const month = MONTHS[d.getMonth()];
  const time = formatTime(iso);
  const year = d.getFullYear();
  if (year !== new Date().getFullYear()) {
    return `${day} ${month} ${year} ${time}`;
  }
  return `${day} ${month} ${time}`;
}

const BYTE_UNITS = ["KB", "MB", "GB", "TB"];

/** "834 KB", "1.2 MB", "3.4 GB" — binary (1024) units, no decimal under 1 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded =
    unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${BYTE_UNITS[unitIndex]}`;
}

/** "20.0 GiB" — always expressed in GiB, to one decimal. */
export function formatGiB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

/** "45 s", "4 min", "1 h 12 min". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;

  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}
