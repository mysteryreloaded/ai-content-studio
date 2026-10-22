// PROTOTYPE data. A mock API-format export of the reshaped LTX 2.5 all-in-one
// Workflow (per ADR 0001 and the LTX coverage decision), plus mock /object_info,
// Backends and the LTX Model's Inputs and Modes. Node classes, titles, files and
// default values come from workflows/ltx-2-5-all-in-one.ui.json and the LTX
// research notes; node ids above 6000 are invented, because the reshaped
// Workflow does not exist yet. The Inputs × Modes table is a draft until
// "What Inputs and Mode states does the LTX 2.5 Model ship with?" settles it.

const L = (id, slot = 0) => [String(id), slot];

export function buildLtxWorkflow() {
  const wf = {};
  const add = (id, class_type, title, inputs) => {
    wf[String(id)] = { class_type, inputs, _meta: { title } };
    return String(id);
  };

  // Shared loaders
  add(366, "UnetLoaderGGUF", "Unet Loader (GGUF)", { unet_name: "LTX-2.5-Distilled-Q4_K_M.gguf" });
  add(6001, "LoraLoaderModelOnly", "LoRA · OmniNFT", { model: L(366), lora_name: "LTX-2.3-OmniNFT-RL-Lora_bf16.safetensors", strength_model: 0.4 });
  add(6002, "LoraLoaderModelOnly", "LoRA · Transition", { model: L(6001), lora_name: "LTX-2.5-Transition-Lora_bf16.safetensors", strength_model: 0.8 });
  add(5727, "CLIPLoader", "Text encoder · Gemma 4 12B", { clip_name: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors", type: "ltxv", device: "default" });
  add(174, "VAELoaderKJ", "VAELoader Video", { vae_name: "ltx-2.5-video-vae-bf16.safetensors", device: "main_device", weight_dtype: "bf16" });
  add(175, "VAELoaderKJ", "VAELoader Audio", { vae_name: "ltx-2.5-audio-vae-bf16.safetensors", device: "main_device", weight_dtype: "bf16" });
  add(101, "LatentUpscaleModelLoader", "Latent upscaler ×2", { model_name: "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors" });

  // Prompt and settings
  add(6010, "PrimitiveStringMultiline", "Prompt", { value: "A DJ in a neon-lit club lifts her hands as the beat drops; the crowd cheers." });
  add(5536, "CLIPTextEncode", "CLIP Text Encode (Prompt) positive", { text: L(6010), clip: L(5727) });
  add(5537, "CLIPTextEncode", "CLIP Text Encode (Prompt) negative", { text: "blurry, low quality, still frame, frames, watermark, overlay, titles, has blurbox, has subtitles", clip: L(5727) });
  add(196, "mxSlider", "Clip Length ( in seconds )", { Xi: 10, Xf: 10, isfloatX: 0 });
  add(5445, "INTConstant", "FPS", { value: 24 });
  add(5387, "MathExpression|pysssss", "Frames (a*b+1)", { expression: "a*b+1", a: L(196), b: L(5445) });
  add(5736, "ResolutionSelector", "Resolution", { aspect_ratio: "16:9 (Widescreen)", megapixel: 2, divisible_by: 32 });

  // Upload loaders
  add(149, "LoadImage", "Load Image1", { image: "10 (1).png" });
  add(5437, "LoadImage", "Load Image2", { image: "11.png" });
  add(5738, "LoadImage", "Load Image3", { image: "12.png" });
  const resize = (img) => ({ input: L(img), resize_type: "scale dimensions", width: L(5736, 0), height: L(5736, 1), crop: "center", scale_method: "lanczos" });
  add(5742, "ResizeImageMaskNode", "Resize · start image", resize(149));
  add(5434, "ResizeImageMaskNode", "Resize · last frame", resize(5437));
  add(5429, "ResizeImageMaskNode", "Resize · middle frame", resize(5738));
  add(5400, "VHS_LoadAudioUpload", "Load Audio", { audio: "Parisian Reverie.mp3", start_time: 0, duration: 5 });
  add(5444, "VHS_LoadVideo", "Load Video", { video: "Female DJ 10s.mp4", force_rate: 24, custom_width: 0, custom_height: 0, frame_load_cap: 200, skip_first_frames: 0, select_every_nth: 1 });

  // First–Middle–Last audio switch (two Modes, one Path)
  add(6300, "LTXVEmptyLatentAudio", "Generated audio · FML", { frames_number: L(5387), frame_rate: L(5445), batch_size: 1, audio_vae: L(175) });
  add(6302, "LTXVAudioVAEEncode", "Your audio · FML", { audio: L(5400), audio_vae: L(175) });
  add(6301, "ComfySwitchNode", "Audio source", { switch: true, on_true: L(6302), on_false: L(6300) });

  // Style Transfer guide: two nested core switches
  add(5376, "LTXICLoRALoaderModelOnly", "IC-LoRA · Union control", { model: L(6002), lora_name: "ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors", strength_model: 1 });
  add(6410, "DepthAnythingV2Preprocessor", "Depth guide", { image: L(5444), ckpt_name: "depth_anything_v2_vitl.pth", resolution: 512 });
  add(6411, "DWPreprocessor", "Pose guide", { image: L(5444), detect_hand: "enable", detect_body: "enable", detect_face: "enable", resolution: 512 });
  add(6412, "CannyEdgePreprocessor", "Canny guide", { image: L(5444), low_threshold: 100, high_threshold: 200, resolution: 512 });
  add(6402, "ComfySwitchNode", "Guide · pose or canny", { switch: true, on_true: L(6411), on_false: L(6412) });
  add(6401, "ComfySwitchNode", "Guide · depth or other", { switch: true, on_true: L(6410), on_false: L(6402) });
  add(6413, "PreviewImage", "Guide preview", { images: L(6401) });

  // Reference sheet (grafted from Lightricks' Ingredients graph)
  add(6102, "LoadImage", "Load reference sheet", { image: "ref-sheet-example.png" });
  add(6110, "PrimitiveStringMultiline", "Character description", { value: "The same woman: short silver hair, red bomber jacket, silver headphones." });
  add(6112, "StringConcatenate", "Prompt + character", { string_a: L(6010), string_b: L(6110), delimiter: "\n" });
  add(6111, "GemmaAPITextEncode", "Gemma API Text Encode", { api_key: "", prompt: L(6112), clip: L(5727) });
  add(6120, "LTXICLoRALoaderModelOnly", "IC-LoRA · Ingredients", { model: L(6002), lora_name: "ltx-2.5-22b-ic-lora-ingredients.safetensors", strength_model: 1 });
  add(6130, "PrimitiveInt", "Sheet width", { value: 768 });
  add(6131, "PrimitiveInt", "Sheet height", { value: 448 });
  add(6132, "PrimitiveInt", "Sheet frames", { value: 121 });

  // Outpaint (grafted from LTX-2.5_ICLoRA_Outpaint_Two_Stage_Distilled)
  add(6202, "VHS_LoadVideo", "Load outpaint source", { video: "Female DJ 10s.mp4", force_rate: 24, custom_width: 0, custom_height: 0, frame_load_cap: 200, skip_first_frames: 0, select_every_nth: 1 });
  add(6203, "LoadImage", "Load outpaint start image", { image: "10 (1).png" });
  add(6210, "PrimitiveInt", "Target width", { value: 1280 });
  add(6211, "PrimitiveInt", "Target height", { value: 704 });
  add(6220, "LTXICLoRALoaderModelOnly", "IC-LoRA · In/outpaint", { model: L(6002), lora_name: "ltx-2.3-22b-ic-lora-in-outpainting.safetensors", strength_model: 1 });
  add(6221, "ImagePadKJ", "Centre and pad source", { image: L(6202), target_width: L(6210), target_height: L(6211), pad_color: "0, 0, 0" });

  // One two-stage chain per Path, each ending in its own output node
  for (const c of CHAINS) buildChain(add, c);
  return wf;
}

// p: chain number (node ids 7000 + p*100 + n), key: filename prefix
const CHAINS = [
  { p: 1, key: "T2V", label: "T2V", model: 6002, pos: 5536, size: "res", images: [], audio: "empty" },
  { p: 2, key: "A2V", label: "A2V", model: 6002, pos: 5536, size: "res", images: [], audio: "encode" },
  { p: 3, key: "I2V", label: "I2V", model: 6002, pos: 5536, size: "res", images: [5742], audio: "empty" },
  { p: 4, key: "FLF", label: "FLF", model: 6002, pos: 5536, size: "res", images: [5742, 5434], audio: "empty" },
  { p: 5, key: "LIP", label: "Lipsync", model: 6002, pos: 5536, size: "res", images: [5742], audio: "encode" },
  { p: 6, key: "FLFLIP", label: "FLF lipsync", model: 6002, pos: 5536, size: "res", images: [5742, 5434], audio: "encode" },
  { p: 7, key: "FML", label: "FML", model: 6002, pos: 5536, size: "res", images: [5742, 5429, 5434], audio: "switch" },
  { p: 8, key: "STYLE", label: "Style", model: 5376, pos: 5536, size: "res", images: [5742], audio: "empty", guide: 6401, lengthFrom: 5444, combine: true },
  { p: 9, key: "REF", label: "Ref sheet", model: 6120, pos: 6111, size: "sheet", images: [], audio: "empty", guide: 6102 },
  { p: 10, key: "OUT", label: "Outpaint", model: 6220, pos: 5536, size: "out", images: [6203], audio: "source", guide: 6221, lengthFrom: 6202 },
];

function buildChain(add, c) {
  const id = (n) => 7000 + c.p * 100 + n;
  const t = (s) => `${s} · ${c.label}`;
  const size = c.size === "res" ? [L(5736, 0), L(5736, 1)] : c.size === "sheet" ? [L(6130), L(6131)] : [L(6210), L(6211)];
  const length = c.size === "sheet" ? L(6132) : c.lengthFrom ? L(c.lengthFrom, 1) : L(5387);
  add(id(1), "LTXVConditioning", t("Conditioning"), { positive: L(c.pos), negative: L(5537), frame_rate: L(5445) });
  add(id(2), "EmptyLTXVLatentVideo", t("Empty latent"), { width: size[0], height: size[1], length, batch_size: 1 });
  let latent = L(id(2));
  if (c.guide) {
    add(id(3), "LTXAddVideoICLoRAGuide", t("Add guide"), { latent, guide: L(c.guide), vae: L(174), strength: 1 });
    latent = L(id(3));
  }
  if (c.images.length) {
    const ins = { latent, vae: L(174), strength: 1 };
    c.images.forEach((img, i) => (ins[i === 0 ? "image" : `image_${i + 1}`] = L(img)));
    add(id(4), c.images.length > 1 ? "LTXVImgToVideoInplaceKJ" : "LTXVImgToVideoInplace", t("Image to video"), ins);
    latent = L(id(4));
  }
  let audio;
  if (c.audio === "empty") audio = add(id(5), "LTXVEmptyLatentAudio", t("Empty audio"), { frames_number: length, frame_rate: L(5445), batch_size: 1, audio_vae: L(175) });
  else if (c.audio === "encode") audio = add(id(5), "LTXVAudioVAEEncode", t("Encode audio"), { audio: L(5400), audio_vae: L(175) });
  else if (c.audio === "source") audio = add(id(5), "LTXVAudioVAEEncode", t("Keep source audio"), { audio: L(6202, 2), audio_vae: L(175) });
  else audio = "6301";
  add(id(6), "LTXVConcatAVLatent", t("Join audio + video"), { video_latent: latent, audio_latent: L(audio) });
  add(id(7), "RandomNoise", t("Noise · stage 1"), { noise_seed: 1000 + c.p * 7 });
  add(id(8), "KSamplerSelect", t("Sampler"), { sampler_name: "euler_ancestral" });
  add(id(9), "ManualSigmas", t("Sigmas · stage 1"), { sigmas: "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0" });
  add(id(10), "CFGGuider", t("Guider"), { model: L(c.model), positive: L(id(1), 0), negative: L(id(1), 1), cfg: 1 });
  add(id(11), "SamplerCustomAdvanced", t("Stage 1 sampler"), { noise: L(id(7)), guider: L(id(10)), sampler: L(id(8)), sigmas: L(id(9)), latent_image: L(id(6)) });
  add(id(12), "LTXVSeparateAVLatent", t("Split stage 1"), { av_latent: L(id(11)) });
  add(id(13), "LTXVLatentUpsampler", t("Upscale ×2"), { samples: L(id(12), 0), upscale_model: L(101), vae: L(174) });
  add(id(14), "RandomNoise", t("Noise · stage 2"), { noise_seed: 42 });
  add(id(15), "LTXVConcatAVLatent", t("Rejoin for stage 2"), { video_latent: L(id(13)), audio_latent: L(id(12), 1) });
  add(id(16), "ManualSigmas", t("Sigmas · stage 2"), { sigmas: "0.909375, 0.725, 0.421875, 0.0" });
  add(id(17), "SamplerCustomAdvanced", t("Stage 2 sampler"), { noise: L(id(14)), guider: L(id(10)), sampler: L(id(8)), sigmas: L(id(16)), latent_image: L(id(15)) });
  add(id(18), "LTXVSeparateAVLatent", t("Split stage 2"), { av_latent: L(id(17)) });
  add(id(19), "VAEDecodeTiled", t("Decode video"), { samples: L(id(18), 0), vae: L(174), tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 });
  add(id(20), "LTXVAudioVAEDecode", t("Decode audio"), { samples: L(id(18), 1), audio_vae: L(175) });
  if (c.combine) {
    add(id(21), "VHS_VideoCombine", t("Save"), { images: L(id(19)), audio: L(id(20)), frame_rate: 24, loop_count: 0, filename_prefix: `LTX2.5/${c.key}`, format: "video/h264-mp4", pix_fmt: "yuv420p", crf: 10, save_metadata: false });
  } else {
    add(id(21), "CreateVideo", t("Create video"), { images: L(id(19)), audio: L(id(20)), fps: L(5445) });
    add(id(22), "SaveVideo", t("Save"), { video: L(id(21)), filename_prefix: `LTX2.5/${c.key}`, format: "auto", codec: "auto" });
  }
}

export const OUT = (p) => String(7000 + p * 100 + (p === 8 ? 21 : 22));

// ---------- Mock /object_info: field specs for widget fields ----------
const BIG = 18446744073709551615;
const IMAGES = ["10 (1).png", "11.png", "12.png", "ref-sheet-example.png", "studio/7f3c…/start.png"];
const VIDEOS = ["Female DJ 10s.mp4", "studio/7f3c…/source.mp4"];
const AUDIOS = ["Parisian Reverie.mp3", "studio/7f3c…/voice.wav"];
export const FIELD_SPECS = {
  LoadImage: { image: { type: "COMBO", options: IMAGES, upload: "image" } },
  VHS_LoadVideo: { video: { type: "COMBO", options: VIDEOS, upload: "video" }, force_rate: { type: "FLOAT", min: 0, max: 60, step: 1 }, frame_load_cap: { type: "INT", min: 0, max: BIG, step: 1 }, custom_width: { type: "INT", min: 0, max: 8192, step: 8 }, custom_height: { type: "INT", min: 0, max: 8192, step: 8 }, skip_first_frames: { type: "INT", min: 0, max: BIG, step: 1 }, select_every_nth: { type: "INT", min: 1, max: BIG, step: 1 } },
  VHS_LoadAudioUpload: { audio: { type: "COMBO", options: AUDIOS, upload: "audio" }, start_time: { type: "FLOAT", min: 0, max: BIG, step: 0.001 }, duration: { type: "FLOAT", min: 0, max: BIG, step: 0.001 } },
  mxSlider: { Xi: { type: "INT", min: 0, max: 4096, step: 1 }, Xf: { type: "FLOAT", min: 0, max: 4096, step: 0.01 }, isfloatX: { type: "INT", min: 0, max: 1, step: 1 } },
  RandomNoise: { noise_seed: { type: "INT", min: 0, max: BIG, step: 1 } },
  LoraLoaderModelOnly: { strength_model: { type: "FLOAT", min: -100, max: 100, step: 0.01 }, lora_name: { type: "COMBO", options: ["LTX-2.3-OmniNFT-RL-Lora_bf16.safetensors", "LTX-2.5-Transition-Lora_bf16.safetensors"] } },
  LTXICLoRALoaderModelOnly: { strength_model: { type: "FLOAT", min: -100, max: 100, step: 0.01 } },
  ResolutionSelector: { aspect_ratio: { type: "COMBO", options: ["1:1 (Square)", "2:3 (Portrait)", "3:4 (Portrait)", "9:16 (Portrait)", "3:2 (Landscape)", "4:3 (Landscape)", "16:9 (Widescreen)", "21:9 (Ultrawide)"] }, megapixel: { type: "FLOAT", min: 0.1, max: 16, step: 0.01 }, divisible_by: { type: "INT", min: 1, max: 256, step: 1 } },
  PrimitiveInt: { value: { type: "INT", min: -BIG, max: BIG, step: 1 } },
  INTConstant: { value: { type: "INT", min: -BIG, max: BIG, step: 1 } },
  PrimitiveStringMultiline: { value: { type: "STRING", multiline: true } },
  CLIPTextEncode: { text: { type: "STRING", multiline: true } },
  ComfySwitchNode: { switch: { type: "BOOLEAN" } },
  GemmaAPITextEncode: { api_key: { type: "STRING" } },
  EmptyLTXVLatentVideo: { width: { type: "INT", min: 64, max: 8192, step: 32 }, height: { type: "INT", min: 64, max: 8192, step: 32 }, length: { type: "INT", min: 1, max: 8193, step: 8 }, batch_size: { type: "INT", min: 1, max: 64, step: 1 } },
  SaveVideo: { filename_prefix: { type: "STRING" }, format: { type: "COMBO", options: ["auto", "mp4"] }, codec: { type: "COMBO", options: ["auto", "h264"] } },
  VHS_VideoCombine: { filename_prefix: { type: "STRING" }, frame_rate: { type: "FLOAT", min: 1, max: 240, step: 1 }, crf: { type: "INT", min: 0, max: 100, step: 1 } },
  CFGGuider: { cfg: { type: "FLOAT", min: 0, max: 100, step: 0.1 } },
  KSamplerSelect: { sampler_name: { type: "COMBO", options: ["euler", "euler_ancestral", "euler_ancestral_cfg_pp", "res_multistep"] } },
  ManualSigmas: { sigmas: { type: "STRING" } },
  "MathExpression|pysssss": { expression: { type: "STRING" } },
  StringConcatenate: { delimiter: { type: "STRING" } },
  LTXVImgToVideoInplace: { strength: { type: "FLOAT", min: 0, max: 1, step: 0.01 } },
  LTXVImgToVideoInplaceKJ: { strength: { type: "FLOAT", min: 0, max: 1, step: 0.01 } },
  LTXAddVideoICLoRAGuide: { strength: { type: "FLOAT", min: 0, max: 1, step: 0.01 } },
};

// Classes ComfyUI marks as calling an outside service. GemmaAPITextEncode is not a
// partner node; it sends the prompt to api.ltx.video once its key holds "ltxv_".
export const EXTERNAL_CLASSES = {
  GemmaAPITextEncode: { host: "api.ltx.video", keyField: "api_key", note: "Sends the prompt to api.ltx.video when its LTX API key field holds a key." },
};

// ---------- Backends (shared across Models) ----------
export const BACKENDS = [
  { id: "b1", name: "3090 #0", url: "http://100.101.7.12:8188", auth: "none", health: "healthy", comfy: "v0.36.1", vram: "24 GB", used: ["LTX 2.5", "Wan 2.2"], missing: [], running: "1 running" },
  { id: "b2", name: "3090 #1", url: "http://100.101.7.12:8189", auth: "none", health: "healthy", comfy: "v0.36.1", vram: "24 GB", used: ["LTX 2.5", "Wan 2.2"], missing: [], running: "idle" },
  { id: "b3", name: "spare-4090", url: "http://100.88.20.5:8188", auth: "header", health: "healthy", comfy: "v0.35.2", vram: "24 GB", used: [], missing: ["DepthAnythingV2Preprocessor", "DWPreprocessor", "CannyEdgePreprocessor"], missingPack: "comfyui_controlnet_aux", running: "idle" },
  { id: "b4", name: "old-a6000", url: "http://100.64.3.9:8188", auth: "basic", health: "credentials", comfy: "", vram: "", used: ["LTX 2.5"], missing: [], running: "" },
];

// ---------- The LTX 2.5 Model, revision 7 ----------
const sel = (id, label, values) => ({ id, label, values });

export const LTX_INPUTS = () => [
  { id: "prompt", label: "Prompt", type: "text", multiline: true, maxLength: 2000, help: "Describe the shot. For several shots, describe each in order (Multishot).", bindings: [b(6010, "value")] },
  { id: "duration", label: "Duration", type: "number", unit: "s", min: 1, max: 10, step: 1, default: "", help: "", bindings: [b(196, "Xi")] },
  { id: "aspect", label: "Aspect ratio", type: "select", default: "", help: "", bindings: [b(5736, "aspect_ratio")], options: [sel("wide", "16:9", { "5736.aspect_ratio": "16:9 (Widescreen)" }), sel("tall", "9:16", { "5736.aspect_ratio": "9:16 (Portrait)" }), sel("square", "1:1", { "5736.aspect_ratio": "1:1 (Square)" })] },
  { id: "seed", label: "Seed", type: "seed", help: "Blank picks a new seed for each Generation.", bindings: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((p) => b(7000 + p * 100 + 7, "noise_seed")) },
  { id: "start", label: "Start image", type: "image", limits: { maxMB: 20, maxLongSide: 4096 }, help: "", bindings: [b(149, "image"), b(6203, "image")] },
  { id: "last", label: "Last frame", type: "image", limits: { maxMB: 20, maxLongSide: 4096 }, help: "", bindings: [b(5437, "image")] },
  { id: "middle", label: "Middle frame", type: "image", limits: { maxMB: 20, maxLongSide: 4096 }, help: "", bindings: [b(5738, "image")] },
  { id: "audio", label: "Audio", type: "audio", limits: { maxMB: 50, maxSec: 10, trimmable: true }, help: "Speech or music the video follows.", bindings: [b(5400, "audio")] },
  { id: "source", label: "Source video", type: "video", limits: { maxMB: 300, maxSec: 10, maxLongSide: 1920, trimmable: true }, help: "", bindings: [b(5444, "video"), b(6202, "video")] },
  { id: "sheet", label: "Reference sheet", type: "image", limits: { maxMB: 20, maxLongSide: 4096 }, help: "Character panels on a black background.", bindings: [b(6102, "image")] },
  { id: "character", label: "Character description", type: "text", multiline: true, maxLength: 600, help: "Who appears in the sheet, in one or two sentences.", bindings: [b(6110, "value")] },
  { id: "guide", label: "Motion guide", type: "select", default: "depth", help: "Which motion from the source video to follow.", bindings: [b(6401, "switch"), b(6402, "switch")], options: [sel("depth", "Depth", { "6401.switch": true, "6402.switch": true }), sel("pose", "Pose", { "6401.switch": false, "6402.switch": true }), sel("canny", "Edges (canny)", { "6401.switch": false, "6402.switch": false })] },
  { id: "audioSource", label: "Audio source", type: "toggle", help: "", bindings: [b(6301, "switch")], options: [sel("yours", "Your audio", { "6301.switch": true }), sel("generated", "Generated", { "6301.switch": false })] },
  { id: "outAspect", label: "Target aspect", type: "select", default: "", help: "The source is centred and the rest is generated.", bindings: [b(6210, "value"), b(6211, "value")], options: [sel("wide", "16:9", { "6210.value": 1280, "6211.value": 704 }), sel("tall", "9:16", { "6210.value": 704, "6211.value": 1280 }), sel("square", "1:1", { "6210.value": 960, "6211.value": 960 })] },
  { id: "omni", label: "OmniNFT strength", type: "number", min: 0, max: 1, step: 0.05, help: "", bindings: [b(6001, "strength_model")] },
  { id: "transition", label: "Transition LoRA strength", type: "number", min: 0, max: 1, step: 0.05, help: "", bindings: [b(6002, "strength_model")] },
];
function b(node, field) { return { node: String(node), field }; }

const R = { s: "required" }, O = { s: "optional" }, F = (v) => ({ s: "fixed", v });
const mode = (id, name, p, description, states) => ({ id, name, description, outputs: [{ node: OUT(p), kind: "video" }], states: { omni: F(0.4), transition: F(0), seed: O, prompt: R, ...states } });
const FLF = { transition: F(0.8) };

export const LTX_MODES = () => [
  mode("t2v", "Text to Video", 1, "Video with sound from a prompt.", { duration: O, aspect: O }),
  mode("a2v", "Audio to Video", 2, "Video that follows your audio.", { aspect: O, audio: R }),
  mode("i2v", "Image to Video", 3, "Bring a still to life.", { duration: O, start: R }),
  mode("flf", "First/Last Frame", 4, "Move from one image to another.", { ...FLF, duration: O, start: R, last: R }),
  mode("lip", "Lipsync", 5, "Make a face speak or sing your audio.", { start: R, audio: R }),
  mode("flflip", "First/Last Frame Lipsync", 6, "", { ...FLF, start: R, last: R, audio: R }),
  mode("fmlYours", "First–Middle–Last Frame, your audio", 7, "", { ...FLF, start: R, middle: R, last: R, audio: R, audioSource: F("yours") }),
  mode("fmlGen", "First–Middle–Last Frame, generated audio", 7, "", { ...FLF, duration: O, start: R, middle: R, last: R, audioSource: F("generated") }),
  mode("style", "Style Transfer", 8, "Restyle a video with a reference image, keeping its motion.", { source: R, start: R, guide: O }),
  mode("ref", "Reference sheet", 9, "Keep one character the same across Generations.", { sheet: R, character: R }),
  mode("out", "Outpaint", 10, "Widen or reframe a video; its audio is kept.", { source: R, start: O, outAspect: R }),
];

export const LTX_DETAILS = () => ({
  name: "LTX 2.5",
  slug: "ltx-2-5",
  description: "Video with sound from text, images, audio or a source video.",
  order: 1,
  maxRunMin: 15,
  enabled: true,
  termsText: "Example terms. LTX 2.5 is published by Lightricks under its own model license. By using it here you agree to that license and its use restrictions.",
  licenseUrl: "https://huggingface.co/Lightricks",
  askAgain: false,
  attribution: "Powered by LTX 2.5 from Lightricks",
});
