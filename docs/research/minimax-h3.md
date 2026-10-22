# MiniMax H3: open weights, ComfyUI nodes, serving and license

Research for ticket `05-minimax-h3`, gathered 2026-10-22 from primary sources. Hugging Face, docs.comfy.org, recipes.vllm.ai, docs.sglang.io and minimax.io were read with a web fetcher, because the research shell cannot reach them. GitHub repos were cloned at the commits listed under [Sources](#sources), and their files and node source were read directly. Hugging Face discussion posts count as primary only when MiniMax staff wrote them.

## Summary

- **What is open:** only **H3-Base**. It ships as two task-specific checkpoints, each with a 33B dense DiT. **FL2VA** covers text-to-video and first, last or first+last frame. **Ref2VA** covers up to 9 images, 3 video clips and 3 audio clips, which gives reference and character consistency, prompt-driven video editing, and voice or music reuse. Every mode generates native 32 kHz stereo audio. Output has a 768 px short edge, 24 fps and runs 4–15 s.
- **What is API-only:** **H3-Context-IR**, the prompt enhancer. MiniMax says it is critical to output quality. **H3-Regenerate-2K** (the 2K pass) is also API-only, and so is sparse attention, which is not released yet.
- **ComfyUI core nodes:** native nodes have shipped since **v0.30.0** (2026-08-02); the current release is 0.42.0. The nodes are `MiniMaxH3ImageToVideo` (t2va/fl2va), `MiniMaxH3ReferenceToVideo` (ref2va), `MiniMaxH3AddGuide` (image or audio guides at any frame), `MiniMaxH3FunControlNetApply` (control video or masked inpainting) and `MiniMaxH3SigmaShift`. Context-IR and 2K are reachable only through paid **partner (API) nodes**.
- **Frame and size rules:** the frame count snaps up to the **17k+5** grid at 24 fps (124 frames = 5 s, 362 frames = 15 s). Width and height must be multiples of 32. Native 16:9 is 1344×768, and area is capped near 768×1344.
- **A single-GPU path now exists, so the charter's "no single-GPU path" no longer holds.** Three routes:
  - ComfyUI with Comfy-quantized, pruned DiTs (16–21 GB) plus an NVFP4 text encoder (15.7 GB) and dynamic VRAM offload. No VRAM floor is published.
  - SGLang on one RTX 4090 at about 18 GB peak. A 50-step clip took about 17 minutes.
  - vLLM-Omni single-GPU layerwise offload.

  MiniMax's own reference setup uses **4 GPUs with Ulysses-4**.
- **Serving:** ComfyUI-native fits the studio's Backend directly. vLLM-Omni and SGLang each ship ComfyUI node packs, so either can also sit behind a Backend, with caveats.
- **License: territory.** The license is the MiniMax H3 Community License, dated 2026-08-02. It grants rights **only outside the EU, UK, Republic of Korea and US** (II). It also bars **displaying or distributing Outputs** outside that area (V.4). Serving users located in those regions therefore looks unauthorized, although MiniMax has not addressed that case directly.
- **License: obligations.**
  - Commercial products must show "MiniMax H3" prominently in the UI (IV.2).
  - Yearly revenue above US$20M needs written authorization (IV.1).
  - Hosted services must bind users to the use restrictions (V.2) and run safeguards, abuse reporting and suspension (V.5).
  - Outputs may not be used to train other models (V.3).
  - A 20-item Acceptable Use Policy applies (Exhibit A).
- **H3 still should not gate launch.** The reason is now the license, plus slow consumer-GPU throughput, rather than hardware availability.

## The earlier quick check, verified

| Earlier claim | Verdict | Primary evidence |
|---|---|---|
| Only H3-Base (33B, 768p) is open | **Confirmed, with nuance.** H3-Base comes as two checkpoints, FL2VA and Ref2VA. Each has a 33B dense DiT, of which about 13B sit in AdaLN branches that inference can cache. Each checkpoint's BF16 transformer is 66.3 GB. 768 px is the default short edge. | GitHub README; `FL2VA/transformer/model.safetensors.index.json` total_size 66,280,430,144 B |
| H3-Context-IR and H3-Regenerate-2K are API-only | **Confirmed.** MiniMax says Regenerate-2K will be released once it is ready, with no date given. | GitHub README, H3-Regenerate-2K section |
| Self-hosting is blocked in US/EU/UK/South Korea | **Confirmed, and broader.** The grant excludes those territories for any use, including displaying or distributing Outputs. Organizations there can apply to MiniMax for a separate license. | LICENSE I.5, II, V.4; QA-about-License.md |
| "MiniMax H3" must be shown in the product UI | **Confirmed for commercial products and services:** the label must be shown "prominently". | LICENSE IV.2 |
| Written authorization above $20M revenue | **Confirmed.** The test is yearly revenue of "your commercial products and services". | LICENSE IV.1 |
| Distillation is banned | **Confirmed, and broader.** The Works and their Outputs must not be used to improve any AI model other than H3 or its derivatives. | LICENSE V.3, I.11 |
| Some content is banned | **Confirmed:** 20 Acceptable Use Policy items, which MiniMax may update. | LICENSE Exhibit A |
| The reference deployment uses 4 GPUs | **Confirmed as an example, not a requirement.** The example is `sglang serve --num-gpus 4 --ulysses-degree 4`. | GitHub README, SGLang deployment |
| (Charter #11) There is no single-GPU path | **Refuted.** ComfyUI, SGLang and vLLM-Omni each document a single-GPU route; see [Hardware](#hardware). | Comfy docs; SGLang cookbook; vLLM-Omni recipe |

## Capability table

"Open" means the capability works with the downloadable H3-Base weights. Class names in the ComfyUI column are ComfyUI core `class_type` values unless marked otherwise.

| Capability | Open weights? | Checkpoint | ComfyUI path (class_type) | Notes |
|---|---|---|---|---|
| Text-to-video + audio (t2va) | Yes | FL2VA | `MiniMaxH3ImageToVideo` with no images | Template `video_minimax_h3_t2v` |
| Image-to-video, first frame | Yes | FL2VA | `MiniMaxH3ImageToVideo.first_frame` | `first_frame` is stretched to the canvas without keeping its aspect ratio |
| Last frame only | Yes | FL2VA | `MiniMaxH3ImageToVideo.last_frame` | `last_frame` is center-cropped |
| First + last frame | Yes | FL2VA | both `first_frame` and `last_frame` | The I2V template covers it; there is no separate FLF template |
| Keyframes at any frame (multiframe) | Yes (ComfyUI extension) | either | `MiniMaxH3AddGuide` (chained) | ComfyUI ≥0.34. Not one of MiniMax's documented tasks, whose official keyframes are frame 0 and -1 only. |
| Reference / character consistency (≤9 images) | Yes | Ref2VA | `MiniMaxH3ReferenceToVideo.ref_images` | The prompt refers to inputs as `<Picture i>`. The R2V template wires 2 images. |
| Reference video (≤3 clips, each 2–15 s, ≤15 s total) | Yes | Ref2VA | `ref_videos` + paired `ref_video_audios` | Frames are read as 24 fps with no metadata, so other rates must be converted first |
| Video editing / V2V (prompt-driven) | Yes | Ref2VA | reference video plus an edit prompt | SGLang calls V2V a ref2va use case. MiniMax's Ref2VA demo is an edit with audio reuse. |
| Native audio (dialogue, SFX, music) | Yes, in every mode | both | `VAEDecodeAudio` → `CreateVideo` | 32 kHz stereo. Dialogue is stable in 11 languages. |
| Audio-conditioned (voice timbre, music reuse) | Yes | Ref2VA | `ref_audios` (≤3) | At most 12 references in total. Audio-only references are rejected; a visual reference is required (vLLM-Omni recipe). |
| Audio-driven (lock a given soundtrack) | Yes (ComfyUI / vLLM-Omni extension) | either | `MiniMaxH3AddGuide.audio` at `frame_idx` | The node source says guide latents are re-injected every step and never denoised. vLLM-Omni offers `audio_mode=lock_source`. |
| Control video (pose/depth/canny/HED/MLSD) and masked inpaint | Yes, through a third-party checkpoint | Ref2VA | `MiniMaxH3FunControlNetApply` + `ModelPatchLoader` | alibaba-pai "Fun ControlNet Union", ComfyUI ≥0.35 |
| Continuation / extension | Yes | FL2VA | I2V from the previous last frame, or `AddGuide` with a clip at frame 0 | Template `video_minimax_h3_i2v_continuation`. Quality drifts over long chains. |
| Context-IR prompt enhancement | **API-only** | n/a | partner node `MinimaxHailuo03ContextIRNode` | MiniMax says it is critical to quality. The open alternative is MiniMax's prompt guides (`skills/h3-prompt-writing`). |
| 2K output | **API-only** | n/a | partner node `MinimaxHailuo03RegenerateNode` (2K) | Needs the unmodified 768P video, the exact prompt and the same references. Locally, the only route is a community latent upscaler (unofficial). |
| Sparse attention | Not released | n/a | n/a | The open release uses full attention. Third-party FastH3 (VSA) exists. |
| Clips longer than 15 s | Untested | n/a | `length` up to 3600 frames | Trained range is about 5–15 s. vLLM-Omni has an opt-in `long_video` mode. |

Hosted variants called "H3 Max" and "H3 Max Turbo" (480P/768P) also exist as partner-node options. They are not open.

## ComfyUI nodes and the Node fields an Input would set

All the nodes below are in `comfy_extras/nodes_minimax_h3.py` at ComfyUI `1a82e6d` (v0.42.0). H3 support landed in `57500fc` (#15224) on 2026-08-02, and the first tag containing it is v0.30.0.

| class_type | Node fields (widgets / inputs) | Constraints from source |
|---|---|---|
| `MiniMaxH3ImageToVideo` | `clip`, `vae`, **`prompt`**, **`width`**, **`height`**, **`length`**, optional **`first_frame`**, **`last_frame`** (IMAGE) | width and height: min 32, step 32, default 1344×768. length: min 5, max 3600, step 17, default 124. Outputs conditioning plus an AV latent. |
| `MiniMaxH3ReferenceToVideo` | `clip`, optional `vae`, `audio_vae`, **`prompt`**, **`width`**, **`height`**, **`length`**, **`ref_image_size`** (`match`/`max`), autogrow **`ref_images.ref_image_0..8`**, **`ref_videos.ref_video_0..2`**, **`ref_video_audios.ref_video_audio_0..2`**, **`ref_audios.ref_audio_0..2`** | `max` keeps a 2048 px short edge and is much slower. Reference videos need ≥5 frames and are cut to 17k+5 frames and to the output length. Without `vae`, references condition only the text encoder (#16065). |
| `MiniMaxH3AddGuide` | `positive`, `latent`, optional `vae`, `audio_vae`, **`image`**, **`audio`**, **`frame_idx`** | frame_idx ranges from -9999 to 9999; negative values count from the end. Image batches of 5 or more frames are cropped to 17k+5. |
| `MiniMaxH3FunControlNetApply` | `model`, `model_patch`, `vae`, **`strength`** (0–10), `start_percent`, `end_percent`, optional **`control_video`**, **`mask`**, `source_video` | In the mask, 1 marks regions to regenerate |
| `MiniMaxH3SigmaShift` (display name "ModelSamplingMiniMaxH3") | `model`, `shift_video` (default 12), `shift_audio` (default 3) | Defaults come from the model; only distilled variants need the node |
| `EmptyMiniMaxH3LatentAV` | `width`, `height`, `length` | Joint video and audio latent |

**Stock nodes used by the official templates.** Each entry gives the Node fields a user-facing Input would write:

- **Seed:** `RandomNoise.noise_seed`.
- **Steps:** `BasicScheduler.steps`. Defaults are 20 for the base model, 8 with the T2V/I2V turbo LoRA and 4 with the R2V turbo LoRA. Audio needs at least 12 steps.
- **Uploads:** `LoadImage.image`, `LoadVideo.file`, `LoadAudio.audio`.
- **Duration in seconds:** `PrimitiveFloat.value`. A `ComfyMathExpression` snaps it to 17k+5 frames and feeds `length`.
- **Size:** `ResolutionSelector.aspect_ratio` and `.megapixels` (multiple 32). Templates open at 0.4 MP, 864×480 for drafts; 0.98 MP gives about 1344×768.
- **Turbo:** `PrimitiveBoolean.value`, which drives two `ComfySwitchNode.switch` nodes (model and steps).

Model files load through `UNETLoader`, `CLIPLoader` (type `minimax`) and two `VAELoader` nodes. Output is assembled by `CreateVideo` (fps 24) and saved by `SaveVideo`.

**Template structure** (Comfy-Org/workflow_templates `447747b`, MIT):

- T2V, I2V, I2V-continuation and FastH3 wrap the sampler in a **subgraph**. Its exposed inputs include `prompt`, `width`, `height`, `duration`, `noise_seed`, `turbo_mode`, `turbo_steps` and `turbo_model_strength`.
- R2V, Multiframe Reference and Fun ControlNet are **flat**.
- A `MiniMaxH3ReferenceToVideo` node placed on a T2V/I2V canvas is silently ignored (Comfy docs).

How subgraphs and autogrow keys (`ref_images.ref_image_0`) appear in API format belongs to ticket 02.

## Value constraints

- **Resolution:** the short edge is 768 px by default. Width and height must be multiples of 32, and area is capped at 768×1344 (`MAX_PIXELS` in the source). Supported ratios are 21:9, 16:9, 4:3, 1:1, 3:4 and 9:16. FL2VA follows the first image's aspect ratio. Raising the size above about 1 MP adds no detail (Comfy docs). The vLLM-Omni server accepts aspect ratios from 1:4 to 4:1.
- **Duration:** officially 4–15 s, and the trained range is about 124–362 frames. In ComfyUI the `length` value is in frames and snaps up to 17k+5. A 4 s request becomes 107 frames (about 4.46 s), and 15 s becomes 362 frames.
- **Frame rate:** fixed at 24 fps.
- **Audio:** 32 kHz stereo. Reference audio is resampled to 32 kHz.
- **References:** up to 9 images, 3 videos and 3 audio clips, with at most 12 in total. Each video or audio clip runs 2–15 s, with at most 15 s in total. Audio needs a visual reference. In the prompt, references are tagged `<Picture i>`, `<Video k>` and `<Audio j>`, ordered images first, then videos (each soundtrack's `<Audio>` comes right before its `<Video>`), then standalone audio.
- **Prompt:** the vLLM-Omni model sheet says up to 7,000 characters. The model performs best with long, structured prompts written to MiniMax's guide or produced by Context-IR.

## Hardware

**Weight sizes on disk:**

- **Original BF16 checkpoints:** about 134 GiB per partition (FL2VA or Ref2VA), roughly 270 GiB for both (vLLM-Omni recipe). The DiT is 66.3 GB and the Qwen3-VL-32B encoder 51.5 GB for its 50 retained layers.
- **Comfy-Org repack:**
  - DiTs, per partition: `pruned_w6a8` 16 GB (ComfyUI ≥0.38), `pruned_int8_convrot` 21 GB (the template default), `pruned_fp8_scaled` 21 GB, `pruned_bf16` 40.2 GB, full `bf16` 66.3 GB.
  - Text encoders: `nvfp4_awq` 15.7 GB (does not need a Blackwell GPU), `int8_convrot` 27.1 GB, `bf16` 51.5 GB.
  - VAEs: video `int8_convrot` 2.81 GB, video `fp16` 5.21 GB, audio `fp32` 605 MB.
  - The default T2V/I2V template downloads about 40 GB in total; R2V adds another 21 GB DiT.

**Measured or documented setups:**

| Path | GPUs × VRAM | Notes / evidence |
|---|---|---|
| ComfyUI-native, default template | 1 GPU, no VRAM floor published | Dynamic VRAM offload is on by default (`comfy/cli_args.py`). The Comfy blog (2026-08-03) claims an RTX 3060 can run H3 but gives no VRAM, RAM or time figures. The docs advise using the smallest build that fits, because CPU offload costs more than precision. **No first-party timing exists.** |
| SGLang, single card | 1× RTX 4090 24 GB | `--quantization convrot_int8` with layerwise offload of `dit,text_encoder`. Peak is about 18 GB. A 50-step BF16 run took 1008.6 s; Spectrum step-skipping cut that to 285.3 s. Host RAM for this setup is not stated. |
| vLLM-Omni, single card | 1× RTX 5090 32 GB | DLO with 12 resident layers peaked at 26.50 GiB (allocation test). Needs at least 200 GiB of system RAM; 384 GiB is recommended. A generic one-GPU layerwise-offload profile also exists and needs host RAM for the whole checkpoint. |
| vLLM-Omni, two cards | 2× RTX 5090 | TP2 with DLO: a 5 s clip at 1344×768, 50 steps, took **8 min 38 s** end to end, at about 22.6 GiB per GPU (one validation run) |
| SGLang | 4× H100 80 GB | TP2 × Ulysses2, or FSDP at about 57 GB per GPU |
| SGLang | 4× H200 | Full BF16 model resident. A 5 s clip at 1344×768, 50 steps, took 75.1 s with exact output. |
| SGLang | 8× B300 | Ulysses8: FL2VA in 19.0 s (BF16, about 83.6 GB per GPU) or 18.0 s (FP8, about 51.9 GB) |
| MiniMax reference | 4 GPUs, type unstated | `--num-gpus 4 --ulysses-degree 4` |

**Parallelism:**

- **ComfyUI** has no tensor or sequence parallelism. Its multi-GPU nodes are `MultiGPU_WorkUnits` (CFG split), which brings nothing here because H3 is CFG-distilled with a single conditioning branch, and `SelectModelDevice` / `SelectCLIPDevice` / `SelectVAEDevice` for per-device placement. In practice, ComfyUI scales H3 by running more Backends, one per GPU, or by moving the text encoder to a second GPU.
- **vLLM-Omni and SGLang** support TP, Ulysses and Ring sequence parallelism, VAE patch parallelism and text-encoder TP. CFG parallelism is rejected by design.

**Speed-ups:**

- Turbo/Lightning LoRAs (lightx2v) cut steps to 8 or 4, which trades away some fidelity, reference adherence and audio quality.
- The FastH3 distillations (FastVideo) are third-party.
- Sage attention and Comfy Kitchen attention are also available.

## Serving: ComfyUI-native vs vLLM-Omni vs SGLang

| | ComfyUI-native | vLLM-Omni | SGLang Diffusion |
|---|---|---|---|
| Version / date | ComfyUI 0.42.0 (2026-10-21); H3 since 0.30.0 | vllm-omni `6a56252` (2026-10-22); recipe page updated 2026-10-21; Docker `vllm/vllm-omni:minimax-h3` | sglang `a6a6bef` (2026-10-22); cookbook pinned to commit `15d2cbcc90fc` for GB300 validation |
| Weights | Comfy-Org single files (quantized or pruned) | Original HF checkpoint (gated) | Original HF checkpoint (online quantization), or Comfy single files in integrated mode |
| Tasks | All, including AddGuide, Fun ControlNet and noise masks | t2va, fl2va, ref2va; one server can load both DiTs and select one with `extra_params.task` | t2va, fl2va, ref2va; one deployment per `--model-variant` |
| Own API | ComfyUI `/prompt` (ticket 02) | `POST /v1/videos` (async), `/v1/videos/sync` (MP4 in the body) | `POST /v1/videos`, `GET /v1/videos/{id}`, `/content` |
| How ComfyUI reaches it | Natively | Node pack **ComfyUI-vLLM-Omni** (`vllm-omni/apps/ComfyUI-vLLM-Omni`). `VLLMOmniGenerateVideo` takes `url`, `model`, `prompt`, `width`, `height`, `fps`, `duration`, plus `first_frame` / `last_frame` / `references` / `sampling_params` / `model_params` / `lora`. Helpers: `VLLMOmniVideoReferences` (image_1..9, video_1..3, audio_1..3), `VLLMOmniMiniMaxH3Params` (`flow_shift`, `audio_flow_shift`), `VLLMOmniDiffusionSampling`. ComfyUI loads no weights and can run with `--cpu`. | Plugin **ComfyUI_SGLDiffusion** (`sglang/python/sglang/multimodal_gen/apps/`). **Server mode:** `SGLDiffusionServerModel` (`base_url`, `api_key`) plus `SGLDiffusionGenerateH3` (`task`, `positive_prompt`, `first_frame`, `last_frame`, `reference_image`, `reference_video` / `reference_audio` as path or URL **strings**, `seed`, `steps`, `short_edge`, `aspect_ratio`, `duration_seconds` 4–15, `flow_shift`, `audio_flow_shift`). **Integrated mode:** `SGLDUNETLoader` plus `SGLDOptions` (`model_type: minimax_h3`, `num_gpus`, …) replaces `UNETLoader` in a native graph; ComfyUI keeps CLIP, VAE and the sampler, and SGLang runs the DiT on each step. |
| Multi-GPU | No (scale out with more Backends) | Yes | Yes |
| Caveats | No published VRAM floor or timings | The serving path accepts **fewer references than the model**: exactly one image plus one audio, or videos with no separate audio. Large host RAM is needed for offload. One request per diffusion batch. | Server-mode references are file paths or URLs that the SGLang server must be able to read, not Uploads. Integrated mode's local ZMQ/CUDA-IPC design suggests the same host (inference, not stated). |

## License

**This is a reading of the license text, not legal advice.** Self-hosters should get their own counsel.

**Identity:**

- MiniMax H3 Community License Agreement, license date 2026-08-02. The licensor is Nanonoble Pte. Ltd. (I.15). Hong Kong law and courts govern (IX).
- The Qwen3-VL-32B encoder weights are Apache-2.0 (the license's closing note).
- The Hugging Face checkpoint is gated. The model card says the application form applies only to users in the USA, EU, UK and South Korea.

**Clause map:**

| Clause | Gist |
|---|---|
| I.3, I.5 | The Applicable Territory is worldwide minus the Excluded Territories: the **EU, UK, Republic of Korea and USA** |
| I.8 | "Hosted Services" means anything offered through APIs, web access or other remote means |
| I.11, I.12 | Model Derivatives include anything that transfers H3's patterns, weights or Outputs, distillation included. Outputs themselves are not derivatives. |
| II | A royalty-free, non-transferable grant, "solely within the Applicable Territory". Entities in excluded territories may ask MiniMax for a separate license. |
| III (preamble) | Redistribution is allowed only within the Applicable Territory. Recipients of an **integrated end-user product** are exempt from III but remain bound by V and Exhibit A. |
| III.1 | Give a copy of the Agreement to Third Parties who receive the Works **or use your related products or services** |
| III.2 | Mark modified files |
| III.3 | *Encouraged only:* (a) a "Powered by MiniMax H3" notice, (b) an AI-generation identifier in generated files, (c) a public write-up |
| III.4 | Non-hosted distributions need a NOTICE file naming the license, with a 2026 MiniMax copyright line. Hosted Services are exempt. |
| IV.1 | Yearly revenue from "your commercial products and services" above **US$20M** requires prior written authorization (api@minimax.io). The license does not say whether only H3-related revenue counts. Licensee does not include affiliates. |
| IV.2 | Commercial products or services using H3 must **"prominently display 'MiniMax H3'"** on their user interface. "Commercial" is not defined. |
| V.1 | Comply with law, including trade-compliance law, and with the Acceptable Use Policy |
| V.2 | **Before giving anyone access**, including through a Hosted Service, bind each user to enforceable terms at least as protective as V and Exhibit A, and tell them the restrictions apply |
| V.3 | Do not use the Works **or Outputs** to improve any other AI model |
| V.4 | Do not use, reproduce, modify, distribute or **display** the Works **or their Outputs** outside the Applicable Territory |
| V.5 | A service that generates Outputs for Third Parties must keep reasonable safeguards (IP infringement included), an accessible **reporting channel**, investigate reports, remove or disable content, **suspend repeat violators**, and enforce all of this downstream |
| VI.2 | The only trademark right granted is a limited use of the "MiniMax H3" mark to comply with III.3 |
| VI.3 | Suing over the Works ends your licenses; you indemnify MiniMax |
| VI.4 | MiniMax claims no rights in Outputs; you are responsible for them |
| VIII.2 | MiniMax may terminate for breach. You must then delete the Works and notify downstream recipients. |
| Exhibit A | 20 prohibited uses, which MiniMax may update. They include: (1) use outside the territory; (6) harming minors; (7) disinformation or election interference; (12) publishing machine-generated content without clear disclosure; (13) impersonation without consent; (14) high-risk automated decisions; (15) violating other regions' social or moral standards (vague); (19) military use; (20) unlicensed professional practice. |

**The geographic restriction:**

- **"Deploy" is not defined.** It appears only in Section II, where MiniMax invites entities in excluded territories to ask about deploying its models. The operative tests are where you **use** the Works (II, V.4) and where Outputs are **displayed or distributed** (V.4, Exhibit A.1).
- The license never says where "use" happens: at the licensee's seat, the GPU's location, or the user's location. A cautious operator would satisfy all three.
- **Serving users located in excluded regions from an allowed region** is not addressed. The words "located", "VPN" and "servers" never appear.
- Read plainly, V.4 means that delivering Outputs to, or displaying them for, a user in the US, EU, UK or South Korea is display or distribution outside the territory, and is therefore not licensed.
- Comfy's docs, written as a seller of the commercial license, take the same reading: the territory rule also covers where outputs are used.
- On Hugging Face thread #12, the MiniMax org account (ryanlee-dev, 2026-08-03) said the restriction reflects regulatory uncertainty and means "not yet". It also said organizations in restricted regions can apply. A user's question about serving users from servers outside the restricted regions has no visible staff answer.
- **Other routes:**
  - MiniMax's licence application at platform.minimax.io/h3-license. Its content could not be read.
  - A commercial license that Comfy says it is the "only official reseller" of: Professional starts at US$5,000/month (up to 10 users, 1 domain, distilled open weights); Enterprise is custom. Whether these cover the excluded territories, or third-party-facing hosted services, is not stated.
  - MiniMax's hosted API. QA-about-License says it is globally available, but it runs under separate API terms that were not reviewed here.

**Attribution:**

- **Required:** the string "MiniMax H3" on the UI of a commercial product or service, prominently (IV.2). The exact wording beyond that string, and its placement, are not specified.
- **Encouraged:** a "Powered by MiniMax H3" notice (III.3(a)). It also contains the required string.
- **Discrepancy:** Comfy's docs present the "Powered by MiniMax H3" credit as a requirement of the free license.
- For self-hosted users, III.1 also suggests linking the license text.

**What an MIT project that only integrates H3 should tell its self-hosters.** The project ships no weights. Workflow JSON derived from Comfy's MIT templates is neither Materials nor a Model Derivative as I.6, I.10 and I.11 define them, though this is unconfirmed. Contents of the notice:

1. The studio's MIT license covers only the studio code. H3 weights are not included and not licensed by the project. You download them yourself and accept the MiniMax H3 Community License.
2. Do not run H3 if you, your GPUs, or **the users you serve or show outputs to** are in the EU, UK, South Korea or US, unless MiniMax has licensed you separately (II, V.4).
3. If your yearly commercial revenue exceeds US$20M, get MiniMax's written authorization (IV.1).
4. If your deployment is commercial, show "MiniMax H3" prominently. The studio's per-Model attribution field can carry "Powered by MiniMax H3" (IV.2, III.3(a)).
5. Before users get access, bind them to H3's use restrictions and Acceptable Use Policy, and give them the license text or a link to it (V.2, III.1).
6. Keep safeguards, a way to report abuse, takedown, and suspension of repeat offenders (V.5).
7. Do not use Assets to train or improve other models (V.3). Users must disclose AI generation when they publish (Exhibit A.12).
8. This is not legal advice.

## Options & implications for the studio

These are trade-offs to weigh, not decisions.

**How H3 splits into Models** (charter #3 leaves this to a later ticket):

- **A. Two Models, one per checkpoint:**
  - "H3", on FL2VA, with Modes text-to-video, first frame, last frame and first+last frame.
  - "H3 Reference", on Ref2VA, with Modes for references, video edit and voice/music reuse.

  This mirrors the official templates and the checkpoint split, and each Workflow loads one 21 GB DiT. Users see two entries, and a Backend that serves both swaps DiTs.
- **B. One Model with an all-in-one Workflow** using both loaders and switch nodes. This gives a single entry, but it is not an official graph, and it depends on switch and bypass behaviour in API format (ticket 02).
- **C. One Model through vLLM-Omni's combined service,** where the task is picked per request. This gives one node, but it inherits the reference gap and a heavy server.

**Serving path:**

- **ComfyUI-native** keeps the Backend model unchanged and runs on one GPU. Throughput comes only from adding Backends, and nothing has been measured on consumer cards.
- **vLLM-Omni or SGLang behind a thin ComfyUI** adds multi-GPU speed but makes another service to operate. Through vLLM-Omni, references are limited. Through SGLang server mode, references must be server-readable paths or URLs.
- **SGLang integrated mode** keeps the native graph and adds multi-GPU DiT execution, probably on the same host.

**API-only parts** (Context-IR, 2K) can be reached only through ComfyUI partner nodes. Those need a Comfy account key passed in the prompt's `extra_data` (`api_key_comfy_org`), and calls are billed per second. The price badges in source show about US$0.13/s for 768P, US$0.19/s for 2K and US$0.07/s for regenerate; the operator would pay. Choices:

- leave them out;
- offer them as an operator-paid Mode;
- substitute MiniMax's prompt guides, possibly with an LLM helper, for Context-IR, and an unofficial latent upscaler for 2K.

The API is also under MiniMax's API terms rather than the community license.

**Input rules for zod and the admin panel:**

- Duration must snap to 17k+5 frames. The templates already do this in-graph, so the studio could snap or defer.
- Size must be multiples of 32 and at most about 1 MP.
- Reference counts and lengths: ≤9 images, ≤3 videos, ≤3 audio clips, ≤12 in total; clips 2–15 s each and ≤15 s in total.
- Audio needs a visual reference.
- Reference video must be 24 fps, which fits the charter's server-side Upload processing (#8).

**License-driven features beyond the attribution note** (charter #11). Without these, a self-hoster cannot comply:

- a per-Model terms acknowledgement plus a license link (V.2, III.1);
- an Asset report button, admin takedown and user suspension (V.5);
- optional per-Model gating by user region (V.4);
- optional AI-generated labels or metadata on Assets (III.3(b), Exhibit A.12).

The trade-off is extra scope against H3 being usable at all.

**Throughput:** consumer-GPU clips take minutes. The vLLM-Omni 2× RTX 5090 run took 8.6 minutes; the SGLang 1× 4090 run took 5–17 minutes. This affects queue timeouts and progress reporting (tickets 02 and 06) and the per-user caps.

**Launch gating:** H3 should still not gate launch. The reasons are now the territory and user-location terms, plus throughput, not GPU count.

## Open / unconfirmed

- The real VRAM, RAM and time floor for ComfyUI-native H3 on 12–24 GB cards. The RTX 3060 claim has no figures, so this needs a run on the ticket-08 test Backend.
- Whether serving users located in excluded territories from an allowed region is permitted. The license does not say, and a user's question on HF thread #12 has no visible staff answer.
- What counts as "commercial" in IV.2. In particular, whether a free, self-hosted community deployment is commercial.
- Whether IV.1 counts all revenue or only H3-related revenue, and over which period.
- Whether III.1 (giving users a copy of the license) applies to a hosted-only service. The III preamble speaks of redistribution, but III.1 mentions users of related services.
- Comfy's commercial-license tiers:
  - whether they cover excluded territories and third-party-facing SaaS;
  - whether MiniMax confirms Comfy as its reseller (no MiniMax page read here says so);
  - the content of MiniMax's own application form (platform.minimax.io/h3-license could not be read).
- The vLLM-Omni model sheet lists a 1440p mode, but its own input matrix requires `short_edge` 768, and the model card says 2K is API-only. Local 1440p is therefore unconfirmed.
- The licenses of third-party derivatives (lightx2v Turbo LoRAs, alibaba-pai Fun ControlNet, FastH3). SGLang's docs say such checkpoints inherit the H3 license; the individual repos were not checked.
- Whether the Comfy-Org/MiniMax-H3 repack is gated like the original (not checked).
- When H3-Regenerate-2K and sparse attention will be released. MiniMax says only that they will come once ready.
- How autogrow keys and template subgraphs appear in API-format Workflows (ticket 02).

## Sources

- Hugging Face model card [MiniMaxAI/MiniMax-H3](https://huggingface.co/MiniMaxAI/MiniMax-H3), [LICENSE](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE) (license date 2026-08-02), [QA-about-License.md](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/QA-about-License.md). Fetched 2026-10-22.
- GitHub [MiniMax-AI/MiniMax-H3](https://github.com/MiniMax-AI/MiniMax-H3) @ `d21241f` (2026-08-15): README, `FL2VA/model_index.json`, transformer configs, safetensors indexes, `scripts/readme/*.sh`.
- MiniMax blog [minimax-h3](https://www.minimax.io/blog/minimax-h3) (2026-07-31).
- Hugging Face discussions [#12](https://huggingface.co/MiniMaxAI/MiniMax-H3/discussions/12) (MiniMax org account ryanlee-dev, 2026-08-03) and [#9](https://huggingface.co/MiniMaxAI/MiniMax-H3/discussions/9) (non-staff).
- [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI) @ `1a82e6d` (2026-10-21, v0.42.0): `comfy_extras/nodes_minimax_h3.py`, `comfy_api_nodes/nodes_minimax.py`, `comfy_extras/nodes_multigpu.py`, `comfy/cli_args.py`, `execution.py`. History: `57500fc` #15224 (2026-08-02), `e01fb4c` #15439 (2026-08-13), `1266698` #15471 (partner Context-IR/Regenerate, 2026-08-13).
- [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates) @ `447747b` (2026-10-22, MIT): `templates/video_minimax_h3_*.json`, `api_minimax_h3_*.json`, `video_fast*h3*.json`.
- [Comfy-Org/docs](https://github.com/Comfy-Org/docs) @ `506a4a94` (2026-10-21): `tutorials/video/minimax/minimax-h3.mdx` (last changed `07afa6b0`, 2026-10-19) and `minimax-h3-native.mdx`. Live at [docs.comfy.org](https://docs.comfy.org/tutorials/video/minimax/minimax-h3).
- [blog.comfy.org day-0 post](https://blog.comfy.org/p/minimax-h3-day-0-support-in-comfyui) (2026-08-03).
- [comfy.org/minimax/license](https://comfy.org/minimax/license) ("Updated August 2026").
- Hugging Face [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3) file listings and README.
- [vllm-project/vllm-omni](https://github.com/vllm-project/vllm-omni) @ `6a56252` (2026-10-22): `recipes/MiniMaxAI/MiniMax-H3*.md`, `recipes/models/MiniMaxAI/MiniMax-H3.yaml`, `apps/ComfyUI-vLLM-Omni/`. Live at [recipes.vllm.ai](https://recipes.vllm.ai/MiniMaxAI/MiniMax-H3), last updated 2026-10-21.
- [sgl-project/sglang](https://github.com/sgl-project/sglang) @ `a6a6bef` (2026-10-22): `docs/cookbook/diffusion/MiniMax/MiniMax-H3.mdx`, `python/sglang/multimodal_gen/apps/ComfyUI_SGLDiffusion/`. Live at [docs.sglang.io cookbook](https://docs.sglang.io/cookbook/diffusion/MiniMax/MiniMax-H3) and [ComfyUI plugin page](https://docs.sglang.io/docs/sglang-diffusion/comfyui).
