// PROTOTYPE logic: the browser half of the shared rules. In the real studio,
// parseInputValues lives in packages/shared and runs again on the server.
import { SITE } from "./data.js";

export const ACTIVE = ["queued", "starting", "running", "saving"];
export const ENDED = ["succeeded", "failed", "cancelled"];

// Inputs a Mode shows, in the Model's Input order, with their state.
export function shownInputs(model, mode) {
  return model.inputs
    .filter((i) => mode.states[i.id] === "required" || mode.states[i.id] === "optional")
    .map((i) => ({ input: i, state: mode.states[i.id] }));
}

export const isUpload = (i) => i.type === "image" || i.type === "video" || i.type === "audio";

// The count picker shows whenever the Mode's Path holds the seed Input's fields,
// even when the seed itself is hidden. Every launch Mode has one.
export const hasSeed = (model, mode) => model.inputs.some((i) => i.type === "seed") && mode.states.seed !== undefined;

const MSG = {
  required: "Required",
  addImage: "Add an image",
  addVideo: "Add a video",
  addAudio: "Add an audio clip",
  uploading: "Still uploading",
  number: "Enter a number",
  wholeNumber: "Enter a whole number",
  between: (a, b, u = "") => `Between ${a}${u} and ${b}${u}`,
  steps: (s, m) => `Use steps of ${s} from ${m}`,
  tooLong: (n) => `At most ${n} characters`,
  points: "Click the person to replace",
  tooManyPoints: (n) => `At most ${n} points`,
  trimTooLong: (s) => `Trim to ${s} s or less`,
  trimTooShort: (s) => `Trim to at least ${s} s`,
};

// parseInputValues: the form's resolver and, on the server, the submit check.
export function parseInputValues(model, mode, values, uploads) {
  const issues = {};
  const out = {};
  for (const { input, state } of shownInputs(model, mode)) {
    const v = values[input.id];
    const req = state === "required";
    const blank = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (isUpload(input)) {
      if (!v?.uploadId) {
        if (req) issues[input.id] = input.type === "image" ? MSG.addImage : input.type === "video" ? MSG.addVideo : MSG.addAudio;
        continue;
      }
      const u = uploads[v.uploadId];
      if (!u || u.status === "removed") { issues[input.id] = "This Upload is gone. Add it again."; continue; }
      if (u.status === "failed") { issues[input.id] = u.error; continue; }
      if (u.status !== "ready") { issues[input.id] = MSG.uploading; continue; }
      const L = input.limits || {};
      if (L.trimmable && u.duration) {
        const len = trimLength(v, u);
        if (L.maxSec && len > L.maxSec + 0.01 && !u.unplayable) { issues[input.id] = MSG.trimTooLong(L.maxSec); continue; }
        if (L.minSec && len < L.minSec - 0.01) { issues[input.id] = MSG.trimTooShort(L.minSec); continue; }
      }
      out[input.id] = v;
      continue;
    }
    if (input.type === "points") {
      if (blank) { if (req) issues[input.id] = MSG.points; continue; }
      if (v.length > (input.max || 10)) { issues[input.id] = MSG.tooManyPoints(input.max || 10); continue; }
      out[input.id] = v;
      continue;
    }
    if (blank) { if (req) issues[input.id] = MSG.required; continue; }
    if (input.type === "text") {
      const s = input.multiline ? String(v) : String(v).replace(/\s*\n\s*/g, " ");
      if (!s.trim()) { if (req) issues[input.id] = MSG.required; continue; }
      if (input.maxLength && s.length > input.maxLength) { issues[input.id] = MSG.tooLong(input.maxLength); continue; }
      out[input.id] = s;
    } else if (input.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n)) { issues[input.id] = MSG.number; continue; }
      if (n < input.min || n > input.max) { issues[input.id] = MSG.between(input.min, input.max, input.unit ? ` ${input.unit}` : ""); continue; }
      const k = (n - input.min) / input.step;
      if (Math.abs(k - Math.round(k)) > 1e-9) { issues[input.id] = MSG.steps(input.step, input.min); continue; }
      out[input.id] = n;
    } else if (input.type === "seed") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) { issues[input.id] = MSG.wholeNumber; continue; }
      out[input.id] = n;
    } else if (input.type === "select") {
      if (!input.options.some((o) => o.id === v)) { issues[input.id] = "Pick one of the options"; continue; }
      out[input.id] = v;
    }
  }
  return { values: out, issues };
}

// Server-only checks the browser can't make (blocked words never ship to the browser).
export function blockedWordIssue(model, mode, values) {
  for (const { input } of shownInputs(model, mode)) {
    if (input.type !== "text" || !values[input.id]) continue;
    const s = String(values[input.id]).toLowerCase();
    if (SITE.blockedWords.some((w) => new RegExp(`\\b${w}\\b`).test(s))) return input.id;
  }
  return null;
}

export const trimLength = (v, u) => {
  if (!u?.duration) return 0;
  const t = v?.trim || { start: 0, end: u.duration };
  return Math.max(0, t.end - t.start);
};
export const isTrimmed = (v, u) => !!(u?.duration && v?.trim && (v.trim.start > 0.05 || v.trim.end < u.duration - 0.05));

// Caps: the concurrent cap counts queued/starting/running/saving; the daily cap
// counts the last 24 h of submissions, except failed ones and ones cancelled
// before they ran.
export function capsState(gens, caps, now) {
  const active = gens.filter((g) => ACTIVE.includes(g.state)).length;
  const day = gens.filter((g) => g.createdAt > now - 86400e3 && g.state !== "failed" && !(g.state === "cancelled" && !g.ran));
  const usedToday = day.length;
  const oldest = day.reduce((m, g) => Math.min(m, g.createdAt), Infinity);
  const leftDaily = Math.max(0, caps.daily - usedToday);
  const leftConcurrent = Math.max(0, caps.concurrent - active);
  return {
    active, usedToday, leftDaily, leftConcurrent,
    nextFree: oldest === Infinity ? null : oldest + 86400e3,
    maxCount: Math.max(0, Math.min(4, leftDaily, leftConcurrent)),
  };
}

export function capsRefusal(caps, count) {
  if (caps.leftDaily < count) return caps.leftDaily === 0 ? `You've used all of today's Generations. The next one frees at ${clock(caps.nextFree)}.` : `You have ${caps.leftDaily} left today.`;
  if (caps.leftConcurrent < count) return caps.leftConcurrent === 0 ? "You already have the most Generations under way at once. Wait for one to finish." : `You can start ${caps.leftConcurrent} more while these run.`;
  return null;
}

export function seedsFor(seed, count) {
  if (seed === undefined || seed === null || seed === "") return Array.from({ length: count }, () => Math.floor(Math.random() * 2 ** 40));
  return Array.from({ length: count }, (_, i) => Number(seed) + i);
}

// ---------- formatting ----------
export const clock = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
export function ago(t, now) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });
}
export const secs = (n) => {
  if (n === undefined || n === null || Number.isNaN(n)) return "";
  const s = Math.max(0, n);
  return s < 60 ? `${s.toFixed(s < 10 && s % 1 ? 1 : 0)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
};
export const tc = (n) => `${Math.floor(n / 60)}:${(n % 60).toFixed(1).padStart(4, "0")}`;
export const mb = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
export const shortId = (id) => id.slice(-6);
export const slugify = (s) => s.toLowerCase().replace(/[–—/]+/g, "-").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Readable Asset file name: model_mode_date_time_shortid.mp4
export function assetFileName(model, mode, g) {
  const d = new Date(g.createdAt);
  const p = (n) => String(n).padStart(2, "0");
  return `${model.slug}_${slugify(mode.name)}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}_${shortId(g.id)}.mp4`;
}

// UUIDv7-ish ids, good enough to look right.
let counter = 0;
export function uuid7(t = Date.now()) {
  const hex = t.toString(16).padStart(12, "0");
  const r = () => Math.floor(Math.random() * 16).toString(16);
  const rand = Array.from({ length: 19 }, r).join("");
  counter = (counter + 1) % 4096;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${counter.toString(16).padStart(3, "0")}-${"89ab"[Math.floor(Math.random() * 4)]}${rand.slice(0, 3)}-${rand.slice(3, 15)}`;
}

export const STAGE_LABEL = { starting: "starting", running: "generating", saving: "saving" };
