# LTX 2.5 in ComfyUI: capabilities, Workflows, Node fields and Modes

Research for ticket `03-ltx-2-5-modes`, done on 2026-10-22. Terms follow `CONTEXT.md` (Model, Workflow, Node field, Input, Mode, Upload, Backend).

Scope: the **local open-weights** model (`Lightricks/LTX-2.5`) running in ComfyUI. That covers native core nodes plus Lightricks' `ComfyUI-LTXVideo` pack. The paid hosted "partner" API nodes are kept separate (see "Paid API nodes"). Sources are source code and workflow JSON cloned at the commits listed under Sources, plus first-party docs and model cards. No code was run, and no Workflow was executed.

## Summary

- **One base model covers almost everything.** Every official LTX 2.5 Workflow uses the same distilled 22B transformer, the Gemma 4 12B text encoder, a video VAE and an audio VAE. Capabilities differ by graph shape (conditioning nodes, one/two/three stages) and by an optional **IC-LoRA** of about 1.3 GB. A Mode change in an all-in-one Workflow therefore swaps at most a LoRA, an upscaler or an annotator, never the base weights. That makes an all-in-one Workflow more practical for LTX 2.5 than for Wan 2.2.
- **Supported locally, with official graphs:**
  - text-to-video, image-to-video, first/last frame (all with joint audio by default);
  - DFR "production" T2V/I2V, with an optional temporal ×2 to 48 fps;
  - audio-to-video (a soundtrack drives the video) and text-to-audio;
  - depth/canny/pose control from a reference video (Union Control IC-LoRA);
  - motion paths drawn on a still (Motion Track IC-LoRA);
  - reference-sheet character, prop and location consistency (Ingredients IC-LoRA);
  - masked inpaint and outpaint of a video;
  - fixed-effect video-to-video IC-LoRAs (clean plate, day-to-night, deblur, colorize and others);
  - latent ×2 upscale, tiled upscale to FullHD/4K/8K, and HDR;
  - native multishot (driven by the prompt);
  - auto duration (a core node exists, but no template uses it).
- **Not supported, or no official local path:**
  - **character replacement** that keeps the rest of the video;
  - **general prompt-driven editing** of an existing video ("make it night" as an instruction);
  - **video extension** in ComfyUI;
  - an official **identity/voice reference LoRA** for 2.5;
  - Foley and Dub-It on 2.5.

  Closest substitutes: inpaint with a mask video, Union Control with a new prompt and a start image, effect IC-LoRAs, and the Python-only Retake and chunked pipelines.
- **Rules every Mode must obey:**
  - the frame count must be 8n+1;
  - width and height must be multiples of 32, which in practice means 64 on two-stage graphs, because stage 1 runs at half size and the latent floors to 32;
  - the default rate is 24 fps;
  - sampling is distilled at CFG 1, so the **negative prompt has no effect** in the stock graphs.

  ComfyUI does not enforce the step sizes, so the studio has to.
- **No official all-in-one Workflow exists.** The official graphs switch only small things, always through `PrimitiveBoolean` values:
  - T2V↔I2V via `LTXVImgToVideoInplace.bypass`;
  - prompt enhancer on/off and local vs LTX-API text encoding via `ComfySwitchNode`;
  - the DFR temporal stage and tiled decode via `ComfySwitchNode`.

  Union Control picks its annotator by **re-wiring**, not by a switch. Community "all-in-one" graphs cover only T2V, I2V, FLF and extension. They depend on extra packs (rgthree group bypassers, Easy-Use index switches and others) whose bypass state is lost on API export.
- **VRAM:** Lightricks gives 32 GB+ as the minimum and 80 GB (A100/H100) as recommended. The int8 "convrot" files (transformer 21.5 GB, encoder 15.4 GB) are what the Comfy-Org templates load. Community authors claim 12–24 GB for int8 T2V/I2V with offloading. There are no official per-Mode or per-resolution figures.

## Capability table

"LX" means `Lightricks/ComfyUI-LTXVideo/example_workflows/2.5/`. "CT" means `Comfy-Org/workflow_templates/templates/`. Unless noted, every row also uses the shared core nodes (`UNETLoader`, `CLIPLoader` type `ltxv`, `VAELoader`×2, `CLIPTextEncode`, `LTXVConditioning`, `EmptyLTXVLatentVideo`, `LTXVEmptyLatentAudio`, `LTXVConcatAVLatent`, `SamplerCustomAdvanced`, `ManualSigmas`, `RandomNoise`, `LTXVSeparateAVLatent`, `VAEDecodeTiled`, `LTXVAudioVAEDecode`, `CreateVideo`, `SaveVideo`).

| Capability | Local support | Official Workflow | Key extra nodes (class_type) | Node fields a user Input would set | Constraints / extra weights |
|---|---|---|---|---|---|
| Text-to-video (+audio) | **Yes** | CT `video_ltx2_5_t2v`; LX `LTX-2.5_T2V_I2V_Two_Stage_Distilled` (or `_Single_Stage_`) | `LTXVLatentUpsampler`, `LatentUpscaleModelLoader`, `LTXVDualCFGGuider`, `TextGenerateLTX2Prompt` + `ComfySwitchNode` (enhancer) | `PrimitiveStringMultiline` "Prompt".`value`; `PrimitiveInt` "Width"/"Height".`value`; `PrimitiveInt` "Duration".`value` (CT, integer s) or `PrimitiveFloat` duration (LX); `PrimitiveInt`/`PrimitiveFloat` "Frame Rate".`value`; `RandomNoise.noise_seed` (stage-1 node); `PrimitiveBoolean` "Enable Prompt Enhance".`value` | stage 1 at w/2×h/2, ×2 latent upscale, 3-step refine → output w,h effectively multiples of 64 (1280×720 → 1280×704); frames 8n+1; spatial upscaler 1.0 GB; enhancer model about 5 GB |
| Image-to-video | **Yes** | CT `video_ltx2_5_i2v`; LX two/single-stage T2V_I2V | `LoadImage`, `ResizeImageMaskNode`, `LTXVPreprocess`, `LTXVImgToVideoInplace` (stage 1 strength 0.7, stage 2 strength 1) | `LoadImage.image`; as T2V; `PrimitiveBoolean` "Switch to Text to Video?".`value` (CT) or "use image input" (LX) → `LTXVImgToVideoInplace.bypass` | image centre-cropped to w×h; `LTXVPreprocess.img_compression` 18 |
| First/last frame | **Yes** | CT `video_ltx2_5_flf2v` (single stage) | `LTXVAddGuide` ×2 (`frame_idx` 0 and −1, `strength` 0.7), `LTXVCropGuides`, `GetImageSize` | 2× `LoadImage.image`; prompt; Width/Height/Duration/Frame Rate primitives; seed | single stage at full w×h (multiple of 32); same aspect ratio for both images; no upscaler |
| Multi-keyframe (start/mid/end) | **Partial**: core nodes allow it; no 2.5 template | — (chain more `LTXVAddGuide`) | `LTXVAddGuide` per keyframe | `LoadImage.image` + `LTXVAddGuide.frame_idx` / `.strength` per keyframe | multi-frame guides snap to 1+8k; single images any index; inferred, not run |
| DFR "production" T2V/I2V | **Yes** | CT `video_ltx2_5_dfr_i2v` | `LTXVAddGeneratedKeyframes`, `LTXVSeparateGeneratedKeyframes`, `LTXVAddLatentGuide`, `LTXVGeneratedKeyframesToGuides`, `LTXVFreezeLatent`, `LoraLoaderModelOnly` (pixel spatial upscaler IC-LoRA), temporal `LatentUpscaleModelLoader` | `LoadImage.image`; prompts; `ResolutionSelector` → `ResizeImageMaskNode.resize_type.width/height`; `PrimitiveFloat` "Float (Duration)"/"Float (fps)"; booleans "Switch to T2V", "Run 3rd stage - Temporal Upscale", "Enable Tiled Decode", "Enable Prompt Enhancer"; 3× `RandomNoise.noise_seed` | ComfyUI ≥ v0.35.0; output w,h multiples of 64; temporal ×2 → 241 frames at 48 fps for 5 s; + detailing IC-LoRA and temporal upscaler (0.26 GB) |
| Video-to-video, fixed-effect IC-LoRAs | **Yes** (one effect per LoRA) | LX `LTX-2.5_V2V_ICLoRA_Single_Stage_Distilled` | `LoadVideo`, `GetVideoComponents`, `LTXICLoRALoaderModelOnly`, `LTXAddVideoICLoRAGuide`, `LTXVSetAudioRefTokens` (source audio frozen), `EmptyAudio` + `AudioMerge` (silence fallback) | `LoadVideo.file`; prompt; `LTXICLoRALoaderModelOnly.lora_name` (effect); optional start image | size, length and fps follow the Upload; one IC-LoRA per effect (Clean-Plate, Day-To-Night, Deblur, Colorization, Decompression, Water-Simulation are 2.5; Instant-Shave is 2.3) |
| Control: depth / canny / pose ("motion tracking" from a video) | **Yes** | LX `LTX-2.5_ICLoRA_Union_Control_Distilled` (two-stage) | `LTXICLoRALoaderModelOnly` (`ltx-2.3-22b-ic-lora-union-control-ref0.5`), `LTXAddVideoICLoRAGuide`, `LTXVCropGuides`; annotators `VideoDepthAnythingProcess` (default), `CannyEdgePreprocessor`, `DWPreprocessor` | `LoadVideo.file` (reference); prompt; optional `LoadImage.image` + "use image input"; annotator choice = **re-wire** today | reference resized to 544 short side, then a multiple of 64 (ref ×0.5); output ×2; length/fps from the Upload; needs Video-Depth-Anything and controlnet_aux packs |
| Motion paths drawn on a still | **Yes** | LX `LTX-2.5_ICLoRA_Motion_Track_Distilled` (single stage) | `LTXVSparseTrackEditor`, `LTXVDrawTracks`, `LTXAddVideoICLoRAGuide` (`ltx-2.3-22b-ic-lora-motion-track-control-ref0.5`) | `LoadImage.image`; `LTXVSparseTrackEditor.points_store` (JSON splines of `{x,y}`); prompt; fps/duration primitives | tracks are in pixel coordinates of the resized image; new "track drawing" Input type needed |
| Reference-based character consistency | **Partial** | LX `LTX-2.5_ICLoRA_Ingredients_Single_Stage_Distilled` | `RepeatImageBatch` (sheet held on every frame), `LTXAddVideoICLoRAGuide` (Ingredients IC-LoRA, ref ×1) | `LoadImage.image` (one composite reference sheet); two-part prompt; fps/duration | trained at 768×448, 121 frames, 24 fps; sheet = panels on black; within one clip only. No ID/face LoRA for 2.5 |
| Character replacement (keep the rest) | **No dedicated path** | closest: LX `LTX-2.5_ICLoRA_Inpaint_Two_Stage_Distilled` | `LTXVInpaintPreprocess`, `LTXVDilateVideoMask`, `LTXAddVideoICLoRAGuideAdvanced`, `LTXVLaplacianPyramidBlend`, `LTXVSetAudioRefTokens` | `LoadVideo.file` ×2 (source + **B&W mask video**); prompt describing the filled region; optional start image; `PrimitiveInt` "Spacial radius" | mask must match the frame count and aspect; uses the 2.3 in/outpainting IC-LoRA; no reference-image input for the new character |
| Scene replacement / restyle | **Partial** | Union Control (depth/canny + new prompt + start image); V2V effect LoRAs; Layout-to-Render (graph not in repo) | as above | as above | regenerates the whole frame |
| Prompt-driven edit of a video | **No general path** | closest: V2V effect LoRAs; Tiled Fusion Native graph (stage-1 prompt describes the change, with an effect LoRA) | — | — | Retake (regenerate a time span) exists only in Python `ltx-pipelines` |
| Audio generated with video | **Yes, always on** in local graphs | all of the above | `LTXVEmptyLatentAudio`, `LTXVAudioVAEDecode` → `CreateVideo.audio` | prompt (dialogue in quotes, ambience) | audio VAE 0.36 GB; no local "audio off" switch |
| Audio-to-video (soundtrack drives video) | **Yes** | LX `LTX-2.5_A2V_Two_Stage_Distilled` | `LoadAudio`, `TrimAudioDuration`, `LTXVAudioVAEEncode`, `SolidMask` + `SetLatentNoiseMask` (freeze), original audio muxed | `LoadAudio.audio`; `PrimitiveFloat` "audio start (seconds)"; `PrimitiveFloat` "duration in seconds (video + audio trim)"; prompt; optional image | video length = trimmed audio snapped to 8n+1 |
| Text-to-audio | **Yes** | LX `LTX-2.5_T2A_Single_Stage_Distilled` | `LTXVAudioOnlyModel`, `LTXVAudioOnlyEmptyVideoLatent`, `LTXVEmptyLatentAudio` | prompt; `LTXVEmptyLatentAudio.frames_number` / `.frame_rate` (duration) | output is **audio**, not video |
| Voice/identity from reference audio | **No official 2.5 path** | 2.3 only (CT `video_ltx2_3_id_lora`) | core `LTXVReferenceAudio` (+ 2.3 ID-LoRA) | — | — |
| Video extension | **No official ComfyUI path** | — | pack `LTXVExtendSampler` (video latents; audio untested); `LTXVLoopingSampler` rejects AV latents | — | Python `ltx-pipelines --chunked` only |
| Upscale / refine | **Yes** | built into two-stage and DFR; LX `LTX-2.5_V2V_TiledFusion_Upscale` / `_Native_4K_8K` | `LTXVTiledFusionSampler`, `LTXVGetTilingSizes`, Refine-Details IC-LoRA | `LoadVideo.file`; look/style prompt; `output_size` (FullHD/4K/8K) on the Preprocess subgraph | prompt describes the look only; 4K = 3840×2176 |
| Auto duration | **Node only** | none | core `LTXVDurationPredictor` + `ModelPatchLoader` (duration head, 3.8 MB) | `frame_rate`, `min_seconds` (1), `max_seconds` (20) | outputs `num_frames` snapped to 8n+1 |
| Multishot | **Yes (prompt-driven)** | any T2V/I2V | — | prompt | 2–4 shots per clip recommended |

## Common rules (all LTX 2.5 Workflows)

**Weights** (`Lightricks/LTX-2.5`, gated; sizes from the HF file tree, 2026-10-22):

| File | Size | Used by |
|---|---|---|
| `diffusion_models/ltx-2.5-22b-distilled-transformer-bf16.safetensors` | 42.0 GB | Lightricks graphs (`UNETLoader.unet_name`) |
| `…-distilled-transformer-comfy-int8-convrot.safetensors` | 21.5 GB | Comfy-Org templates; ComfyUI only |
| `…-distilled-transformer-nvfp4.safetensors` | 18.7 GB | Blackwell GPUs only |
| `…-dev-transformer-{bf16,comfy-int8-convrot}` | 42.0 / 21.5 GB | full model; no 2.5 ComfyUI template uses it |
| `text_encoders/gemma4-12b-with-proj-ltx-2.5-{bf16,comfy-int8-convrot}` | 26.3 / 15.4 GB | every graph (`CLIPLoader`, type `ltxv`) |
| `vae/ltx-2.5-video-vae-bf16` (diffusion decoder) / `…-video-vae-conv-bf16` (lighter) | 1.47 / 1.45 GB | every video graph |
| `vae/ltx-2.5-audio-vae-bf16` | 0.36 GB | every graph |
| `latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0` / `…-temporal-upscaler-x2-…` | 1.0 / 0.26 GB | two-stage graphs, DFR / DFR temporal stage |
| `loras/ltx-2.5-22b-distilled-lora-450-bf16` | — | dev-model graphs only |
| `model_patches/ltx-2.5-duration-head-bf16` | 3.8 MB | `LTXVDurationPredictor` |
| Prompt enhancer `gemma4_e2b_it_{bf16,int8_convrot}` (Comfy-Org/gemma-4) | about 5 GB | optional, `TextGenerateLTX2Prompt` |
| IC-LoRAs | about 1.3 GB each | separate repos, see per-capability sections |

The LTX-2 README puts the basic bf16 download at about 66 GiB. Lightricks names the int8 convrot files and the conv VAE as the lower-VRAM choice, valid in ComfyUI only. (Sources: HF model card and tree; LTX-2 `README.md`; docs.ltx.io Workflow & Asset Compatibility.)

**Resolution.**
- `EmptyLTXVLatentVideo` has `width`/`height` step 32 and builds a latent of `height//32 × width//32`. It floors silently. (ComfyUI `comfy_extras/nodes_lt.py`)
- The model card requires dimensions divisible by 32.
- Two-stage graphs halve the size for stage 1 (`ComfyMathExpression "a/2"`), so a 720 input becomes 704. Effective output sizes are multiples of 64.
- DFR requires multiples of 64 (128 with `--spatial-upscalings 2`). UHD is 3840×2176, not 2160. (LTX-2 `packages/ltx-pipelines/docs/pipelines.md`)
- Lightricks graphs default to 960×544 at stage 1, which gives 1920×1088 out. Comfy-Org templates default to 1280×720 via `ResolutionSelector(aspect_ratio, megapixels 0.9, multiple 32)`.

**Frames, fps and duration.**
- The latent length is `((length-1)//8)+1`, so only 8n+1 frames are honoured.
- Comfy-Org templates compute `duration*fps+1` (`ComfyMathExpression "a * b + 1"`). At 24 fps this lands on the grid; at 25/30/50 fps it is floored (25 fps × 5 s → 126 → 121 decoded).
- Lightricks graphs compute `1 + floor(fps*s/8)*8`.
- fps reaches `LTXVConditioning.frame_rate`, `LTXVEmptyLatentAudio.frame_rate` and `CreateVideo.fps`. All defaults are 24 fps.
- Marketing says output goes up to 50 fps. DFR's temporal stage produces 48 fps (2× the base rate) over the same duration.
- The Python pipelines snap the **conditioning** fps to 60 when the playback fps is above 30. Whether ComfyUI does the same was not checked.
- **No maximum duration is published for the open weights.** Lightricks examples use 121 frames (about 5 s). The duration predictor clamps to 20 s by default. The hosted API allows 2–20 s on Fast and up to 10 s on Pro. Long clips are limited by VRAM and quality.
- The ComfyUI server validates `min`/`max` but not `step`, so the studio must enforce 8n+1 and the size steps itself.

**Sampling recipe (distilled).**
- Stage 1: 8 steps with `ManualSigmas "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0"`.
- Stage 2: 3 steps (`"0.909375, 0.725, 0.421875, 0.0"` in Lightricks graphs; `"0.85, 0.7250, 0.4219, 0.0"` in the Comfy-Org T2V/I2V templates).
- `euler_ancestral`, with CFG 1 (`CFGGuider` 1 or `LTXVDualCFGGuider` 1/1).
- At CFG 1, ComfyUI skips the unconditional pass (`comfy/samplers.py`, `sampling_function`). `LTXVDualCFGGuider` falls back to single CFG when the video and audio scales are equal. So **the negative prompt does nothing** in these graphs.
- Lightricks notes say to keep CFG close to 1. Its docs allow 1.0–1.5 for Union Control.

**Prompting.**
- One flowing, chronological paragraph of about 4–8 sentences, covering shot, scene, action, characters, camera and audio.
- Put dialogue in quotes.
- For multishot, describe each cut in prose (no special syntax); 2–4 shots per clip are recommended.
- The LTX-2 README asks for at most about 200 words. The built-in enhancer system prompt aims for roughly 150–220 words (`comfy_extras/nodes_textgen.py`).
- The Gemma tokenizer has no practical length cap (`max_length` 99999999, padded to at least 1024 tokens; `comfy/text_encoders/lt.py`). The enhancer node is set to `max_length` 600 tokens in the templates.
- The enhancer (`TextGenerateLTX2Prompt`) picks a T2V or I2V system prompt depending on whether an image is connected, and adds about 1–2 minutes. (docs.ltx.io Prompting Guide; docs.comfy.org LTX-2.5)

**Privacy.** Every Lightricks 2.5 graph contains `GemmaAPITextEncode`, which sends the prompt to `https://api.ltx.video` for remote encoding (`gemma_api_conditioning.py`). It is switched on automatically whenever the "LTX API key" string contains `ltxv_` (`StringContains` → two `ComfySwitchNode`s). With the key left empty, encoding stays local.

**VRAM.**
- Lightricks system requirements: NVIDIA with 32 GB+ VRAM, 32 GB RAM, 100 GB disk, CUDA ≥ 12.7 as the minimum; A100 80 GB or H100 with 64 GB+ RAM recommended. No per-pipeline figures. (docs.ltx.io System Requirements)
- The ComfyUI-LTXVideo README also says 32 GB+. Its low-VRAM loader nodes are meant to fit a run in 32 GB, and `--reserve-vram` is suggested.
- Tiled VAE decode settings in every graph trade speed for memory.
- Community and vendor claims (unverified): Civitai "INT8 AllInOne" says 12–16 GB in speed mode and 24 GB+ in quality mode (tested on a 16 GB RTX 5080 at 1920×1088). Civitai 2772148 says 16–20 GB for two-stage I2V. Runpod's blog says 16–24 GB is test-only with int8 plus offload, 32–48 GB runs int8 well, and 80 GB+ runs full bf16.

**ComfyUI versions.** LTX 2.5 support landed in commit 57ce8e1 (2026-08-11), first in **v0.32.0**. Generated-keyframe nodes and `LTXVAddLatentGuide` (needed by DFR) arrived in **v0.35.0** (2026-09-09). The HDR graphs need **v0.38.0**. The current release is v0.42.0 (2026-10-18).

**Graph shape.**
- Each Comfy-Org template is one subgraph containing the whole graph. Only `LoadImage`, `ResolutionSelector` and `SaveVideo` sit at the top level.
- Lightricks graphs use several subgraphs (Load Models, Input Parameters, Preprocess, Sampler, Upscale, Decode), and the prompt/fps/duration primitives sit at the top level.
- In API format, inner nodes get `host:inner` ids.
- Many fields are **linked** from primitives. For example Width → `ComfyMathExpression` → `EmptyLTXVLatentVideo.width`, and Duration × fps → `length`. Inputs must bind to the source primitive's `value`, not to the downstream field.

## Per-capability detail

### Text-to-video
- **Comfy-Org `video_ltx2_5_t2v` (2026-08-11).** The subgraph inputs map as follows:
  - `prompt` → `PrimitiveStringMultiline` "Prompt".`value`;
  - `prompt_enhance` → `PrimitiveBoolean` "Boolean (Enable Prompt Enhance)".`value`;
  - `duration` → `PrimitiveInt` "Duration".`value` (integer seconds);
  - `width`/`height` → `PrimitiveInt` "Width"/"Height".`value` (linked from the top-level `ResolutionSelector`);
  - `seed` → stage-1 `RandomNoise.noise_seed` (the stage-2 noise is fixed at 42);
  - `frame_rate` → `PrimitiveInt` "Frame Rate".`value`;
  - plus the model-file combos.
- Flow: stage 1 at half size → `LTXVSeparateAVLatent` → `LTXVLatentUpsampler` (video only) → `LTXVConcatAVLatent` with the stage-1 audio → 3-step refine → `VAEDecodeTiled` + `LTXVAudioVAEDecode` → `CreateVideo`.
- **Lightricks `LTX-2.5_T2V_I2V_Two_Stage_Distilled`** (repo 2026-10-20) is the same recipe with the bf16 files, a float duration and 960×544 → 1920×1088. The single-stage variant drops the upscaler. The docs call it the lighter, faster preview option.
- Python equivalent: `DistilledPipeline`. (Sources: CT JSON; LX JSON + `example_workflows/2.5/README.md`; ComfyUI `nodes_lt.py`, `nodes_lt_upsampler.py`.)

### Image-to-video
- **Comfy-Org `video_ltx2_5_i2v`:**
  - `LoadImage` "Load First Frame" → `ResizeImageMaskNode` ("scale longer dimension", 1536) → `LTXVPreprocess` (`img_compression` 18) → `LTXVImgToVideoInplace` on the empty latent (`strength` 0.7), then again on the upscaled latent (`strength` 1).
  - `LTXVImgToVideoInplace` resizes the image to the latent size with a bilinear centre crop (`nodes_lt.py`).
  - An inner `PrimitiveBoolean` "Switch to Text to Video?" drives both `bypass` fields. It is not promoted to the subgraph, so it is reached as `398:363` in API format. **This template is already a two-Mode (I2V/T2V) Workflow.**
- **Lightricks graphs:** the "use image input" boolean → `ComfyNotNode` → `bypass_i2v`.
- In T2V mode the `LoadImage` still has to name an existing file. The Wan research established that validation walks every linked node, and `LoadImage.VALIDATE_INPUTS` checks the file.

### First/last frame and multi-keyframe
- **Comfy-Org `video_ltx2_5_flf2v`** (single stage, no upscaler):
  - each image goes `LoadImage` → `ResizeImageMaskNode` ("scale dimensions" to Width×Height, centre crop) → `LTXVPreprocess`;
  - then `LTXVAddGuide` (`frame_idx` 0, `strength` 0.7) and `LTXVAddGuide` (`frame_idx` −1 = last, `strength` 0.7);
  - `LTXVCropGuides` removes the guide frames after sampling.
  - Guides must be added to the **video** latent before `LTXVConcatAVLatent`; the node raises an error on a combined AV latent (`nodes_lt.py`).
- **`LTXVAddGuide` fields:** `frame_idx` (−9999…9999; negative values count from the end), `strength` (0–10), optional `attention_mask`, `iclora_parameters`. A multi-frame guide's index snaps to 1+8k; single images may go at any index. Chaining more `LTXVAddGuide` nodes therefore gives start/middle/end keyframes. **No 2.5 template does this**, so it is inferred from code only.
- **Python (`ltx-pipelines` 1.5.0, 2026-10-18):** keyframe interpolation now runs through `TI2VidTwoStagesPipeline` with `--image PATH FRAME_IDX STRENGTH guide`. "Replace" bindings must sit at frame 0 or 1+8k (`CHANGELOG.md`, `docs/conditioning.md`).
- **Hosted API:** offers `last_frame_uri`, which cannot be combined with auto duration.

### DFR (production quality, T2V/I2V, optional 48 fps)
- **Comfy-Org `video_ltx2_5_dfr_i2v` (2026-09-19; index says it needs ComfyUI-LTXVideo, but every node in it is core as of v0.35+).** Three stages:
  1. half size, 8 steps, with `LTXVAddGeneratedKeyframes` (`interval_frames` 24, about one detailing keyframe per second);
  2. ×2 spatial, 3 steps, with the pixel-spatial-upscaler IC-LoRA (`LoraLoaderModelOnly`, strength 1) and the half-res result pinned by `LTXVAddLatentGuide`;
  3. optional temporal ×2, 4 steps, with keyframes pinned at 0.95 (`LTXVGeneratedKeyframesToGuides`) and audio frozen (`LTXVFreezeLatent`).
- Switches, all `PrimitiveBoolean` → `ComfySwitchNode` or `bypass`:
  - "Boolean (Switch to T2V)" (drives 3× `LTXVImgToVideoInplace.bypass` and selects the T2V or I2V enhancer prompt);
  - "Run 3rd stage - Temporal Upscale" (selects the output latent and `CreateVideo.fps` = fps or 2×fps);
  - "Enable Tiled Decode" (`VAEDecodeTiled` vs `VAEDecode`);
  - "Enable Prompt Enhancer".
- The size comes from `ResolutionSelector` → `ResizeImageMaskNode.resize_type.width/height`. Stage 1 = `floor(a/32)*32/2`.
- There are three `RandomNoise` nodes (seeds 43, 142, 1042). The promoted `noise_seed` drives all three.
- **The Python DFR fixes the detailing LoRA strength at 0.5; the ComfyUI template loads it at 1** (Open).
- Cost: the Python docs note that the keyframe-aware decode is usually where VRAM runs out (`pipelines.md`). Docs page: docs.comfy.org `tutorials/video/ltx/ltx-2-5-dfr`.

### Video-to-video with fixed-effect IC-LoRAs
- **Lightricks `LTX-2.5_V2V_ICLoRA_Single_Stage_Distilled`:**
  - `LoadVideo.file` → `GetVideoComponents` → resize → `LTXAddVideoICLoRAGuide` (`frame_idx` 0, `strength` 1, `latent_downscale_factor` from `LTXICLoRALoaderModelOnly`);
  - the source audio is VAE-encoded and frozen with `LTXVSetAudioRefTokens`; `EmptyAudio` + `AudioMerge` substitute silence when the clip has no audio track;
  - an optional start image is supported;
  - size, length and fps all come from the Upload.
- The graph ships with `ltx-2.3-22b-ic-lora-deblur-0.9` (the README says Instant Shave). Swapping `LTXICLoRALoaderModelOnly.lora_name` changes the effect.
- Lightricks 2.5 IC-LoRAs on HF (created 2026-08-11 to 09-28): Pixel-Spatial-Upscaler, Day-To-Night, Water-Simulation, Clean-Plate, Deblur, Decompression, Colorization, Ingredients, Layout-To-Render, Refine-Details, Restore, SDR-To-HDR, Alpha-Gen, plus the plain LoRAs Cinemagraph and Slow-Motion-Control.
- Clean-Plate (2.5) removes moving people and vehicles with no mask. Its prompt should describe the empty scene; it needs w/h divisible by 32, 8k+1 frames and an audio track (HF card).
- **`LTXAddVideoICLoRAGuide` fields:** `frame_idx`, `strength` (0–1), `latent_downscale_factor`, `crop` (disabled|center), `use_tiled_encode`, `tile_size`, `tile_overlap`, `use_streaming`, `tile_frames` (`iclora.py`).
- `LTXICLoRALoaderModelOnly` reads `reference_downscale_factor` from the LoRA metadata. With `strength_model` 0 it returns the model unpatched.

### Control: depth / canny / pose (Union Control)
- **Lightricks `LTX-2.5_ICLoRA_Union_Control_Distilled`:** `LoadVideo` → "Reference Video" subgraph:
  - `GetVideoComponents` → `ResizeImageMaskNode` ("scale shorter dimension" 544);
  - annotator: `VideoDepthAnythingProcess` (wired by default) or `CannyEdgePreprocessor` or `DWPreprocessor`;
  - → `ResizeImageMaskNode` ("scale to multiple", 32 × downscale factor).
- **Switching the annotator means re-wiring which output feeds the Resize** (graph note). All three annotators stay in the graph, so all three packs must be installed.
- Outputs width/height/length/fps feed Preprocess → `LTXAddVideoICLoRAGuide` (the guide is at half size because of `ref0.5`) → 8 steps → `LTXVCropGuides` → ×2 upscale + 3 steps.
- LoRA: `ltx-2.3-22b-ic-lora-union-control-ref0.5` (an LTX 2.3 adapter used on 2.5 by the official graph).
- Packs:
  - `yuvraj108c/ComfyUI-Video-Depth-Anything` (graph pins `a0db08e`);
  - `Fannovel16/comfyui_controlnet_aux` (`DWPreprocessor`, `CannyEdgePreprocessor`);
  - annotator weights download on first run.
  - Core ComfyUI has `Canny` and SDPose keypoint nodes that could replace two of these packs; untested with this LoRA.
- Docs: IC-LoRA strength 0.5–0.8 gives a softer guide. The prompt describes look and content, not motion.
- This is the "motion tracking" capability in the Wan sense (motion follows a reference video).

### Motion tracks drawn on a still (Motion Control)
- **Lightricks `LTX-2.5_ICLoRA_Motion_Track_Distilled`** (single stage):
  - `LoadImage` → `LTXVSparseTrackEditor` (`image`, `points_store` = JSON array of splines `[[{"x":…,"y":…},…],…]`, `coordinates`, `points_to_sample`, which the graph ties to the frame count) → `tracks` string;
  - → `LTXVDrawTracks` (`tracks`, `width`, `height`) renders a guide video → `LTXAddVideoICLoRAGuide` with `ltx-2.3-22b-ic-lora-motion-track-control-ref0.5`.
  - Coordinates are pixels on the resized input image. The output size follows the image.
- A web form needs a **spline/track-drawing Input** that produces that JSON.
- docs.ltx.io's compatibility page also names a separate "Motion Transfer IC-LoRA" and `LTX-2.5_ICLoRA_Motion_Transfer_Distilled.json`. Neither was found in the repo or on HF (Open).

### Reference-based character consistency
- **Ingredients (reference sheet):**
  - `LoadImage` (one composite sheet) → `RepeatImageBatch` (held on every frame) → `LTXAddVideoICLoRAGuide`;
  - `LTXVImgToVideoInplace.bypass` defaults to on, so the sheet does not become the first frame;
  - the prompt has a "Reference sheet:" part naming each panel by position, then a "Generated video:" part.
  - The 2.5 card (`ltx-2.5-22b-ic-lora-ingredients-0.9`, 1.31 GB) was trained at 768×448, 121 frames, 24 fps, with ref ×1. Other sizes or longer clips are out of distribution.
  - **The official 2.5 graph loads the 2.3 Ingredients file** (Open).
- **Native multishot** holds identity across cuts **within one generation**.
- Nothing official holds an identity across separate Generations beyond reusing the same sheet or first frame. HF community threads (#14, #30, #61, #67; no staff replies) report weak I2V identity on 2.5. They also say the 2.3 ID-LoRA does not carry over well.
- **Third party:** `LiconStudio/LTX-2.5-Multiple-Subject-Reference` ("MSR V2", Apache-2.0 per its card). It takes up to 5 reference images plus up to 2 voice references and needs the `liconstudio/ComfyUI-LTX2.5-MSR` pack. Not evaluated.

### Character or scene replacement
- **No LTX 2.5 equivalent of Wan Animate "Mix"** exists: no node or LoRA takes "new character image + source video" and keeps the background.
- **Closest official path: Inpaint** (`LTX-2.5_ICLoRA_Inpaint_Two_Stage_Distilled`, LoRA `ltx-2.3-22b-ic-lora-in-outpainting-0.9`).
  - Inputs: "Load Original Video" + "Load Mask Video" (both `LoadVideo.file`; white = regenerate; same frame count and aspect), an optional start image, and a prompt that describes **what should be in the region** (not an edit command).
  - Mask processing: `LTXVDilateVideoMask` (`spatial_radius`, `temporal_radius`), and a Laplacian-pyramid blend at each stage.
  - The source audio can stay frozen.
  - A web form would need a **mask source**. Options are a mask-video Upload, a painter, or automatic segmentation (core `SAM3_Detect`/`SAM3_VideoTrack` take points, boxes or text; not tried with LTX). There is also no reference-image input for the replacement character. Pairing it with Ingredients in one graph is untested.
- **Scene swap / restyle:** Union Control (depth or canny of the source) with a new prompt and an optional start image re-renders the whole frame while keeping structure and motion. Day-To-Night, Clean-Plate and Layout-To-Render (layout video + art-directed first frame; w/h divisible by 64; HF card, but its JSON is not in the repo) are fixed-purpose variants.

### Prompt-driven video editing
- **Not supported as instruction editing.**
- The V2V effect LoRAs apply one trained effect each, and their prompts describe content.
- Inpaint prompts describe the region.
- The Tiled Fusion "Native 4K/8K" graph's stage-1 prompt describes the change, but only together with an effect LoRA (Day-To-Night in the shipped graph).
- **Retake**, which regenerates a `[start,end]` time span of video and/or audio from a prompt, is a Python pipeline (`retake.py`; source 8k+1 frames, multiples of 32). The pack has `LTXVSetAudioVideoMaskByTime` (`start_time`, `end_time`, `video_fps`, `mask_video`, `mask_audio`, optional `spatial_mask`), used only in 2.0 graphs. No 2.5 ComfyUI retake graph exists, and the hosted API says retake/extend are not offered for 2.5.

### Audio
- **Joint audio is on in every local video graph.** It goes `LTXVEmptyLatentAudio` → concat → `LTXVAudioVAEDecode` → `CreateVideo.audio`. There is no local "audio off" switch. `CreateVideo.audio` is optional, so a switch could drop it (untested). The hosted API has `generate_audio`.
- **Audio-to-video** (`LTX-2.5_A2V_Two_Stage_Distilled`):
  - `LoadAudio` "Audio input".`audio` → `TrimAudioDuration` (`start_index`, `duration`) fed by the "audio start (seconds)" and "duration in seconds (video + audio trim)" primitives → `LTXVAudioVAEEncode` → `SetLatentNoiseMask` (`SolidMask` 0), so the audio is frozen in both stages;
  - the original trimmed waveform is muxed in, not decoded;
  - the video length comes from the trimmed duration, snapped to 8n+1;
  - an optional first-frame image is supported.
  - This covers "reference audio" as a driver (music, speech timing). Lip-sync quality is not documented.
- **Text-to-audio** (`LTX-2.5_T2A_Single_Stage_Distilled`): `LTXVAudioOnlyModel` turns off the video stream; `LTXVAudioOnlyEmptyVideoLatent` is a 64×64 one-frame placeholder; the length comes from `LTXVEmptyLatentAudio.frames_number`/`frame_rate`. The output is an audio file.
- **Voice identity from reference audio:** core `LTXVReferenceAudio` (`reference_audio`, `identity_guidance_scale` 3, about 5 s of reference recommended) plus an ID-LoRA. Only for 2.3 (CT `video_ltx2_3_id_lora`; ID-LoRA repo is 2.3 only).
- **Dub-It** (re-speak with lip sync) and **Foley V2A** are 2.3 adapters. Foley is listed as 2.3-only; Dub-It's 2.5 status is not stated.

### Video extension and long clips
- No official 2.5 ComfyUI extend graph exists.
- `LTXVExtendSampler` (pack; `latents`, `num_new_frames`, `frame_overlap` ≥16 step 8, needs `STGGuiderAdvanced`) works on video latents. Its handling of the joint audio latent is untested.
- `LTXVLoopingSampler` explicitly rejects audio-video latents (`looping_sampler.py`).
- Python `ltx-pipelines` 1.4.0+ can generate long clips in windows (`--chunked`: 97-frame windows with a 25-frame carry; `--chunk-blend-frames`). That is not exposed in ComfyUI.
- The community graph `javawock7618/comfy-ltx-2.x-workflows` claims extension "from the beginning or end" (see below).

### Upscale, refine, HDR
- The two-stage latent ×2 and DFR are described above.
- **Tiled Fusion** (`LTX-2.5_V2V_TiledFusion_Upscale`, `…_Native_4K_8K`) uses `LTXVTiledFusionSampler` + `LTXVGetTilingSizes`:
  - Preprocess subgraph widgets: `tile_size`, `initial_canvas_size` (qHD/HD/FullHD), `output_size` (FullHD/4K/8K);
  - IC-LoRA `ltx-2.5-22b-ic-lora-refine-details-1.0`;
  - `use_streaming` on, `tile_frames` 8n+1;
  - prompts describe look and style only, because named objects can repeat in every tile.
- HDR graphs live in `HDR_workflows/` and need ComfyUI ≥ v0.38.0 and OpenImageIO for EXR.

### Auto duration and multishot
- `LTXVDurationPredictor` (core) takes the encoded positive prompt and the duration head (`ModelPatchLoader`). It returns `num_frames` (8n+1, clamped to `min_seconds`/`max_seconds`) and the raw seconds. No template wires it.
- Multishot has no node; it comes from the prompt.

### Paid API nodes (separate, not local)
- Core `comfy_api_nodes/nodes_ltxv.py`: `LtxApi25TextToVideo`, `LtxApi25ImageToVideo`, `LtxApi25AudioToVideo`.
  - Model "LTX-2.5 (Fast)": 2–20 s, up to 3840×2160, 24/25/48/50 fps; over 10 s requires 720p/1080p at 24/25.
  - Model "LTX-2.5 (Pro)": 2–10 s, 720p/1080p, 24/25/50.
  - `generate_audio` boolean.
  - Billed per second ($0.1287–$0.429/s in the price badge).
- Templates `api_ltx2_5_{t2v,i2v,flf2v}`.
- These need a Comfy account and send work to Lightricks. They are not self-hosted.

## All-in-one Workflows and how they switch

**Official:** none. The official graphs switch only these things:

| Graph | What it switches | Mechanism |
|---|---|---|
| CT `video_ltx2_5_i2v` | I2V ↔ T2V | `PrimitiveBoolean` "Switch to Text to Video?" → `LTXVImgToVideoInplace.bypass` (×2) |
| CT T2V/I2V/FLF/DFR | prompt enhancer on/off | `PrimitiveBoolean` → `ComfySwitchNode` (raw prompt vs `TextGenerateLTX2Prompt` output) |
| CT DFR | I2V ↔ T2V; temporal stage; tiled decode | booleans → `bypass` and three `ComfySwitchNode`s (latent, fps, decoder) |
| LX all 2.5 graphs | image on/off; local vs API text encoding | "use image input" → `ComfyNotNode` → `bypass_i2v`; `StringContains(api_key, "ltxv_")` → `ComfySwitchNode` ×2 |
| LX Union Control | depth / canny / pose | **manual re-wire** (no switch) |

Lightricks says its 2.5 graphs share one subgraph layout (load models, inputs, preprocess, sample, decode) so that users can move between files. In other words, separate files per capability is the intended pattern (LX `README.md`).

**Community "all-in-one" graphs** (not official; none combines the IC-LoRA Modes):
- **Civitai 2852749, "LTX-2.5 INT8 AllInOne — Speed / Quality / Low Vram" v1.0 (2026-08-12).**
  - Covers T2V/I2V/FLF2V in one graph with a two-stage ×2 upscale and Speed/Quality attention modes.
  - Needs `ltx25_smart_controls` 1.2.0 (zip), KJNodes 1.5.0, SolAttn_triton, SageAttention and Triton.
  - The switching mechanism is not described.
  - VRAM claims: 12–16 GB (speed), 24 GB+ (quality).
- **HF `javawock7618/comfy-ltx-2.x-workflows`, `LTX2.5_int8_I2V-javano2608.1.json`.**
  - Covers T2V/I2V/FLF, extension, custom audio and voice cloning.
  - Switches with `Fast Groups Bypasser (rgthree)` ×2 (group bypass), `easy anythingIndexSwitch` ×3 (Easy-Use index switch), `ComfySwitchNode` and `PrimitiveBoolean`. Groups: "Extend", "Source I2V", "Source Video".
  - Packs: comfyui-easy-use, VideoHelperSuite, WhatDreamsCost, KJNodes, comfyui-ollama, WAS, SolAttn.
  - The group-bypass part does not survive API export. The JSON was read only through a summarising fetch, which noted the file was truncated.
- **FutuTek YouTube "LTX 2.5 All-In-One"** (2026-08-20, known only from a lilys.ai summary; no file link).
  - Lists 8 modes: T2V, A2V, I2V, FLF, image+audio lip sync, FLF+lip sync, first/middle/last+lip sync, and motion transfer to a still.
  - Uses GGUF weights.
  - Each mode selects its own sampler group. Mechanism and packs are unknown.

**Mechanics that constrain an LTX all-in-one** (from source; the first three were also found by other tickets):
- Bypass and mute are dropped on API export, so Modes must steer through values: `PrimitiveBoolean` → `ComfySwitchNode`. The switch is lazy, so the unused branch does not run.
- Unused file loaders still validate. `validate_inputs` walks every linked upstream node, including both inputs of a lazy switch. `LoadImage`, `LoadVideo` and `LoadAudio` reject missing files. **Combos are validated too** (`value_not_in_list`, `execution.py`). So every `lora_name`, `unet_name` and annotator model named anywhere in the Workflow must exist on every Backend.
- Core has only **two-way** switches (`ComfySwitchNode`, `ComfySoftSwitchNode`). N Modes need a chain, or booleans derived from a Mode string (`StringCompare` "Equal" → BOOLEAN) or from `CustomCombo`'s INDEX.
- **Inferred alternative:** `/prompt` accepts `partial_execution_targets`, and `validate_prompt` then validates and runs only the listed output nodes and their ancestors (`server.py` 1196–1202, `execution.py` 1182–1213). A Workflow with **one `SaveVideo`/save node per branch** could have each Mode name its output node. Other branches would then be neither validated nor run, so no placeholder files would be needed. Not tested.
- **Stage structure differs per capability:** single stage (FLF, Motion Track, Ingredients, V2V), two stage (T2V/I2V, Union, Inpaint, A2V), or three stage (DFR). So does the **source of size and length**: user width/height, the image size, the reference video, the trimmed audio or the sheet. An all-in-one graph has to switch these sources as well as the conditioning.
- **Output media type differs.** T2A outputs audio; everything else outputs video.

## Requested features vs. LTX 2.5

| Wanted feature (charter / Workflow brief) | LTX 2.5 local | Where |
|---|---|---|
| First/last frame | Yes | CT FLF2V (`LTXVAddGuide` ×2); more keyframes by chaining (no template) |
| Reference image (as first frame) | Yes | I2V, DFR, A2V, Union, Motion Track, Inpaint (optional start image) |
| Reference image (appearance) | Partial | Ingredients reference sheet; third-party MSR |
| Reference video | Yes, as a structure/motion source or as the edit subject | Union Control; V2V IC-LoRAs; Inpaint/Outpaint; Tiled upscale |
| Reference audio | Yes, as the soundtrack driver | A2V (frozen, muxed). Voice identity: 2.3 only |
| Character replace | **No dedicated path** | Inpaint + mask video (no character reference); Union pose + new look (whole frame re-rendered) |
| Motion tracking | Yes | Union Control (pose/depth/canny from a video); Motion Track (drawn paths on a still) |
| Character consistency | Partial | Multishot within a clip; Ingredients sheet; no 2.5 ID-LoRA |
| Prompt-driven edit of a video | **No general path** | Effect IC-LoRAs, Union restyle; Retake is Python-only |
| Duration | Yes | Duration/fps primitives → 8n+1; auto duration node (unwired) |
| Video extension | **No official ComfyUI path** | Python chunked; pack `LTXVExtendSampler` untested with audio |
| Native audio in output | Yes (always on locally) | — |

## Options & implications for the studio

These are trade-offs; this research does not choose between them.

**A. How far "all-in-one" goes**
1. **One LTX Model, one large Workflow,** built from the Lightricks 2.5 subgraphs behind value switches. Possible Modes: T2V, I2V, FLF (+ keyframes), A2V, DFR quality, Union control ×3, Motion paths, Ingredients, Inpaint/replace-region, Outpaint, effect V2V, upscale.
   - Pros: matches the charter. The base weights are shared, so Mode changes cost only a LoRA patch or annotator load. One page for users.
   - Cons:
     - a very large graph, with every branch tested on every ComfyUI update;
     - every Backend needs every LoRA, the annotator packs and their models;
     - placeholder Uploads for hidden file Inputs, unless the `partial_execution_targets` route works;
     - T2A changes the output type.
2. **A core all-in-one plus a few sibling LTX Models.** "LTX 2.5" covers T2V/I2V/FLF/A2V/DFR; "LTX 2.5 Video tools" covers Union/V2V effects/Inpaint/Outpaint/upscale; "LTX 2.5 Reference" covers Ingredients/Motion paths; optionally "LTX 2.5 Audio" for T2A.
   - Pros: each Workflow stays close to an official file; output type per Model stays clean; smaller test surface.
   - Cons: it departs from the charter's single all-in-one Model, and users must pick a Model.
3. **The official files nearly as-is, one Model each.**
   - Pros: simplest bindings.
   - Cons: 10+ catalog entries; drops the all-in-one idea.

**B. How a Mode steers the Workflow**
- Booleans → `ComfySwitchNode` (the official pattern), plus placeholder files on each Backend for hidden Upload Inputs.
- One output node per branch, with the Mode choosing `partial_execution_targets`. This could avoid placeholders and skip validation of other branches. It is inferred from source and needs a test on the ticket-08 Backend. It touches ticket 02's API client.
- IC-LoRA on/off: a switch on the MODEL path (lazy, so the LoRA is not loaded), or `strength_model` 0. Either way, the guide nodes must also be switched off.
- The Union annotator choice needs new switch nodes; the official graph re-wires.

**C. Inputs and validation the studio must own**
- Width/height: enforce multiples of 64 on two-stage and DFR paths and 32 on single-stage paths, or expose aspect + quality presets that map to the primitives.
- Duration: enforce 8n+1 through the Duration/fps primitives (show the snapped length). Cap duration per Mode for VRAM, since no official maximum exists.
- Video Uploads drive length/size in V2V, Union and Inpaint. The charter's server-side trim keeps them bounded. Mask videos must match the source frame count.
- The negative prompt has no effect at CFG 1. Hide that Input or fix it in the Workflow.
- Seeds: several `RandomNoise` nodes per graph (two-stage: stage 1 random, stage 2 fixed; DFR: three). Multi-generation should vary at least stage 1; whether to vary all is a choice.
- The LTX API key field (`GemmaAPITextEncode`) should stay empty or be removed, otherwise prompts leave the Backend.
- **New Input types:**
  - a spline/track editor on a still, which produces `points_store` JSON (Motion paths);
  - a mask source for region replace (mask-video Upload, a painter, or automatic SAM3 from clicks or text);
  - optionally a reference-sheet composer (Ingredients wants panels on black).

  Everything else is text, number, boolean, select, or image/video/audio Upload.

**D. Gaps against the charter's Modes**
- **Character replace:**
  - route it to the Wan 2.2 Animate Model, which has a true path;
  - or offer an LTX "replace region" Mode (Inpaint + mask) whose prompt describes the new content;
  - or a pose-driven re-render (Union pose + start image of the new character), which also redraws the background;
  - or evaluate the third-party MSR pack.
- **Prompt-driven edit / scene swap:** present a set of effect presets (Day-to-Night, Clean Plate, Colorize, Deblur…) plus a "restyle with structure" Mode (Union depth/canny + prompt + optional reference image). A general instruction edit is not available locally.
- **Extension:** leave it out of LTX v1, or chain Generations in the studio (last frame → I2V start; audio continuity is lost), or build on the pack's `LTXVExtendSampler` after testing.

**E. Backends**
- Official minimum 32 GB VRAM (80 GB recommended). Int8 convrot files lower the need; community authors claim 12–24 GB with offload. A mixed fleet could be served by giving a Model different file choices per Backend, but file names are Node fields, so this is a Model-level choice.
- Disk: about 66 GiB bf16 core, or about 40 GB int8 core, plus about 1.3 GB per IC-LoRA, about 5 GB enhancer, annotator models and about 1.3 GB upscalers.
- ComfyUI ≥ v0.35.0 for DFR; ≥ v0.38.0 for HDR.
- Packs: ComfyUI-LTXVideo (v1.1.0) for every Lightricks graph; Video-Depth-Anything and controlnet_aux for Union; KJNodes for Outpaint (`ImagePadForOutpaintTargetSize`).

**F. License.** The LTX-2.x Community License allows free commercial use below $10M annual revenue (measured across the whole entity, affiliates included); above that a paid agreement is needed (HF card). This fits the charter's per-Model attribution/license note.

## Open / unconfirmed

- **"Motion Transfer IC-LoRA"** and `LTX-2.5_ICLoRA_Motion_Transfer_Distilled.json` appear on docs.ltx.io's compatibility page. They were not found in ComfyUI-LTXVideo at `220e1d4` or among the Lightricks HF repos, and the filename is not given.
- **2.3 adapters on 2.5.** The official 2.5 graphs use 2.3 Union Control, Motion Track and In/Outpainting LoRAs, and the 2.3 Ingredients file despite a 2.5 Ingredients card. Lightricks says "a small number of exceptions" exist without listing them. Quality on 2.5 was not checked.
- **DFR detailing LoRA strength:** 1.0 in the ComfyUI template vs a fixed 0.5 in `ltx-pipelines`.
- **Multi-keyframe (>2) and middle frames** via chained `LTXVAddGuide`: inferred from node code; no 2.5 template.
- **`partial_execution_targets` as a Mode mechanism:** read from source, not run.
- **Extension:** whether `LTXVExtendSampler` works with LTX 2.5's joint audio-video latent; the community graph's method is unknown.
- **Retake in ComfyUI on 2.5** with `LTXVSetAudioVideoMaskByTime`: no 2.5 graph; untested.
- **Union annotator via switches** instead of re-wiring; core `Canny`/SDPose as replacements for the custom packs.
- **Inpaint + SAM3 auto-mask** for click-to-pick replacement; Inpaint combined with Ingredients for a character reference.
- **Maximum useful duration** for local generation; no open-weights figure (API: 20 s Fast / 10 s Pro).
- **VRAM per Mode and resolution:** only the official 32 GB minimum and community claims. Int8 convrot GPU-architecture requirements were not checked.
- **fps above 30:** whether ComfyUI snaps the conditioning fps the way the Python pipelines do; the behaviour of 25/50 fps (frame flooring) in the Comfy-Org templates.
- **Turning audio off locally** (dropping `CreateVideo.audio`): untested.
- **Dub-It on 2.5:** not stated. **Foley V2A:** 2.3-only per docs.
- **Third-party MSR** (multi-reference, voice): quality, pack maintenance and weight files not evaluated.
- **The javawock7618 community graph** was read only through a summarising fetch of a truncated JSON.
- **Layout-To-Render's ComfyUI JSON** is named on its HF card but is not in the repo at `220e1d4`.

## Sources (versions)

| Source | Version / date |
|---|---|
| comfyanonymous/ComfyUI: `comfy_extras/nodes_lt.py`, `nodes_lt_keyframes.py`, `nodes_lt_audio.py`, `nodes_lt_upsampler.py`, `nodes_logic.py`, `nodes_textgen.py`, `nodes_resolution.py`, `nodes_primitive.py`, `nodes_audio.py`, `nodes_video.py`, `nodes_context_windows.py`, `nodes_sam3.py`, `nodes_string.py`; `comfy/samplers.py`; `comfy/text_encoders/lt.py`; `comfy/ldm/lightricks/duration_head.py`; `comfy_api_nodes/nodes_ltxv.py`; `execution.py`; `server.py`; git history (57ce8e1, efa6c8f, 0d0b6b5; tags v0.32.0, v0.35.0, v0.38.0, v0.42.0) | `1a82e6d01f395b43275c77acd289af1eb7090bb9`, 2026-10-21 (release v0.42.0, 2026-10-18) |
| Lightricks/ComfyUI-LTXVideo: `README.md`, `example_workflows/2.5/*.json`, `example_workflows/2.5/HDR_workflows/*.json`, `example_workflows/2.5/README.md`, `iclora.py`, `easy_samplers.py`, `looping_sampler.py`, `latents.py`, `sparse_tracks.py`, `gemma_api_conditioning.py`, `audio_only.py`, `vanish_nodes.py`, `tiled_fusion_plan.py`, `pyproject.toml` (1.1.0) | `220e1d45aa0469f518e982102fca4dca92a61862`, 2026-10-20 |
| Lightricks/LTX-2: `README.md`, `CHANGELOG.md` (1.5.0, 2026-10-18), `packages/ltx-pipelines/docs/{pipeline-selection,pipelines,conditioning,optimization,installation}.md`, `packages/ltx-pipelines/src/ltx_pipelines/` listing | `e98f6d927d83c92ef2be6aec76c8440b19306e39`, 2026-10-18 |
| Comfy-Org/workflow_templates: `templates/index.json`, `video_ltx2_5_{t2v,i2v,flf2v,dfr_i2v}.json`, `video_ltx2_3_id_lora.json`, `api_ltx2_5_*` | `447747bf37b7e2f6d5fab3f15288e03bf889b82f`, 2026-10-22 |
| Comfy-Org/docs: `tutorials/video/ltx/ltx-2-5.mdx`, `ltx-2-5-dfr.mdx`, `tutorials/partner-nodes/lightricks/ltx-2-5.mdx` (also fetched at docs.comfy.org) | `506a4a94db30524adb8706667aec050d71dbdf60`, 2026-10-21 |
| Comfy-Org/ComfyUI_frontend: `src/utils/executionUtil.ts`, `src/lib/litegraph/src/subgraph/ExecutableNodeDTO.ts` | `0ce48633dd96193b891d77f88dbd9a23b73d23cf`, 2026-10-21 |
| kijai/ComfyUI-KJNodes (`ImagePadForOutpaintTargetSize`) | `f4bae1f9960e5d643573a2ecf7abd56453a21821`, 2026-10-20 |
| Fannovel16/comfyui_controlnet_aux (`node_wrappers/dwpose.py`, `canny.py`) | `a587a4c1594524c1d2de5cd1a86cd868ff448e1c`, 2026-10-11 |
| HF `Lightricks/LTX-2.5` model card and file tree (`diffusion_models/`, `text_encoders/`, `vae/`, `latent_upscale_models/`, `model_patches/`); HF API listings of Lightricks models (search "LTX-2.5", "2.5-22b", "LTX-2.3-22b", "LoRA"); collection `Lightricks/ltx-25` | fetched 2026-10-22 (repo created 2026-07-23; open weights released 2026-08-11) |
| HF model cards: `Lightricks/LTX-2.5-22b-IC-LoRA-{Ingredients,Clean-Plate,Layout-To-Render}`, `Lightricks/LTX-2.3-22b-IC-LoRA-{Union-Control,Motion-Track-Control}`, `Lightricks/LTX-2.3-22b-LoRA-Foley-V2A`; tree of `…-IC-LoRA-Ingredients` | fetched 2026-10-22 |
| docs.ltx.io: System Requirements; Integration → ComfyUI; IC-LoRA Adapters; Reference → Workflow & Asset Compatibility; Usage Guides → Prompting Guide, Text-to-Video, Audio-to-Video; Feature Guides → Union Control, Motion Control; Open Source overview; `models/ltx-2-5` (API) | fetched 2026-10-22 (no page dates shown) |
| HF discussions `Lightricks/LTX-2.5` #14, #30, #61, #67 (community, no staff replies) | fetched 2026-10-22 |
| Community: Civitai 2852749 (v1.0, 2026-08-12), Civitai 2772148 (v2.0, 2026-08-25), HF `javawock7618/comfy-ltx-2.x-workflows` (`LTX2.5_int8_I2V-javano2608.1.json`), lilys.ai note on FutuTek video (2026-08-20), HF `LiconStudio/LTX-2.5-Multiple-Subject-Reference`, HF `RuneXX/LTX-2.3-2.5-Workflows`, GitHub `ID-LoRA/ID-LoRA-LTX2.3-ComfyUI`, Runpod blog (updated 2026-10-15), comfy.org/ltx-2.5 | fetched 2026-10-22; secondary or community, used only for claims marked as such |
