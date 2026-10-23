---
status: accepted
---

# A Mode runs only its Path; switches steer choices inside it

A Model has exactly one Workflow, yet one Workflow (LTX 2.5's all-in-one) covers many Modes. We decided that each Mode names the output nodes that produce its Assets. For each Generation, the studio sends the Backend only that Mode's Path: those nodes plus every node they depend on, found by following links upstream. Nodes are removed; links are never changed.

When working out the Path, the studio follows only the chosen side of a core `ComfySwitchNode` whose value is known before sending. That value may be written into the switch itself or into a primitive node feeding it. Switches therefore steer choices *inside* a Path, such as which motion guide to follow; they do not pick the Mode.

We chose this because it is the only option where another Mode's nodes never reach the Backend. That means no placeholder Upload files, no node packs needed for Modes not being run, and no stray loaders or VRAM use. It works on any ComfyUI version and on any Backend that accepts an API graph, and Path computation is a pure function that can be tested without a GPU.

## Considered Options

- **Bypass groups, as ComfyUI users usually build all-in-ones.** Bypassed and muted nodes are dropped on API export, so an export holds only the Mode active at export time. Replaying bypasses server-side from the UI save would need frontend-only logic: KJNodes Set/Get, subgraph flattening and widget mapping.
- **One API export per Mode.** This breaks "one Workflow per Model" and means re-exporting N times on every Workflow change.
- **Switch chains selecting the Mode.** rgthree Any Switch is not lazy, so every connected branch runs. Core `ComfySwitchNode` is lazy, but ComfyUI validates both sides, so every hidden Upload needs a placeholder file on every Backend. Eight Modes need seven switches per stream.
- **`partial_execution_targets` on `POST /prompt`.** It is ComfyUI-only (v0.3.48+) and silently ignores unknown target ids. Every node type in the whole Workflow must still be installed. `IS_CHANGED` still runs on every node, including other Modes' loaders.

## Consequences

- Workflows must give each Mode its own output node(s). Shared merge points such as Any Switch → one save node, and side outputs such as a preview node on a loader, are not allowed.
- A variant that changes which Uploads are needed is a separate Mode; a variant with the same Uploads is an Input steering a switch. Several Modes may share one Path.
- The Model editor checks each Mode's Path through `checkModel`, a pure function of the Model and ComfyUI's `object_info` (ADR-0049), which absorbs and extends the Path-specific errors and warnings first decided here:
  - no output node named, or a node that is not an output node (error);
  - an Upload loader on the Path with neither a visible Input nor a fixed value (error; Upload checks themselves land with their own ticket);
  - a visible Input that binds to nothing on the Path, a fixed value outside the Path, and duplicate Modes (warnings).
- `ComfySwitchNode` is marked experimental in ComfyUI. If it is renamed, its branches simply stay on the Path, and the editor's Upload-loader error surfaces the breakage.
