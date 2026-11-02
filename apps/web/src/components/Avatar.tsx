import { cn } from "cn";
import { useState } from "react";

interface AvatarProps {
  /** The signed-in user's display name — the initials fallback. */
  name: string;
  /** The Google profile picture, or `null` when the user has none. */
  picture: string | null;
  /** The square's pixel size (always rendered round). Defaults to 32, the header's size; #207's Users pages reuse it smaller. */
  size?: number;
}

/** Up to two initials for the no-picture / failed-picture fallback. */
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

// No `style={{…}}` (issue #188's screen rule), so `size` maps onto a
// fixed set of Tailwind sizes rather than a computed pixel value.
const SIZE_CLASSES: Record<number, string> = {
  24: "size-6",
  32: "size-8",
  40: "size-10",
  48: "size-12",
};

/**
 * The one shared round avatar (issue #188): the Google picture with
 * `referrerPolicy="no-referrer"` (the picture host does not want the
 * app's domain in its logs), and the initials on the avatar colour when
 * there is no picture **or the picture fails to load** (issue #188's
 * gap 4 — a dead Google URL used to show a broken image).
 */
export function Avatar({ name, picture, size = 32 }: AvatarProps) {
  const [pictureFailed, setPictureFailed] = useState(false);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#c2884f] text-xs font-semibold text-white",
        SIZE_CLASSES[size] ?? "size-8",
      )}
    >
      {picture && !pictureFailed ? (
        <img
          src={picture}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setPictureFailed(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
