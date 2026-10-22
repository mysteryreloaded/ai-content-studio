# AI Content Studio

An open-source web studio where signed-in users generate video, image and audio by running ComfyUI workflows on self-hosted GPU machines, curated by admins through a browser admin panel.

## Language

### Catalog

**Model**:
An admin-defined generation offering: exactly one Workflow, the Backends that can run it, its Inputs and its Modes. Users see a Model only while it is enabled.
_Avoid_: engine, checkpoint (that is a weights file), template

**Workflow**:
The ComfyUI graph, in API format, that a Model runs. LTX 2.5's Workflow is "all-in-one": one graph covering many Modes.
_Avoid_: pipeline, graph, flow

**Node field**:
One named entry in a Workflow node's `inputs`; the place an Input's value is written.
_Avoid_: node input, param, widget

**Backend**:
A ComfyUI server, reached at an address with credentials, that can run a Model's Workflow.
_Avoid_: node (means a Workflow node), worker, machine, server

**Input**:
An admin-defined field on a Model's page whose value is written into one or more Node fields. Blank unless the admin sets a default.
_Avoid_: parameter, control, option

**Mode**:
A named preset of a Model (for example first/last frame, character replace) that chooses which Inputs appear and fixes the values that steer the Workflow down one path. Modes differ in which Uploads they ask for: a variant that keeps the same Uploads (for example which motion guide to follow) is an Input within a Mode, not a separate Mode. Several Modes may share one path and differ only in the values they fix.
_Avoid_: feature, preset, tab, sub-workflow

### Generating

**Generation**:
One request to produce output from a Model in a chosen Mode with chosen Input values. A multi-generation request creates several Generations that differ only by seed.
_Avoid_: job (queue mechanics), prompt (ComfyUI's word for one execution), run, render

**Upload**:
A file a user supplies as an Input value, such as a reference image, video or audio clip.
_Avoid_: reference (names the Input's purpose, not the file), attachment

**Asset**:
A file a Generation produced (video, image or audio), owned by the user who requested it.
_Avoid_: output, result, media

**Gallery**:
A user's own view of their past Generations and their Assets.
_Avoid_: history, library

### Administration

**Admin**:
A user allowed into the admin panel.
_Avoid_: moderator, owner

**Audit entry**:
A record of one change made through the admin panel: who, what, when, before and after.
_Avoid_: log, history, changelog

**Log entry**:
An operational record (error or warning) from the app or a Backend, kept for diagnosis. Distinct from Audit entries.
_Avoid_: audit, event

**Site settings**:
The admin-editable branding of the site: title, logo and background image.
_Avoid_: config, preferences
