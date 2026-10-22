---
status: accepted
---

# ComfyUI is the only kind of Backend

Every Backend is a ComfyUI server. A Model is one Workflow, and its Inputs write into Node fields. The Generation lifecycle relies on ComfyUI's `/upload`, `/prompt`, `/ws`, `/api/jobs` (including cancel), `/system_stats` and `/view`. The studio has no Backend `kind` and no generic Backend interface: all ComfyUI calls live together in one module.

The deciding reason is what a second kind would cost compared with what it would give. vLLM-Omni's gains are multi-GPU speed for a single Generation and batching. On the launch machine (2× RTX 3090), LTX 2.5 already fits on one card, and the largest gain is MiniMax H3 split across both cards, which needs at least 200 GiB of host RAM and does not gate launch.

## Considered Options

- **A vLLM-Omni (or SGLang) Backend kind.** This would need a second contract that binds Inputs to request form fields instead of Node fields. Modes would have no Path, because a task is picked through `extra_params`. Each server serves one model, so it could not be shared across Models. It reports no live progress, since `progress` is set only at completion. Health checks, dispatch and restart recovery would each need a second path. It also covers fewer capabilities: LTX T2V and first-frame I2V only, and no Wan Animate. It does offer real cancel and bearer auth.
- **A `kind` column or a generic Backend interface kept as a seam.** Rejected. Both build for a kind we ruled out, and that kind's Input-binding contract cannot be predicted today.
- **Workflows that hand inference to another server through node packs** (vLLM-Omni, SGLang, ComfyUI partner API nodes). These keep the Model shape, but they lose progress, ignore interrupts (a cancel holds the Backend for up to 30 minutes while the remote job runs on), call their server without credentials, or spend money and send prompts and Uploads to Comfy.org. Not supported.

## Consequences

- The Backend setup docs start ComfyUI with `--disable-partner-nodes`, so a Path containing a partner node fails the Model editor's check as a missing node type. The docs list remote-inference node packs as unsupported, with the caveats above. The studio does not inspect node packs.
- The studio never knows how many GPUs a Backend uses. The docs recommend one Backend per GPU, so Generations run in parallel. For a Model too big for one card, they describe placing part of it on a second card (`SelectCLIPDevice` and similar nodes), which makes that Backend span both GPUs.
- Multi-GPU speed for a single Generation is unavailable in v1. Adding vLLM-Omni or SGLang later is a new effort, starting from the ComfyUI module.
