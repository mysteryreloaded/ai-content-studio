# LTX 2.5 all-in-one Model — blocked for agent work (issue #81)

Issue #81 is labeled `ready-for-human`, meaning it requires human implementation
rather than an AFK agent (see `docs/agents/triage-labels.md`).

This ticket needs a running ComfyUI instance and a real 2×3090 GPU backend to:

- reshape `ltx-2-5-all-in-one.ui.json` interactively (node rewiring, grafts,
  switch/loader removal) per the spec in #28
- run the required GPU checks (per-Mode end-to-end runs, VRAM fit at
  1080p×10s and 720p, lora-loading verification, sampler/strength tuning)
- export the reshaped workflow to API format and commit the Model file

None of that is practical to do blind from an agent worktree without the
ComfyUI UI and GPU access. No workflow or Model files were changed here.

Remaining blockers at the time of writing: #41, #49, #51, #60, #73, #78.

Recommendation: keep #81 assigned to a human with GPU/ComfyUI access, or
split out a narrower, clearly agent-doable slice (e.g. the `checkModel` /
`buildPrompt` snapshot-test harness, once the Model file exists) and label
that slice `ready-for-agent`.
