# AI Content Studio

An open-source web studio where signed-in users generate video, image and audio by running ComfyUI workflows on self-hosted GPU machines, curated by admins through a browser admin panel.

## Language

### Catalog

**Model**:
An admin-defined generation offering: exactly one Workflow, the Backends that can run it, its Inputs and its Modes, plus optional Model terms and Attribution. Users see a Model only while it is enabled.
_Avoid_: engine, checkpoint (that is a weights file), template

**Model revision**:
One saved state of a Model's Workflow, Inputs and Modes. Each save of any of them makes a new, numbered one, and so does restoring an earlier one. A Generation runs with the Model revision current when it was submitted, and keeps showing the settings it ran with even after the Model changes. A test Generation instead runs with an unnumbered revision of the Admin's unsaved changes, which never becomes current.
_Avoid_: version (Model terms and Site terms have versions), draft

**Workflow**:
The ComfyUI graph, in API format, that a Model runs. LTX 2.5's Workflow is "all-in-one": one graph covering many Modes.
_Avoid_: pipeline, graph, flow

**Node field**:
One named entry in a Workflow node's `inputs` that holds a value rather than a link from another node; the place an Input's value is written.
_Avoid_: node input, param, widget

**Backend**:
A ComfyUI server, reached at an address (with credentials when the network in front of it asks for them), that runs the Workflows of one or more Models, one Generation at a time. ComfyUI is the only kind of Backend. A machine may host several Backends (usually one per GPU), and one Backend may use several GPUs.
_Avoid_: node (means a Workflow node), worker, machine, server

**Input**:
An admin-defined field of a Model whose value is written into one or more Node fields; a select writes its own value for each field. Each Mode shows it (optional or required), hides it, or fixes its value. It starts blank unless the admin sets a default, and when it is blank or hidden, its Node fields keep the Workflow's own values.
_Avoid_: parameter, control, option

**Mode**:
A named preset of a Model (for example first/last frame, character replace) that picks its Path by naming the Workflow nodes that produce its Assets, chooses which Inputs appear, and fixes values that steer choices inside the Path. Modes differ in which Uploads they ask for: a variant that keeps the same Uploads (for example which motion guide to follow) is an Input within a Mode, not a separate Mode. Several Modes may share one Path and differ only in the values they fix.
_Avoid_: feature, preset, tab, sub-workflow

**Path**:
The part of a Workflow that a Mode runs: the nodes that produce its Assets and every node they depend on. The rest of the Workflow plays no part in that Mode's Generations.
_Avoid_: branch, route, sub-workflow

**Model terms**:
A Model's own terms and license link, which a user acknowledges before using that Model, and again when the Model terms change.
_Avoid_: license note, disclaimer, EULA

**Attribution**:
A Model's credit line (for example "Powered by MiniMax H3"), shown with the Model and its Generations.
_Avoid_: license note, credit, watermark

### Generating

**Generation**:
One request to produce output from a Model in a chosen Mode with chosen Input values. A Submission creates one or more Generations that differ only by seed. A test Generation is one an Admin runs from the Model editor to try a Mode, even on a disabled Model; it doesn't count toward Caps.
_Avoid_: job (queue mechanics), prompt (ComfyUI's word for one execution), run, render

**Submission**:
One press of Generate: it creates 1–4 Generations that share the Model revision, Mode and Input values and differ only by seed. A user can cancel or delete a whole Submission.
_Avoid_: batch, multi-generation request, job

**Upload**:
A file a user supplies as an Input value, such as a reference image, video or audio clip. Trimming one makes a new Upload, trimmed from the original; a Generation uses the Uploads it actually sends.
_Avoid_: reference (names the Input's purpose, not the file), attachment

**Asset**:
A file a Generation produced (video, image or audio), owned by the user who requested it.
_Avoid_: output, result, media

**Gallery**:
A user's own view of all their Generations across every Model, under way or ended, shown by Submission with their Assets. A Model page shows only that Model's latest few.
_Avoid_: history, library

**Cap**:
A per-user limit on Generations: the daily cap limits how many a user submits in a rolling 24 hours, the concurrent cap how many they have under way at once. Each comes from the Site settings unless an Admin overrides it for that user.
_Avoid_: quota, credits, limit (Upload limits are a different thing)

**Notification**:
A message a user's own browser shows when one of their Submissions ends, raised by an open studio tab once the user has turned notifications on in that browser.
_Avoid_: alert (what the Operator's monitor sends), Notice (an Admin's banner to everyone), push

### Administration

**Operator**:
The person or organisation who runs an instance of the studio: deploys it, owns its configuration and the GPU machines behind its Backends, and answers for the Models it offers. Often an Admin too, but the role is outside the app.
_Avoid_: self-hoster, host, owner

**User**:
A person who has signed in with Google. A user is pending (waiting for an Admin's approval), active, or disabled (barred from signing in, their running work stopped, their files kept).
_Avoid_: account, member, customer

**Admin**:
A user allowed into the admin panel. An Admin named in the Operator's configuration is pinned: the admin panel cannot demote, disable or delete them.
_Avoid_: moderator, owner, superuser

**Audit entry**:
A record of one save of something Admins control (a Model with its Inputs and Modes, a Backend, a user, the Site settings, a Removal), made by an Admin, by the system, or by a user deleting their own account: who, what, when, before and after. Before and after are snapshots of the changed fields, not a stored diff; see Audit page. Admins are named in it; a user who isn't an Admin appears without their name or email, so deleting the account leaves neither behind.
_Avoid_: log, history, changelog

**Audit page**:
The admin panel page listing every Audit entry, newest first, filterable by actor, target type, target, action and date. It computes each entry's diff at display time from its stored before/after snapshots (ADR 0007), rendered per target type: a Backend's credentials show as set/changed/unchanged/cleared, never their value; a Model's Workflow shows by its id and hash, never its full graph; a Site terms save shows the full accepted text and whether it asked everyone to re-accept. An Admin actor is named; any other actor shows by id, with the name looked up live from the users table, reading "Deleted user" once the account is gone. A History link on the thing that changed (Site settings first; later a Model, a Backend, a user) opens the Audit page filtered to it.
_Avoid_: log page, activity feed, changelog

**Log entry**:
An operational record (error, warning or info) about the app or a Backend, kept for diagnosis. Distinct from Audit entries.
_Avoid_: audit, event

**Problem**:
A condition the studio reports to Admins and to the Operator's outside monitor for as long as it lasts, such as a Model with no usable Backend or a disk running low. It clears itself when the condition ends; nobody acknowledges or closes it.
_Avoid_: alert (what the Operator's monitor sends), incident, issue (a validation error)

**Site settings**:
The admin-editable site-wide settings: branding (title, logo, which is also the favicon, background image, an accent colour picked from a fixed palette, and the landing text shown to signed-out visitors), whether new users need an Admin's approval, the default Caps, the contact (for reports and account questions) shown on every page, the blocked words refused in prompts, the Site terms, the Operator's part of the Privacy policy, up to three extra footer links, the Notice, and whether generating is Paused.
_Avoid_: config, preferences

**Notice**:
A short message an Admin writes in the Site settings, shown as a banner on every page to everyone, signed in or out: for example, a planned maintenance window. It shows whenever an Admin has set it, and always during a Pause, with a standard message when blank.
_Avoid_: announcement, alert (what the Operator's monitor sends), banner (that is how it is shown), notification (a browser's message about the user's own Submission)

**Pause**:
An Admin stopping generating across the whole studio for maintenance until an Admin resumes it. New Submissions are refused; queued Generations wait without failing; those already under way finish; only test Generations start. Signing in, browsing, Uploads and downloads carry on.
_Avoid_: maintenance mode, freeze, lockdown, drain (draining is one Backend taking no new Generations)

**Site terms**:
The terms a user accepts before using the studio, when an Admin has set them in the Site settings. Anyone can read them, signed in or not. Each acceptance records the version accepted.
_Avoid_: ToS, agreement, policy (the Privacy policy is a separate page)

**Privacy policy**:
The public page telling visitors what the studio keeps about them: the Operator's own text from the Site settings, followed by a section the studio writes from its own configuration, which no Admin can edit. Nobody accepts it; it informs.
_Avoid_: privacy notice, data policy, terms

**Removal**:
An Admin deleting a user's Generation or Upload for breaking the rules. Unlike a user's own delete, the owner sees that it was removed.
_Avoid_: takedown, moderation, ban
