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
A ComfyUI server, reached at an address with credentials, that runs the Workflows of one or more Models, one Generation at a time.
_Avoid_: node (means a Workflow node), worker, machine, server

**Input**:
An admin-defined field on a Model's page whose value is written into one or more Node fields. Blank unless the admin sets a default.
_Avoid_: parameter, control, option

**Mode**:
A named preset of a Model (for example first/last frame, character replace) that picks its Path by naming the Workflow nodes that produce its Assets, chooses which Inputs appear, and fixes values that steer choices inside the Path. Modes differ in which Uploads they ask for: a variant that keeps the same Uploads (for example which motion guide to follow) is an Input within a Mode, not a separate Mode. Several Modes may share one Path and differ only in the values they fix.
_Avoid_: feature, preset, tab, sub-workflow

**Path**:
The part of a Workflow that a Mode runs: the nodes that produce its Assets and every node they depend on. The rest of the Workflow plays no part in that Mode's Generations.
_Avoid_: branch, route, sub-workflow

### Generating

**Generation**:
One request to produce output from a Model in a chosen Mode with chosen Input values. A multi-generation request creates several Generations that differ only by seed.
_Avoid_: job (queue mechanics), prompt (ComfyUI's word for one execution), run, render

**Upload**:
A file a user supplies as an Input value, such as a reference image, video or audio clip. Trimming one makes a new Upload, trimmed from the original; a Generation uses the Uploads it actually sends.
_Avoid_: reference (names the Input's purpose, not the file), attachment

**Asset**:
A file a Generation produced (video, image or audio), owned by the user who requested it.
_Avoid_: output, result, media

**Gallery**:
A user's own view of their past Generations and their Assets.
_Avoid_: history, library

### Administration

**User**:
A person who has signed in with Google. A user is pending (waiting for an Admin's approval), active, or disabled (barred from signing in, their running work stopped, their files kept).
_Avoid_: account, member, customer

**Admin**:
A user allowed into the admin panel. An Admin named in the operator's configuration is pinned: the admin panel cannot demote, disable or delete them.
_Avoid_: moderator, owner, superuser

**Audit entry**:
A record of one save of something Admins control (a Model with its Inputs and Modes, a Backend, a user, the Site settings), made by an Admin or by the system: who, what, when, before and after.
_Avoid_: log, history, changelog

**Log entry**:
An operational record (error, warning or info) about the app or a Backend, kept for diagnosis. Distinct from Audit entries.
_Avoid_: audit, event

**Site settings**:
The admin-editable site-wide settings: branding (title, logo, background image) and whether new users need an Admin's approval.
_Avoid_: config, preferences
