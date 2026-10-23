# Wan 2.2 Animate (Mix / character replace): facts for "What Inputs and Mode states does the Wan 2.2 Model ship with?"

Gathered 2026-10-23. This extends [`docs/research/wan-2-2-modes.md`](https://github.com/mysteryreloaded/ai-content-studio/blob/research/wan-2-2-modes/docs/research/wan-2-2-modes.md) and does not repeat what that doc already settles. "Inferred" means read from code or reasoned about, not executed. Nothing here was run on a GPU.

## Sources (read from shallow clones)

| Repo | Commit, date |
|---|---|
| comfyanonymous/ComfyUI (HEAD; `comfyui_version.py` = 0.42.0) | `bef11fcbfa8d772678e2ad00b1294c63eb3e5da7`, 2026-10-22. Full history clone used for tags: v0.36.0 = `ee71d5c4` (2026-09-15), v0.42.0 = `355cd6b1` (2026-10-18) |
| Comfy-Org/workflow_templates | `67984637eefcd4825dcf5c134e39034785be1682`, 2026-10-23 |
| Comfy-Org/docs | `f488ce24fa5fccca9ab9a55063c204f71db298d8`, 2026-10-22 |
| Comfy-Org/comfy-kitchen (version 0.2.40, the version ComfyUI pins in `requirements.txt`) | `f8b7e97a1418d2e529bd5405fbf86312be198ae6`, 2026-10-21 |
| Wan-Video/Wan2.2 | `1ea34ff48f87168174e12956e200b1d908b1c5ff`, 2026-09-21 |
| kijai/ComfyUI-KJNodes | `74b7f1731cfd0208ae50b9ffc55145564c25e65f`, 2026-10-22, plus the template-pinned `e81f33508b08` (2025-09-19) |
| kijai/ComfyUI-segment-anything-2 | `0c35fff5f382803e2310103357b5e985f5437f32`, 2025-09-28 |
| Fannovel16/comfyui_controlnet_aux | `a587a4c1594524c1d2de5cd1a86cd868ff448e1c`, 2026-10-11 |
| Kosinkadink/ComfyUI-VideoHelperSuite | `4d907bee61e92c2e65af3bd6383a4e4d356126d1`, 2026-09-01 |
| city96/ComfyUI-GGUF | `6ea2651e7df66d7585f6ffee804b20e92fb38b8a`, 2026-01-12 |
| HF pages (via WebFetch; shell access to huggingface.co is blocked) | `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` diffusion_models listing; `QuantStack/Wan2.2-Animate-14B-GGUF`. Both fetched 2026-10-23 |

---

## F1. Length-adaptive looping

### How `video_wan_animate2.json` loops (templates @ `6798463`)

Everything is inside the subgraph "Motion Transfer (Wan Animate 2)". Node IDs are from the template.

**Frame count and iteration count** (computed outside the loop body, once):
- `GetVideoComponents` #288 (driving VIDEO) → `GetImageSize` #537 gives `batch_size`. This is **F**, the driving frame count.
- `PrimitiveInt` #635 "Int (fragment_length)" gives **b** = 81.
- `ComfyMathExpression` #636 computes `floor((a - 2) / (b - 1))` = k (the number of continuations).
- `ComfyMathExpression` #645 computes `a + 1` = n. This feeds `StartLoop` #642, input `mode.num_iterations` (mode `simple`, `cache_iterations` false).
- `ComfyMathExpression` #639 computes `4 * ceil((a - b*c + c - 1) / 4) + 1` with a=F, b=81, c=k. This is the length of the **last** segment, rounded up to 4n+1.
- `ComfyMathExpression` #667 computes `(a % 4 == 1) and ((b - 1) % 4 == 0)`. It answers "exact without trim?".

**Loop body** (copied once per iteration by `StartLoop`):
- `ComfySwitchNode` #646 "If/Else Switch(length)": `switch` = `StartLoop.is_last`, on_true = #639, on_false = b. It feeds `WanAnimate2ToVideo.length`. So every segment is 81 frames except the last, which is shortened. If n = 1, the only segment is first and last, and its length is `4*ceil((F-1)/4)+1`.
- Carried value: `StartLoop.current_iteration_value` → `GetItemFromList` #649 (index 0 = previous IMAGE) and #653 (index 1 = previous `video_frame_offset`).
  - `ComfySwitchNode` #651 on `is_first`: on_false = #649 → `continue_motion`. On the first iteration it returns None, which leaves the optional input unset.
  - `ComfySwitchNode` #652 on `is_first`: on_true = `PrimitiveInt` 0, on_false = #653 → `video_frame_offset`.
- `WanAnimate2ToVideo` #587 → `SamplerCustom` #597 (lcm, `BasicScheduler` simple 6 steps, `ModelSamplingSD3` shift 5, cfg 1) → `TrimVideoLatent` #602 (`trim_latent`) → `VAEDecode` #601.
- `CreateList` #648 builds `[VAEDecode.IMAGE, WanAnimate2ToVideo.video_frame_offset]` → `EndLoop.next_iteration_value`.
- The frame to keep goes to `ComfySwitchNode` #605 on `is_first`. On the first iteration it takes the full decode. Later iterations take `ImageFromBatch` #604 with `batch_index` **1 as a fixed widget** and length 4096, which drops the 1 overlap frame. #605 feeds `EndLoop.output_value`.
- `EndLoop` #647: `accumulate` true; `terminations.termination0` = `video_frame_offset`.

**After the loop:**
- `RebatchImages` #661 (`batch_size` = F) → `ImageFromBatch` #670 "Trim tail to F" (length = F) → `ComfySwitchNode` #671 "Apply tail trim?" (switch = #667) → `CreateVideo` #245.
  - `CreateVideo` takes `fps` = `GetVideoComponents.fps` and `audio` = `GetVideoComponents.audio`.
- The in-template note "Loop math (exact frame count)" and docs `tutorials/video/wan/wan-animate-2.mdx` (lines 112–118) describe this design: each continuation adds b − 1 frames, the output is trimmed to exactly F, and it needs ComfyUI ≥ 0.36.0.

**Template quirks** (from reading the JSON):
- **Inferred, not run.** `RebatchImages` (core `nodes_rebatch.py`) flattens every frame and re-chunks it into lists of `batch_size` = F. When the generated count G > F, it emits **two list items**: F frames, then G − F frames. Downstream nodes map over lists (`execution.py` `_async_map_node_over_list`). So `ImageFromBatch` #670 is a no-op on the first item, and a short second VIDEO of the tail frames may also reach `CreateVideo`/`SaveVideo`.
- The Animate 2 note text still says "Native loop support PR #13180 … still under review", and so does the `video_wan_animate2_distilled.json` note. That text is out of date in the main template, which does use the loops. The distilled template has no `StartLoop`; it needs manual chaining.
- Only two templates in the repo use `StartLoop`: `video_wan_animate2.json` and `image_ming_image_01_design_image_edit.json`. No Animate v1 template does.

### Loop node mechanics (core `comfy_extras/nodes_loop.py`, `comfy_execution/validation.py`)

- **Body.** `validate_loops` pairs each `StartLoop` with an `EndLoop`. It sets `_loop_body` to the nodes reachable from `StartLoop`'s outputs before `EndLoop`.
  - A path from StartLoop to an output node that does not pass through EndLoop raises `loop_escape`. Side-effect outputs inside the loop must be wired to `EndLoop.terminations`.
- **Expansion.** `StartLoop.execute` expands the body n times (`_expand_loop`). Links to nodes **outside** the body are kept as they are (`copied_link` returns the source unchanged).
  - So preprocessing upstream of the loop (DWPose, SAM2, mask, background) runs **once** and is shared by every iteration.
  - `current_iteration_value` takes `next_iteration_value` from the previous copy. `LoopIteration` is not cached unless `cache_iterations` is on.
- **Version.** Added in commit `50ab50c1` (2026-09-14, PR #16227 "Implement Generic Loops"). Follow-ups `a84f954b` and `b2da2b42` landed 2026-09-15. The first tag containing all three is **v0.36.0** (Comfy docs changelog: "v0.36.0, September 15, 2026 … Generic Loops").
- Helper nodes: `CreateList` (core since 2026-02-05, #12173), `GetItemFromList` (added with the loops, v0.36.0), `ComfyMathExpression` (2026-03-05, #12687; supports `floor`, `ceil`, `min`, `max`, `round`).

### Can the same loop drive Animate v1 `WanAnimateToVideo`? (core `nodes_wan.py` @ `bef11fc`, lines 1117–1255)

Judgment: **yes in principle, with three changes.** Inferred; not executed.

1. **No per-iteration slicing of the inputs is needed.** `WanAnimateToVideo` slices every per-frame input by `video_frame_offset` itself.
   - `pose_video[video_frame_offset:]`, `face_video[video_frame_offset:]`, `background_video[video_frame_offset:]` and `character_mask[video_frame_offset:]` are each then cut to `[:length]`.
   - A single-frame `character_mask` is broadcast instead.
   - So the full-length tensors from the existing preprocessing chain can be fed unchanged into the loop body from outside.
   - When an input runs out:
     - `pose_video` shorter than `length` is padded with its last frame.
     - `face_video` is **not** padded. The model pads `motion_vec` with zeros (`comfy/ldm/wan/model_animate.py` `after_patch_embedding`).
     - `background_video` beyond its end leaves mid-grey 0.5 frames.
     - `character_mask` beyond its end leaves mask 1 (generate).
     - Past the end, `pose_video`/`face_video` become None. v2, by contrast, **raises** when `pose_video.shape[0] <= video_frame_offset`.
     - These tails only affect frames that are trimmed off later.
2. **Overlap differs: v1 uses `continue_motion_max_frames` (template 5), v2 a fixed 1.**
   - With 5, v1 lowers the offset by 5. `trim_image` = `((5-1)//4+1)*4-3` = 5, so each continuation adds `length − 5` frames (72 for 77). v2 adds `length − 1`.
   - The template's `ImageFromBatch` #604 hard-codes `batch_index` 1. For v1, wire `WanAnimateToVideo.trim_image` into `batch_index` instead, as the v1 template does. It is 0 on the first iteration, so the `is_first` switch #605 becomes unnecessary.
   - The k/len formulas (#636, #639, #667) assume an overlap of 1 and must be re-derived for 5.
   - **Option:** `continue_motion_max_frames` has min 1 and step 4, so **1 is legal**. Upstream also supports `--refert_num 1` (asserted 1 or 5 in `wan/animate.py` L351; README examples use 1). With 1, v1's overlap and trim become 1, and the v2 math should carry over unchanged (inferred).
3. **Length fields.** v1's default `length` is 77, not 81. Any 4n+1 works.
   - v1 needs `width`/`height` wired correctly. The v1 template's Extend subgraph wires `width` to both width and height (quirk already noted in the research doc).
   - v1 also takes `clip_vision_output`, `face_video`, `background_video` and `character_mask` from outside the loop.
   - In the v1 template `KSampler` uses one seed for all chunks, which also happens in a loop.

**What would break or needs care:**
- The `RebatchImages` tail behaviour above.
- RAM: all chunk outputs are held until `EndLoop` (accumulate), as well as the full-resolution source tensor and the per-frame preprocessing tensors.
- The `is_last` length switch shortens the **last** chunk, so a short final chunk gets little motion context. Upstream instead pads the inputs up to whole clips (`wan/animate.py` `get_valid_len`/`inputs_padding`) and trims to `real_frame_len`.

**Community reports of Animate v1 in a loop:** none found (web search, 2026-10-23). The GitHub issue search could not be reached: GraphQL and cross-repo search are blocked here, and the issues page timed out on approval. **Unconfirmed.**

---

## F2. Frame-count and fps nodes

**Core (v0.42, @ `bef11fc`):**
- **Frame count:**
  - `GetImageSize` returns `width`, `height` and `batch_size` (= frame count of an IMAGE batch). Animate 2 uses this.
  - `GetVideoComponents` returns `images`, `audio`, `fps` (FLOAT = `float(video_stream.average_rate)`), `bit_depth` and `color_space`. It has **no frame-count output**.
  - `VideoInput.get_frame_count()` exists but is not exposed as a node output.
- **Note on variable frame rate:** the sample `street_dance_drive.mp4` has `r_frame_rate` 60/1 but `avg_frame_rate` 7260/301 ≈ 24.12, and core reports 24.12 (ffprobe on the file in the templates `input/` folder).
- **Resample or every-Nth in core:** there is **no fps-resample or select-every-Nth node.** Closest options:
  - `VideoFrameSample` (experimental, `nodes_dataset.py`, added 2026-07-21 in #13588). Inputs: `num_frames`; `strategy` uniform/head/tail/random.
    - "uniform" picks `round(i*(total-1)/(num_frames-1))`. With `num_frames = round(F * target_fps / source_fps)` this approximates a resample, but `num_frames` must be computed from a prior decode.
    - Its output VIDEO keeps the **original** `frame_rate` metadata.
    - The helper decodes with `rgb24` and no rotation handling (`_decode_selected_frames`). That last point is inferred.
  - `VideoTemporalCrop` / `Video Slice` / `VideoTrim` select a contiguous range only.
  - `FrameInterpolate` (RIFE/FILM) only multiplies the frame count by an integer.
- **KJNodes:**
  - `GetImageSizeAndCount` returns `count`.
  - `EncodeVideoComponents` returns `fps` and `frame_count`.
  - `GetImagesFromBatchIndexed` selects from a comma-separated index string.
  - `GetImageRangeFromBatch` selects a contiguous range.
  - `LoadVideosFromFolder` has `force_rate`/`select_every_nth`, but it **imports VideoHelperSuite** and fails without it.
  - No standalone every-Nth or fps-resample node.
- **comfyui_controlnet_aux, segment-anything-2:** none.
- **VideoHelperSuite (not currently required):**
  - `VHS_LoadVideo` has `force_rate` (0 = source; max 60; a time-accumulator drop/duplicate in `cv_frame_generator`), `frame_load_cap`, `skip_first_frames` and `select_every_nth`. It outputs IMAGE, `frame_count`, audio and `video_info`.
  - `VHS_LoadVideoFFmpeg` resamples with the ffmpeg `fps=` filter.
  - `VHS_VideoInfo` outputs `source_fps`, `source_frame_count`, `source_duration`, `source_width`, `source_height` and the matching `loaded_*` values.
  - `VHS_SelectEveryNthImage`/`Mask`/`Latent` return `images[skip::n]` plus `count`.

## F3. Upstream Wan Animate fps and length (Wan2.2 @ `1ea34ff`)

- **Preprocessing resamples to a fixed fps.**
  - `preprocess_data.py --fps` defaults to **30**; −1 keeps the source rate.
  - `process_pipepline.py`: `target_num = int(frame_num / video_fps * fps)` and `get_frame_indices` picks `round(i/fps * video_fps)`. This is nearest-frame drop/duplicate.
  - Frames are resized by area: `--resolution_area` defaults to 1280 720, keeps the aspect ratio, divisor 16.
  - The pose, face, bg and mask videos are written at that fps.
- **Output fps is fixed.** `wan/configs/wan_animate_14B.py` sets `sample_fps = 30` and `frame_num = 77` (clip_len). `generate.py` writes with `fps=cfg.sample_fps`, so the output is always 30 fps. If preprocessing used a different `--fps`, the output tempo would be wrong (inferred).
- The diffusers example in the README also exports at `fps=30` with `segment_frame_length=77` and `prev_segment_conditioning_frames=1`.
- **UserGuider.md:**
  - "The `fps` parameter can specify the frame rate for video processing. A lower frame rate can improve generation efficiency, but may cause stuttering or choppiness."
  - `resolution_area` "determines the resolution for both preprocessing and the generation model … by pixel area".
  - The mask step is single-person only.
- **No maximum clip length is stated.** Upstream processes the whole video in chunks of `clip_len` (77) with an overlap of `refert_num` (1 or 5, asserted). It pads the inputs to whole chunks and trims to the real length (`wan/animate.py` L380–647).
- `generate.py`'s argparse default `--refert_num 77` would fail the assert; the README passes `--refert_num 1`.

## F4. Template fixed values (`templates/video_wan2_2_14B_animate.json` @ workflow_templates `6798463`, 2026-10-23)

Widget values marked "stale" are overridden by links.

| Item | Value |
|---|---|
| `UNETLoader` #20 | `Wan2_2-Animate-14B_fp8_e4m3fn_scaled_KJ.safetensors`, weight_dtype `default` |
| LoRA 1 `LoraLoaderModelOnly` #18 | `lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors`, strength 1 |
| LoRA 2 `LoraLoaderModelOnly` #99 | `WanAnimate_relight_lora_fp16.safetensors`, strength 1 |
| `ModelSamplingSD3` #60 | shift 8 |
| Main `KSampler` #63 (subgraph "Video Sampling and output") | seed 1106558644923357 `randomize`; steps 6; cfg 1; `euler`; `simple`; denoise 1. These are promoted subgraph widgets (`proxyWidgets`) |
| Extend `KSampler` #91 (subgraph "Video Extend") | seed 387378783691198 `fixed`; steps 6; cfg 1; `euler`; `simple`; denoise 1 |
| `GrowMask` #274 | expand 10, tapered_corners true |
| `BlockifyMask` #276 | block_size 32 |
| `DWPreprocessor` #101 (pose_video) | hand enable, body enable, face disable; bbox `yolox_l.onnx`; pose `dw-ll_ucoco_384_bs5.torchscript.pt`; scale_stick disable; resolution linked (widget 512 stale) |
| `DWPreprocessor` #100 (face_video) | hand disable, body disable, face enable; other settings as above |
| `PixelPerfectResolution` #158 | `resize_mode` "Just Resize". `image_gen_width`/`height` come from the Width/Height primitives (widget 512/512 stale). `original_image` is the **unscaled** source frames. Result = `round(max(h/H, w/W) * min(H, W))`, e.g. 640 for 640×640 from a 1920×1080 or 640×640 source |
| `ImageScale` #212 | lanczos, crop `center`, w/h linked (widget 512/512 stale) |
| Width / Height `PrimitiveInt` #159/#160 | 640 / 640 |
| `WanAnimateToVideo` #62 (main) | w/h linked (640×640), length 77, batch_size 1, continue_motion_max_frames 5, video_frame_offset 0 |
| `WanAnimateToVideo` #90 (Extend) | widgets 1280/1280 stale (both linked to `width`), length 77, batch 1, cmmf 5; offset linked |
| Extend subgraphs | 2 instances: #242 (def `975ed319…`) **active**; #278 (def `063b0ee8…`, identical) **bypassed** (mode 4); its `SaveVideo` #277 is also bypassed |
| Outputs | `SaveVideo` #19 (main chunk only) and #243 (main + extend 1). Two videos per run |
| `CreateVideo` fps | 16, in main and Extend; promoted `fps` subgraph widget |
| Positive prompt | `The character is dancing in the room` |
| Negative prompt | `色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走` (standard Wan negative) |
| CLIP vision | `CLIPVisionLoader` `clip_vision_h.safetensors`; `CLIPVisionEncode` crop `none`; input is the raw `LoadImage` |
| Text encoder | `CLIPLoader` `umt5_xxl_fp8_e4m3fn_scaled.safetensors`, type `wan` |
| VAE | `wan_2.1_vae.safetensors` |
| SAM2 | `DownloadAndLoadSAM2Model` `sam2_hiera_base_plus.safetensors`, `video`, `cuda`, `fp16`; `Sam2Segmentation` keep_model_loaded true, individual_objects false; only `coordinates_positive` is wired |
| `PointsEditor` #229 | points_store `{"positive":[{"x":256,"y":256}],"negative":[{"x":0,"y":0}]}`, coordinates `[{"x":256,"y":256}]`, neg `[{"x":0,"y":0}]`, bbox_store/bboxes `[{}]`, `xyxy`, 640, 640, normalize false |
| `DrawMaskOnImage` #275 | color `0, 0, 0` |
| Sample inputs | `video_wan2_2_14B_animate_reference_image.png` (1024×1024); `video_wan2_2_14B_animate_original_video.mp4` (ffprobe: 640×640, **16 fps, 149 frames**, 9.31 s, **no audio stream**) |
| index.json | date 2025-09-22; size 27,380,416,512 B; requiresCustomNodes `ComfyUI-segment-anything-2`, `comfyui-kjnodes`, `comfyui_controlnet_aux` |
| Pinned pack versions (cnr `ver`) | controlnet_aux `59b027e`, KJNodes `e81f335` / `623b591` / `00da191`, SAM2 `c59676b`, core nodes "0.3.59"/"0.3.60" |

**Check:** 77 (main) + 72 (one extend, 77 − 5 overlap) = 149, exactly the sample clip's length at 16 fps. This confirms the 72-frames-per-extend reading and explains `CreateVideo` fps 16.

**Template notes** (verbatim gist):
- "Note: about size": width and height must be multiples of 16. "By default, we set it to a smaller size. This is in case you don't have enough VRAM and input a large size, which may cause an out-of-memory issue."
- Note #103: "The Image Scale node is to prevent you from inputting an oversized video. A large size video will take a very long time to preprocess."
- Move-mode note (disconnect, do not bypass); Points Editor usage note; "Copy this group then link the 'Batch images' and the 'video_frame_offset' to the next extend subgraph".
- No VRAM, time or length numbers in the v1 template.
- Docs (`wan2-2-animate.mdx` L142–152): "please use a small size … in case you don't have enough VRAM"; "Each `Video Extend` will extend another 77 frames (Around 4.8125 seconds)". Real gain by code: 72.

## F5. Weights on a 24 GB RTX 3090 (sm_86)

| Weights | Size | What happens on Ampere (core @ `bef11fc`, comfy-kitchen 0.2.40) |
|---|---|---|
| `Wan2_2-Animate-14B_fp8_e4m3fn_scaled_KJ` | 17.14 GB per template note (likely GiB) | Legacy `scaled_fp8` is converted to `float8_e4m3fn` mixed-precision (`comfy/utils.py` `convert_old_quants`). `supports_fp8_compute` needs sm ≥ 8.9, so fp8 is **disabled → "emulated ops"** (`ops.py` `get_disabled_quant_formats`): weights stay fp8 in VRAM and are dequantized per layer to bf16/fp16 for the matmul. Saves VRAM, no speed gain |
| `wan2.2_animate_14B_int8_convrot` (Comfy-Org repack) | 18.4 GB (HF listing, decimal) | Format `int8_tensorwise` + `convrot` flag. ConvRot = orthogonal group-wise **Hadamard rotation** (group 256) of weights, applied online to activations, before int8 quantization with per-channel scale (comfy-kitchen `tensor/int8.py`, `backends/cuda` `int8_linear`). Supported since **ComfyUI v0.27.0** (commit `1a510f04`, 2026-06-25, PR #14636; changelog "int8 support now works on Turing GPUs and newer"). `supports_int8_compute` is true on CUDA. **Native W8A8 int8 matmul on Ampere:** activations are quantized rowwise to int8, then a CUTLASS int8 GEMM (enabled for compute capability major ≥ 8) or cuBLAS int8. If PyTorch is below cu130, comfy-kitchen's CUDA backend is disabled (warning in `quant_ops.py`) and the eager path uses `torch._int_mm` (cuBLASLt int8), still int8 compute. **Not used by the v1 template**, which lists only fp8 KJ and bf16. Animate 2 templates use int8_convrot. LoRA on int8 is supported (changelog: "Better int8 LoRA", "int8 LoRA requant"); quality impact with 2 LoRAs is unconfirmed |
| `wan2.2_animate_14B_bf16` | 32.18 GB per note / 34.5 GB on HF (same size; GiB vs GB) | Does not fit in 24 GB, so it relies on ComfyUI's partial loading/offload. Expect it to be much slower (inferred) |
| GGUF (QuantStack `Wan2.2-Animate-14B-GGUF`) | Q2_K 6.46 … Q4_K_M 11.5 … Q6_K 14.6 … Q8_0 18.7 GB | Needs the extra pack city96/ComfyUI-GGUF (`wan` is in `IMG_ARCH_LIST`). Weights are dequantized on the fly per layer, compute in fp16/bf16 (`ops.py`). The HF page names `ComfyUI/models/unet` and an example "wan animate native.json". No VRAM or version guidance on the page |

**Published VRAM and time numbers for Animate:**
- **None from Comfy-Org for Animate**, and no 3090-specific figures found.
- Related figures:
  - The T2V/I2V 14B fp8 template notes (same 14B DiT size, different model): 4090D 24 GB at 640×640×81 used 83–89% VRAM, about 513–536 s at 20 steps and 71–108 s with a 4-step LoRA.
  - The community auto-replace template note (`template_purz_wan22_animate_auto_character_replace.json`): "Stay around 720p (e.g. 720x720 or 832x480)", "1080p may error depending on VRAM", "77–150 frames". It defaults to Width/Height 720/720 while `ImageScale` and `WanAnimateToVideo` widgets say 832×480, and `CreateVideo` uses 30 fps.
  - NextDiffusion tutorial (2025-10-23; uses wrapper-style "WanVideo Animate Embeds" nodes, **not** native `WanAnimateToVideo`; fp8 KJ): RTX 4090 24 GB, 720×1280, 150 frames ≈ 450 s, "around 240 frames was the maximum before running into memory limits".
- **"Safe on 24 GB":** the community guidance is about 720p-class per 77-frame chunk (832×480, 720×720). 1280×720 is reported only on a 4090 with the wrapper. **3090 numbers are unconfirmed.**
- The 3090 has the same 24 GB as a 4090 but no fp8 compute, so expect a similar VRAM ceiling and slower steps (inferred).

## F6. Centre-crop math, decode memory, audio

**`ImageScale` → `comfy.utils.common_upscale(samples, w, h, method, "center")`** (`comfy/utils.py` L1140–1172). It **crops first, then scales**:
```
old_aspect = W / H ; new_aspect = w / h          # Python floats (IEEE double)
x = y = 0
if old_aspect > new_aspect: x = round((W - W * (new_aspect / old_aspect)) / 2)
elif old_aspect < new_aspect: y = round((H - H * (old_aspect / new_aspect)) / 2)
crop = samples[..., y : H - y, x : W - x]          # symmetric; size (W-2x) x (H-2y)
out = resize(crop, w, h)                            # lanczos = PIL LANCZOS on uint8; else torch interpolate
```
- Python `round` is **round-half-to-even**. JS `Math.round` rounds half up, so a matching mapping must use banker's rounding and the same operation order.
  - Example: W 641 → 640×640 gives `round(0.5)` = 0, so no crop. JS would give 1.
- The crop is symmetric, so when W − w·H/h is odd, the kept region is not exactly the target aspect and the resize stretches it slightly.
- Point mapping, source pixel (sx, sy) → output (ox, oy):
  - `ox = (sx − x) * w / (W − 2x)`, `oy = (sy − y) * h / (H − 2y)`.
  - With pixel-centre convention: `ox = (sx + 0.5 − x) * w/(W−2x) − 0.5`. PIL and torch with `align_corners=False` use centres (inferred).
  - `PointsEditor` then does `int(round())`.
- `ImageScale` with `width` or `height` = 0 keeps the aspect ratio (not used by the template).
- Video rotation metadata is applied at decode (`np.rot90`), so W and H are in display orientation.

**Decode memory** (`comfy_api/latest/_input_impl/video_types.py` `VideoFromFile.get_components_internal`):
- `LoadVideo` is lazy. `GetVideoComponents` decodes **every frame** (within any trim window) at **full source resolution** and stacks them into one tensor.
  - Usual H.264/yuv420p is read as `gbrpf32le` float32.
  - `yuvj*`/`rgb24` is read as uint8, then `.float() / 255`, also ending as float32.
- 1920×1080×3×4 B = 24.9 MB per frame, so **300 frames ≈ 7.46 GB**.
- Inferred: the float32 path holds the frame list and the stacked copy at once, so peak RAM is about 2× briefly. The output also stays cached for the run.
- fps = `average_rate`.

**Audio:**
- The template wires `GetVideoComponents.audio` straight into `CreateVideo.audio` in both subgraphs, unchanged.
- At save time (`save_to`), the audio is cut to `ceil(sample_rate / fps × n_frames)` samples. It is not resampled in time.
- So if `CreateVideo.fps` ≠ source fps, motion and audio drift apart. The main-chunk video is 77 frames at 16 fps (4.8 s) and gets the first 4.8 s of audio. Inferred from code.
- The sample video has no audio stream.

## F7. Points

**`PointsEditor`** (KJNodes `nodes/curve_nodes.py` L1403–1541 @ `74b7f17`; same logic at pinned `e81f335`):
- Required fields: `points_store`, `coordinates`, `neg_coordinates`, `bbox_store`, `bboxes` (all STRING); `bbox_format` (`xyxy` | `xywh`); `width`, `height` (INT 8–4096 step 8, default 512); `normalize` (BOOLEAN, default false).
- Optional: `bg_image` (IMAGE).
- Outputs: `positive_coords`, `negative_coords` (STRING JSON), `bbox` (BBOX), `bbox_mask`, `cropped_image`.
- `coordinates` and `neg_coordinates` are passed through `json.loads`, then `int(round())` on x and y.
  - With `normalize: false` the output is `[{"x":int,"y":int}]` in the coordinate space of the image the widget showed. The JS editor sets `width`/`height` to `bg_image` size (`editor_base.js` `handleImageLoad`), which is the W×H `ImageScale` output.
  - `width`/`height` matter only for normalize, `bbox_mask` and `cropped_image`.
  - No clamping is done.
- Current KJNodes raises `ValueError("No points on the canvas…")` on an empty `coordinates` list. Pinned `e81f335` does not raise; it would fail later in SAM2 (inferred).

**`Sam2Segmentation`** (segment-anything-2 `nodes.py` L178–420; `sam2/sam2_video_predictor.py` L157–222):
- H and W are taken from the input image **before** the video segmentor stretches it to 1024×1024 (bilinear, no crop). `init_state(..., H, W)` stores them.
- Points are normalized by `/[W, H]`, multiplied by `image_size` (1024), then given +0.5 and positionally encoded (`prompt_encoder._embed_points`, `position_encoding.forward_with_coords`).
- **Points outside the frame are not validated or clamped anywhere.** Values < 0 or > W/H simply encode to coordinates outside [0, 1] and still run. Fourier features accept any real number. Expect a poor or empty mask (inferred), not an error.
- Malformed JSON is swallowed by a bare `try/except: pass` and fails later with an unclear error (inferred).
- Prompts are added at `frame_idx=0` only (already in the research doc).

## Not confirmed / blocked

- Community reports of Animate v1 driven by `StartLoop`/`EndLoop`: none found. GitHub issue search was blocked; the issues page timed out.
- Whether the Animate 2 template really emits a second tail VIDEO when F is not 4n+1 (from reading `RebatchImages`; not run).
- Any RTX 3090 VRAM or time figure for Animate in native ComfyUI. Relative int8_convrot vs fp8 speed and quality on Ampere.
- Exact HF upload dates for `wan2.2_animate_14B_int8_convrot` (the page shows "4 months ago").
- API-format key for `StartLoop`'s dynamic combo (the template shows input `mode.num_iterations`; the API export shape was not checked).
