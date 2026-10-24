---
status: accepted
---

# `checkModel` is a pure function of a Model and ComfyUI's `object_info`

ADR-0001 already decided two Path errors and three warnings for the Model editor. The full rail needs far more: binding problems, value-range problems, and Backend compatibility. We decided all of it lives in one pure function, `checkModel(model, objectInfo)`, called with the Admin's in-progress edits (not just the saved revision) and the `object_info` of every Backend attached to the Model. It returns a flat list of Issues, each with a severity (`error` or `warning`), a message, and enough of a path (Mode id, Input id, node id/field) for the rail and the inline form to both point at it. Nothing about it touches the database, the dispatcher, or a live Backend connection beyond the `object_info` it's given, so it runs identically in the editor's live rail and in the save-route guard, and it is unit-tested without a GPU.

`object_info` is ComfyUI's `GET /object_info` response: per node class, its input slots (which are links vs. widgets, and for widgets, type, and for numeric widgets, `min`/`max`/`step`/`options`) and whether it is `OUTPUT_NODE`. The editor fetches it once per attached Backend and caches it; `checkModel` takes the already-fetched map so it stays pure.

## Rules

Errors (block enabling, and block saving an enabled Model):

- a binding names a node id or field that doesn't exist in the Workflow (**missing**), or a Mode's named output node doesn't exist, isn't `OUTPUT_NODE: true` in `object_info`, or is a preview-only node (**non-output or preview output node**) — the Path error from ADR-0001, generalised to any binding;
- a binding whose Input type doesn't match the Node field's type in `object_info` (**incompatible binding**), or that targets a field the Workflow already feeds from another node's output (**link-fed binding**): a widget value can't override a link;
- two Inputs bound to the same Node field (**two Inputs on a field**);
- two seed Inputs on one Model: a Submission varies only one seed across its Generations, so a second seed Input has nothing to drive (**two seed Inputs**);
- a select Input's options, or any fixed value, that falls outside the bound field's `object_info` options or numeric range (**select or fixed value outside options or range**);
- an Input's configured min/max wider than the bound field's `object_info` range (**number range outside a bound field's range**);
- an INT field's `object_info` step grid not respected by the Input's default, fixed value, or configured range — ComfyUI accepts only `min + k * step`; the message states the grid in those terms, e.g. "This field takes 1 + a multiple of 4" for `min: 1, step: 4` (**step grid**);
- any binding to `filename_prefix`: the studio owns output naming and storage paths, so this field is never user- or admin-controlled (**bound `filename_prefix`**);
- a Mode whose Path no *attached* Backend's `object_info` covers in full — every attached Backend is missing at least one node class the Path needs (**a Mode no attached Backend can run**);
- a binding surviving a Workflow re-upload only by node id or field name, where the node's type or slot shape changed underneath it (**broken bindings**) — same underlying case as "missing", called out separately because it's reached by editing the Workflow, not the binding.

Warnings (never block):

- a visible Input (shown or required by some Mode) bound to nothing on that Mode's Path — ADR-0001's existing warning, which `checkModel` now reports per Mode rather than once;
- a fixed value set on a field that isn't on any Mode's Path that uses it — ADR-0001's existing warning;
- two Modes with the same Path and the same fixed values, making one indistinguishable from the other (**duplicate Modes**) — ADR-0001's existing warning;
- a Mode that *some* but not all attached Backends can run (**some Backends can't run a Mode**) — the same per-Mode `object_info` coverage check as the error above, but a warning when at least one attached Backend still covers it, since a Generation can still be dispatched there;
- an attached Backend that was unreachable when `object_info` was last fetched, so it is skipped from every Mode's coverage check rather than being treated as missing every node (**an unreachable Backend skipped**) — treating it as covering nothing would wrongly flag every Mode as unrunnable the moment one Backend naps.

Uploads and Caps/points get their own checks in their own tickets; `checkModel` doesn't touch either.

## Considered Options

- **A Zod schema with custom refinements**, reusing the shared validation builder from the Input-validation work. Rejected: most rules compare a binding against live `object_info`, which a static schema can't hold, and several rules (duplicate Modes, Backend coverage) are cross-field checks across the whole Model, not one field's shape.
- **Splitting the check into several functions** (one for bindings, one for values, one for Backend coverage), called separately by the rail and the save route. Rejected: the rail and the save-route guard must agree on exactly the same Issues or an Admin could hit a save-time error the rail never showed; one function with one return shape is the only way to guarantee that.
- **Running checks against the saved revision only**, recomputing on save. Rejected: the rail has to update as the Admin types, before anything is saved, which is the entire point of #49.

## Consequences

- The Model editor header reads the current `checkModel` result on every keystroke that could change it. While any error is present, an enabled Model's "Save" button is replaced by "Save and disable"; a disabled Model keeps a plain "Save", errors or not. "Enable" is disabled while any error is present.
- The Backends section renders the per-Mode coverage check directly: for each Mode, which attached Backends can't run it and the first missing node class, named with its node pack, e.g. "Can't run Outpaint: missing ImageCompositeMasked (pack: comfyui-inpaint-nodes)." The node-class-to-pack lookup is static data shipped with the studio, not inferred from `object_info`.
- `checkModel` is called with the Admin's unsaved edits for the rail, and again inside the save route's transaction with the same arguments it's about to persist, so a stale rail (e.g. a Backend going unreachable between render and submit) can never let an errored, enabled Model reach the database.
- ADR-0001's Model-editor bullets are superseded by the fuller rule list above; its Path decision (how the Path itself is computed) stands unchanged.
