---
status: accepted
---

# An Upload the browser can't play passes through only if it already fits

Trimming a video or audio Upload happens on a local player: the user drags a range over what they can see and hear, and only that range is kept. That only works when the browser can decode the file. Some video files ffprobe accepts but browsers won't play reliably — variable frame rate, an unusual profile, or a container a given browser's `<video>` element doesn't support — and ffprobe alone can't tell us whether a browser could show it, only that it's a valid video stream.

We decided: when the browser can't play an Upload, it's used untrimmed if it already satisfies the Video/Audio Upload Input's min/max duration and max long side, and refused otherwise (including when a points pick, not just a trim, is what's needed).

## Considered Options

- **Trim it blindly from probe metadata, with no preview.** The user would pick a range they can't see or hear. A VFR file's "seconds" don't line up evenly with frames, so a server-computed cut could silently miss the content the user meant to keep. Rejected: it breaks the invariant that a Generation uses the Uploads the user actually chose.
- **Always refuse an unplayable Upload.** Simpler, but it throws out files that are already within limits and need no trim at all — the common case for a short clip someone already cut on their phone.
- **Pass through untrimmed only if it already fits; refuse otherwise.** Chosen. It never guesses a range on the user's behalf, and it doesn't penalize a file that doesn't need trimming just because the browser's preview can't show it.

## Consequences

- The "fits without a trim" check runs against the same min/max duration and max long side the Video/Audio Upload Input already enforces, from ffprobe facts, independent of whether the browser can play the file.
- A fixture set for this rule needs at least one browser-unplayable file that already fits (passes through) and one that doesn't (refused), alongside the allowed/refused/VFR/truncated/misnamed fixtures the issue calls for.
- The re-encode step (frame-accurate trim to H.264/AAC MP4, same size and fps) only ever runs on an Upload the browser could play and the user actually trimmed on screen.
