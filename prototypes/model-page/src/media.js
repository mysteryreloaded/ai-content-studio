// PROTOTYPE media: synthetic clips inlined by build.ts as window.__MEDIA (base64)
// and played from data: URLs (the published page's sandbox allows them); sample
// images drawn on a canvas. Files the user picks play from blob: URLs.

const RAW = (typeof window !== "undefined" && window.__MEDIA) || {};
const urls = {};
const dataUrl = (key) => (RAW[key] ? (urls[key] ||= `data:${RAW[key].type};base64,${RAW[key].b64}`) : "");
const blobUrl = dataUrl;
const bytesOf = (key) => (RAW[key] ? Math.round(RAW[key].b64.length * 0.75) : 0);

// Asset stand-ins by aspect.
const CLIPS = { wide: ["aurora", "dusk", "fractal", "bloom"], tall: ["tall"], square: ["square"] };
let pick = 0;
export function assetClip(aspect) {
  const list = CLIPS[aspect] || CLIPS.wide;
  const key = list[pick++ % list.length];
  return { url: blobUrl(`${key}.mp4`), poster: dataUrl(`${key}.jpg`), aspect, key };
}
export function assetClipByKey(key, aspect) {
  return { url: blobUrl(`${key}.mp4`), poster: dataUrl(`${key}.jpg`), aspect, key };
}

// ---------- Sample Uploads ----------
function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")];
}
function rnd(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

function landscape(ctx, w, h, t) {
  // t: 0 sunrise, 0.5 noon, 1 dusk
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  const tops = ["#f6a96b", "#6fb3e8", "#3d2a6b"], bots = ["#fde2c4", "#d6ecfb", "#f08a5d"];
  const i = t < 0.25 ? 0 : t < 0.75 ? 1 : 2;
  sky.addColorStop(0, tops[i]); sky.addColorStop(1, bots[i]);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  const sx = w * (0.15 + 0.7 * t), sy = h * (0.62 - 0.45 * Math.sin(Math.PI * t));
  ctx.fillStyle = i === 2 ? "#ffd27a" : "#fff4c2";
  ctx.beginPath(); ctx.arc(sx, sy, h * 0.08, 0, Math.PI * 2); ctx.fill();
  const hills = [["#3c6e47", 0.72, 0.06], ["#28553a", 0.8, 0.05], ["#1b3d2b", 0.88, 0.04]];
  if (i === 2) hills.forEach((x, k) => (x[0] = ["#4a2f5e", "#36224a", "#241636"][k]));
  for (const [col, base, amp] of hills) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) ctx.lineTo(x, h * base + Math.sin(x / (w * 0.09) + base * 9) * h * amp);
    ctx.lineTo(w, h); ctx.fill();
  }
}

function figure(ctx, cx, base, s, colors) {
  const [skin, top, legs, hair] = colors;
  ctx.fillStyle = legs; ctx.fillRect(cx - s * 0.22, base - s * 1.0, s * 0.18, s * 1.0); ctx.fillRect(cx + s * 0.04, base - s * 1.0, s * 0.18, s * 1.0);
  ctx.fillStyle = top; roundRect(ctx, cx - s * 0.32, base - s * 1.85, s * 0.64, s * 0.95, s * 0.12); ctx.fill();
  ctx.fillRect(cx - s * 0.48, base - s * 1.75, s * 0.16, s * 0.75); ctx.fillRect(cx + s * 0.32, base - s * 1.75, s * 0.16, s * 0.75);
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(cx, base - s * 2.15, s * 0.27, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(cx, base - s * 2.22, s * 0.28, Math.PI, Math.PI * 2); ctx.fill();
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

const DRAW = {
  sunrise: { w: 1280, h: 720, draw: (ctx, w, h) => landscape(ctx, w, h, 0) },
  noon: { w: 1280, h: 720, draw: (ctx, w, h) => landscape(ctx, w, h, 0.5) },
  dusk: { w: 1280, h: 720, draw: (ctx, w, h) => landscape(ctx, w, h, 1) },
  face: {
    w: 768, h: 1024, draw: (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h * 0.4, 10, w / 2, h / 2, h * 0.7); g.addColorStop(0, "#335c67"); g.addColorStop(1, "#14262b");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#e2a47c"; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.45, w * 0.23, h * 0.22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(w * 0.43, h * 0.62, w * 0.14, h * 0.12);
      ctx.fillStyle = "#9e2a2b"; roundRect(ctx, w * 0.2, h * 0.72, w * 0.6, h * 0.4, 60); ctx.fill();
      ctx.fillStyle = "#2b1d14"; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.31, w * 0.25, h * 0.11, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1d1d1d"; [0.41, 0.59].forEach((x) => { ctx.beginPath(); ctx.ellipse(w * x, h * 0.44, 14, 9, 0, 0, Math.PI * 2); ctx.fill(); });
      ctx.strokeStyle = "#7a3b2e"; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(w / 2, h * 0.52, w * 0.07, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    },
  },
  painting: {
    w: 1280, h: 720, draw: (ctx, w, h) => {
      ctx.fillStyle = "#1c2f5e"; ctx.fillRect(0, 0, w, h);
      const r = rnd(7); const cols = ["#f2c14e", "#f78154", "#4d9de0", "#e15554", "#3bb273", "#7768ae", "#fef3c7"];
      for (let i = 0; i < 900; i++) {
        const x = r() * w, y = r() * h, a = Math.sin(x / 140) + Math.cos(y / 110);
        ctx.strokeStyle = cols[Math.floor(r() * cols.length)]; ctx.lineWidth = 6 + r() * 10; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * 30, y + Math.sin(a) * 30, x + Math.cos(a + 0.6) * 60, y + Math.sin(a + 0.6) * 60); ctx.stroke();
      }
    },
  },
  character: {
    w: 768, h: 1152, draw: (ctx, w, h) => {
      ctx.fillStyle = "#ece7df"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#d8d0c4"; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.93, w * 0.25, h * 0.025, 0, 0, Math.PI * 2); ctx.fill();
      figure(ctx, w / 2, h * 0.92, h * 0.36, ["#c98e6b", "#f4a261", "#264653", "#d9d9d9"]);
    },
  },
  sheet: {
    w: 1536, h: 896, draw: (ctx, w, h) => {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
      const colors = ["#c98e6b", "#c1121f", "#1d3557", "#e5e5e5"];
      [0.2, 0.5, 0.8].forEach((x, k) => {
        ctx.fillStyle = "#151515"; ctx.fillRect(w * x - w * 0.14, h * 0.06, w * 0.28, h * 0.88);
        figure(ctx, w * x, h * 0.9, h * 0.3 * (k === 1 ? 1 : 0.95), colors);
      });
    },
  },
};

const imgCache = {};
function drawSample(key) {
  if (imgCache[key]) return imgCache[key];
  const d = DRAW[key];
  const [c, ctx] = canvas(d.w, d.h);
  d.draw(ctx, d.w, d.h);
  const url = c.toDataURL("image/jpeg", 0.86);
  imgCache[key] = { url, w: d.w, h: d.h, size: Math.round(url.length * 0.75) };
  return imgCache[key];
}

export const SAMPLES = {
  image: [
    { key: "sunrise", name: "valley-sunrise.jpg", label: "Valley at sunrise" },
    { key: "noon", name: "valley-noon.jpg", label: "Valley at noon" },
    { key: "dusk", name: "valley-dusk.jpg", label: "Valley at dusk" },
    { key: "face", name: "portrait.jpg", label: "Portrait" },
    { key: "painting", name: "brushwork.jpg", label: "Brushwork" },
    { key: "character", name: "character.jpg", label: "Character" },
    { key: "sheet", name: "character-sheet.jpg", label: "Character sheet" },
  ],
  video: [{ key: "dance.mp4", name: "two-dancers.mp4", label: "Two dancers, 14 s", duration: 14, w: 1920, h: 1080, fakeSize: 29_800_000 }],
  audio: [{ key: "song.mp3", name: "little-tune.mp3", label: "Little tune, 12 s", duration: 12, fakeSize: 1_900_000 }],
};

// Which sample suits which Input, so "Use a sample" picks something sensible.
const PREFERRED = { start: "sunrise", middle: "noon", last: "dusk", sheet: "sheet", character: "character" };
export function sampleFor(input, modeId) {
  if (input.type === "image") {
    let key = PREFERRED[input.id] || "sunrise";
    if (input.id === "start" && ["lip", "flflip", "fmlYours"].includes(modeId)) key = "face";
    if (input.id === "start" && modeId === "style") key = "painting";
    return SAMPLES.image.find((s) => s.key === key);
  }
  return SAMPLES[input.type][0];
}

export function materialiseSample(sample, type) {
  if (type === "image") {
    const d = drawSample(sample.key);
    return { name: sample.name, url: d.url, w: d.w, h: d.h, size: Math.round(d.w * d.h * 0.42), mime: "image/jpeg" };
  }
  return { name: sample.name, url: blobUrl(sample.key), w: sample.w, h: sample.h, duration: sample.duration, size: sample.fakeSize || bytesOf(sample.key), mime: RAW[sample.key]?.type };
}
