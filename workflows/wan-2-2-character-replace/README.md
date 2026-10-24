# Wan 2.2 Character replace

Status: **blocked on hardware access** (see below). This folder is the
landing spot for the reshaped Workflow and exported Model file once someone
with a reachable 2×3090 test Backend finishes the build in #80.

## Why this isn't built yet

#80 requires building the Workflow inside ComfyUI on the launch 2×3090
Backend and running its six GPU checks (loop node support, int8 vs fp8,
size-fits-24GB, timing, frame-count/sync, point placement) before the
Workflow and Model files can be committed. No GPU Backend is reachable from
an agent sandbox: `tailscale status` shows only this host and one offline
peer, neither a ComfyUI machine, and `docs/ops/backend-kit.md` confirms
Backends sit on a private Tailscale network the Operator sets up on the GPU
hosts themselves. Checking in an un-run Workflow/Model pair would mean
guessing the fallback branches (int8 vs fp8, exact max size, max run time)
instead of measuring them, which is exactly what the GPU checks exist to
prevent.

This README instead pins down everything that doesn't need a GPU to settle,
distilled from `docs/research/wan-2-2-modes.md` (branch
`research/wan-2-2-modes`) and issue #29, so the remaining hands-on work is
just: open ComfyUI, build per spec below, run the six checks, export.

## Node packs and weights (pin before installing on the Backend)

| Pack / weight | Pinned ref | Why |
|---|---|---|
| ComfyUI core | ≥ v0.42.0 (tested at `1a82e6d`) | native `WanAnimateToVideo`, `ModelSamplingSD3` |
| comfyui_controlnet_aux (`DWPreprocessor`) | `59b027e` (template pin) | DWPose body/face preprocessing |
| ComfyUI-KJNodes (`PointsEditor`, `GrowMask`, `BlockifyMask`) | `e81f335` (template pin) | points-on-frame-0 Input, mask post-processing |
| ComfyUI-segment-anything-2 (`Sam2Segmentation`, `DownloadAndLoadSAM2Model`) | `c59676b` (template pin) | SAM2 mask propagation from points |
| VideoHelperSuite | latest compatible with the above | video load/save helpers used by the reshaped loop |
| `wan2.2_animate_14B_int8_convrot` | Comfy-Org/Wan_2.2_ComfyUI_Repackaged, ~18.4 GB | primary checkpoint per spec; fallback `..._fp8_e4m3fn_scaled_KJ` (~17.1 GB) if int8 convrot isn't supported by the Backend's ComfyUI build |
| `lightx2v` I2V 480p rank64 LoRA | template pin | strength 1 per spec |
| `WanAnimate_relight_lora_fp16` | template pin | strength 1 per spec |
| `sam2_hiera_base_plus.safetensors` | HF `Kijai/sam2-safetensors` | SAM2 weights, auto-downloaded by the pack on first run |
| `yolox_l.onnx`, `dw-ll_ucoco_384_bs5.torchscript.pt` | fetched by comfyui_controlnet_aux | DWPose detection/pose models |

Disk: ~18.4 GB (int8) or ~17.1 GB (fp8 fallback) for the checkpoint, plus
LoRAs and preprocessing weights, per launch Backend GPU.

## Build spec (from #80 and #29)

- Base: the official Animate template (`video_wan2_2_14B_animate.json`,
  "Mix"/character-replace branch — `background_video` and `character_mask`
  connected).
- Checkpoint: int8 convrot; fall back to fp8 if the Backend's ComfyUI can't
  load it.
- LoRAs: lightx2v and `WanAnimate_relight_lora_fp16`, both strength 1.
- Sampler: `KSampler`, 6 steps, cfg 1, euler; `ModelSamplingSD3` shift 8.
- Preprocessing runs **once**, outside the per-segment loop: `DWPreprocessor`
  (pose + face) and `Sam2Segmentation` (SAM2, prompted from `PointsEditor`
  points on frame 0 only, after the source has been scaled and centre-cropped
  by `ImageScale` — the point-picker UI must show the same scaled/cropped
  frame 0 so clicks line up).
- Segmentation into chunks: the template's native chunking is 77 frames per
  `WanAnimateToVideo` pass, each "Video Extend" adding ~72 *new* frames (77
  minus 5 overlap, from `docs/research/wan-2-2-modes.md`); #80 asks for
  segments that add 76 frames each — this needs the per-GPU-check #1 (does
  this Backend's ComfyUI support a core `StartLoop`/`EndLoop` rebuild, i.e.
  Animate v1 generalized the way Wan Animate 2's template does, needs
  ComfyUI ≥ 0.36) to decide between a `StartLoop`/`EndLoop` rebuild (preferred,
  trims the output to exactly F frames) and the template's native fixed
  Extend-chunk chain (fallback, output length capped by however many Extend
  subgraphs are wired in).
- Output: 30 fps (matches `wan_animate_14B.py`'s native `sample_fps`, not the
  template's `CreateVideo` default of 16 — the fps field must be overridden),
  muxed with the source's own audio (from `GetVideoComponents`), trimmed to
  exactly F frames, one `SaveVideo` node (the template's `CreateVideo` +
  implicit save must be replaced/consolidated into a single explicit
  `SaveVideo`).
- Known template quirk to fix while reshaping: inside the Extend subgraph the
  `width` input is wired to both `width` and `height` of `WanAnimateToVideo`
  — rewire so height comes from its own primitive.

## The six GPU checks (to run on the real Backend, with fallbacks)

1. Does the loop drive Wan Animate v1 (core `StartLoop`/`EndLoop`,
   needs ComfyUI ≥ 0.36)? Else fall back to the template's native fixed
   Extend-chunk chain.
2. Does the Backend's ComfyUI load the int8 convrot checkpoint? Else fall
   back to fp8 (`wan2.2_animate_14B_fp8_e4m3fn_scaled_KJ`).
3. Do the spec's sizes fit the 3090's 24 GB? Else fall back to the largest
   width/height multiple of 16 that fits.
4. Time a representative 10 s run; the max allowed run time is 2× that,
   rounded up to the next 5 minutes, floored at 30 minutes.
5. Confirm exactly F frames come out at 30 fps and stay in sync with the
   source audio, including a variable-frame-rate source and a 1-second clip
   (edge cases for the segment-chunking math).
6. Confirm a clicked point lands on the character it was clicked on (the
   scaled/cropped frame shown to the user must exactly match what
   `Sam2Segmentation` sees).

## What's left

- [ ] Run the six checks above on the 2×3090 test Backend and record which
      fallback (if any) each one took.
- [ ] Export the reshaped Workflow (API format) into this folder.
- [ ] Export the Model (one Mode, "Character replace"; Apache-2.0, no Model
      terms) via the exporter from #73 into this folder.
- [ ] Add per-Mode `checkModel`/`buildPrompt` digest snapshot tests
      (`packages/shared/src/workflow/check-model.test.ts` pattern) that load
      the committed Model file.
