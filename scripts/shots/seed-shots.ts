// The shots tool's seed (issue #187, section 4): puts a studio through its
// own API so every screen state in `routes.ts` exists. Identities and their
// end states are fixed, so the screenshots read the same on every run.

import { type Client, createClient } from "./client.js";

export interface SeedResult {
  model: {
    video: { id: string; slug: string };
    images: { id: string; slug: string };
    draft: { id: string };
  };
  user: Record<
    "alice" | "sam" | "robin" | "pat" | "quinn" | "dana" | "eve",
    string
  >;
  gen: {
    succeededVideo: string;
    succeededImage: string;
    failed: string;
    cancelled: string;
    removed: string;
    deleted: string;
    running: string;
    queued: string;
  };
}

function versionOf(json: unknown): number {
  const obj = json as { version?: number; record?: { version: number } };
  return obj.record ? obj.record.version : (obj.version as number);
}

/**
 * Each Site settings sub-form has its own revision counter (`version` for
 * branding, `termsRevision`, `privacyRevision`, `blockedWordsRevision`,
 * `noticeRevision`, `capsRevision`), independent of the others, so saving
 * one never races another into a 409.
 */
async function siteSettingsRevision(
  alice: Client,
  field:
    | "version"
    | "termsRevision"
    | "privacyRevision"
    | "blockedWordsRevision"
    | "noticeRevision"
    | "capsRevision",
): Promise<number> {
  const current = await alice.json<Record<string, number>>(
    "GET",
    "/api/admin/site-settings",
  );
  return current[field] as number;
}

async function readFile(path: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(path).arrayBuffer());
}

async function uploadFile(
  client: Client,
  mediaPath: string,
  name: string,
  type: string,
): Promise<string> {
  const bytes = await readFile(mediaPath);
  const created = await client.json<{ upload: { id: string } }>(
    "POST",
    "/api/uploads",
    { json: { name, size: bytes.length, type } },
  );
  const id = created.upload.id;
  await client.api(
    "PUT",
    `/api/uploads/${id}/chunk?offset=0`,
    new Blob([bytes], { type: "application/octet-stream" }),
  );
  await client.api("POST", `/api/uploads/${id}/complete`);
  return id;
}

/** Waits for the health monitor's first poll (issue #187: mirrors `scripts/seed.ts`'s `waitReachable`). */
async function waitReachable(alice: Client, backendId: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const list = await alice.json<{
      backends: { id: string; health: { reachability: string } }[];
    }>("GET", "/api/admin/backends");
    const reachability = list.backends.find((b) => b.id === backendId)?.health
      .reachability;
    if (reachability === "reachable") return;
    if (Date.now() > deadline) {
      throw new Error(
        `shots: backend ${backendId} never became reachable (last: ${reachability})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const UUID = () => crypto.randomUUID();

interface Binding {
  nodeId: string;
  field: string;
  classType: string;
  title: string | null;
}

function bind(nodeId: string, field: string, classType: string): Binding {
  return { nodeId, field, classType, title: null };
}

function seedVideoWorkflow(): Record<string, unknown> {
  return {
    "1": {
      class_type: "EmptyImage",
      inputs: { width: 832, height: 480, batch_size: 1, color: 0 },
    },
    "2": { class_type: "LoadImage", inputs: { image: "" } },
    "3": { class_type: "LoadAudioCustom", inputs: { audio: "" } },
    "4": { class_type: "LoadVideoCustom", inputs: { video: "" } },
    "11": {
      class_type: "CreateVideo",
      inputs: { images: ["1", 0], fps: 24 },
    },
    "12": {
      class_type: "CreateVideo",
      inputs: { images: ["2", 0], fps: 24 },
    },
    "13": {
      class_type: "CreateVideo",
      inputs: { images: ["2", 0], audio: ["3", 0], fps: 24 },
    },
    "14": {
      class_type: "CreateVideo",
      inputs: { images: ["4", 0], fps: 24 },
    },
    // Node 5 carries the Prompt text: checkModel refuses binding an
    // Input to `filename_prefix` on a Mode's own output node, so the
    // Prompt Input binds here instead. The synthetic `_promptLink` on
    // each SaveVideo below is never read by anything; it only keeps
    // node 5 on every Mode's Path (computePath follows any node-link
    // value, not just known field names), so Prompt stays relevant to
    // all four Modes.
    "5": {
      class_type: "SaveImage",
      inputs: { images: ["1", 0], filename_prefix: "seed-video" },
    },
    "21": {
      class_type: "SaveVideo",
      inputs: {
        video: ["11", 0],
        filename_prefix: "seed-video",
        format: "auto",
        codec: "auto",
        _promptLink: ["5", 0],
      },
    },
    "22": {
      class_type: "SaveVideo",
      inputs: {
        video: ["12", 0],
        filename_prefix: "seed-video",
        format: "auto",
        codec: "auto",
        _promptLink: ["5", 0],
      },
    },
    "23": {
      class_type: "SaveVideo",
      inputs: {
        video: ["13", 0],
        filename_prefix: "seed-video",
        format: "auto",
        codec: "auto",
        _promptLink: ["5", 0],
      },
    },
    "24": {
      class_type: "SaveVideo",
      inputs: {
        video: ["14", 0],
        filename_prefix: "seed-video",
        format: "auto",
        codec: "auto",
        _promptLink: ["5", 0],
      },
    },
  };
}

function seedImagesWorkflow(): Record<string, unknown> {
  return {
    "1": {
      class_type: "EmptyImage",
      inputs: { width: 8, height: 8, batch_size: 1, color: 0 },
    },
    "2": { class_type: "TestSleep", inputs: { value: ["1", 0], seconds: 1 } },
    // Node 4 carries the Prompt text (see the matching comment in
    // `seedVideoWorkflow`): the Mode's own output node (3) can't have
    // its `filename_prefix` bound by an Input.
    "4": {
      class_type: "SaveImage",
      inputs: { images: ["1", 0], filename_prefix: "seed-images" },
    },
    "3": {
      class_type: "SaveImage",
      inputs: {
        images: ["2", 0],
        filename_prefix: "seed-images",
        _promptLink: ["4", 0],
      },
    },
  };
}

/** Builds Seed Video's Inputs, each with a fresh UUID. */
interface SeedVideoInputs {
  startImage: { id: string };
  audio: { id: string };
  sourceVideo: { id: string };
  prompt: { id: string };
  frameRate: { id: string };
  aspectRatio: { id: string };
  seed: { id: string };
  list: unknown[];
}

function seedVideoInputs(): SeedVideoInputs {
  const startImage = UUID();
  const audio = UUID();
  const sourceVideo = UUID();
  const prompt = UUID();
  const frameRate = UUID();
  const aspectRatio = UUID();
  const seed = UUID();

  const list = [
    {
      id: startImage,
      kind: "image_upload",
      group: "describe",
      label: "Start image",
      help: "",
      bindings: [bind("2", "image", "LoadImage")],
      maxSizeMb: 50,
      maxLongSide: null,
    },
    {
      id: audio,
      kind: "audio_upload",
      group: "describe",
      label: "Audio",
      help: "",
      bindings: [bind("3", "audio", "LoadAudioCustom")],
      maxSizeMb: 50,
      minDurationMs: 0,
      maxDurationMs: 60_000,
      trimmable: true,
    },
    {
      id: sourceVideo,
      kind: "video_upload",
      group: "describe",
      label: "Source video",
      help: "",
      bindings: [bind("4", "video", "LoadVideoCustom")],
      maxSizeMb: 200,
      maxLongSide: null,
      minDurationMs: 0,
      maxDurationMs: 60_000,
      trimmable: true,
    },
    {
      id: prompt,
      kind: "text",
      group: "describe",
      label: "Prompt",
      help: "",
      // Not node 21-24's own `filename_prefix`: those are each Mode's
      // output node, and checkModel refuses a bound output-node
      // filename_prefix. Node 5 carries it instead (see the workflow).
      bindings: [bind("5", "filename_prefix", "SaveImage")],
      multiline: true,
      maxLength: 2000,
      default: "",
    },
    {
      id: frameRate,
      kind: "number",
      group: "settings",
      label: "Frame rate",
      help: "",
      bindings: [
        bind("11", "fps", "CreateVideo"),
        bind("12", "fps", "CreateVideo"),
        bind("13", "fps", "CreateVideo"),
        bind("14", "fps", "CreateVideo"),
      ],
      numberMode: "decimal",
      min: 12,
      max: 30,
      step: 1,
      default: 24,
    },
    {
      id: aspectRatio,
      kind: "select",
      group: "settings",
      label: "Aspect ratio",
      help: "",
      bindings: [
        bind("1", "width", "EmptyImage"),
        bind("1", "height", "EmptyImage"),
      ],
      options: [
        { id: UUID(), label: "16:9", values: [832, 480] },
        { id: UUID(), label: "9:16", values: [480, 832] },
      ],
      default: null,
    },
    {
      id: seed,
      kind: "seed",
      group: "settings",
      label: "Seed",
      help: "",
      bindings: [bind("1", "color", "EmptyImage")],
      max: 16777215,
    },
  ];

  return {
    startImage: { id: startImage },
    audio: { id: audio },
    sourceVideo: { id: sourceVideo },
    prompt: { id: prompt },
    frameRate: { id: frameRate },
    aspectRatio: { id: aspectRatio },
    seed: { id: seed },
    list,
  };
}

function seedImagesInputs(): { prompt: string; seed: string; list: unknown[] } {
  const prompt = UUID();
  const seed = UUID();
  const list = [
    {
      id: prompt,
      kind: "text",
      group: "describe",
      label: "Prompt",
      help: "",
      // Node 4, not node 3 (the Mode's own output node; see the
      // workflow's comment).
      bindings: [bind("4", "filename_prefix", "SaveImage")],
      multiline: true,
      maxLength: 2000,
      default: "",
    },
    {
      id: seed,
      kind: "seed",
      group: "settings",
      label: "Seed",
      help: "",
      bindings: [bind("1", "color", "EmptyImage")],
      max: 16777215,
    },
  ];
  return { prompt, seed, list };
}

function modeSetting(
  inputId: string,
  state: "hidden" | "optional" | "required" | "fixed",
): unknown {
  return { inputId, state, fixedValue: null, label: "" };
}

/** Pushes a success script for the next submitted prompt and returns its output filenames (per output node id). */
function successOutputs(
  outputNodeIds: string[],
  filename: string,
  kind: "images" | "video",
): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  for (const nodeId of outputNodeIds) {
    outputs[nodeId] =
      kind === "images"
        ? { images: [{ filename, subfolder: "", type: "output" }] }
        : { images: [{ filename, subfolder: "", type: "output" }] };
  }
  return outputs;
}

async function waitForGeneration(
  client: Client,
  id: string,
  states: readonly string[],
  timeoutMs = 30_000,
): Promise<{ state: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const detail = await client.json<{ state: string }>(
      "GET",
      `/api/generations/${id}`,
    );
    if (states.includes(detail.state)) return detail;
    if (Date.now() > deadline) {
      throw new Error(
        `shots: generation ${id} never reached [${states.join(", ")}] (last: ${detail.state})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export async function seedShots(
  base: string,
  fakeComfyUiUrl: string,
  mediaDir: string,
): Promise<SeedResult> {
  const alice = await createClient(base, "alice@example.com", "Alice Admin");

  // 1. Site settings branding, privacy, blocked words, caps.
  {
    const revision = await siteSettingsRevision(alice, "version");
    const form = new FormData();
    form.set("version", String(revision));
    form.set("title", "My Studio");
    form.set("landingText", "");
    form.set("accent", "teal");
    form.set("signUpMode", "approval");
    form.set("contact", "studio-admin@example.org");
    form.set(
      "footerLinks",
      JSON.stringify([
        { label: "Status", url: "https://status.example.org" },
        { label: "Discord", url: "https://discord.example.org" },
      ]),
    );
    await alice.api("PUT", "/api/admin/site-settings", { form });
  }
  {
    const revision = await siteSettingsRevision(alice, "privacyRevision");
    await alice.api("PUT", "/api/admin/site-settings/privacy", {
      json: { revision, body: "## Privacy\n\nWe keep what we need." },
    });
  }
  {
    const revision = await siteSettingsRevision(alice, "blockedWordsRevision");
    await alice.api("PUT", "/api/admin/site-settings/blocked-words", {
      json: { revision, text: "bloodbath" },
    });
  }
  {
    const revision = await siteSettingsRevision(alice, "capsRevision");
    await alice.api("PUT", "/api/admin/site-settings/caps", {
      json: { revision, dailyCap: 30, concurrentCap: 4 },
    });
  }

  // 2. Backends.
  const backendGpu1 = await alice.json<{ id: string }>(
    "POST",
    "/api/admin/backends",
    { json: { name: "GPU 1", baseUrl: fakeComfyUiUrl, auth: "none" } },
  );
  await alice.api("POST", "/api/admin/backends", {
    json: { name: "Spare GPU", baseUrl: "http://localhost:8199", auth: "none" },
  });

  // 3. Models.
  const videoCreated = await alice.json<{
    model: { id: string; version: number };
  }>("POST", "/api/admin/models", {
    json: { name: "Seed Video", workflow: seedVideoWorkflow() },
  });
  const videoId = videoCreated.model.id;
  let videoVersion = videoCreated.model.version;

  videoVersion = versionOf(
    await alice.json("PUT", `/api/admin/models/${videoId}`, {
      json: {
        version: videoVersion,
        name: "Seed Video",
        slug: "seed-video",
        description: "Four ways to make a video.",
        maxRunTimeMinutes: 10,
      },
    }),
  );

  const videoInputs = seedVideoInputs();
  videoVersion = versionOf(
    await alice.json("PUT", `/api/admin/models/${videoId}/inputs`, {
      json: { version: videoVersion, inputs: videoInputs.list },
    }),
  );

  videoVersion = versionOf(
    await alice.json("PUT", `/api/admin/models/${videoId}/modes`, {
      json: {
        version: videoVersion,
        modes: [
          {
            name: "Text to video",
            description: "From a prompt.",
            outputNodeIds: ["21"],
            inputSettings: [modeSetting(videoInputs.seed.id, "optional")],
          },
          {
            name: "Image to video",
            description: "From images.",
            outputNodeIds: ["22"],
            inputSettings: [modeSetting(videoInputs.startImage.id, "required")],
          },
          {
            name: "Lipsync",
            description: "With your audio.",
            outputNodeIds: ["23"],
            inputSettings: [
              modeSetting(videoInputs.startImage.id, "required"),
              modeSetting(videoInputs.audio.id, "required"),
            ],
          },
          {
            name: "Restyle",
            description: "From a video.",
            outputNodeIds: ["24"],
            inputSettings: [
              modeSetting(videoInputs.sourceVideo.id, "required"),
            ],
          },
        ],
      },
    }),
  );

  // Model terms is guarded by its own `termsRevision`, independent of
  // `version` (so saving Details/Modes/Inputs never races it into a 409).
  {
    const videoDetail = await alice.json<{
      model: { termsRevision: number };
    }>("GET", `/api/admin/models/${videoId}`);
    await alice.api("PUT", `/api/admin/models/${videoId}/terms`, {
      json: {
        revision: videoDetail.model.termsRevision,
        termsBody: "## Seed Video terms\n\nBe nice.",
        licenseUrl: "",
        attribution: "Powered by Seed Video from Example Labs",
        askAgain: false,
      },
    });
  }

  await alice.api("POST", `/api/admin/models/${videoId}/backends`, {
    json: { backendId: backendGpu1.id },
  });
  const spareBackend = (
    await alice.json<{ backends: { id: string; name: string }[] }>(
      "GET",
      "/api/admin/backends",
    )
  ).backends.find((b) => b.name === "Spare GPU");
  if (spareBackend) {
    await alice.api("POST", `/api/admin/models/${videoId}/backends`, {
      json: { backendId: spareBackend.id },
    });
  }

  await waitReachable(alice, backendGpu1.id);
  await alice.api("POST", `/api/admin/models/${videoId}/enable`, {
    json: { version: videoVersion },
  });

  const imagesCreated = await alice.json<{
    model: { id: string; version: number };
  }>("POST", "/api/admin/models", {
    json: { name: "Seed Images", workflow: seedImagesWorkflow() },
  });
  const imagesId = imagesCreated.model.id;
  let imagesVersion = imagesCreated.model.version;

  imagesVersion = versionOf(
    await alice.json("PUT", `/api/admin/models/${imagesId}`, {
      json: {
        version: imagesVersion,
        name: "Seed Images",
        slug: "seed-images",
        description: "One Mode, one picture.",
        maxRunTimeMinutes: 5,
      },
    }),
  );

  const imagesInputs = seedImagesInputs();
  imagesVersion = versionOf(
    await alice.json("PUT", `/api/admin/models/${imagesId}/inputs`, {
      json: { version: imagesVersion, inputs: imagesInputs.list },
    }),
  );

  imagesVersion = versionOf(
    await alice.json("PUT", `/api/admin/models/${imagesId}/modes`, {
      json: {
        version: imagesVersion,
        modes: [
          {
            name: "Picture",
            description: "One image.",
            outputNodeIds: ["3"],
            inputSettings: [],
          },
        ],
      },
    }),
  );

  await alice.api("POST", `/api/admin/models/${imagesId}/backends`, {
    json: { backendId: backendGpu1.id },
  });
  await alice.api("POST", `/api/admin/models/${imagesId}/enable`, {
    json: { version: imagesVersion },
  });

  const draftCreated = await alice.json<{ model: { id: string } }>(
    "POST",
    "/api/admin/models",
    { json: { name: "Draft model", workflow: seedImagesWorkflow() } },
  );
  const draftId = draftCreated.model.id;

  // 4. Site terms, then Alice accepts.
  {
    const revision = await siteSettingsRevision(alice, "termsRevision");
    await alice.api("PUT", "/api/admin/site-settings/terms", {
      json: {
        revision,
        body: "## Site terms\n\nUse this studio responsibly.",
        askAgain: false,
      },
    });
  }
  await alice.api("POST", "/api/terms/accept");

  // 5. Users sign in, Alice approves most of them.
  const sam = await createClient(base, "sam.park@example.com", "Sam Park");
  const robin = await createClient(base, "robin@example.com", "Robin New");
  // Dana, Eve, Quinn and Pat only need to exist as pending/disabled rows;
  // their API jars aren't used again (Pat's Site terms accept happens
  // through the browser, per section 5).
  await createClient(base, "dana@example.com", "Dana Disabled");
  await createClient(base, "eve@example.com", "Eve Blocked");
  await createClient(base, "quinn@example.com", "Quinn Pending");
  await createClient(base, "pat@example.com", "Pat Pending");

  const userList = await alice.json<{
    users: { id: string; email: string }[];
  }>("GET", "/api/admin/users");
  const idByEmail = new Map(userList.users.map((u) => [u.email, u.id]));
  const userId = (email: string): string => {
    const id = idByEmail.get(email);
    if (!id) throw new Error(`shots: no user found for ${email}`);
    return id;
  };

  for (const email of [
    "sam.park@example.com",
    "robin@example.com",
    "dana@example.com",
    "eve@example.com",
  ]) {
    await alice.api("POST", `/api/admin/users/${userId(email)}/approve`);
  }

  await sam.api("POST", "/api/terms/accept");
  await robin.api("POST", "/api/terms/accept");
  await sam.api("POST", "/api/models/seed-video/terms/accept");

  // 6. Sam's uploads.
  const startPng = await uploadFile(
    sam,
    `${mediaDir}/start.png`,
    "start.png",
    "image/png",
  );
  const voiceWav = await uploadFile(
    sam,
    `${mediaDir}/voice.wav`,
    "voice.wav",
    "audio/wav",
  );
  const sourceMp4 = await uploadFile(
    sam,
    `${mediaDir}/source.mp4`,
    "source.mp4",
    "video/mp4",
  );

  // 7. Sam's Submissions, in order, polling each to its end state.
  const videoDetail = await sam.json<{
    model: { revision: number; modes: { id: string; name: string }[] };
  }>("GET", "/api/models/seed-video");
  const videoRevision = videoDetail.model.revision;
  const modeId = (name: string): string => {
    const mode = videoDetail.model.modes.find((m) => m.name === name);
    if (!mode) throw new Error(`shots: mode ${name} not found`);
    return mode.id;
  };

  const imagesDetail = await sam.json<{
    model: { revision: number; modes: { id: string; name: string }[] };
  }>("GET", "/api/models/seed-images");
  const imagesRevision = imagesDetail.model.revision;
  const pictureModeId = imagesDetail.model.modes[0]?.id;
  if (!pictureModeId) throw new Error("shots: Picture mode not found");

  async function submitVideo(
    mode: string,
    count: number,
    values: Record<string, unknown> = {},
  ): Promise<{ generations: { id: string; submissionId: string }[] }> {
    return sam.json("POST", "/api/models/seed-video/generations", {
      json: { modeId: modeId(mode), revision: videoRevision, count, values },
    });
  }
  async function submitImage(
    count: number,
  ): Promise<{ generations: { id: string; submissionId: string }[] }> {
    return sam.json("POST", "/api/models/seed-images/generations", {
      json: {
        modeId: pictureModeId,
        revision: imagesRevision,
        count,
        values: {},
      },
    });
  }

  function scriptNext(script: Record<string, unknown>): Promise<Response> {
    return fetch(new URL("/__control__/script-next", fakeComfyUiUrl), {
      method: "POST",
      body: JSON.stringify(script),
    });
  }

  async function putOutputFile(filename: string, path: string): Promise<void> {
    const bytes = await readFile(path);
    await fetch(
      new URL(`/__control__/output-file?filename=${filename}`, fakeComfyUiUrl),
      { method: "POST", body: bytes },
    );
  }

  await putOutputFile("out.png", `${mediaDir}/out.png`);
  await putOutputFile("out-wide.mp4", `${mediaDir}/out-wide.mp4`);
  await putOutputFile("out-tall.mp4", `${mediaDir}/out-tall.mp4`);

  // #1: Text to video, succeeded.
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["21"], "out-wide.mp4", "video"),
  });
  const g1 = await submitVideo("Text to video", 1);
  const succeededVideo = g1.generations[0]?.id as string;
  await waitForGeneration(sam, succeededVideo, ["succeeded"]);

  // #2: Image to video x2 (one wide, one tall).
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["22"], "out-wide.mp4", "video"),
  });
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["22"], "out-tall.mp4", "video"),
  });
  const g2 = await submitVideo("Image to video", 2, {
    [videoInputs.startImage.id]: startPng,
  });
  for (const generation of g2.generations) {
    await waitForGeneration(sam, generation.id, ["succeeded"]);
  }

  // #3: Lipsync, failed with a CUDA message.
  await scriptNext({
    steps: 3,
    stepIntervalMs: 50,
    fail: "CUDA out of memory",
  });
  const g3 = await submitVideo("Lipsync", 1, {
    [videoInputs.startImage.id]: startPng,
    [videoInputs.audio.id]: voiceWav,
  });
  const failed = g3.generations[0]?.id as string;
  await waitForGeneration(sam, failed, ["failed"]);

  // #4: Restyle, hangs, Sam cancels, Alice removes its source Upload.
  await scriptNext({ hang: true });
  const g4 = await submitVideo("Restyle", 1, {
    [videoInputs.sourceVideo.id]: sourceMp4,
  });
  const cancelled = g4.generations[0]?.id as string;
  const cancelledSubmissionId = g4.generations[0]?.submissionId as string;
  await waitForGeneration(sam, cancelled, ["running", "starting"]);
  await sam.api("POST", `/api/submissions/${cancelledSubmissionId}/cancel`);
  await waitForGeneration(sam, cancelled, ["cancelled"]);
  await alice.api("POST", `/api/admin/uploads/${sourceMp4}/remove`, {
    json: { reason: "Cancelled submission's source" },
  });

  // #5: Text to video, blank Prompt, 4x (3 succeed, 1 fails).
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["21"], "out-wide.mp4", "video"),
  });
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["21"], "out-wide.mp4", "video"),
  });
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["21"], "out-wide.mp4", "video"),
  });
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    fail: "CUDA out of memory",
  });
  const g5 = await sam.json<{
    generations: { id: string; submissionId: string }[];
  }>("POST", "/api/models/seed-video/generations", {
    json: {
      modeId: modeId("Text to video"),
      revision: videoRevision,
      count: 4,
      values: {},
    },
  });
  for (const generation of g5.generations) {
    await waitForGeneration(sam, generation.id, ["succeeded", "failed"]);
  }

  // #6: Picture x2.
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["3"], "out.png", "images"),
  });
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["3"], "out.png", "images"),
  });
  const g6 = await submitImage(2);
  let succeededImage = "";
  for (const generation of g6.generations) {
    await waitForGeneration(sam, generation.id, ["succeeded"]);
    succeededImage = generation.id;
  }

  // #7: Text to video, succeeded, then Alice removes it.
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["21"], "out-wide.mp4", "video"),
  });
  const g7 = await submitVideo("Text to video", 1);
  const removed = g7.generations[0]?.id as string;
  await waitForGeneration(sam, removed, ["succeeded"]);
  await alice.api("POST", `/api/admin/generations/${removed}/remove`, {
    json: { reason: "Shows a real person" },
  });

  // #8: Picture, succeeded, then Sam deletes it.
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["3"], "out.png", "images"),
  });
  const g8 = await submitImage(1);
  const deleted = g8.generations[0]?.id as string;
  await waitForGeneration(sam, deleted, ["succeeded"]);
  await sam.api("DELETE", `/api/generations/${deleted}`);

  // #9: Image to video, succeeded.
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["22"], "out-wide.mp4", "video"),
  });
  const g9 = await submitVideo("Image to video", 1, {
    [videoInputs.startImage.id]: startPng,
  });
  await waitForGeneration(sam, g9.generations[0]?.id as string, ["succeeded"]);

  // #10: Text to video, succeeded.
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["21"], "out-wide.mp4", "video"),
  });
  const g10 = await submitVideo("Text to video", 1);
  await waitForGeneration(sam, g10.generations[0]?.id as string, ["succeeded"]);

  // #11: Text to video, left running (a very long scripted job).
  await scriptNext({ steps: 3600, stepIntervalMs: 1000 });
  const g11 = await submitVideo("Text to video", 1);
  const running = g11.generations[0]?.id as string;
  await waitForGeneration(sam, running, ["running", "starting"]);

  // #12: Image to video x2, left queued (GPU 1 is busy with #11).
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["22"], "out-wide.mp4", "video"),
  });
  await scriptNext({
    steps: 2,
    stepIntervalMs: 50,
    outputs: successOutputs(["22"], "out-tall.mp4", "video"),
  });
  const g12 = await submitVideo("Image to video", 2, {
    [videoInputs.startImage.id]: startPng,
  });
  const queued = g12.generations[0]?.id as string;
  await waitForGeneration(sam, queued, ["queued"]);

  // 8. Accounts.
  await alice.api(
    "POST",
    `/api/admin/users/${userId("dana@example.com")}/disable`,
    {
      json: { reason: "Spam uploads" },
    },
  );
  await alice.api(
    "POST",
    `/api/admin/users/${userId("eve@example.com")}/disable`,
    {
      json: { reason: "Spam uploads" },
    },
  );
  await alice.api("DELETE", `/api/admin/users/${userId("eve@example.com")}`, {
    json: { reason: "Left the organisation" },
  });

  // 9. Notice.
  {
    const revision = await siteSettingsRevision(alice, "noticeRevision");
    await alice.api("PUT", "/api/admin/site-settings/notice", {
      json: {
        revision,
        text: "Scheduled maintenance on Sunday from 22:00 to 23:00.",
      },
    });
  }

  return {
    model: {
      video: { id: videoId, slug: "seed-video" },
      images: { id: imagesId, slug: "seed-images" },
      draft: { id: draftId },
    },
    user: {
      alice: userId("alice@example.com"),
      sam: userId("sam.park@example.com"),
      robin: userId("robin@example.com"),
      pat: userId("pat@example.com"),
      quinn: userId("quinn@example.com"),
      dana: userId("dana@example.com"),
      eve: userId("eve@example.com"),
    },
    gen: {
      succeededVideo,
      succeededImage,
      failed,
      cancelled,
      removed,
      deleted,
      running,
      queued,
    },
  };
}
