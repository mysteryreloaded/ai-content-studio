# Building a Model

A **Model** in the Studio is one thing your users can generate: a
ComfyUI Workflow (a graph exported from the ComfyUI editor), a set of
named **Inputs** that map onto the graph's parameters, and one or more
**Modes** — saved presets of those Inputs. A user picks a Mode and fills
in the Inputs; the Studio routes the Generation to one of the Backends
you've attached to the Model.

Everything happens on one page: **Models**, then the Model's editor.
The editor has sections down the left — *Details*, *Revisions*,
*Workflow*, *Backends*, *Modes*, *Test*, *Terms* and *Inputs* — and a
*Checks* rail on the right ending in the **Enable** / **Disable**
button.

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
the Model's graph.

**Inputs** — the named parameters a user fills in. Each Input has a
label (1–60 characters, unique within the Model), a type — text,
number, select, seed, or a media upload — and a **target**: the node and
input in the Workflow it feeds. A *select* Input carries 2–50 options
(exactly 2 makes it a toggle); a *seed* Input is a single INT field; a
media upload's size limit may not exceed your server's
`MAX_UPLOAD_MB`. Inputs are grouped into *describe* (what the user
sees) and *settings* (advanced).

**Modes** — saved presets: a name (1–60), a fixed **path** (which node in
the Workflow starts the generation) and fixed values for some of the
Inputs. A user who picks a Mode gets its fixed values pre-filled and can
still change anything not locked. At least one Mode is required to
enable.

**Workflow** — the ComfyUI graph itself. Uploading a new version of the
workflow file stores it as a new revision (see Revisions). For the Model
to run, every node type in the graph must be installed on at least one
attached Backend.

**Revisions** — the numbered history of the Workflow graph. The current
revision is the one in use; earlier revisions can be restored.

**Test** — run the Model's current, **unsaved** state on one of its
attached Backends. Test runs work on disabled Models, don't count
against the Model's concurrency caps, can be cancelled, and stream
progress exactly like a real Generation; the last five are kept
server-side for comparison. Use them to check a change before you save
it.

**Terms** — the Model's own consent: a terms body (up to 50,000
characters), a **License URL** (an http(s) link, up to 2,000
characters, or blank) and an **attribution** line (up to 120 characters)
that is stamped into finished Assets and shown where the Model is. An
"Ask everyone to accept again" checkbox is explained in
[the consent screen](consent.md).

**Checks** — the right-hand rail runs the enablement check live as you
edit. **Errors** block enabling; **warnings** never do. The rail ends
in the **Enable** / **Disable** button. When the Model is already
enabled and your current edits have introduced an error, the button
reads **Save and disable** — you can't keep a broken Model live by
accident.

## What "enable" requires

The enable check passes only when all of these hold:

- the Model has at least one Mode and at least one attached Backend;
- every Mode has a fixed path;
- every Mode's path can run on at least one attached Backend — every
  class type in the graph is installed there;
- every seed Input is an INT field with a maximum set, no default
  value, and required;
- every media-upload loader on a path is fed by a **shown** (not hidden)
  Input, or by a fixed bare filename that appears in the options of
  every enabled Backend;
- a video upload in particular is fed by a node that declares the
  `video_upload` capability (the ComfyUI-VideoSuite `VHS_LoadVideo`
  node does).

When the check fails, the Checks rail lists each failure with the node
or Input it concerns, so you can fix them one at a time.

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
