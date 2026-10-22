// PROTOTYPE data for the user's Model page.
// LTX 2.5's Inputs and Mode states copy the draft in the Admin prototype
// (prototypes/model-editor/src/data.js on branch prototype/model-editor), so both
// prototypes describe one Model. Wan 2.2's Inputs are a draft. Both tables stay
// drafts until "What Inputs and Mode states does the LTX 2.5 / Wan 2.2 Model ship
// with?" settle them. `wf` is the Workflow's own value, shown as the placeholder
// of a blank optional Input.

export const SITE = {
  title: "AI Content Studio",
  contact: "studio-admin@example.org",
  blockedWords: ["bloodbath", "gore"],
  maxUploadMB: 500,
};

export const DEFAULT_CAPS = { daily: 30, concurrent: 4 };

const R = "required", O = "optional", H = "hidden";

const sel = (id, label) => ({ id, label });

const LTX_INPUTS = [
  { id: "start", label: "Start image", type: "image", limits: { maxMB: 20, maxLongSide: 4096 }, help: "The first frame. In Style Transfer, your source video's first frame, already restyled." },
  { id: "middle", label: "Middle frame", type: "image", limits: { maxMB: 20, maxLongSide: 4096 } },
  { id: "last", label: "Last frame", type: "image", limits: { maxMB: 20, maxLongSide: 4096 } },
  { id: "audio", label: "Audio", type: "audio", limits: { maxMB: 50, maxSec: 10, trimmable: true }, help: "Speech or music the video follows." },
  { id: "source", label: "Source video", type: "video", limits: { maxMB: 300, maxSec: 10, maxLongSide: 1920, trimmable: true } },
  { id: "sheet", label: "Reference sheet", type: "image", limits: { maxMB: 20, maxLongSide: 4096 }, help: "Character panels on a black background." },
  { id: "prompt", label: "Prompt", type: "text", multiline: true, maxLength: 2000, help: "Describe the shot. For several shots, describe each in order (Multishot)." },
  { id: "character", label: "Character description", type: "text", multiline: true, maxLength: 600, help: "Who appears in the sheet, in one or two sentences." },
  { id: "duration", label: "Duration", type: "number", unit: "s", min: 1, max: 10, step: 1, wf: "10" },
  { id: "aspect", label: "Aspect ratio", type: "select", wf: "wide", options: [sel("wide", "16:9"), sel("tall", "9:16"), sel("square", "1:1")] },
  { id: "guide", label: "Motion guide", type: "select", wf: "depth", help: "Which motion from the source video to follow.", options: [sel("depth", "Depth"), sel("pose", "Pose"), sel("canny", "Edges (canny)")] },
  { id: "outAspect", label: "Target aspect", type: "select", help: "The source is centred and the rest is generated.", options: [sel("wide", "16:9"), sel("tall", "9:16"), sel("square", "1:1")] },
  { id: "seed", label: "Seed", type: "seed", help: "Blank picks a new seed for each Generation." },
];

// Mode states from the Admin prototype. Inputs left out are hidden; fixed Inputs
// (LoRA strengths, the FML audio switch) never reach the user's form.
const mode = (id, name, description, states, extra = {}) => ({ id, name, description, states: { seed: O, prompt: R, ...states }, ...extra });

const LTX_MODES = [
  mode("t2v", "Text to Video", "Video with sound from a prompt.", { duration: O, aspect: O }, { runSec: 16 }),
  mode("a2v", "Audio to Video", "Video that follows your audio.", { aspect: O, audio: R }, { runSec: 18, lengthFrom: "audio" }),
  mode("i2v", "Image to Video", "Bring a still to life.", { duration: O, start: R }, { runSec: 17 }),
  mode("flf", "First/Last Frame", "Move from one image to another.", { duration: O, start: R, last: R }, { runSec: 18 }),
  mode("lip", "Lipsync", "Make a face speak or sing your audio.", { start: R, audio: R }, { runSec: 19, lengthFrom: "audio" }),
  mode("flflip", "First/Last Frame Lipsync", "Move between two images while a face speaks your audio.", { start: R, last: R, audio: R }, { runSec: 20, lengthFrom: "audio" }),
  mode("fmlYours", "First–Middle–Last Frame, your audio", "Pass through three images, following your audio.", { start: R, middle: R, last: R, audio: R }, { runSec: 21, lengthFrom: "audio" }),
  mode("fmlGen", "First–Middle–Last Frame, generated audio", "Pass through three images with generated sound.", { duration: O, start: R, middle: R, last: R }, { runSec: 20 }),
  mode("style", "Style Transfer", "Restyle a video with a reference image, keeping its motion.", { source: R, start: R, guide: O }, { runSec: 22, lengthFrom: "source" }),
  mode("ref", "Reference sheet", "Keep one character the same across Generations.", { sheet: R, character: R }, { runSec: 17, fixedLength: 5, fixedAspect: "sheet" }),
  mode("out", "Outpaint", "Widen or reframe a video; its audio is kept.", { source: R, start: O, outAspect: R }, { runSec: 21, lengthFrom: "source", aspectFrom: "outAspect" }),
];

const WAN_INPUTS = [
  { id: "character", label: "Character image", type: "image", limits: { maxMB: 20, maxLongSide: 4096 }, help: "A clear picture of the new character, ideally full body." },
  { id: "source", label: "Source video", type: "video", limits: { maxMB: 300, minSec: 1, maxSec: 10, maxLongSide: 1920, trimmable: true }, help: "One person in frame works best." },
  { id: "who", label: "Who to replace", type: "points", of: "source", cropFrom: "size", min: 1, max: 10, help: "Click the person to replace on the first frame of your trimmed video." },
  { id: "prompt", label: "Prompt", type: "text", multiline: true, maxLength: 1500, wf: "The person is dancing in the room." },
  { id: "size", label: "Size", type: "select", wf: "landscape", options: [sel("landscape", "832×480"), sel("portrait", "480×832"), sel("square", "640×640")] },
  { id: "seed", label: "Seed", type: "seed", help: "Blank picks a new seed for each Generation." },
];

const WAN_MODES = [
  mode("replace", "Character replace", "Swap a person in your video for the character in your image, keeping their motion.", { character: R, source: R, who: R, prompt: O, size: O }, { runSec: 24, lengthFrom: "source", aspectFrom: "size" }),
];

export const MODELS = [
  {
    id: "ltx",
    slug: "ltx-2-5",
    name: "LTX 2.5",
    description: "Video with sound from text, images, audio or a source video.",
    attribution: "Powered by LTX 2.5 from Lightricks",
    terms: {
      version: 1,
      text: "Example Model terms. LTX 2.5 is published by Lightricks under its own model license. By using it here you agree to that license and its use restrictions, including not generating content that harms minors, impersonates real people without consent, or deceives viewers about what is real.",
      licenseUrl: "https://huggingface.co/Lightricks",
    },
    revision: 7,
    steps: 11,
    inputs: LTX_INPUTS,
    modes: LTX_MODES,
  },
  {
    id: "wan",
    slug: "wan-2-2",
    name: "Wan 2.2",
    description: "Replace a person in a video with your character.",
    attribution: "",
    terms: null,
    revision: 3,
    steps: 6,
    inputs: WAN_INPUTS,
    modes: WAN_MODES,
  },
];

export const modelById = (id) => MODELS.find((m) => m.id === id);

// Aspect of an Asset a Mode produces, from its values.
export function assetAspect(model, mode, values) {
  if (mode.fixedAspect === "sheet") return "wide";
  const key = mode.aspectFrom || (model.inputs.some((i) => i.id === "aspect") ? "aspect" : null);
  const input = key && model.inputs.find((i) => i.id === key);
  const v = (key && values[key]) || input?.wf || "wide";
  if (v === "portrait" || v === "tall") return "tall";
  if (v === "square") return "square";
  return "wide";
}

export const UPLOAD_KINDS = { image: "image", video: "video", audio: "audio" };

export const ACCEPT = {
  image: "image/png,image/jpeg,image/webp",
  video: "video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv",
  audio: "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/flac,.mp3,.wav,.m4a,.aac,.ogg,.flac",
};
