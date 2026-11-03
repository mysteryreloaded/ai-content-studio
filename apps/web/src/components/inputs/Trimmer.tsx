import { cn } from "cn";
import { Pause, Play, Scissors } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "../ui/button.js";
import type { TrimRange } from "./types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `m:ss.s`, the trim handles' `aria-valuetext` and the info line's clock; also used by `PointsField`'s "frame at …" line. */
export function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** A deterministic waveform for the audio track, seeded off `src` so it doesn't reshuffle every render. */
function seededBars(seed: number, count: number): number[] {
  let s = seed;
  return Array.from({ length: count }, () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  });
}

type Handle = "start" | "end";

/**
 * A trimmable video/audio Upload's local trim player (issue #51's
 * story 28, restyled for issue #197): a draggable selection on a track,
 * keyboard-adjustable handles, a playhead that loops the selection.
 * `durationMs`/`range`/`minMs`/`maxMs` are milliseconds at the props
 * boundary; the geometry below works in seconds, matching the
 * prototype's own `Trimmer`.
 */
export function Trimmer({
  kind,
  src,
  durationMs,
  range,
  onChange,
  minMs,
  maxMs,
}: {
  kind: "video" | "audio";
  src: string;
  durationMs: number;
  range: TrimRange;
  onChange: (range: TrimRange) => void;
  minMs: number;
  maxMs: number;
}) {
  const duration = durationMs / 1000;
  const minLen = Math.max(0.5, minMs / 1000);
  const maxLen = maxMs / 1000;
  const start = range.startMs / 1000;
  const end = range.endMs / 1000;
  const len = end - start;

  const rangeRef = useRef({ start, end });
  rangeRef.current = { start, end };
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [head, setHead] = useState(start);

  function apply(nextStart: number, nextEnd: number) {
    onChange({
      startMs: Math.round(nextStart * 10) * 100,
      endMs: Math.round(nextEnd * 10) * 100,
    });
  }

  function move(which: Handle, t: number) {
    let { start: s, end: e } = rangeRef.current;
    if (which === "start") {
      s = clamp(t, 0, e - minLen);
      if (e - s > maxLen) e = s + maxLen;
    } else {
      e = clamp(t, s + minLen, duration);
      if (e - s > maxLen) s = e - maxLen;
    }
    apply(s, e);
    const media = mediaRef.current;
    const target = which === "start" ? s : e;
    if (media) media.currentTime = target;
    setHead(target);
  }

  function onPointerDownOn(which: Handle | "range") {
    return (event: ReactPointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const measured = trackRef.current?.getBoundingClientRect();
      if (!measured || measured.width === 0) return;
      const rectLeft = measured.left;
      const rectWidth = measured.width;
      const t0 = ((event.clientX - rectLeft) / rectWidth) * duration;
      const s0 = rangeRef.current;
      function onMove(moveEvent: PointerEvent) {
        const t = ((moveEvent.clientX - rectLeft) / rectWidth) * duration;
        if (which === "range") {
          const l = s0.end - s0.start;
          const nextStart = clamp(s0.start + (t - t0), 0, duration - l);
          apply(nextStart, nextStart + l);
          const media = mediaRef.current;
          if (media) media.currentTime = nextStart;
          setHead(nextStart);
        } else {
          move(which, t);
        }
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }

  function onKeyDownOn(which: Handle) {
    return (event: ReactKeyboardEvent) => {
      const delta = event.shiftKey ? 1 : 0.1;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        move(which, rangeRef.current[which] - delta);
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        move(which, rangeRef.current[which] + delta);
      }
    };
  }

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    function onTimeUpdate() {
      if (!media) return;
      setHead(media.currentTime);
      if (media.currentTime >= rangeRef.current.end) {
        media.currentTime = rangeRef.current.start;
      }
    }
    media.addEventListener("timeupdate", onTimeUpdate);
    return () => media.removeEventListener("timeupdate", onTimeUpdate);
  }, []);

  function togglePlay() {
    const media = mediaRef.current;
    if (!media) return;
    if (playing) {
      media.pause();
      setPlaying(false);
      return;
    }
    if (media.currentTime < start || media.currentTime >= end) {
      media.currentTime = start;
    }
    media.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  }

  const pct = (t: number) => (duration > 0 ? `${(t / duration) * 100}%` : "0%");
  const waves = seededBars(src.length * 97 + 13, 64);
  const over = duration > maxLen + 0.05;
  const handleClassName =
    "absolute -inset-y-0.5 w-3.5 cursor-ew-resize touch-none bg-primary after:absolute after:top-1/2 after:left-1/2 after:h-3 after:w-0.5 after:-translate-1/2 after:rounded-[1px] after:bg-primary-foreground focus-visible:outline-2 focus-visible:outline-foreground";

  return (
    <div className="flex flex-col gap-1.5">
      {kind === "video" ? (
        // biome-ignore lint/a11y/useMediaCaption: a user's own upload has no captions to offer.
        <video
          ref={mediaRef as RefObject<HTMLVideoElement>}
          className="w-full max-h-60 rounded-md bg-media"
          src={src}
          playsInline
          preload="auto"
          onLoadedData={(event) => {
            event.currentTarget.currentTime = start;
          }}
        />
      ) : (
        // biome-ignore lint/a11y/useMediaCaption: a user's own upload has no captions to offer.
        <audio
          ref={mediaRef as RefObject<HTMLAudioElement>}
          src={src}
          preload="auto"
        />
      )}
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={playing ? "Pause" : "Play the selection"}
          onClick={togglePlay}
        >
          {playing ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5" />
          )}
        </Button>
        <div
          ref={trackRef}
          className="relative h-[34px] min-w-0 flex-1 touch-none select-none"
        >
          <div
            aria-hidden
            className={cn(
              "absolute inset-0 overflow-hidden rounded-[5px] bg-muted",
              kind === "video"
                ? "[background-image:repeating-linear-gradient(90deg,color-mix(in_srgb,var(--accent)_28%,var(--sunk))_0_22px,color-mix(in_srgb,var(--accent)_18%,var(--sunk))_22px_24px)]"
                : "flex items-center gap-px px-0.5",
            )}
          >
            {kind === "video"
              ? Array.from({ length: Math.floor(duration) + 1 }, (_, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed count of decorative, aria-hidden 1-second ticks that never reorders.
                    key={`tick-${i}`}
                    className="absolute inset-y-0 w-px bg-foreground/12"
                    style={{ left: pct(i) }}
                  />
                ))
              : waves.map((h, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length, aria-hidden decorative waveform that never reorders.
                    key={`bar-${i}`}
                    className="flex-1 rounded-[1px] bg-[color-mix(in_srgb,var(--info)_60%,var(--line))]"
                    style={{ height: `${20 + h * 75}%` }}
                  />
                ))}
          </div>
          <div
            className="absolute inset-y-0 cursor-grab rounded-[5px] border-2 border-primary bg-primary/14 shadow-[0_0_0_9999px_color-mix(in_srgb,var(--panel)_55%,transparent)] [clip-path:inset(-2px_-40px_-2px_-40px)]"
            style={{ left: pct(start), width: pct(len) }}
            onPointerDown={onPointerDownOn("range")}
          >
            <span
              role="slider"
              tabIndex={0}
              aria-label="Trim start"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={start}
              aria-valuetext={formatClock(start)}
              className={cn(handleClassName, "-left-[9px] rounded-l-[5px]")}
              onPointerDown={onPointerDownOn("start")}
              onKeyDown={onKeyDownOn("start")}
            />
            <span
              role="slider"
              tabIndex={0}
              aria-label="Trim end"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={end}
              aria-valuetext={formatClock(end)}
              className={cn(handleClassName, "-right-[9px] rounded-r-[5px]")}
              onPointerDown={onPointerDownOn("end")}
              onKeyDown={onKeyDownOn("end")}
            />
          </div>
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-y-[3px] w-0.5 -translate-x-px bg-foreground"
            style={{ left: pct(head) }}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <Scissors aria-hidden className="size-3.5" />
        <span className="tabular-nums">
          Using {formatClock(start)}–{formatClock(end)} ·{" "}
          <strong>{len.toFixed(1)} s</strong> of {duration.toFixed(1)} s
        </span>
        <span className="text-faint">
          {over
            ? `pick up to ${maxLen} s`
            : len < duration - 0.05
              ? "trimmed on the server when you press Generate"
              : `up to ${maxLen} s`}
        </span>
      </div>
    </div>
  );
}
