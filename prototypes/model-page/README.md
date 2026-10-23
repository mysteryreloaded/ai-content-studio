# PROTOTYPE: Model page (throwaway)

Three variants of the user-facing Model page, switchable from a floating bar, for the ticket [How does a user drive a Model page and watch Generations?](https://github.com/mysteryreloaded/ai-content-studio/issues/20). This branch is the prototype's record; nothing here merges to `main`.

## Verdict

Settled with the user on 2026-10-23: **A · Workbench** wins, with Generate waiting for Uploads, values carrying across Modes, per-Mode Input labels, no queue position, and no frame-position setting. Full answer: [the ticket's resolution](https://github.com/mysteryreloaded/ai-content-studio/issues/20#issuecomment-6354093574).

## Run it

- Open `index.html` in a browser (React loads from cdnjs), or
- rebuild after editing `src/`: `bun prototypes/model-page/build.ts`
- `make-media.sh` (ffmpeg) regenerates the stand-in clips in `media/`, which the build inlines.

Switch variants with the bar's arrows, the ← / → keys, or `?variant=a|b|c`. The bar's menu switches scenarios (a usual day, a first visit with Model terms and no history, an Admin-set Cap of 10 a day, GPUs busy with other people's work). **Simulate** arms faults: a GPU failure, a timeout, a lost GPU that is retried, an Admin updating the Model (409 on submit), trim errors, no server, Admin Removals. Try `bloodbath` in a prompt for the blocked-word refusal.

## The variants

- **A · Workbench.** Two columns. The form on the left: a grouped Mode menu, then the Inputs in three groups (your files, describe it, settings), with Generate, the count and the Caps pinned to its foot. This Model's Submissions stream in on the right. Gallery is its own page.
- **B · Feed and dock.** The Model page is the Gallery for that Model: a wall of Generations, newest first, with filters. A composer docked at the bottom holds a Mode chip, Upload slots, the prompt and settings chips. Trims and point picking open in a sheet.
- **C · Storyboard.** The Model page opens on its Modes grouped by what you start from. Picking one opens a storyboard: image Uploads sit on a timeline at the moment they shape, audio and video Uploads are lanes with their trim, settings sit beside it. Work under way lives in a queue tray across Models; the latest Submission shows under the board.

All three share one in-memory studio, so a form filled or a Generation started in one shows in the others. Nothing is saved.

## What behaves as decided

From the closed tickets: Inputs blank by default with the Workflow's value as placeholder; Uploads start on pick with chunk progress and limit checks; trims on a local player, done on the server at submit ("Preparing video…"); points on the first frame of the trimmed video, inside the crop outline, cleared when the video or trim start changes; count 1–4 with all-or-nothing Caps (concurrent counts queued too; daily is a rolling 24 h); states Queued → Running (starting / generating / saving) → Done / Failed / Cancelled, "cancelling" until the GPU confirms, Cancel all; a time-estimate percentage capped at 99% with the step counter, or an indeterminate bar with no history; the agreed failure messages and the Generation id; Model terms before first use; Attribution; blocked words; Removals; "Reuse these settings"; deleting one or a whole Submission; downloads under readable names with the AI-generated note; the 409 "This Model was updated" reload.

## What the prototype adds (for reaction)

- **Generate waits for Uploads.** Pressing Generate while an Upload is still going starts the Submission once it finishes, with "Don't start".
- **Values carry across Modes.** Inputs belong to the Model, so switching Mode keeps shared values (prompt, start image).
- **Points outside a new Size are dropped**, with a note.
- **Modes grouped by what you start from** (prompt, images, your audio, a video), derived from each Mode's required Uploads.
- **Readable file names**: `model_mode_date_time_shortid.mp4`.

## What is mock

- LTX 2.5's Inputs × Modes copy the Admin prototype's draft (branch `prototype/model-editor`); Wan 2.2's are a draft. Both wait on "What Inputs and Mode states does the LTX 2.5 / Wan 2.2 Model ship with?".
- Uploads, the two GPUs, progress, history and every server answer are simulated; times run about 8× faster than real.
- Clips are synthetic ffmpeg patterns; sample images are drawn on a canvas.
- Variant C places images on the timeline by Input id (start / middle / last). For real that needs a "frame position" on image Inputs, set by an Admin.
