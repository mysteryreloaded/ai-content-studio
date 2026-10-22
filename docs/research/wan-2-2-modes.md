# Wan 2.2 in ComfyUI: variants, Workflows, Node fields and Modes

Research for ticket `04-wan-2-2-modes`. Researched 2026-10-22. Terms follow `CONTEXT.md` (Model, Workflow, Node field, Input, Mode, Upload, Backend).

## Summary

- Wan 2.2 is a family of separate checkpoints, not one model. Each official ComfyUI template uses exactly one of them: T2V-A14B, I2V-A14B (also used for first/last frame), TI2V-5B, Animate-14B, S2V-14B, Fun Control, Fun Camera and Fun InP. The 14B ones are pairs of high-noise and low-noise experts run by two `KSamplerAdvanced` nodes. No official template switches between checkpoints, so Wan 2.2 naturally splits into **one Model per checkpoint family** (about 5–8 Models). Modes inside a Model come from switch nodes and optional inputs.
- All native conditioning nodes share one shape: `width`/`height` (step 16, or 32 on the 5B), `length` in frames, where the latent count is `((length-1)//4)+1`. So only `4n+1` frame counts are honoured. One pass is about 5 s: 81 frames at 16 fps on the 14B models, 121 frames at 24 fps on the 5B. Longer output needs chunk chaining (Animate, S2V) or the core loop nodes (Wan Animate 2 template).
- Supported in open Wan 2.2: T2V, I2V, first/last frame, motion transfer (Animate "Move"; Fun Control with pose, depth or canny), character replacement (Animate "Mix"), speech-to-video (S2V), camera presets (Fun Camera), and duration (`length`). **Not supported:** generating audio, editing an existing video from a prompt, consistent multi-reference characters (subject-to-video), and extending T2V/I2V output (no official template).
- **For character replacement the user supplies** a reference image, a source video, a short prompt and **one or more positive points (optionally a box) on the first frame**. The character mask is derived by the Workflow: SAM2 propagates it from those points, then it is grown and blockified. The user never paints a mask. Points enter as a JSON string `[{"x":int,"y":int}]` in the KJNodes `PointsEditor.coordinates` field (or any STRING feeding `Sam2Segmentation.coordinates_positive`). A web form can collect them by letting the user click on a first frame that has been scaled and cropped exactly as the Workflow does. A second community template skips clicks: it auto-detects the largest person, which is reliable only for single-person videos.
- Preprocessing nodes are custom packs: comfyui_controlnet_aux (`DWPreprocessor`), ComfyUI-segment-anything-2, ComfyUI-KJNodes, ComfyUI-WanAnimatePreprocess, VideoHelperSuite. Every Backend that runs Animate needs them. Core ComfyUI now also has SAM3 nodes that accept text, points or boxes.
- VRAM: the fp8 14B templates were measured by Comfy-Org on a 24 GB RTX 4090D at 640×640×81 (about 83–89% VRAM; about 520 s at 20 steps, about 70–140 s with the 4-step Lightning LoRA). Comfy-Org says the 5B fits 8 GB with offloading. The official non-ComfyUI code peaks at about 41 GB (480P) or 60 GB (720P) for the 14B models on one GPU.

## Capability table

The 14B models use 16 fps and the Wan 2.1 VAE (`width`/`height` step 16); the 5B uses 24 fps and the Wan 2.2 VAE (step 32). "Template" means a file in Comfy-Org/workflow_templates `templates/`.

| Variant (weights) | Capability | Template | Key nodes (class_type) | User-supplied Node fields | Constraints |
|---|---|---|---|---|---|
| T2V-A14B (high+low experts) | Text to video | `video_wan2_2_14B_t2v` | `UNETLoader`×2, `LoraLoaderModelOnly`×2, `ModelSamplingSD3`, `EmptyHunyuanLatentVideo`, `KSamplerAdvanced`×2, `CreateVideo`, `ComfySwitchNode`, `ComfyMathExpression` | `CLIPTextEncode.text`; `EmptyHunyuanLatentVideo.width/height`; `PrimitiveFloat` "Duration" `.value` (→ `floor(s*fps)+1` → `length`); `KSamplerAdvanced.noise_seed` (high-noise pass); `PrimitiveBoolean` "Enable Lightning LoRA" `.value` | 480P/720P official; templates default 640×640×81; length 4n+1; 16 fps |
| I2V-A14B | Image to video | `video_wan2_2_14B_i2v` | as T2V but `WanImageToVideo` | `LoadImage.image`; prompt; `WanImageToVideo.width/height`; Duration primitive; seed; Lightning boolean | official `--size` is an area, so the aspect follows the image; same frame rules |
| I2V-A14B | First/last frame | `video_wan2_2_14B_flf2v` | `WanFirstLastFrameToVideo`, `LoadImage`×2, `KSamplerAdvanced`×2 | `LoadImage.image` ×2 (`start_image`, `end_image`); prompt; `WanFirstLastFrameToVideo.width/height/length`; seed | template 640×640×81, 20 steps, cfg 4 (4-step group bypassed) |
| TI2V-5B (single dense model) | T2V **and** I2V in one model | `video_wan2_2_5B_ti2v` | `Wan22ImageToVideoLatent` (optional `start_image`), `KSampler` | prompt; optional `LoadImage.image`; `Wan22ImageToVideoLatent.width/height/length`; `KSampler.seed` | official 1280×704 / 704×1280; step 32; default 121 frames at 24 fps |
| Animate-14B | Character replacement ("Mix") | `video_wan2_2_14B_animate` | `LoadVideo`, `GetVideoComponents`, `ImageScale`, `DWPreprocessor`×2, `PointsEditor`, `DownloadAndLoadSAM2Model`, `Sam2Segmentation`, `GrowMask`, `BlockifyMask`, `DrawMaskOnImage`, `CLIPVisionEncode`, `WanAnimateToVideo`, `KSampler`, `TrimVideoLatent`, `ImageFromBatch` | `LoadImage.image` (character); `LoadVideo.file` (source); `PointsEditor.coordinates` (JSON points on frame 0); prompt; Width/Height `PrimitiveInt.value`; `KSampler.seed` | w/h multiple of 16; 77 frames per chunk; each "Video Extend" chunk adds about 72 new frames; output fps should equal the source fps |
| Animate-14B | Motion transfer ("Move") | same template, with `background_video` and `character_mask` disconnected | `WanAnimateToVideo` with only `reference_image`, `pose_video`, `face_video` | reference image; driving video; prompt; size; seed | same as above |
| Animate-14B | Auto character replacement (no clicks) | `template_purz_wan22_animate_auto_character_replace` (community, listed in the official index) | `VHS_LoadVideo`, `VHS_VideoInfo`, `OnnxDetectionModelLoader`, `PoseAndFaceDetection`, `DrawViTPose`, `Sam2Segmentation` (fed by `bboxes`), `GrowMaskWithBlur`, `BlockifyMask`, `DrawMaskOnImage`, `WanAnimateToVideo` | reference image; `VHS_LoadVideo.video` (+ `frame_load_cap`); prompt; Width/Height | one chunk of `length` = the loaded frame count; recommended about 720p and 77–150 frames |
| S2V-14B | Speech/sound to video (talking, singing) | `video_wan2_2_14B_s2v` | `AudioEncoderLoader`, `AudioEncoderEncode`, `LoadAudio`, `WanSoundImageToVideo`, "Video S2V Extend" subgraphs (`WanSoundImageToVideoExtend`, `KSampler`, `LatentConcat`), `LatentCut`, `CreateVideo` (input audio muxed in) | `LoadImage.image`; `LoadAudio.audio`; prompt; `WanSoundImageToVideo.width/height`; "Chunk Length" `PrimitiveInt` (77); `KSampler.seed`; optional `control_video` (pose) | 16 fps (hard-coded in node); chunk ≥73 frames, default 77; number of chunks fixed by the graph |
| Fun-A14B-Control (+5B variant) | Pose, depth or canny control ("motion tracking"), plus a reference image | `video_wan2_2_14B_fun_control`, `video_wan2_2_5B_fun_control` | `LoadVideo`, `GetVideoComponents`, `Canny` (bypassed by default), `Wan22FunControlToVideo`, `KSamplerAdvanced`×2 | `LoadVideo.file` (control video); `LoadImage.image` → `ref_image`; prompt; `Wan22FunControlToVideo.width/height/length`; seed | trained 81 frames at 16 fps, 512/768/1024; only `Canny` is in core, so pose and depth need packs |
| Fun-A14B-Control-Camera | Camera move from one image | `video_wan2_2_14B_fun_camera` | `WanCameraEmbedding`, `WanCameraImageToVideo`, `KSamplerAdvanced`×2 | `LoadImage.image`; prompt; `WanCameraEmbedding.camera_pose` (combo), `.width/.height/.length/.speed`; seed | one preset per run (Static, Pan Up/Down/Left/Right, Zoom In/Out, ACW, CW) |
| Fun-A14B-InP (+5B) | Start/end frame | `video_wan2_2_14B_fun_inpaint`, `video_wan2_2_5B_fun_inpaint` | `WanFunInpaintToVideo` (calls the FLF node internally) | 2× `LoadImage.image`; prompt; `WanFunInpaintToVideo.width/height/length`; seed | overlaps with I2V FLF; different weights |
| Fun VACE A14B | Control + multi-reference (VACE) | **no official template** | presumably `WanVaceToVideo` (core detects VACE weights) | (unconfirmed) | weights exist in Comfy-Org repack; see Open |
| Wan Animate 2 (Aug 2026) | Motion transfer without pose extraction; prompt sets new background and camera | `video_wan_animate2`, `video_wan_animate2_distilled` | `WanAnimate2ToVideo`, `WanAnimate2Cache`, `ContextWindowsManual`, `StartLoop`/`EndLoop`, `SamplerCustom` | reference image; driving video; `text_1` (appearance and background), `text_2` (motion); `pose_strength`, `reference_image_strength` | `fragment_length` 81 (4n+1); loops over the whole driving video; needs ComfyUI ≥ 0.36; **no replacement inputs** |
| Wan Dancer (Wan 2.2 based, Jul 2026) | Music to dance | `video_wan_dancer` | `WanDancerEncodeAudio`, `WanDancerVideo`, `WanDancerPadKeyframes` | image; audio; dance style; amplitude; durations; size | `length` stays 149; needs a lot of VRAM |

## Common rules (all native Wan nodes)

Source: `comfy_extras/nodes_wan.py`, `comfy_extras/nodes_hunyuan.py`, `comfy_extras/nodes_camera_trajectory.py` in ComfyUI @ `1a82e6d` (2026-10-21, v0.42.0).

- **Frame count:** every node creates a latent with `((length - 1) // 4) + 1` frames, and the decoded video has `4·T - 3` frames. A `length` that is not `4n+1` is effectively rounded down; for example 80 gives 77 frames. Schemas declare `step=4`, but the server's prompt validation (`execution.py` `validate_inputs`) checks only `min`/`max`, not `step`. **The studio must enforce 4n+1 itself.** The official CLI help also says `--frame_num` should be 4n+1 (Wan2.2 `generate.py`).
- **Resolution:** 14B nodes use `width`/`height` with `step=16` (Wan 2.1 VAE, 8× spatial). `Wan22ImageToVideoLatent` (5B, Wan 2.2 VAE 16× spatial, 48 channels) uses `step=32`. Steps are not enforced by the server either. Upstream supported sizes (`wan/configs/__init__.py` `SUPPORTED_SIZES`): t2v/i2v-A14B use 1280×720, 720×1280, 832×480 and 480×832; ti2v-5B uses 1280×704 and 704×1280; s2v adds 1024×704 and 704×1024; animate lists 1280×720 and 720×1280 (preprocessing works by pixel area).
- **fps:** `wan/configs/shared_config.py` sets `sample_fps=16` and `frame_num=81` (14B); `wan_ti2v_5B.py` sets 24 fps and 121 frames; `wan_animate_14B.py` sets 30 fps and 77 frames. The ComfyUI templates write fps into `CreateVideo.fps`. The T2V/I2V templates expose "Duration" (seconds) and "FPS" primitives combined by `ComfyMathExpression` (`floor(a*b)+1`). At 16 or 24 fps with whole seconds this always lands on 4n+1.
- **Images are centre-cropped:** every conditioning node resizes inputs with `common_upscale(..., "center")`, which crops to the target aspect ratio first (`comfy/utils.py`). Uploads with a different aspect ratio lose their edges.
- **Experts:** 14B Workflows load `*_high_noise_*` and `*_low_noise_*` files in two `UNETLoader`s and split the steps between two `KSamplerAdvanced` nodes. The first runs `add_noise: enable` with the seed and `end_at_step` = split; the second runs `start_at_step` = split. **The seed Node field is the high-noise sampler's `noise_seed`.**
- **Lightning (lightx2v) 4-step LoRAs:** the T2V and I2V templates include a `PrimitiveBoolean` that drives `ComfySwitchNode`s choosing LoRA vs no LoRA, steps (4 vs 20), split (2 vs 10) and cfg (1 vs 3.5). A "Fast vs Quality" choice is therefore already a single BOOLEAN Node field. The FLF, Fun and S2V templates use bypass groups for the same choice. Bypass does not survive API export (see Options).

## Per-variant detail

### T2V-A14B: text to video
- Template `video_wan2_2_14B_t2v.json`: one subgraph "Text to Video(Wan2.2)" containing `EmptyHunyuanLatentVideo` (640, 640, 81), `ModelSamplingSD3` shift 5 on both experts, and `CreateVideo` at 16 fps. Lightning is off by default (20 steps, split 10, cfg 3.5).
- Weights (Comfy-Org/Wan_2.2_ComfyUI_Repackaged): `wan2.2_t2v_high_noise_14B_fp8_scaled` and `..._low_noise_...` (about 14.3 GB each; fp16 about 28.6 GB each). LoRAs `wan2.2_t2v_lightx2v_4steps_lora_v1.1_{high,low}_noise` (about 1.23 GB each). Text encoder `umt5_xxl_fp8_e4m3fn_scaled`; VAE `wan_2.1_vae`.
- VRAM: on the 4090D 24 GB at 640×640, fp8 used 84% and took about 536 s / 513 s; with the 4-step LoRA, 89% and about 108 s / 71 s (template note "VRAM Usage"). Upstream single-GPU peak was 41.3 GB at 480P and 59.8 GB at 720P, with times of about 327–1134 s at 480P depending on GPU (Wan2.2 `assets/comp_effic.png`).
- Sources: docs.comfy.org `tutorials/video/wan/wan2_2` (Comfy-Org/docs @ `506a4a9`); workflow_templates @ `447747b` `templates/video_wan2_2_14B_t2v.json`; Wan-Video/Wan2.2 @ `1ea34ff` README and configs.

### I2V-A14B: image to video
- Template `video_wan2_2_14B_i2v.json`: subgraph "Image to Video (Wan2.2)" with `WanImageToVideo` (640, 640, 81), shift 5, `CreateVideo` at 16 fps. Duration, FPS and the Lightning switch work as in T2V.
- `WanImageToVideo` inputs: `width`, `height`, `length`, `batch_size`, optional `clip_vision_output`, `start_image`, `ref_pad_image`. The 2.2 template does not use CLIP vision.
- Weights: `wan2.2_i2v_{high,low}_noise_14B_fp8_scaled` (about 14.3 GB each). LoRAs `wan2.2_i2v_lightx2v_4steps_lora_v1_{high,low}_noise`.
- Note: the docs page's I2V step text names the t2v files, but the template JSON loads the i2v files. Trust the JSON.

### First/last frame (FLF2V) on I2V-A14B
- Template `video_wan2_2_14B_flf2v.json`: the active group uses fp8 without the LoRA. It runs `WanFirstLastFrameToVideo` (640, 640, 81) with `KSamplerAdvanced` at 20 steps, cfg 4, split at 10 and shift 8. A second group (fp8 + 4-step LoRA) is bypassed.
- `WanFirstLastFrameToVideo` takes optional `start_image`, `end_image`, `clip_vision_start_image` and `clip_vision_end_image`. With only `start_image` set it behaves like I2V. With only `end_image` set it pins the final frame.
- Alternative weights: Fun InP (`WanFunInpaintToVideo`, which calls the same FLF code) in `video_wan2_2_14B_fun_inpaint.json` and the 5B `video_wan2_2_5B_fun_inpaint.json`.

### TI2V-5B: hybrid text and image to video
- Template `video_wan2_2_5B_ti2v.json`: `Wan22ImageToVideoLatent` (1280, 704, 121), a single `KSampler` (20 steps, cfg 5, uni_pc), shift 8, `CreateVideo` at 24 fps. The `LoadImage` is bypassed by default, so the default run is T2V; enabling the image makes it I2V.
- `Wan22ImageToVideoLatent` inputs: `width`/`height` (default 1280×704, step 32), `length` (default 49), `batch_size`, optional `start_image`.
- Weights: `wan2.2_ti2v_5B_fp16` (about 10 GB) + `wan2.2_vae` + umt5. VRAM: Comfy-Org says it fits 8 GB with native offloading. Upstream peak was 22.9 GB on a 4090 at 720P (about 525–535 s).
- Because one checkpoint does both T2V and I2V, this is the simplest "one Model, two Modes" candidate.

### Animate-14B: character replacement ("Mix") and motion transfer ("Move")
**What the model needs** (`WanAnimateToVideo`, core, experimental):
- `reference_image` (character), `clip_vision_output` (CLIP-H of the reference), `pose_video` (rendered skeleton frames), `face_video` (resized internally to 512×512).
- Replacement mode only: `background_video` (source frames with the character region blanked) and `character_mask` (MASK per frame).
- Chunking fields: `continue_motion` and `continue_motion_max_frames` (template uses 5), `video_frame_offset`. Shape fields: `width`, `height`, `length` (default 77).
- If `pose_video` or `background_video` is shorter than the offset, it is ignored; if shorter than `length`, its last frame is repeated. A single-frame `character_mask` is broadcast to every frame.

**What the official ComfyUI template does** (`video_wan2_2_14B_animate.json`, required packs comfyui_controlnet_aux, ComfyUI-KJNodes, ComfyUI-segment-anything-2):
1. `LoadVideo` → `GetVideoComponents` (images and audio; audio is passed to the output) → `ImageScale` (lanczos, Width×Height, centre crop) using `PrimitiveInt` Width/Height (640/640).
2. `DWPreprocessor` #101 (hand and body on, face off) → `pose_video`. `DWPreprocessor` #100 (face only) → `face_video`. The resolution comes from `PixelPerfectResolution`. Models `yolox_l.onnx` and `dw-ll_ucoco_384_bs5.torchscript.pt` are fetched by the pack.
3. `PointsEditor` (KJNodes) on the scaled first frame → `positive_coords` → `Sam2Segmentation.coordinates_positive`. `DownloadAndLoadSAM2Model` loads `sam2_hiera_base_plus.safetensors` with `segmentor: video` (auto-downloaded from HF `Kijai/sam2-safetensors`).
4. Mask post-processing: `GrowMask` (expand 10, tapered) → `BlockifyMask` (block 32) → `character_mask`. `DrawMaskOnImage` (black) over the scaled frames → `background_video`.
5. Model chain: `UNETLoader` (`Wan2_2-Animate-14B_fp8_e4m3fn_scaled_KJ`, 17.14 GB; or `wan2.2_animate_14B_bf16`, 32 GB; or the newer repack `wan2.2_animate_14B_int8_convrot`, 18.4 GB) → `LoraLoaderModelOnly` lightx2v I2V 480p rank64 → `LoraLoaderModelOnly` `WanAnimate_relight_lora_fp16` → `ModelSamplingSD3` shift 8.
6. Subgraph "Video Sampling and output": `WanAnimateToVideo` (77 frames) → `KSampler` (6 steps, cfg 1, euler) → `TrimVideoLatent` (trims the reference latent) → `VAEDecode` → `ImageFromBatch` (drops `trim_image`) → `CreateVideo`.
7. "Video Extend" subgraphs chain `IMAGE` → `continue_motion` and `video_frame_offset` → `video_frame_offset`. One is active and a second is bypassed. **Real gain per extend** from the code: it re-reads 5 overlap frames and drops them, so about 72 new frames per 77-frame chunk. The docs say 77 per extend.
- **Move mode:** per the docs and a template note, disconnect `background_video` and `character_mask`. Bypassing is not enough, because bypass passes the input through.
- **Template quirks found in the JSON:**
  - Inside the Extend subgraph the subgraph input `width` is wired to both `width` and `height` of `WanAnimateToVideo`, so extends assume square output unless rewired.
  - `face_video` here is a DWPose face-landmark drawing. Upstream Wan and the auto template use real 512×512 face crops (`PoseAndFaceDetection.face_images`); the quality impact is unconfirmed.
  - `CreateVideo.fps` defaults to 16, while frames are taken 1:1 from the source video. The output fps should equal the source fps, or the source should be resampled first. The auto template wires `VHS_VideoInfo.source_fps`.
- **Upstream pipeline** (Wan2.2 `wan/modules/animate/preprocess/`):
  - Replacement preprocessing (`--replace_flag`) uses YOLOv10m, ViTPose-H wholebody and SAM2-large. It prompts SAM2 with **automatically chosen body keypoints on key frames** (`process_pipepline.py` `get_mask`), not user clicks. It expands the mask with `iterations`/`k` and shapes it with `w_len`/`h_len`.
  - UserGuider.md warns the mask step is **single-person only** and that replacement mode disables pose retargeting.
  - Animation mode recommends retargeting, optionally with FLUX.1-Kontext. The ComfyUI official template does no retargeting; `PoseAndFaceDetection` has an optional `retarget_image`.
  - Inference uses `--refert_num 1` or `5`, `clip_len` 77 and `--use_relighting_lora` for replacement. The README advises against LoRAs trained on Wan 2.2 base with Animate.
- **VRAM:** not stated upstream. The auto template's note recommends about 720p, warns that 1080p may fail, and suggests 77–150 frames.

**Auto character replace** (`template_purz_wan22_animate_auto_character_replace.json`, 2026-03-08, needs ComfyUI-WanAnimatePreprocess, segment-anything-2, KJNodes and VideoHelperSuite):
- `PoseAndFaceDetection` (YOLOv10m + ViTPose-L wholebody ONNX in `models/detection`) returns `pose_data`, `face_images`, `key_frame_body_points` (JSON string), `bboxes` (first frame's person box) and `face_bboxes`.
- `bboxes` → `Sam2Segmentation.bboxes` (SAM2.1 base+, video segmentor) → `GrowMaskWithBlur` → `BlockifyMask` → `DrawMaskOnImage`.
- `DrawViTPose` → `pose_video`; `face_images` → `face_video`.
- The detector keeps the **largest** person per frame (`Yolo(... select_type='max')` in `models/onnx_models.py`). The template note suggests swapping to `key_frame_body_points` if the box gives a bad mask.
- `length` = `VHS_LoadVideo.frame_count`, so the whole clip is one chunk; `frame_load_cap` limits it.

Sources: docs.comfy.org `tutorials/video/wan/wan2-2-animate`; templates above @ `447747b`; ComfyUI `nodes_wan.py` @ `1a82e6d`; `built-in-nodes/WanAnimateToVideo.mdx`; Wan2.2 @ `1ea34ff` README, `wan/configs/wan_animate_14B.py`, `wan/modules/animate/preprocess/{UserGuider.md,process_pipepline.py}`; HF `Wan-AI/Wan2.2-Animate-14B` (fetched 2026-10-22); kijai/ComfyUI-WanAnimatePreprocess @ `0e0b6a2` `nodes.py`, `models/onnx_models.py`.

### Character replacement: what the user supplies and how it reaches Node fields

| User supplies | Required? | Web-form friendly? | Node field it lands in |
|---|---|---|---|
| Character reference image | yes | yes, as an image Upload | `LoadImage.image` (filename after upload to the Backend) |
| Source video (the scene) | yes | yes, as a video Upload; the charter's server-side trim applies | `LoadVideo.file` (official) or `VHS_LoadVideo.video` (+ `frame_load_cap`, `skip_first_frames`) |
| Which character: ≥1 positive point on the **first frame** | yes in the official template (`PointsEditor` raises an error with no points) | yes, needs a new Input type: show frame 0 and record clicks | `PointsEditor.coordinates` = JSON string `[{"x":256,"y":256}]` (pixel ints). Or bind a `PrimitiveString.value` wired to `Sam2Segmentation.coordinates_positive` |
| Negative points (exclude regions) | optional | yes (e.g. right-click or toggle) | `PointsEditor.neg_coordinates` (same JSON) → needs a link to `Sam2Segmentation.coordinates_negative`, which the template does not wire |
| Box around the character | optional alternative | yes (drag a rectangle) | `PointsEditor.bboxes` = JSON `[{"startX":..,"startY":..,"endX":..,"endY":..}]` with `bbox_format: xyxy` → `bbox` (BBOX) → `Sam2Segmentation.bboxes` (not wired in the template) |
| Mask | **no**, the Workflow derives it | a user-painted mask video would need a new Input type and extra nodes | `character_mask` comes from SAM2 → `GrowMask` → `BlockifyMask` |
| Prompt | yes (short) | yes | `CLIPTextEncode.text` |
| Output size | admin default or Input | yes | Width/Height `PrimitiveInt.value` (multiples of 16) |

Details a click-picker must respect (from source):
- **Coordinate space.** Points are pixel coordinates in the image fed to `Sam2Segmentation.image`: the source frame after `ImageScale` to Width×Height with **centre crop**. The form should show frame 0 cropped and scaled the same way, or convert click positions (scale, then subtract the crop offset). SAM2's video predictor normalises points against that frame's H/W internally (`sam2_video_predictor.py`, `normalize_coords=True`).
- **Frame index.** `Sam2Segmentation` adds prompts at `frame_idx=0` only, then propagates through the clip. The character must be visible and separable in the first frame of the (trimmed) Upload.
- **Getting frame 0** needs no ComfyUI round-trip. The browser can draw the first frame of the selected file to a canvas, or the server can extract it (e.g. ffmpeg) after trimming. The `PointsEditor` widget's own image is UI-only state (`points_store`, `bbox_store`, `imgData` properties) and is not needed in API format.
- **Field shapes.** `PointsEditor` has required STRING fields `points_store`, `coordinates`, `neg_coordinates`, `bbox_store`, `bboxes`, plus `bbox_format`, `width`, `height` and `normalize`. Only `coordinates`, `neg_coordinates` and `bboxes` matter for execution, and `json.loads` is applied to them. Keep `normalize: false`.
- **No-click alternatives:**
  - The auto template (largest person).
  - Core `SAM3_Detect`: `conditioning` (text such as "the woman in red"), `positive_coords`/`negative_coords` (same JSON), `bboxes`. With `SAM3_VideoTrack` / `SAM3_TrackToMask` (`object_indices`) this would allow text selection.
  - SAM3 is used by the official Wan 2.1 VACE inpainting template, but **no Wan 2.2 Animate template uses it** (unconfirmed combination).

### S2V-14B: speech or sound to video
- Template `video_wan2_2_14B_s2v.json`:
  - Loading and encoding: `AudioEncoderLoader` (`wav2vec2_large_english_fp16` in `models/audio_encoders`) → `AudioEncoderEncode` (from `LoadAudio`).
  - First chunk: `WanSoundImageToVideo` (640, 640, 77; `ref_image` from `LoadImage`) → `KSampler`.
  - Extension: then N "Video S2V Extend" subgraphs (`WanSoundImageToVideoExtend` → `KSampler` → `LatentConcat`).
  - Output: `LatentCut`/`LatentConcat` duplicate the first frame (a VAE workaround), then `ImageFromBatch` drops it using the "Batch sizes" value. `CreateVideo` muxes the **input** audio.
  - Defaults: two extends active (three chunks of 77 at 16 fps, about 14 s). "Batch sizes" must equal the chunk count. The 4-step path uses `wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise` (the template note says it is not trained for S2V and loses quality). The non-LoRA path uses 20 steps at cfg 6.
- `WanSoundImageToVideo` inputs: `width`, `height`, `length` (default 77), `batch_size`, optional `audio_encoder_output`, `ref_image`, `control_video`, `ref_motion`. The node hard-codes 16 fps when bucketing audio, and keeps up to 73 motion frames.
- **Duration** = number of chunks × 77 frames ÷ 16 fps. The docs tell users to work out the chunk count from the audio length, e.g. 14 s → 224 frames → 3 chunks. A static API-format Workflow has a fixed maximum.
- Upstream adds `--pose_video` (a DWPose sequence for pose-driven S2V), `--num_clip`, `--infer_frames` (default 80, a multiple of 4) and optional CosyVoice TTS (`--enable_tts`, `--tts_text`, ...). It quotes 80 GB VRAM for the single-GPU command. In ComfyUI the pose path maps to the optional `control_video`, which the template does not wire.
- Weights: `wan2.2_s2v_14B_fp8_scaled` (16.4 GB) or bf16 (32.6 GB), a single model with no expert pair.
- Sources: docs `tutorials/video/wan/wan2-2-s2v`; template above; `nodes_wan.py` `wan_sound_to_video`; Wan2.2 README and `wan/configs/wan_s2v_14B.py`; HF `Wan-AI/Wan2.2-S2V-14B`.

### Fun Control A14B / 5B: pose, depth or canny control ("motion tracking")
- Template `video_wan2_2_14B_fun_control.json`: `LoadVideo` → `GetVideoComponents` → `Canny` (bypassed, because the sample video is already a pose render) → `Wan22FunControlToVideo.control_video`. `LoadImage` → `ref_image`. Two `KSamplerAdvanced` at 20 steps, cfg 3.5, split 10, shift 8. Size 640×640×81. A 4-step LoRA group is bypassed.
- **`Wan22FunControlToVideo` schema** exposes `ref_image` and `control_video`, not `start_image`, although its `execute` accepts one. `ref_image` is VAE-encoded into `reference_latents`, i.e. an **appearance reference, not a pinned first frame**. The docs call it a start frame; the code says otherwise.
- Pose or depth extraction needs packs: `DWPreprocessor` (controlnet_aux) or DepthAnythingV2 (template note). Core has only `Canny`.
- Model card (alibaba-pai/Wan2.2-Fun-A14B-Control): Canny, Depth, Pose, MLSD and trajectory control; trained on 81 frames at 16 fps at 512/768/1024. Trajectory control has no official ComfyUI template.
- 5B variant: `video_wan2_2_5B_fun_control.json` (704×704×121, 24 fps, `wan2.2_fun_control_5B_bf16` + `wan2.2_vae`).
- Weights: `wan2.2_fun_control_{high,low}_noise_14B_fp8_scaled` (about 14.3 GB each). VRAM and time are the same as T2V on the 4090D (83–89%, about 524 s or about 79–138 s).

### Fun Camera A14B: camera presets
- Template `video_wan2_2_14B_fun_camera.json`: `WanCameraEmbedding` (`camera_pose`, `width`, `height`, `length`, `speed`, advanced `fx`, `fy`, `cx`, `cy`). It outputs `camera_embedding`, `width`, `height` and `length`, which feed `WanCameraImageToVideo` (`start_image` required for this use).
- **Bind the size and length Inputs to `WanCameraEmbedding`**, because `WanCameraImageToVideo`'s copies are linked.
- `camera_pose` options: Static, Pan Up, Pan Down, Pan Left, Pan Right, Zoom In, Zoom Out, Anti Clockwise (ACW), ClockWise (CW). The docs mention combinations, but the core node takes one value.
- Weights: `wan2.2_fun_camera_{high,low}_noise_14B_fp8_scaled` (15.3 GB each).

### Fun VACE A14B (2.2): present as weights, no official Workflow
- HF `alibaba-pai/Wan2.2-VACE-Fun-A14B` says it is built on Wan2.2-T2V-A14B. It lists Canny, Depth, Pose, MLSD, trajectory and one or more reference images; inpainting and first/last frame are not listed for it.
- Comfy-Org repack ships `wan2.2_fun_vace_{high,low}_noise_14B_{bf16,fp8_scaled}` (fp8 about 17.3 GB each).
- ComfyUI core detects VACE weights by `vace_patch_embedding` (`comfy/model_detection.py`) and has `WanVaceToVideo` (`control_video`, `control_masks`, `reference_image`, `strength`).
- There is **no 2.2 VACE template or tutorial**; all VACE templates are Wan 2.1.

### Wan Animate 2 (newer, motion transfer only)
- Released 2026-08-07 (Wan-Video/Wan-Animate-2 @ `3ad2fef`; HF `Wan-AI/Wan2.2-Animate-2-14B`). The ComfyUI source header says it uses **Wan2.1-I2V-14B weights** with a pose branch fed directly by the driving video (`comfy/ldm/wan/model_animate2.py`).
- No skeleton or face preprocessing. The prompt sets appearance and background, and text controls the camera. The upstream README and code show **no replacement mode** (no mask or background inputs).
- `WanAnimate2ToVideo` fields:
  - `reference_image`, `pose_video`, `clip_vision_output`
  - `positive_pose`, `clip_vision_output_pose`
  - `continue_motion`, `video_frame_offset`
  - `pose_strength`, `pose_start_percent`, `pose_end_percent`, `reference_image_strength`
- `WanAnimate2Cache` trades about 12.5 GB of system RAM (480×832×81, bf16) for about 2× speed.
- Template `video_wan_animate2.json`: inside one subgraph, `StartLoop`/`EndLoop` iterate until the whole driving video is covered. The output is trimmed to exactly the driving frame count, and each extra loop adds `fragment_length - 1` frames. It needs ComfyUI ≥ 0.36.0. This is the only official Wan-family Workflow that **adapts its length to the Upload inside one static graph**.

### Not in the Wan 2.2 open family (for completeness)
- Wan-Move and ATI (trajectory drawing) are Wan 2.1-based.
- InfiniteTalk (Wan 2.1) does audio-driven dubbing.
- SCAIL-2 (`video_wan21_scail2_character_replacement`, Wan 2.1) is another character-replacement Workflow.
- Wan 2.5–3.0 (video edit, reference-to-video, native audio) are closed API partner nodes, not self-hostable.

## Requested features vs. Wan 2.2

| Wanted feature | Wan 2.2 support | Where |
|---|---|---|
| First/last frame | Yes | I2V-A14B `WanFirstLastFrameToVideo`; Fun InP |
| Reference image (as first frame) | Yes | I2V-A14B, TI2V-5B, Fun Camera |
| Reference image (appearance) | Partial | Animate `reference_image`; Fun Control `ref_image`; S2V `ref_image`; Animate 2 |
| Reference video | Yes, as motion source | Animate (pose and face extracted); Fun Control (`control_video`); Animate 2 |
| Reference audio | Yes, as the driver | S2V (speech, singing); Wan Dancer (music). The audio is muxed, not generated |
| Character replace | Yes | Animate "Mix" (points, or auto-detect, then SAM2) |
| Motion tracking/transfer | Yes | Animate "Move"; Fun Control pose/depth/canny; Animate 2 |
| Character consistency (multi-shot, multi-reference) | **No dedicated support** | Only single-reference conditioning; Fun VACE multi-reference unconfirmed in ComfyUI |
| Prompt-driven edit of an existing video | **No** | Closest: Fun Control with depth/canny of the source plus a new prompt (restyle). The true edit model (Wan 2.7 Video Edit) is closed API |
| Duration | Yes, per pass (`length`, 4n+1, about 5 s) | Longer: chunked Animate/S2V, looped Animate 2. **No official T2V/I2V extension** |
| Native audio in output | **No** | |

## Options & implications for the studio

These are trade-offs; this research does not pick between them.

**How Wan 2.2 might split into Models**

1. **One Model per official template** (T2V-14B, I2V-14B, FLF-14B, TI2V-5B, Animate, S2V, Fun Control, Fun Camera, maybe Fun InP).
   - Pros: the Workflows are used almost as exported; each binding is easy to test; matches the docs one-to-one.
   - Cons: 8–9 catalog entries; similar Inputs repeated; the user must know which to pick.
2. **One Model per checkpoint family, with Modes inside** (the weights decide the Model, the task decides the Mode):
   - "Wan 2.2 Image→Video 14B": Modes Image→Video, First/last frame, and Fast (Lightning) vs Quality.
   - "Wan 2.2 Text→Video 14B": Quality and Fast.
   - "Wan 2.2 5B": Text→Video and Image→Video.
   - "Wan 2.2 Animate": Character replace (click to pick), Character replace (auto-pick), Motion transfer.
   - "Wan 2.2 Speech→Video": with or without a pose video.
   - "Wan 2.2 Control": pose, depth or canny as Modes switching the preprocessor.
   - "Wan 2.2 Camera": the preset is an Input, not a Mode.
   - Pros: 5–7 Models that map to user tasks; one weight set per Backend.
   - Cons: the Workflows must be hand-built from the templates (switch nodes, placeholders, see below); more testing per Model.
3. **Task-oriented all-in-one** (e.g. one "Wan 2.2 Video" Model that switches between T2V, I2V and FLF expert pairs).
   - Pros: closest to the LTX 2.5 experience.
   - Cons: a Mode change swaps about 28 GB of fp8 experts on the Backend (cold loads), every Backend needs every weight file, and the graph is the hardest to maintain.
- Motion transfer could also come from **Wan Animate 2** (better motion, new background from the prompt, length-adaptive loop) while character replacement stays on **Animate v1**. That gives two Models with different weights.

**Mechanics that constrain any split** (from source; not tested end to end):
- **Bypass is lost on export.** `graphToPrompt` drops BYPASS and NEVER nodes and reroutes around them (ComfyUI_frontend @ `0ce4863` `src/utils/executionUtil.ts`). An API-format Workflow therefore cannot toggle a bypass group per Mode. Modes must steer with values: a `PrimitiveBoolean` feeding `ComfySwitchNode`, which is lazy (`check_lazy_status`) so the unused branch never runs. The official T2V and I2V templates already do this for Lightning.
- **A switch can unset an optional input.** `ComfySwitchNode` with an unconnected branch returns `None`. Feeding `background_video` and `character_mask` through such switches would let one Animate Workflow cover Mix and Move. The same pattern could make `end_image` optional for FLF. This is inferred from `nodes_logic.py` and `nodes_wan.py`; untested.
- **Unused file loaders still validate.** `validate_inputs` walks every linked upstream node, and `LoadImage`, `LoadVideo` and `LoadAudio` reject missing files even when a lazy switch would skip them. Modes that hide an image or video Input need a **placeholder file** present on the Backend, or must use optional sockets fed only through switches.
- **Subgraph nodes get colon IDs in API format.** Nodes inside subgraphs are flattened to IDs such as `"232:62"` (`ExecutableNodeDTO` joins the subgraph path with `:`). Every 2.2 template except FLF, 5B and the Fun templates uses subgraphs, so Input bindings must handle these string IDs.
- **Bind to the source primitive, not the linked field.** Many fields are linked from primitives: Duration → `ComfyMathExpression` → `length`; `WanCameraEmbedding` → `WanCameraImageToVideo`; Width/Height primitives in Animate. Writing a literal into the downstream field replaces the link and silently disconnects the primitive. Bind Inputs to the source primitive.
- **The studio must validate shapes.** The server does not enforce steps: `length` must be 4n+1, `width`/`height` multiples of 16 (14B) or 32 (5B). A "Duration (s)" Input can map to the template's Duration primitive (fps fixed per Mode) instead of raw frames.
- **Long output.** Animate and S2V templates have a fixed number of chunk subgraphs, so output length is capped by the Workflow; extra source frames are ignored. Choices: cap Upload length per Mode (pairs with the charter's server-side trim), offer Modes with different chunk counts (separate Workflows, so separate Models under one-Workflow-per-Model), or rebuild with core `StartLoop`/`EndLoop` as Animate 2 does (needs ComfyUI ≥ 0.36 on every Backend).
- **New Input types are needed.**
  - A **point/box picker on the first video frame** (character replace), producing a JSON string for one STRING Node field.
  - Optionally a **camera-preset picker**; this is a plain select over a combo field.
  - Everything else is image, video or audio Upload, text, number or boolean.
- **Backend requirements per Model:**
  - Custom packs: Animate needs controlnet_aux, KJNodes and segment-anything-2 (+ WanAnimatePreprocess and VideoHelperSuite for the auto template).
  - Auto-downloaded preprocessing models: DWPose and SAM2. Backends need internet on first run or pre-seeded folders.
  - Disk: about 29 GB per fp8 14B expert pair, plus about 6 GB text encoder and about 1.2 GB CLIP-H.
  - Admins will want a per-Model list of required node packs and files.

## Open / unconfirmed

- **Wan 2.2 Fun VACE in ComfyUI.** Weights are repackaged and core should accept them in `WanVaceToVideo`, but there is no official template. Unknown: how the two experts interact with `vace_*` conditioning, and whether reference-image and multi-reference modes work as on Wan 2.1 VACE.
- **Animate face input.** The official ComfyUI template feeds a DWPose face-landmark render as `face_video`, while upstream uses real face crops. The effect on expression fidelity was not tested.
- **Real output length of Animate extends.** By code, each extend adds about 72 new frames (77 minus 5 overlap); the docs say 77. Not run.
- **Mix/Move and FLF in one Workflow** via `ComfySwitchNode` returning `None`: inferred from source, not executed.
- **SAM3 for Animate.** Text- or point-prompted SAM3 tracking as a replacement for SAM2 + PointsEditor is plausible but not in any Wan 2.2 template.
- **VRAM for Animate and S2V at 480p/720p in ComfyUI** is not published. The only figures are template notes for T2V, I2V, FLF and Fun on a 24 GB card at 640×640, and upstream non-ComfyUI peaks.
- **Wan Animate 2 lineage.** The HF repo is named "Wan2.2-Animate-2-14B", but ComfyUI calls its weights Wan2.1-I2V-14B-based. Whether it counts as "Wan 2.2" for the catalog is a naming choice.
- **Trajectory control** (listed on the Fun Control model card) has no ComfyUI template for 2.2. The trajectory Workflows (Wan-Move, ATI) are Wan 2.1.
- **Fun Camera presets.** The docs mention combined moves, but the core `WanCameraEmbedding` takes one preset. Combined moves may need the VideoX-Fun custom nodes.

## Sources (versions)

| Source | Version / date |
|---|---|
| comfyanonymous/ComfyUI (`comfy_extras/nodes_wan.py`, `nodes_camera_trajectory.py`, `nodes_logic.py`, `nodes_sam3.py`, `nodes_video.py`, `nodes_audio.py`, `execution.py`, `comfy/utils.py`, `comfy/model_detection.py`, `comfy/ldm/wan/model_animate2.py`) | `1a82e6d01f395b43275c77acd289af1eb7090bb9`, 2026-10-21, v0.42.0 |
| Comfy-Org/workflow_templates (`templates/index.json`, the `video_wan2_2_*`, `video_wan_animate2*`, `template_purz_wan22_*` JSONs) | `447747bf37b7e2f6d5fab3f15288e03bf889b82f`, 2026-10-22 |
| Comfy-Org/docs (docs.comfy.org `tutorials/video/wan/{wan2_2,wan2-2-animate,wan2-2-s2v,wan2-2-fun-control,wan2-2-fun-camera,wan2-2-fun-inp,wan-animate-2,wan-dancer,wan-move}.mdx`, `built-in-nodes/WanAnimateToVideo.mdx`, `development/api-development/workflow-api-format.mdx`, `changelog/index.mdx`) | `506a4a94db30524adb8706667aec050d71dbdf60`, 2026-10-21 |
| Comfy-Org/ComfyUI_frontend (`src/utils/executionUtil.ts`, `src/lib/litegraph/src/subgraph/ExecutableNodeDTO.ts`) | `0ce48633dd96193b891d77f88dbd9a23b73d23cf`, 2026-10-21 |
| Wan-Video/Wan2.2 (README, `generate.py`, `wan/configs/*`, `wan/modules/animate/preprocess/*`, `assets/comp_effic.png`) | `1ea34ff48f87168174e12956e200b1d908b1c5ff`, 2026-09-21 |
| Wan-Video/Wan-Animate-2 (README) | `3ad2fef7d61d6200c9c653e0fe47be7616b323f3`, 2026-08-08 |
| kijai/ComfyUI-KJNodes (`nodes/curve_nodes.py` `PointsEditor`; `nodes/mask_nodes.py`) | `f4bae1f9960e5d643573a2ecf7abd56453a21821`, 2026-10-20 (template pins older commits `e81f335`, `623b591`, `00da191`) |
| kijai/ComfyUI-segment-anything-2 (`nodes.py`, `sam2/sam2_video_predictor.py`) | `0c35fff5f382803e2310103357b5e985f5437f32`, 2025-09-28 (template pins `c59676b`) |
| kijai/ComfyUI-WanAnimatePreprocess (`nodes.py`, `models/onnx_models.py`, readme) | `0e0b6a2a555625acf4d4aefb780e27d06937132f`, 2026-05-27 (template pins `e63d6e7`) |
| Fannovel16/comfyui_controlnet_aux (`node_wrappers/dwpose.py`) | `a587a4c1594524c1d2de5cd1a86cd868ff448e1c`, 2026-10-11 (template pins `59b027e`) |
| HF model cards: `Wan-AI/Wan2.2-Animate-14B`, `Wan-AI/Wan2.2-S2V-14B`, `alibaba-pai/Wan2.2-Fun-A14B-Control`, `alibaba-pai/Wan2.2-VACE-Fun-A14B`; file listing of `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` (`split_files/diffusion_models`, `split_files/loras`) | fetched 2026-10-22 |
