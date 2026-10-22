// PROTOTYPE store: one in-memory studio shared by all three variants, so a form
// filled or a Generation started in one layout shows in the others. A 200 ms
// tick simulates chunked Uploads, two GPU Backends taking Generations one at a
// time, progress, saving, cancels and faults. Times run ~8× faster than real.
import { MODELS, SITE, DEFAULT_CAPS, assetAspect } from "./data.js";
import { parseInputValues, blockedWordIssue, capsState, capsRefusal, seedsFor, isUpload, isTrimmed, trimLength, uuid7, ACTIVE, shownInputs } from "./logic.js";
import { assetClip, assetClipByKey, materialiseSample, SAMPLES } from "./media.js";

const { useSyncExternalStore } = React;

export const S = {};
const listeners = new Set();
export function emit() { S.v = (S.v || 0) + 1; listeners.forEach((l) => l()); }
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
export function useStore() { useSyncExternalStore(subscribe, () => S.v); return S; }

export const SCENARIOS = [
  { id: "usual", label: "Usual day (history, one running)" },
  { id: "first", label: "First visit (terms, nothing yet)" },
  { id: "caps", label: "Near the Caps (Admin-set 10 a day)" },
  { id: "busy", label: "Busy studio (GPUs taken by others)" },
];

const MIN = 60e3, HOUR = 60 * MIN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

function freshForm(model) {
  return { modeId: model.modes[0].id, chosen: model.modes.length === 1, values: {}, issues: {}, notes: {}, count: 1, phase: null, formError: null, banner: null };
}

export function resetScenario(id) {
  const now = Date.now();
  Object.assign(S, {
    scenario: id,
    now,
    page: S.page && S.page.name !== "home" ? S.page : { name: "model", modelId: "ltx" },
    caps: { ...DEFAULT_CAPS, overridden: false },
    termsAck: id === "first" ? {} : { ltx: 1 },
    models: Object.fromEntries(MODELS.map((m) => [m.id, structuredClone(m)])),
    uploads: {},
    gens: [],
    backends: [
      { id: "b1", name: "GPU 1", up: true, gen: null, busyUntil: 0 },
      { id: "b2", name: "GPU 2", up: true, gen: null, busyUntil: 0 },
    ],
    history: {},
    faults: { fail: null, lose: false, timeout: false, stale: false, trim: null, noServer: false },
    dialog: null,
    toasts: S.toasts || [],
    forms: {},
  });
  for (const m of MODELS) S.forms[m.id] = freshForm(m);
  if (id === "first") { emit(); return; }

  S.history = { "ltx:t2v": [15, 16, 17], "ltx:i2v": [17, 18], "ltx:flf": [18], "wan:replace": [23, 25] };
  seedHistory(now);
  if (id === "caps") {
    S.caps = { daily: 10, concurrent: 2, overridden: true };
  }
  if (id === "busy") {
    S.backends[0].busyUntil = now + 28e3;
    S.backends[1].busyUntil = now + 40e3;
  }
  if (id === "usual" || id === "caps") {
    // One Submission under way: one running on GPU 1, one waiting while GPU 2 finishes someone else's work.
    S.backends[1].busyUntil = now + 14e3;
    const sid = uuid7(now - 9e3);
    const values = { prompt: "Slow dolly through a greenhouse at dawn; condensation drips from glass panes, birds flit between the ferns.", duration: 8 };
    addGen({ sid, modelId: "ltx", modeId: "t2v", values, seed: 811402, createdAt: now - 9e3, state: "running", backendId: "b1", stageAt: now - 6e3, runAt: now - 6e3, runDur: 17 });
    addGen({ sid, modelId: "ltx", modeId: "t2v", values, seed: 811403, createdAt: now - 9e3, state: "queued" });
  }
  emit();
}

function addUploadRecord(sampleKey, type, extra = {}) {
  const sample = SAMPLES[type].find((s) => s.key === sampleKey);
  const m = materialiseSample(sample, type);
  const id = uuid7(Date.now() - 3 * HOUR);
  S.uploads[id] = { id, kind: type, ...m, status: "ready", sent: m.size, isSample: true, createdAt: Date.now() - 3 * HOUR, ...extra };
  return id;
}

function seedHistory(now) {
  const up = (k, t, extra) => addUploadRecord(k, t, extra);
  const sunrise = up("sunrise", "image"), face = up("face", "image"), painting = up("painting", "image");
  const dance = up("dance.mp4", "video"), song = up("song.mp3", "audio"), character = up("character", "image"), dusk = up("dusk", "image");
  const danceTrim = up("dance.mp4", "video", { name: "two-dancers (2.0–12.0 s).mp4", duration: 10, trimmedFrom: dance, size: 21_300_000 });
  const songTrim = up("song.mp3", "audio", { name: "little-tune (0.0–6.5 s).mp3", duration: 6.5, trimmedFrom: song, size: 1_000_000 });

  const done = (o) => addGen({ state: "succeeded", ran: true, ...o, asset: assetClipByKey(o.clip, o.aspect || "wide") });
  let sid = uuid7(now - 26 * HOUR);
  done({ sid, modelId: "ltx", modeId: "t2v", values: { prompt: "Aerial shot over a coral reef at golden hour, schools of fish scatter as a turtle glides past.", aspect: "wide" }, seed: 19340, createdAt: now - 26 * HOUR, clip: "aurora", runFor: 152 });

  sid = uuid7(now - 3 * HOUR);
  done({ sid, modelId: "wan", modeId: "replace", values: { character: { uploadId: character }, source: { uploadId: danceTrim }, who: [{ x: 0.33, y: 0.6 }], size: "landscape" }, seed: 557210, createdAt: now - 3 * HOUR, clip: "bloom", runFor: 241 });

  sid = uuid7(now - 2 * HOUR);
  const v1 = { prompt: "A paper boat drifts down a rain-soaked street at night; neon signs ripple in the puddles around it.", duration: 6, aspect: "wide" };
  done({ sid, modelId: "ltx", modeId: "t2v", values: v1, seed: 402118, createdAt: now - 2 * HOUR, clip: "dusk", runFor: 131 });
  done({ sid, modelId: "ltx", modeId: "t2v", values: v1, seed: 402119, createdAt: now - 2 * HOUR, clip: "fractal", runFor: 138 });

  sid = uuid7(now - 70 * MIN);
  addGen({ sid, modelId: "ltx", modeId: "style", values: { prompt: "Thick oil-paint brushwork, swirling night sky.", source: { uploadId: danceTrim }, start: { uploadId: painting }, guide: "pose" }, seed: 99120, createdAt: now - 70 * MIN, state: "succeeded", ran: true, removed: true, asset: assetClipByKey("bloom", "wide") });

  sid = uuid7(now - 40 * MIN);
  done({ sid, modelId: "ltx", modeId: "i2v", values: { prompt: "The sun climbs over the valley as mist lifts off the hills.", start: { uploadId: sunrise } }, seed: 77001, createdAt: now - 40 * MIN, clip: "dusk", runFor: 144 });

  sid = uuid7(now - 25 * MIN);
  addGen({ sid, modelId: "ltx", modeId: "flf", values: { prompt: "Day turns to night over the valley.", start: { uploadId: sunrise }, last: { uploadId: dusk }, duration: 10 }, seed: 5150, createdAt: now - 25 * MIN, state: "failed", ran: true, failure: "the GPU server couldn't run this" });

  sid = uuid7(now - 12 * MIN);
  addGen({ sid, modelId: "ltx", modeId: "lip", values: { prompt: "A woman sings softly to the camera in a dim studio.", start: { uploadId: face }, audio: { uploadId: songTrim } }, seed: 3321, createdAt: now - 12 * MIN, state: "cancelled", ran: true });
}

function addGen(o) {
  const model = S.models[o.modelId];
  const mode = model.modes.find((m) => m.id === o.modeId);
  const g = {
    id: uuid7(o.createdAt), submissionId: o.sid, modelId: o.modelId, modeId: o.modeId, revision: model.revision,
    values: o.values, seed: o.seed, createdAt: o.createdAt, state: o.state, ran: !!o.ran,
    aspect: assetAspect(model, mode, o.values), steps: model.steps, step: 0, pct: null,
    backendId: o.backendId || null, stageAt: o.stageAt || o.createdAt, runAt: o.runAt || null, runDur: o.runDur || null,
    startDur: 1.6, tries: 1, failure: o.failure || null, asset: o.asset || null, removed: !!o.removed, dismissed: false,
    cancelRequested: false, endedAt: o.state === "succeeded" || o.state === "failed" || o.state === "cancelled" ? o.createdAt + (o.runFor || 120) * 1000 : null,
    runFor: o.runFor || null, note: null,
  };
  if (g.state === "running" && g.backendId) S.backends.find((b) => b.id === g.backendId).gen = g.id;
  S.gens.push(g);
  return g;
}

// ---------- the tick ----------
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

function tick() {
  const now = Date.now();
  const dt = (now - S.now) / 1000;
  S.now = now;
  let changed = false;

  for (const u of Object.values(S.uploads)) {
    if (u.status === "uploading") {
      const rate = Math.max(u.size / 2.2, 9_000_000); // bytes/s, at least ~2 s
      u.sent = Math.min(u.size, u.sent + rate * dt);
      if (u.sent >= u.size) { u.status = "checking"; u.checkAt = now; }
      changed = true;
    } else if (u.status === "checking" && now - u.checkAt > 700) {
      if (u.unplayable && u.size > 60_000_000) { u.status = "failed"; u.error = "This video can't be played here and is too long to use untrimmed. Convert it to H.264 MP4 or try another browser."; }
      else u.status = "ready";
      for (const [mid, f] of Object.entries(S.forms)) for (const [k, v] of Object.entries(f.values)) if (v?.uploadId === u.id && f.issues[k]) revalidate(mid, k);
      changed = true;
    }
  }

  for (const b of S.backends) {
    if (b.downUntil && now > b.downUntil) { b.up = true; b.downUntil = 0; changed = true; }
  }
  const up = (b) => b.up && !S.faults.noServer;

  // Dispatch: a free Backend takes the oldest queued Generation.
  for (const b of S.backends) {
    if (!up(b) || b.gen || b.busyUntil > now) continue;
    const next = S.gens.filter((g) => g.state === "queued").sort((a, c) => a.createdAt - c.createdAt || a.seed - c.seed)[0];
    if (!next) break;
    next.state = "starting"; next.backendId = b.id; next.stageAt = now; next.startDur = rand(1.2, 2.4); next.note = next.tries > 1 ? next.note : null;
    b.gen = next.id;
    changed = true;
  }

  for (const g of S.gens) {
    if (!ACTIVE.includes(g.state)) continue;
    changed = true;
    const model = S.models[g.modelId];
    const mode = model.modes.find((m) => m.id === g.modeId);
    const b = S.backends.find((x) => x.id === g.backendId);
    if (g.state === "queued") {
      if (S.faults.noServer && now - (g.queuedSince || g.createdAt) > 20e3) end(g, "failed", "no server available for this Model");
      continue;
    }
    if (g.cancelRequested && (g.state === "starting" || g.state === "running")) {
      if (now - g.cancelAt > 1500) end(g, "cancelled");
      continue;
    }
    if (g.state === "starting" && now - g.stageAt > g.startDur * 1000) {
      g.state = "running"; g.runAt = now; g.ran = true; g.runDur = mode.runSec * rand(0.85, 1.15);
      if (g.failMode === "fail") g.failAt = g.runDur * rand(0.3, 0.6);
      if (g.failMode === "timeout") g.failAt = g.runDur * 0.75;
      if (g.failMode === "lose") g.loseAt = g.runDur * 0.4;
    } else if (g.state === "running") {
      const el = (now - g.runAt) / 1000;
      g.step = Math.min(g.steps, Math.floor((el / g.runDur) * g.steps) + 1);
      const h = S.history[`${g.modelId}:${g.modeId}`];
      g.pct = h && h.length ? Math.min(0.99, el / median(h)) : null;
      if (g.loseAt && el > g.loseAt) {
        if (!g.lostSince) { g.lostSince = now; if (b) { b.up = false; b.downUntil = now + 12e3; } }
        else if (now - g.lostSince > 4000) { // "unreachable for more than 2 minutes"
          g.loseAt = null; g.lostSince = null; g.failMode = null;
          if (b) b.gen = null;
          if (g.tries >= 2) end(g, "failed", "the GPU server couldn't run this");
          else { g.tries++; g.state = "queued"; g.queuedSince = now; g.backendId = null; g.step = 0; g.pct = null; g.note = "Retrying on another GPU: the first one stopped responding."; }
        }
      } else if (g.failAt && el > g.failAt) {
        end(g, "failed", g.failMode === "timeout" ? "timed out" : "the GPU server couldn't run this");
      } else if (el >= g.runDur) {
        g.state = "saving"; g.stageAt = now; g.step = g.steps; g.pct = 0.99;
      }
    } else if (g.state === "saving" && now - g.stageAt > 1400) {
      (S.history[`${g.modelId}:${g.modeId}`] ||= []).push(g.runDur);
      g.asset = assetClip(g.aspect);
      g.runFor = Math.round(g.runDur * 8);
      end(g, "succeeded");
      toast(`${mode.name} finished.`, "ok", { genId: g.id });
    }
  }

  S.toasts = S.toasts.filter((t) => now - t.at < (t.ttl || 4500));
  if (changed || S.toasts.length || now - (S.lastEmit || 0) > 10e3) { S.lastEmit = now; emit(); }
}

function end(g, state, failure) {
  const b = S.backends.find((x) => x.id === g.backendId);
  if (b && b.gen === g.id) b.gen = null;
  g.state = state; g.failure = failure || null; g.endedAt = Date.now(); g.cancelRequested = false; g.pct = state === "succeeded" ? 1 : g.pct;
}

let timer = null;
export function start() { if (!timer) timer = setInterval(tick, 200); }

// ---------- toasts ----------
let tid = 0;
export function toast(text, tone = "info", extra = {}) { S.toasts = [...S.toasts, { id: ++tid, text, tone, at: Date.now(), ...extra }]; emit(); }

// ---------- navigation and dialogs ----------
export function go(page) { S.page = page; S.dialog = null; window.scrollTo?.(0, 0); emit(); maybeTerms(); }
function maybeTerms() {
  if (S.page.name !== "model") return;
  const m = S.models[S.page.modelId];
  if (m.terms && S.termsAck[m.id] !== m.terms.version) { S.dialog = { type: "terms", modelId: m.id }; emit(); }
}
export function openDetail(genId) { S.dialog = { type: "detail", genId }; emit(); }
export function openTerms(modelId, readOnly = true) { S.dialog = { type: "terms", modelId, readOnly }; emit(); }
export function closeDialog() { S.dialog = null; emit(); }
export function acceptTerms(modelId) {
  S.termsAck[modelId] = S.models[modelId].terms.version;
  const resubmit = S.dialog?.resubmit;
  S.dialog = null; emit();
  if (resubmit) submit(modelId);
}

// ---------- the form ----------
export const formOf = (modelId) => S.forms[modelId];
export const modeOf = (modelId) => { const f = S.forms[modelId]; return S.models[modelId].modes.find((m) => m.id === f.modeId); };

export function setMode(modelId, modeId) {
  const f = S.forms[modelId];
  f.modeId = modeId; f.chosen = true; f.formError = null;
  f.issues = {}; f.notes = {};
  emit();
}
export function unchoose(modelId) { S.forms[modelId].chosen = false; emit(); }

function revalidate(modelId, only) {
  const f = S.forms[modelId];
  if (!f.touchedSubmit && !only) return;
  const { issues } = parseInputValues(S.models[modelId], modeOf(modelId), f.values, S.uploads);
  if (only) { if (issues[only]) f.issues[only] = issues[only]; else delete f.issues[only]; }
  else f.issues = issues;
}

const SIZE_RATIO = { landscape: 832 / 480, portrait: 480 / 832, square: 1, wide: 16 / 9, tall: 9 / 16 };
export function setValue(modelId, inputId, value) {
  const f = S.forms[modelId];
  f.values = { ...f.values, [inputId]: value };
  // A new size moves the area the video keeps: points that fall outside it go.
  for (const p of S.models[modelId].inputs) {
    if (p.type !== "points" || p.cropFrom !== inputId || !f.values[p.id]?.length) continue;
    const src = S.uploads[f.values[p.of]?.uploadId];
    if (!src?.w) continue;
    const sizeInput = S.models[modelId].inputs.find((i) => i.id === inputId);
    const r = SIZE_RATIO[value || sizeInput.wf], sr = src.w / src.h;
    const c = sr > r ? { x: (1 - r / sr) / 2, y: 0, w: r / sr, h: 1 } : { x: 0, y: (1 - sr / r) / 2, w: 1, h: sr / r };
    const kept = f.values[p.id].filter((q) => q.x >= c.x && q.x <= c.x + c.w && q.y >= c.y && q.y <= c.y + c.h);
    const gone = f.values[p.id].length - kept.length;
    if (gone) { f.values = { ...f.values, [p.id]: kept }; f.notes[p.id] = `${gone} point${gone > 1 ? "s" : ""} fell outside the new size and ${gone > 1 ? "were" : "was"} removed.`; }
  }
  delete f.notes[inputId];
  if (f.issues[inputId]) revalidate(modelId, inputId);
  f.formError = null;
  emit();
}
export function blurValue(modelId, inputId) { revalidate(modelId, inputId); emit(); }
export function setCount(modelId, n) { S.forms[modelId].count = n; S.forms[modelId].formError = null; emit(); }

// Uploads start the moment a file is picked.
export function refuseUpload(modelId, inputId, message) { const f = S.forms[modelId]; f.issues = { ...f.issues, [inputId]: message }; emit(); }

export function addUpload(modelId, input, meta) {
  const id = uuid7();
  const L = input.limits || {};
  S.uploads[id] = { id, kind: input.type, ...meta, status: "uploading", sent: 0, createdAt: Date.now() };
  const value = { uploadId: id };
  if (L.trimmable && meta.duration && L.maxSec && meta.duration > L.maxSec) value.trim = { start: 0, end: L.maxSec };
  else if (L.trimmable && meta.duration) value.trim = { start: 0, end: meta.duration };
  const f = S.forms[modelId];
  f.values = { ...f.values, [input.id]: value };
  const iss = { ...f.issues }; delete iss[input.id]; f.issues = iss;
  // A points Input on this video starts over.
  for (const p of S.models[modelId].inputs) if (p.type === "points" && p.of === input.id && f.values[p.id]?.length) { f.values[p.id] = []; f.notes[p.id] = "Points cleared: the video changed."; }
  emit();
}
export function useSample(modelId, input, sample) {
  const m = materialiseSample(sample, input.type);
  addUpload(modelId, input, m);
}
export function stopWaiting(modelId) { const f = S.forms[modelId]; if (f.phase === "waiting") { f.phase = null; emit(); } }
export function clearUpload(modelId, inputId) {
  const f = S.forms[modelId];
  const v = { ...f.values }; delete v[inputId]; f.values = v;
  for (const p of S.models[modelId].inputs) if (p.type === "points" && p.of === inputId && f.values[p.id]?.length) { f.values[p.id] = []; f.notes[p.id] = "Points cleared: the video changed."; }
  emit();
}
export function setTrim(modelId, inputId, trim) {
  const f = S.forms[modelId];
  const prev = f.values[inputId];
  f.values = { ...f.values, [inputId]: { ...prev, trim } };
  if (prev?.trim && Math.abs(prev.trim.start - trim.start) > 0.04) {
    for (const p of S.models[modelId].inputs) if (p.type === "points" && p.of === inputId && f.values[p.id]?.length) { f.values[p.id] = []; f.notes[p.id] = "Points cleared: the trim start moved, so the first frame changed."; }
  }
  if (f.issues[inputId]) revalidate(modelId, inputId);
  emit();
}

// ---------- submit: the round trip to the server ----------
export async function submit(modelId) {
  const f = S.forms[modelId];
  const model = S.models[modelId];
  const mode = modeOf(modelId);
  if (f.phase) return;
  f.touchedSubmit = true; f.formError = null; f.banner = null;
  const isPending = () => shownInputs(model, modeOf(modelId)).some(({ input }) => isUpload(input) && f.values[input.id]?.uploadId && ["uploading", "checking"].includes(S.uploads[f.values[input.id].uploadId]?.status));
  let { issues } = parseInputValues(model, mode, f.values, S.uploads);
  const onlyUploading = Object.keys(issues).length > 0 && Object.values(issues).every((x) => x === "Still uploading");
  if (onlyUploading) {
    // Generate waits for Uploads still in progress, then goes on its own.
    f.issues = {}; f.phase = "waiting"; emit();
    while (isPending() && f.phase === "waiting") await sleep(200);
    if (f.phase !== "waiting") return;
    f.phase = null;
    ({ issues } = parseInputValues(model, mode, f.values, S.uploads));
  }
  f.issues = issues;
  const n = Object.keys(issues).length;
  if (n) { f.formError = `Fix ${n === 1 ? "the field" : `${n} fields`} marked above.`; emit(); return; }
  const caps = capsState(S.gens, S.caps, Date.now());
  const refusal = capsRefusal(caps, f.count);
  if (refusal) { f.formError = refusal; emit(); return; }
  if (model.terms && S.termsAck[modelId] !== model.terms.version) { S.dialog = { type: "terms", modelId, resubmit: true }; emit(); return; }

  const trimmed = shownInputs(model, mode).filter(({ input }) => isUpload(input) && input.limits?.trimmable && isTrimmed(f.values[input.id], S.uploads[f.values[input.id]?.uploadId]));
  f.phase = trimmed.some(({ input }) => input.type === "video") ? "preparing" : "sending";
  emit();
  await sleep(f.phase === "preparing" ? 2600 : 600);

  // Server answers, in the order the server checks.
  if (S.faults.stale) {
    S.faults.stale = false;
    applyModelUpdate(modelId);
    f.phase = null; f.banner = "This Model was updated, check your settings.";
    emit(); return;
  }
  if (S.faults.noServer) { f.phase = null; f.formError = "No server is available for this Model right now. Try again in a few minutes."; emit(); return; }
  if (trimmed.length && S.faults.trim) {
    const msg = { busy: "The server is busy. Try again in a minute.", full: "The studio's storage is full. Tell an administrator.", bad: "Your Upload couldn't be processed. Try another file." }[S.faults.trim];
    S.faults.trim = null; f.phase = null;
    f.issues = { ...f.issues, [trimmed[0].input.id]: msg };
    emit(); return;
  }
  const blocked = blockedWordIssue(model, mode, f.values);
  if (blocked) { f.phase = null; f.issues = { ...f.issues, [blocked]: "Your prompt contains a blocked word." }; emit(); return; }

  // Accepted: trims become new Uploads "trimmed from" their originals.
  const values = {};
  for (const { input } of shownInputs(model, mode)) {
    const v = f.values[input.id];
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (isUpload(input) && input.limits?.trimmable && isTrimmed(v, S.uploads[v.uploadId])) {
      const src = S.uploads[v.uploadId];
      const id = uuid7();
      const len = trimLength(v, src);
      const ext = src.name.includes(".") ? src.name.slice(src.name.lastIndexOf(".")) : "";
      S.uploads[id] = { ...src, id, name: `${src.name.replace(/\.[^.]+$/, "")} (${v.trim.start.toFixed(1)}–${v.trim.end.toFixed(1)} s)${ext}`, duration: len, trimmedFrom: src.id, size: Math.round(src.size * (len / src.duration)), createdAt: Date.now(), trimOffset: v.trim.start };
      values[input.id] = { uploadId: id };
    } else values[input.id] = v;
  }
  const sid = uuid7();
  const seeds = seedsFor(f.values.seed, f.count);
  const now = Date.now();
  for (const seed of seeds) {
    const g = addGen({ sid, modelId, modeId: mode.id, values, seed, createdAt: now, state: "queued" });
    g.queuedSince = now;
    if (S.faults.fail) { g.failMode = "fail"; S.faults.fail = false; }
    else if (S.faults.timeout) { g.failMode = "timeout"; S.faults.timeout = false; }
    else if (S.faults.lose) { g.failMode = "lose"; S.faults.lose = false; }
  }
  f.phase = null;
  f.lastSubmission = sid;
  emit();
}

// An Admin changed the Model: Duration now tops out at 8 s (revision +1).
function applyModelUpdate(modelId) {
  const m = S.models[modelId];
  m.revision++;
  const f = S.forms[modelId];
  if (modelId === "ltx") {
    const d = m.inputs.find((i) => i.id === "duration");
    d.max = 8; d.wf = "8";
    if (Number(f.values.duration) > 8) { const v = { ...f.values }; delete v.duration; f.values = v; f.notes.duration = "Duration now goes up to 8 s, so your value was cleared."; }
  } else {
    const s = m.inputs.find((i) => i.id === "size");
    s.options = s.options.filter((o) => o.id !== "square");
    if (f.values.size === "square") { const v = { ...f.values }; delete v.size; f.values = v; f.notes.size = "Square is no longer offered, so your choice was cleared."; }
  }
}

// ---------- Generation actions ----------
export function cancelGen(id) {
  const g = S.gens.find((x) => x.id === id);
  if (!g) return;
  if (g.state === "queued") end(g, "cancelled");
  else if (g.state === "starting" || g.state === "running") { g.cancelRequested = true; g.cancelAt = Date.now(); }
  emit();
}
export function cancelSubmission(sid) { S.gens.filter((g) => g.submissionId === sid).forEach((g) => cancelGen(g.id)); }
export function deleteGen(id) {
  S.gens = S.gens.filter((g) => g.id !== id);
  if (S.dialog?.genId === id) S.dialog = null;
  toast("Generation deleted.");
}
export function deleteSubmission(sid) {
  const n = S.gens.filter((g) => g.submissionId === sid).length;
  S.gens = S.gens.filter((g) => g.submissionId !== sid);
  toast(n > 1 ? `${n} Generations deleted.` : "Generation deleted.");
}
export function dismissRemoved(id) { const g = S.gens.find((x) => x.id === id); if (g) g.dismissed = true; emit(); }

// "Reuse these settings": refill, drop Inputs the Mode no longer shows, clear Uploads that are gone.
export function reuse(genId) {
  const g = S.gens.find((x) => x.id === genId);
  const model = S.models[g.modelId];
  const mode = model.modes.find((m) => m.id === g.modeId);
  const f = S.forms[g.modelId];
  if (!mode) { toast("That Mode no longer exists.", "warn"); return; }
  f.modeId = mode.id; f.chosen = true; f.issues = {}; f.notes = {}; f.formError = null; f.phase = null;
  const values = {};
  const shown = new Set(shownInputs(model, mode).map(({ input }) => input.id));
  let dropped = 0;
  for (const [k, v] of Object.entries(g.values)) {
    if (!shown.has(k)) { dropped++; continue; }
    const input = model.inputs.find((i) => i.id === k);
    if (isUpload(input)) {
      const u = S.uploads[v.uploadId];
      if (!u || u.status === "removed") { f.notes[k] = "This Upload is gone. Add it again."; continue; }
      values[k] = { uploadId: v.uploadId, trim: u.duration ? { start: 0, end: u.duration } : undefined };
    } else if (input.type === "number" && (v < input.min || v > input.max)) { f.notes[k] = `Was ${v}; now between ${input.min} and ${input.max}.`; }
    else values[k] = v;
  }
  values.seed = g.seed;
  if (g.failure === "an Upload was removed by an administrator") { for (const [k, v] of Object.entries(values)) if (v?.uploadId && S.uploads[v.uploadId]?.status === "removed") f.issues[k] = "Removed by an administrator"; }
  f.values = values;
  f.count = 1;
  f.banner = `Settings from Generation …${g.id.slice(-6)} are back in the form${dropped ? `; ${dropped} no longer shown were dropped` : ""}. The seed is filled in so you can repeat it exactly; clear it for a new one.`;
  S.dialog = null;
  S.page = { name: "model", modelId: g.modelId };
  emit();
  window.scrollTo?.(0, 0);
}

// ---------- simulation menu ----------
export const SIMULATIONS = [
  { id: "fail", label: "Next Generation fails on the GPU", run: () => { S.faults.fail = true; toast("Armed: the next Generation will fail mid-run.", "warn"); } },
  { id: "timeout", label: "Next Generation times out", run: () => { S.faults.timeout = true; toast("Armed: the next Generation will hit the max run time.", "warn"); } },
  { id: "lose", label: "Next Generation loses its GPU (retried)", run: () => { S.faults.lose = true; toast("Armed: the next Generation's GPU will stop responding.", "warn"); } },
  { id: "stale", label: "An Admin updates this Model (409 on submit)", run: () => { S.faults.stale = true; toast("Armed: your next submit meets a newer Model revision.", "warn"); } },
  { id: "trimBusy", label: "Trim: server busy", run: () => { S.faults.trim = "busy"; toast("Armed: the next trim answers \"server busy\".", "warn"); } },
  { id: "trimFull", label: "Trim: storage is full", run: () => { S.faults.trim = "full"; toast("Armed: the next trim answers \"storage is full\".", "warn"); } },
  { id: "noServer", label: "Toggle: no server available", run: () => { S.faults.noServer = !S.faults.noServer; toast(S.faults.noServer ? "Both GPUs are now unreachable." : "GPUs are back.", "warn"); } },
  { id: "removeGen", label: "An Admin removes your latest Asset", run: () => {
    const g = [...S.gens].reverse().find((x) => x.state === "succeeded" && !x.removed);
    if (!g) return toast("Nothing finished to remove.", "warn");
    g.removed = true; if (S.dialog?.genId === g.id) S.dialog = null; emit();
  } },
  { id: "removeUpload", label: "An Admin removes an Upload in use", run: () => {
    const g = S.gens.find((x) => ACTIVE.includes(x.state) && Object.values(x.values).some((v) => v?.uploadId));
    const f = S.forms[S.page.modelId || "ltx"];
    const formUpload = Object.values(f.values).find((v) => v?.uploadId)?.uploadId;
    const uid = g ? Object.values(g.values).find((v) => v?.uploadId).uploadId : formUpload;
    if (!uid) return toast("No Upload in use. Add one to the form or start a Generation with one.", "warn");
    S.uploads[uid].status = "removed";
    for (const x of S.gens) if (ACTIVE.includes(x.state) && Object.values(x.values).some((v) => v?.uploadId === uid)) end(x, "failed", "an Upload was removed by an administrator");
    emit();
  } },
];

export function capsNow() { return capsState(S.gens, S.caps, S.now); }
export { SITE };
