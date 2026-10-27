# Building a Model

A **Model** in the Studio is one thing your users can generate: a
ComfyUI Workflow (a graph exported from the ComfyUI editor), a set of
named **Inputs** that map onto the graph's parameters, and one or more
**Modes** — saved presets of those Inputs. A user picks a Mode and fills
in the Inputs; the Studio routes the Generation to one of the Backends
you've attached to the Model.

Everything happens on one page: **Models**, then the Model's editor.
The editor opens with a header row — the Model's state, its current
revision, links to its **History** and **Export**, and the
**Enable** / **Disable** button — followed by a **Checks** section
listing its live errors and warnings, and the stacked sections
*Revisions*, *Details*, *Backends*, *Modes*, *Terms and attribution*,
*Inputs* and *Workflow*.

## Creating a Model

Two ways to start:

- **New Model** — asks for a name (1–80 characters) and a ComfyUI
  workflow file: the `.json` you export from the ComfyUI editor. That
  creates a **disabled** Model at revision 1. You then attach Backends,
  define the Inputs and Modes, and enable it when the checks pass.
- **Import** — takes a Model's **export file** (the JSON this Studio, or
  another, exported) and rebuilds the Model from it. The import keeps
  the Model's id and each Mode's id, so an export → import round-trip
  produces the same Model on another Studio. It fails rather than
  overwriting when the imported name or slug is already taken; the slug
  is the name-derived one unless the export file carries its own.

A new or imported Model starts **disabled** and stays that way until the
checks below pass — nothing a user can see or pick until you enable it.

## The editor, section by section

**Details** — the name (1–80 characters), the slug (1–80, unique across
the Studio), a short description, and the **max run time** (1–240
minutes). The max run time is a hard ceiling: a Generation on this Model
that runs longer than it is killed.

**Backends** — the ComfyUI servers this Model may run on. At least one
attached Backend is required before the Model can be enabled. Attach
several and the Studio picks, per Generation, one that can actually run
that Mode's Path.

**Inputs** — the named parameters a user fills in. Each Input has a
label (1–60 characters, unique within the Model), a type — text,
number, select, seed, or a media upload — and a **target**: the node and
input in the Workflow it feeds. A *select* Input carries 2–50 options
(exactly 2 makes it a toggle); a *seed* Input binds exactly one INT
field (at most one per Model) — left blank in a form, the Studio
draws a random seed for the user, while its **maximum** (capped at the
largest exact JavaScript integer) bounds the draw, so the only thing
enabling requires of it is that the maximum be set; a media upload's
size limit may not exceed your server's
`MAX_UPLOAD_MB`. Inputs are grouped into *describe* (what the user
sees) and *settings* (advanced).

**Modes** — saved presets: a name (1–60), a description, the **output
nodes** that produce its Assets (the first one is the main Asset), and
fixed values for some of the Inputs. A Mode's **Path** is derived
from its output nodes: those nodes plus every node they depend on,
found by following links upstream ([ADR-0001](../adr/0001-modes-run-only-their-path.md)) —
for each Generation the Studio sends a Backend only that Path, not
the whole graph, and the editor shows the Path's size for each Mode.
A user who picks a Mode gets its fixed values pre-filled and can
still change anything not locked. At least one Mode is required to
enable.

There is no separate Test section: each Mode carries its own
**Test** / **Close test** button, which opens a test panel inline
under that Mode. The panel runs the Mode as it stands in the editor
right now — saved or not — with the Workbench's own upload and points
pickers, against **Any** of the attached Backends or one chosen by
name. A test runs on an unnumbered revision that never becomes
current and writes no Audit entry; it bypasses Pause, a disabled
Model's own refusal, the concurrency caps, and Model terms, but is
refused while the Mode itself has an error. A running test streams
progress exactly like a real Generation and can be **Cancel**led. The
**Last 5 tests** list under the Modes section keeps the five most
recent runs (persisted server-side, so they're there when you come
back), each with its Mode, its state, and a **View** link to its
first Asset when it succeeded. Use tests to check a change before you
save it.

**Workflow** — the ComfyUI graph itself. Uploading a new version of the
workflow file stores it as a new revision (see Revisions). For a Mode
to run, every node type in its **Path** — the output nodes it names
plus their upstream dependencies — must be installed on at least one
attached Backend.

**Revisions** — the numbered history of the Workflow graph. The current
revision is the one in use; earlier revisions can be restored.

**Terms and attribution** — the Model's own consent: a terms body (up
to 50,000 characters, in Markdown, with a live preview), a **License
URL** (an http(s) link, up to 2,000 characters, or blank) and an
**attribution** line (up to 120 characters) that is stamped into
finished Assets and shown where the Model is. Saving records a new
terms version; the section's "Ask everyone to accept again" checkbox
and the user-facing dialog are explained in
[the consent screen](consent.md).

**Checks** — the section under the header runs the Model's checks
live as you edit and lists each issue as **Error: …** or
**Warning: …**. Errors block the **Enable** button at the top of the
page (a disabled Model with errors can't be enabled); warnings never
do. When the Model is already enabled and your unsaved edits have
introduced an error, the **Save Modes** and **Save Inputs** buttons
read **Save and disable** — and "Replace Workflow" reads
**Replace Workflow and disable** — so the only way to save a broken
Model is to take it down with it; you can't keep one live by
accident.

## What "enable" requires

The enable check passes only when all of these hold:

- the Model has at least one Mode and at least one attached Backend;
- every seed Input has a **maximum** set — otherwise
  `Seed Input "…" needs a max before enabling` (a blank field is fine:
  the Studio draws a random seed);
- for every Mode, the output nodes it names are still in the current
  Workflow — otherwise `Mode "…" names an output node no longer in
  the Workflow`;
- every Mode's Path — its output nodes plus their upstream
  dependencies — can run on at least one *reachable* attached
  Backend, i.e. every node type in the Path is installed there —
  otherwise `Mode "…" isn't runnable on any attached Backend (missing
  node types)`;
- every Upload loader on a Mode's Path — any field a Backend flags as
  an image, video, or audio upload, and always the `video` field of
  the ComfyUI-VideoSuite `VHS_LoadVideo`/`VHS_LoadVideoFFmpeg` nodes —
  is fed by a **shown** (not hidden) Input, or holds a fixed bare
  filename that appears in the choices of every enabled Backend.

When the check fails, the Checks section lists each failure with the
node or Input it concerns, so you can fix them one at a time.

## Export and import

**Export** writes the Model's JSON file: its id, name, slug,
description, max run time, terms body, License URL, attribution, current
revision, the Workflow graph, its Inputs and its Modes. **Backends are
not part of the export** — they are per-Studio — so an imported Model
arrives disabled, and you attach its own Backends before enabling it.

**Import** (above) is the inverse: it rebuilds a Model from that file.

## Deleting

Deleting a Model removes it from the list; it can no longer be picked
for new Generations. It does not erase what has already been generated —
Assets are kept per the retention rules in [Backups](backup.md) and
[Privacy](privacy.md).
