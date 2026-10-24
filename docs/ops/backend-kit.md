# Backend kit

How an Operator turns a GPU machine into one or more private, tidy Backends.
Each Backend is one ComfyUI server pinned to one GPU, reachable only over the
private network, with its studio files cleaned up daily. See
[ADR-0004](../adr/0004-comfyui-is-the-only-backend-kind.md) for why ComfyUI is
the only Backend kind, and `CONTEXT.md` for what a Backend is in this studio.

## Files

- `ops/comfyui/comfyui@.service` — systemd template unit, one instance per
  GPU (`comfyui@0.service`, `comfyui@1.service`, …).
- `ops/comfyui/comfyui-cleanup@.service` + `comfyui-cleanup@.timer` — daily
  deletion of files under that GPU's `input/studio` and `output/studio`
  older than 24 hours.
- `ops/comfyui/env.d/0.env.example` — example per-instance environment file.

## Installing a GPU as a Backend

For each GPU on the host, pick an index starting at 0 (matching the index
`nvidia-smi` reports) and:

1. Install ComfyUI under `/opt/comfyui/<index>` with its own virtualenv at
   `/opt/comfyui/<index>/venv`, pinned to the [ComfyUI version](#comfyui-version)
   below. Each GPU gets its own ComfyUI install — they are never shared —
   so a bad custom node or a stuck process on one GPU can't take another
   down.
2. Install that launch Model's [node packs and weights](#node-packs-and-weights-per-launch-model)
   into that install.
3. Copy `ops/comfyui/env.d/0.env.example` to `/etc/comfyui/<index>.env` and
   fill in `BACKEND_IP` (the host's private IP, the same for every instance
   on that host), `BACKEND_PORT` (8188 + index), and `MAX_UPLOAD_MB`.
4. Copy the three unit files into `/etc/systemd/system/`, then:

   ```
   systemctl daemon-reload
   systemctl enable --now comfyui@<index>.service
   systemctl enable --now comfyui-cleanup@<index>.timer
   ```

`comfyui@<index>.service` pins the GPU with `--cuda-device <index>`, listens
only on the private IP and port from its env file, raises
`--max-upload-size` to `MAX_UPLOAD_MB`, and passes `--disable-partner-nodes`
so a Workflow that depends on Comfy.org's partner API nodes fails the admin
panel's missing-node-type check instead of silently reaching the internet
(see [Remote-inference node packs](#remote-inference-node-packs-unsupported)).

## The private network

The Operator runs [Tailscale](https://tailscale.com) on the VPS host and on
every GPU machine, as a system service on the host — **not** inside the
studio's Compose stack. The studio's container only ever reaches Backends
over this private network; nothing ComfyUI serves is reachable from the
public internet.

Backends are registered in the admin panel by their **private Tailscale
IP** (`100.x.y.z`, from `tailscale ip -4` on that GPU machine), not by
MagicDNS hostname. The studio's own container sits on Docker's network, not
Tailscale's, so it can reach a Backend's IP over the host's routing but
cannot resolve MagicDNS names — those only resolve through Tailscale's own
DNS, which the container doesn't use. If a GPU machine's Tailscale IP ever
changes (re-authing the node, re-creating the machine), update the Backend's
address in the admin panel.

## Node packs and weights per launch Model

The admin panel's Model editor checks a Workflow's node types against what
its Backend actually has installed and reports any as missing — it doesn't
run anything else first. Install these before pointing a Model at a
Backend.

### LTX 2.5 (`workflows/ltx-2-5-all-in-one.ui.json`)

Custom node packs:

- [rgthree-comfy](https://github.com/rgthree/rgthree-comfy) — Power Lora
  Loader, Any Switch, Fast Groups Bypasser, Label, Set/Get.
- [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) —
  video/audio load and combine nodes.
- [ComfyUI-GGUF](https://github.com/city96/ComfyUI-GGUF) — the UNET GGUF
  loader, for the quantized checkpoints this Workflow can use.
- [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) — VAE loader
  and model preview override.
- [ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts) —
  the Math Expression node.
- [mxToolkit](https://github.com/Smirnov75/ComfyUI-mxToolkit) — the mxSlider
  widget.
- [ComfyUI-LTXVideo](https://github.com/Lightricks/ComfyUI-LTXVideo) — the
  LTX IC-LoRA loader, resolution selector and latent upscale model loader.

Weights (into ComfyUI's usual `models/` subfolders): the LTX 2.5 diffusion
model (or its GGUF quantization), its text encoder and VAE, and the IC-LoRA
weights the Workflow's Power Lora Loader nodes point at. Match whatever
checkpoint filenames the Workflow's loader nodes already carry, or update
those nodes in the Model editor after installing different ones.

### Wan 2.2

The Workflow for this launch Model hasn't landed in `workflows/` yet, so
this section is an assumption to revisit once it does: Wan 2.2 Character
replace is expected to run on ComfyUI's native Wan nodes (no extra node
pack), needing the Wan 2.2 diffusion weights, the UMT5-XXL text encoder and
the Wan VAE. Re-check the Model editor's missing-node-type report against
the real Workflow before relying on this list.

## ComfyUI version

- **Minimum: v0.26.0.** Earlier builds don't have `--disable-partner-nodes`,
  which every Backend needs (see above).
- **Tested version (the contract pin): v0.26.2.** This is the exact build
  the Workflows under `workflows/` were authored and tested against —
  install this version unless you're deliberately testing an upgrade.
  Bump this doc alongside the next Workflow update that's verified against
  a newer ComfyUI. The same pin is what CI's "ComfyUI contract" job
  installs (CPU-only) to run the comfyui module's own contract suite
  against (issue #79) — see
  `apps/server/src/comfyui/contract.e2e.test.ts`.

## Remote-inference node packs: unsupported

Per [ADR-0004](../adr/0004-comfyui-is-the-only-backend-kind.md), Workflows
that hand inference to another server — Comfy.org's partner API nodes,
vLLM-Omni or SGLang client nodes, or any other node pack that calls a
remote inference service — are not supported. They drop progress reporting,
ignore cancel for as long as the remote job runs, often call out without
credentials, and can send prompts and Uploads to a third party outside the
private network.

`--disable-partner-nodes` plus the Model editor's missing-node-type check
catch Comfy.org's own partner nodes automatically. Nothing in ComfyUI
blocks a different node pack from making its own outbound network calls, so
don't install one on a Backend, and reject any Workflow that uses one in
review.
