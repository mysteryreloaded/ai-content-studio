// PROTOTYPE shared parts: app chrome, Input controls, Upload + trim, points on a
// frame, Generation cards, dialogs. Each variant owns its own layout.
import { MODELS, SITE, ACCEPT } from "./data.js";
import {
  S, emit, useStore, go, openDetail, openTerms, closeDialog, acceptTerms, setValue, blurValue, setCount, submit,
  addUpload, refuseUpload, useSample, clearUpload, setTrim, cancelGen, cancelSubmission, deleteGen, deleteSubmission,
  dismissRemoved, reuse, capsNow, modeOf, stopWaiting,
} from "./store.js";
import { shownInputs, isUpload, ACTIVE, ENDED, STAGE_LABEL, clock, ago, secs, tc, mb, assetFileName, trimLength } from "./logic.js";
import { sampleFor } from "./media.js";

const { useState, useEffect, useRef, Fragment } = React;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- icons ----------
const PATHS = {
  plus: "M12 5v14M5 12h14", x: "M6 6l12 12M18 6L6 18", chev: "M6 9l6 6 6-6", left: "M15 18l-6-6 6-6", right: "M9 6l6 6-6 6",
  play: "M7 5l12 7-12 7z", pause: "M8 5v14M16 5v14", download: "M12 4v11m0 0l-4-4m4 4l4-4M5 20h14", copy: "M9 9h10v10H9zM5 15V5h10",
  image: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1 1 0 1 0 0-.01", video: "M4 6h11v12H4zM15 10l5-3v10l-5-3", audio: "M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3",
  text: "M5 6h14M5 12h14M5 18h9", alert: "M12 8v5M12 16.5v.5M10.3 4.3L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z",
  check: "M5 12l5 5 9-10", trash: "M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3", reuse: "M4 12a8 8 0 0 1 14-5.3M20 4v5h-5M20 12a8 8 0 0 1-14 5.3M4 20v-5h5",
  scissors: "M6 9a3 3 0 1 0 0-.01M6 18a3 3 0 1 0 0-.01M8.5 7.5L20 18M8.5 16.5L20 6", target: "M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5", sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4", stop: "M7 7h10v10H7z", dots: "M5 12h.01M12 12h.01M19 12h.01",
  clock: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", info: "M12 11v6M12 7.5v.5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
};
export function Icon({ name, size = 16, className = "" }) {
  return (
    <svg className={`ic ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
export const TYPE_ICON = { image: "image", video: "video", audio: "audio", points: "target", text: "text", number: "sliders", select: "sliders", seed: "sliders" };

// ---------- app chrome ----------
export function AppHeader() {
  const s = useStore();
  const p = s.page;
  const active = s.gens.filter((g) => ACTIVE.includes(g.state)).length;
  const [menu, setMenu] = useState(false);
  return (
    <header className="app-head">
      <button className="brand" onClick={() => go({ name: "home" })}><span className="brand-mark" aria-hidden="true" />{SITE.title}</button>
      <nav className="app-nav" aria-label="Studio">
        {MODELS.map((m) => (
          <button key={m.id} aria-current={p.name === "model" && p.modelId === m.id ? "page" : undefined} onClick={() => go({ name: "model", modelId: m.id })}>{m.name}</button>
        ))}
        <button aria-current={p.name === "gallery" ? "page" : undefined} onClick={() => go({ name: "gallery" })}>Gallery{active ? <span className="nav-count">{active}</span> : null}</button>
      </nav>
      <span className="spacer" />
      <div className="pop-anchor">
        <button className="avatar" aria-label="Account" aria-expanded={menu} onClick={() => setMenu(!menu)}>SP</button>
        {menu && (
          <div className="popover right" onMouseLeave={() => setMenu(false)}>
            <div className="stack tight"><strong>Sam Park</strong><span className="small muted">sam.park@example.com</span></div>
            <hr className="divider" />
            <button className="menu-item" onClick={() => setMenu(false)}>Account</button>
            <button className="menu-item" onClick={() => setMenu(false)}>Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="app-foot">
      <span>Contact · Report abuse:</span> <span className="selectable mono">{SITE.contact}</span> <CopyButton text={SITE.contact} label="Copy address" />
      <span className="spacer" />
      <span className="faint">Terms · Privacy</span>
    </footer>
  );
}

export function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn ghost xs" aria-label={label} title={label} onClick={(e) => {
      e.stopPropagation();
      const ok = () => { setDone(true); setTimeout(() => setDone(false), 1400); };
      try { navigator.clipboard.writeText(text).then(ok, ok); } catch { ok(); }
    }}><Icon name={done ? "check" : "copy"} size={13} /></button>
  );
}

export function ModelIntro({ model, size = "lg" }) {
  return (
    <div className={`model-intro ${size}`}>
      {size === "lg" ? <h1>{model.name}</h1> : <h2>{model.name}</h2>}
      <p className="muted">{model.description}</p>
      {(model.attribution || model.terms) && (
        <p className="attr small">
          {model.attribution}{model.attribution && model.terms ? " · " : ""}
          {model.terms && <button className="link" onClick={() => openTerms(model.id)}>Model terms</button>}
        </p>
      )}
    </div>
  );
}

export function CapsLine({ compact }) {
  useStore();
  const c = capsNow();
  const low = c.leftDaily <= 3;
  return (
    <p className={`caps small ${low || c.leftConcurrent === 0 ? "low" : ""}`}>
      <span className="tnum"><strong>{c.leftDaily}</strong> of {S.caps.daily} left today</span>
      <span className="sep">·</span>
      <span className="tnum"><strong>{c.leftConcurrent}</strong> more at once</span>
      {low && c.nextFree ? <><span className="sep">·</span><span>next frees at {clock(c.nextFree)}</span></> : null}
      {!compact && S.caps.overridden ? <><span className="sep">·</span><span className="faint">limits set for you by an Admin</span></> : null}
    </p>
  );
}

// ---------- fields ----------
export function Field({ modelId, input, state, children, compact, bare }) {
  const f = S.forms[modelId];
  const err = f.issues[input.id];
  const note = f.notes[input.id];
  return (
    <div className={`fld ${err ? "has-err" : ""}`} id={`fld-${modelId}-${input.id}`}>
      {!bare && (
        <div className="fld-label">
          <label htmlFor={`in-${modelId}-${input.id}`}>{input.label}</label>
          {state === "optional" && <span className="opt">Optional</span>}
        </div>
      )}
      {children}
      {input.help && !compact && <div className="hint">{input.help}</div>}
      {note && <div className="note-line"><Icon name="info" size={13} /> {note}</div>}
      {err && <div className="err" role="alert"><Icon name="alert" size={13} /> {err}</div>}
    </div>
  );
}

export function InputControl({ modelId, input, state, compact }) {
  const f = S.forms[modelId];
  const id = `in-${modelId}-${input.id}`;
  const v = f.values[input.id];
  const set = (x) => setValue(modelId, input.id, x);
  const blur = () => blurValue(modelId, input.id);
  if (input.type === "text") {
    const len = (v || "").length;
    return (
      <div className="text-wrap">
        <textarea id={id} className="textarea" rows={compact ? 2 : 3} placeholder={state === "optional" && input.wf ? input.wf : ""} value={v || ""} onChange={(e) => set(e.target.value)} onBlur={blur} />
        {input.maxLength && <span className={`counter tnum ${len > input.maxLength ? "over" : ""}`}>{len} / {input.maxLength}</span>}
      </div>
    );
  }
  if (input.type === "number") {
    return (
      <div className="row nowrap">
        <input id={id} className="input num" type="number" inputMode="decimal" placeholder={input.wf || ""} min={input.min} max={input.max} step={input.step} value={v ?? ""} onChange={(e) => set(e.target.value)} onBlur={blur} />
        {input.unit && <span className="muted">{input.unit}</span>}
        <span className="small faint tnum">{input.min}–{input.max}{input.step !== 1 ? `, steps of ${input.step}` : ""}</span>
      </div>
    );
  }
  if (input.type === "seed") {
    return (
      <div className="row nowrap">
        <input id={id} className="input num mono" inputMode="numeric" placeholder="Random" value={v ?? ""} onChange={(e) => set(e.target.value.replace(/[^0-9]/g, ""))} onBlur={blur} />
        {v !== undefined && v !== "" && <button className="btn ghost sm" onClick={() => set("")}>Random</button>}
      </div>
    );
  }
  if (input.type === "select") {
    const blank = v === undefined || v === "";
    return (
      <div className="seg" role="group" aria-labelledby={id} id={id}>
        {input.options.map((o) => {
          const isDefault = blank && input.wf === o.id;
          return (
            <button key={o.id} type="button" aria-pressed={v === o.id} className={isDefault ? "is-default" : ""} title={isDefault ? "Default" : undefined}
              onClick={() => set(v === o.id && state === "optional" ? "" : o.id)}>
              {o.label}{isDefault && <span className="def"> default</span>}
            </button>
          );
        })}
      </div>
    );
  }
  if (isUpload(input)) return <UploadControl modelId={modelId} input={input} state={state} compact={compact} />;
  if (input.type === "points") return <PointsControl modelId={modelId} input={input} />;
  return null;
}

export function FieldFor({ modelId, input, state, compact }) {
  return <Field modelId={modelId} input={input} state={state} compact={compact}><InputControl modelId={modelId} input={input} state={state} compact={compact} /></Field>;
}

// ---------- Uploads ----------
async function probe(file, type) {
  const url = URL.createObjectURL(file);
  const base = { name: file.name, url, size: file.size, mime: file.type };
  if (type === "image") {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return { ...base, refused: "Use a PNG, JPEG or WebP image." };
    const img = new Image();
    try { await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; }); }
    catch { return { ...base, refused: "This image couldn't be read. Try a PNG, JPEG or WebP." }; }
    return { ...base, w: img.naturalWidth, h: img.naturalHeight };
  }
  const el = document.createElement(type === "video" ? "video" : "audio");
  el.preload = "metadata"; el.muted = true;
  try {
    await new Promise((res, rej) => { el.onloadedmetadata = res; el.onerror = rej; el.src = url; setTimeout(() => rej(new Error("slow")), 8000); });
    return { ...base, duration: el.duration, w: el.videoWidth || undefined, h: el.videoHeight || undefined };
  } catch {
    return { ...base, unplayable: true };
  }
}

function checkLimits(input, meta) {
  const L = input.limits || {};
  const kind = input.type;
  if (meta.refused) return meta.refused;
  if (meta.size > SITE.maxUploadMB * 1e6) return `Files can be up to ${SITE.maxUploadMB} MB; this one is ${mb(meta.size)}.`;
  if (L.maxMB && meta.size > L.maxMB * 1e6) return `This ${kind} is ${mb(meta.size)}; the limit is ${L.maxMB} MB.`;
  if (L.maxLongSide && meta.w && Math.max(meta.w, meta.h) > L.maxLongSide) return `This ${kind} is ${meta.w}×${meta.h}; its long side can be at most ${L.maxLongSide} px.`;
  if (meta.unplayable && L.maxSec && meta.size > 60e6) return "This video can't be played in your browser, so it can't be trimmed here. Convert it to H.264 MP4 or try another browser.";
  if (!L.trimmable && L.maxSec && meta.duration > L.maxSec + 0.05) return `Use a clip of ${L.maxSec} s or less.`;
  if (L.minSec && meta.duration && meta.duration < L.minSec) return `Use a clip of at least ${L.minSec} s.`;
  return null;
}

export async function pickFile(modelId, input, file) {
  if (!file) return;
  const meta = await probe(file, input.type);
  const refusal = checkLimits(input, meta);
  if (refusal) return refuseUpload(modelId, input.id, refusal);
  addUpload(modelId, input, meta);
}

export function useUpload(modelId, input) {
  const v = S.forms[modelId].values[input.id];
  return { value: v, upload: v?.uploadId ? S.uploads[v.uploadId] : null };
}

export function UploadThumb({ upload, size = 48 }) {
  if (!upload) return null;
  if (upload.kind === "image") return <img className="thumb" src={upload.url} alt="" width={size} height={size} />;
  if (upload.kind === "video" && !upload.unplayable) return <video className="thumb" src={`${upload.url}#t=${(upload.trimOffset || 0) + 0.5}`} muted playsInline preload="metadata" width={size} height={size} />;
  return <span className={`thumb icon-thumb t-${upload.kind}`} style={{ width: size, height: size }}><Icon name={upload.kind === "audio" ? "audio" : "video"} size={Math.round(size * 0.45)} /></span>;
}

export function uploadMeta(u) {
  const bits = [mb(u.size)];
  if (u.w) bits.push(`${u.w}×${u.h}`);
  if (u.duration) bits.push(secs(u.duration));
  return bits.join(" · ");
}

export function UploadStatus({ upload }) {
  if (upload.status === "uploading") {
    const chunks = Math.max(1, Math.ceil(upload.size / 16e6));
    const done = Math.min(chunks, Math.floor(upload.sent / 16e6) + 1);
    return (
      <div className="up-progress">
        <div className="progress"><div style={{ width: `${(upload.sent / upload.size) * 100}%` }} /></div>
        <span className="small muted tnum">Uploading {Math.floor((upload.sent / upload.size) * 100)}%{chunks > 1 ? ` · part ${done} of ${chunks}` : ""}</span>
      </div>
    );
  }
  if (upload.status === "checking") return <span className="small muted">Checking the file…</span>;
  if (upload.status === "removed") return <span className="small err-text">Removed by an administrator</span>;
  if (upload.status === "failed") return null;
  return <span className="small muted tnum">{uploadMeta(upload)}{upload.trimmedFrom ? " · trimmed" : ""}{upload.unplayable ? " · can't preview here; used untrimmed" : ""}</span>;
}

export function FilePicker({ modelId, input, children, className = "", onPicked }) {
  const ref = useRef();
  const [over, setOver] = useState(false);
  return (
    <div className={`${className} ${over ? "over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pickFile(modelId, input, e.dataTransfer.files[0]); onPicked?.(); }}>
      <input ref={ref} type="file" hidden accept={ACCEPT[input.type]} id={`in-${modelId}-${input.id}`} onChange={(e) => { pickFile(modelId, input, e.target.files[0]); e.target.value = ""; onPicked?.(); }} />
      {children(() => ref.current.click())}
    </div>
  );
}

export function SampleButton({ modelId, input, onPicked, className = "btn ghost sm" }) {
  const sample = sampleFor(input, S.forms[modelId].modeId);
  return <button type="button" className={className} onClick={() => { useSample(modelId, input, sample); onPicked?.(); }}>Use a sample <span className="faint">({sample.label})</span></button>;
}

export function UploadControl({ modelId, input, state, compact, noTrim }) {
  useStore();
  const { value, upload } = useUpload(modelId, input);
  const L = input.limits || {};
  const limitText = [L.maxMB && `up to ${L.maxMB} MB`, L.maxLongSide && `${L.maxLongSide} px`, L.maxSec && `${L.trimmable ? "trim to " : ""}${L.minSec ? `${L.minSec}–` : ""}${L.maxSec} s`].filter(Boolean).join(", ");
  if (!upload) {
    return (
      <FilePicker modelId={modelId} input={input} className="drop">
        {(open) => (
          <>
            <button type="button" className="drop-main" onClick={open}>
              <Icon name={input.type} size={20} />
              <span><strong>Choose {input.type === "image" ? "an image" : input.type === "video" ? "a video" : "an audio file"}</strong><span className="small muted"> or drop it here · {limitText}</span></span>
            </button>
            <SampleButton modelId={modelId} input={input} />
          </>
        )}
      </FilePicker>
    );
  }
  return (
    <div className={`upload-card ${upload.status}`}>
      <div className="row nowrap">
        <UploadThumb upload={upload} size={compact ? 40 : 52} />
        <div className="grow stack tight">
          <span className="ellipsis" title={upload.name}>{upload.name}</span>
          <UploadStatus upload={upload} />
        </div>
        <FilePicker modelId={modelId} input={input}>
          {(open) => <button type="button" className="btn ghost sm" onClick={open}>Replace</button>}
        </FilePicker>
        <button type="button" className="btn ghost sm" aria-label={`Remove ${input.label}`} onClick={() => clearUpload(modelId, input.id)}><Icon name="x" size={14} /></button>
      </div>
      {!noTrim && L.trimmable && upload.duration && upload.status !== "removed" ? <Trimmer modelId={modelId} input={input} value={value} upload={upload} /> : null}
    </div>
  );
}

// ---------- trim on a local player ----------
function bars(seed, n) { let s = seed; return Array.from({ length: n }, () => ((s = (s * 9301 + 49297) % 233280) / 233280)); }

export function Trimmer({ modelId, input, value, upload, lane }) {
  const L = input.limits || {};
  const dur = upload.duration;
  const trim = value?.trim || { start: 0, end: dur };
  const trimRef = useRef(trim); trimRef.current = trim;
  const media = useRef(); const track = useRef();
  const [playing, setPlaying] = useState(false);
  const [head, setHead] = useState(trim.start);
  const minLen = Math.max(0.5, L.minSec || 0);
  const maxLen = L.maxSec || dur;
  const len = trim.end - trim.start;

  const apply = (start, end) => {
    start = Math.round(start * 10) / 10; end = Math.round(end * 10) / 10;
    setTrim(modelId, input.id, { start, end });
  };
  const move = (which, t) => {
    let { start, end } = trimRef.current;
    if (which === "start") { start = clamp(t, 0, end - minLen); if (end - start > maxLen) end = start + maxLen; }
    else { end = clamp(t, start + minLen, dur); if (end - start > maxLen) start = end - maxLen; }
    apply(start, end);
    if (media.current) { media.current.currentTime = which === "start" ? start : end; setHead(media.current.currentTime); }
  };
  const drag = (which) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const rect = track.current.getBoundingClientRect();
    const t0 = ((e.clientX - rect.left) / rect.width) * dur;
    const s0 = trimRef.current;
    const onMove = (ev) => {
      const t = ((ev.clientX - rect.left) / rect.width) * dur;
      if (which === "range") {
        const l = s0.end - s0.start;
        const start = clamp(s0.start + (t - t0), 0, dur - l);
        apply(start, start + l);
        if (media.current) media.current.currentTime = start;
      } else move(which, t);
    };
    const up = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", up);
  };
  const key = (which) => (e) => {
    const d = e.shiftKey ? 1 : 0.1;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); move(which, trimRef.current[which] - d); }
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); move(which, trimRef.current[which] + d); }
  };
  useEffect(() => {
    const m = media.current; if (!m) return;
    const onTime = () => { setHead(m.currentTime); if (m.currentTime >= trimRef.current.end) { m.currentTime = trimRef.current.start; } };
    m.addEventListener("timeupdate", onTime);
    return () => m.removeEventListener("timeupdate", onTime);
  }, []);
  const toggle = () => {
    const m = media.current; if (!m) return;
    if (playing) { m.pause(); setPlaying(false); return; }
    if (m.currentTime < trim.start || m.currentTime >= trim.end) m.currentTime = trim.start;
    m.play().then(() => setPlaying(true), () => setPlaying(false));
  };
  const pct = (t) => `${(t / dur) * 100}%`;
  const waves = bars(upload.name.length * 97 + 13, 64);
  const over = dur > maxLen + 0.05;
  return (
    <div className={`trim ${lane ? "lane" : ""}`}>
      {upload.kind === "video" && !lane && <video ref={media} className="trim-video" src={upload.url} muted={false} playsInline preload="auto" onLoadedData={(e) => { e.target.currentTime = trim.start; }} />}
      {upload.kind === "video" && lane && <video ref={media} hidden src={upload.url} playsInline preload="auto" />}
      {upload.kind === "audio" && <audio ref={media} src={upload.url} preload="auto" />}
      <div className="row nowrap trim-row">
        <button type="button" className="btn ghost sm icon-only" aria-label={playing ? "Pause" : "Play the selection"} onClick={toggle}><Icon name={playing ? "pause" : "play"} size={14} /></button>
        <div className={`trim-track ${upload.kind}`} ref={track}>
          <div className="trim-bg">
            {upload.kind === "audio" ? waves.map((h, i) => <span key={i} style={{ height: `${20 + h * 75}%` }} />) : Array.from({ length: Math.floor(dur) + 1 }, (_, i) => <span key={i} className="tick" style={{ left: pct(i) }} />)}
          </div>
          <div className="trim-sel" style={{ left: pct(trim.start), width: pct(len) }} onPointerDown={drag("range")}>
            <span className="trim-h start" role="slider" tabIndex={0} aria-label="Trim start" aria-valuemin={0} aria-valuemax={dur} aria-valuenow={trim.start} aria-valuetext={tc(trim.start)} onPointerDown={drag("start")} onKeyDown={key("start")} />
            <span className="trim-h end" role="slider" tabIndex={0} aria-label="Trim end" aria-valuemin={0} aria-valuemax={dur} aria-valuenow={trim.end} aria-valuetext={tc(trim.end)} onPointerDown={drag("end")} onKeyDown={key("end")} />
          </div>
          <span className="trim-head" style={{ left: pct(head) }} />
        </div>
      </div>
      <div className="row small trim-info">
        <Icon name="scissors" size={13} />
        <span className="tnum">Using {tc(trim.start)}–{tc(trim.end)} · <strong>{len.toFixed(1)} s</strong> of {dur.toFixed(1)} s</span>
        <span className="faint">{over ? `pick up to ${maxLen} s` : len < dur - 0.05 ? "trimmed on the server when you press Generate" : `up to ${maxLen} s`}</span>
      </div>
    </div>
  );
}

// ---------- points on the first frame of the trimmed video ----------
const SIZE_RATIO = { landscape: 832 / 480, portrait: 480 / 832, square: 1, wide: 16 / 9, tall: 9 / 16 };

function useFrame(upload, t) {
  const [frame, setFrame] = useState(null);
  useEffect(() => {
    if (!upload || upload.unplayable) return;
    let alive = true;
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = upload.url;
    const grab = () => {
      const c = document.createElement("canvas");
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext("2d").drawImage(v, 0, 0);
      if (alive) setFrame({ url: c.toDataURL("image/jpeg", 0.85), w: v.videoWidth, h: v.videoHeight });
    };
    v.addEventListener("loadeddata", () => { v.currentTime = Math.min(t + 0.04, (v.duration || t + 1) - 0.05); });
    v.addEventListener("seeked", grab, { once: true });
    return () => { alive = false; v.src = ""; };
  }, [upload?.id, upload?.url, t]);
  return frame;
}

export function cropRect(srcRatio, targetRatio) {
  if (srcRatio > targetRatio) { const w = targetRatio / srcRatio; return { x: (1 - w) / 2, y: 0, w, h: 1 }; }
  const h = srcRatio / targetRatio; return { x: 0, y: (1 - h) / 2, w: 1, h };
}

export function PointsControl({ modelId, input, big }) {
  useStore();
  const f = S.forms[modelId];
  const model = S.models[modelId];
  const srcInput = model.inputs.find((i) => i.id === input.of);
  const srcVal = f.values[input.of];
  const up = srcVal?.uploadId ? S.uploads[srcVal.uploadId] : null;
  const ready = up && up.status === "ready";
  const t = srcVal?.trim?.start || 0;
  const frame = useFrame(ready ? up : null, t);
  const [msg, setMsg] = useState(null);
  const points = f.values[input.id] || [];
  if (!up) return <div className="points-empty"><Icon name="target" size={18} /> Add the {srcInput.label.toLowerCase()} first; then click the person to replace on its first frame.</div>;
  if (up.unplayable) return <div className="points-empty">This video can't be shown in your browser, so you can't pick who to replace. Convert it to H.264 MP4 or try another browser.</div>;
  if (!ready || !frame) return <div className="points-empty"><span className="spinner" /> Getting the first frame…</div>;
  const sizeInput = model.inputs.find((i) => i.id === input.cropFrom);
  const sizeVal = f.values[input.cropFrom] || sizeInput?.wf;
  const crop = cropRect(frame.w / frame.h, SIZE_RATIO[sizeVal] || frame.w / frame.h);
  const click = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const hit = points.findIndex((p) => Math.hypot((p.x - x) * r.width, (p.y - y) * r.height) < 14);
    if (hit >= 0) { setValue(modelId, input.id, points.filter((_, i) => i !== hit)); setMsg(null); return; }
    if (x < crop.x || x > crop.x + crop.w || y < crop.y || y > crop.y + crop.h) { setMsg("Click inside the outlined area: only that part of the video is kept."); return; }
    if (points.length >= (input.max || 10)) { setMsg(`At most ${input.max || 10} points. Click a point to remove it.`); return; }
    setMsg(null);
    setValue(modelId, input.id, [...points, { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }]);
  };
  return (
    <div className={`points ${big ? "big" : ""}`}>
      <div className="points-frame" style={{ aspectRatio: `${frame.w} / ${frame.h}` }} onClick={click} role="application" aria-label="First frame: click the person to replace">
        <img src={frame.url} alt="" draggable={false} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path fillRule="evenodd" fill="rgb(0 0 0 / 0.55)" d={`M0 0H100V100H0Z M${crop.x * 100} ${crop.y * 100}h${crop.w * 100}v${crop.h * 100}h${-crop.w * 100}Z`} />
          <rect x={crop.x * 100} y={crop.y * 100} width={crop.w * 100} height={crop.h * 100} fill="none" stroke="white" strokeWidth="0.6" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map((p, i) => <span key={i} className="pt" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}>{i + 1}</span>)}
      </div>
      <div className="row small">
        <span className="muted tnum">{points.length ? `${points.length} point${points.length > 1 ? "s" : ""}` : "No points yet"} · frame at {tc(t)}</span>
        {points.length > 0 && <button className="btn ghost xs" onClick={() => setValue(modelId, input.id, [])}>Clear</button>}
      </div>
      {msg && <div className="note-line warn"><Icon name="alert" size={13} /> {msg}</div>}
    </div>
  );
}

// ---------- count + Generate ----------
export function CountPicker({ modelId, label = "Generations" }) {
  useStore();
  const f = S.forms[modelId];
  const c = capsNow();
  return (
    <div className="count-pick">
      <span className="small muted" id={`cnt-${modelId}`}>{label}</span>
      <div className="seg" role="group" aria-labelledby={`cnt-${modelId}`}>
        {[1, 2, 3, 4].map((n) => (
          <button key={n} type="button" aria-pressed={f.count === n} className={n > c.maxCount ? "over-cap" : ""} title={n > c.maxCount ? "More than your Caps allow right now" : undefined} onClick={() => setCount(modelId, n)}>{n}</button>
        ))}
      </div>
    </div>
  );
}

export function pendingUploads(modelId) {
  const f = S.forms[modelId];
  const mode = modeOf(modelId);
  return shownInputs(S.models[modelId], mode).filter(({ input }) => isUpload(input) && ["uploading", "checking"].includes(S.uploads[f.values[input.id]?.uploadId]?.status)).length;
}

export function GenerateButton({ modelId, className = "" }) {
  useStore();
  const f = S.forms[modelId];
  const label = f.phase === "waiting" ? "Waiting for Uploads…" : f.phase === "preparing" ? "Preparing video…" : f.phase === "sending" ? "Sending…" : `Generate${f.count > 1 ? ` ${f.count}` : ""}`;
  return (
    <button type="button" className={`btn primary go ${className}`} disabled={!!f.phase} aria-busy={!!f.phase} onClick={() => submit(modelId)}>
      {f.phase && <span className="spinner" />}{label}
    </button>
  );
}

export function SubmitNotes({ modelId }) {
  useStore();
  const f = S.forms[modelId];
  const n = pendingUploads(modelId);
  return (
    <>
      {f.phase === "preparing" && <p className="small muted">Trimming your video on the server. This can take up to a minute and a half.</p>}
      {f.phase === "waiting" && <p className="small muted">Your Generation starts as soon as {n > 1 ? `${n} Uploads finish` : "your Upload finishes"}. <button className="link" onClick={() => stopWaiting(modelId)}>Don't start</button></p>}
      {n > 0 && !f.phase && <p className="small muted"><span className="spinner" /> {n} Upload{n > 1 ? "s" : ""} still in progress. You can keep filling the form, or press Generate now.</p>}
      {f.formError && <p className="err" role="alert"><Icon name="alert" size={13} /> {f.formError}</p>}
    </>
  );
}

export function Banner({ modelId }) {
  useStore();
  const f = S.forms[modelId];
  if (!f.banner) return null;
  return (
    <div className="banner" role="status">
      <Icon name="info" size={15} /><span className="grow">{f.banner}</span>
      <button className="btn ghost xs" aria-label="Dismiss" onClick={() => { f.banner = null; emit(); }}><Icon name="x" size={13} /></button>
    </div>
  );
}

// ---------- Generations ----------
export function genStatus(g) {
  if (g.cancelRequested) return { pill: "Cancelling…", tone: "warn", text: "waiting for the GPU to stop" };
  switch (g.state) {
    case "queued": return { pill: "Queued", tone: "", text: g.note || "waiting for a free GPU" };
    case "starting": return { pill: "Running", tone: "accent", text: "starting · sending your files" };
    case "running": return { pill: "Running", tone: "accent", text: `generating · step ${g.step} / ${g.steps}${g.pct != null ? ` · ${Math.floor(g.pct * 100)}%` : ""}` };
    case "saving": return { pill: "Running", tone: "accent", text: "saving" };
    case "succeeded": return { pill: "Done", tone: "ok", text: g.runFor ? `took ${secs(g.runFor)}` : "" };
    case "failed": return { pill: "Failed", tone: "err", text: g.failure };
    case "cancelled": return { pill: "Cancelled", tone: "", text: "" };
    default: return { pill: g.state, tone: "", text: "" };
  }
}

export function Progress({ g, thin }) {
  if (!["starting", "running", "saving"].includes(g.state) || g.cancelRequested) return null;
  const indet = g.state === "starting" || (g.state === "running" && g.pct == null);
  const w = g.state === "saving" ? 99 : (g.pct || 0) * 100;
  return <div className={`progress ${thin ? "thin" : ""} ${indet ? "indet" : ""}`} role="progressbar" aria-valuenow={indet ? undefined : Math.floor(w)} aria-valuemin={0} aria-valuemax={100}><div style={indet ? undefined : { width: `${w}%` }} /></div>;
}

export function AssetVideo({ g, className = "", autoPlay }) {
  return <video className={`asset ${className}`} src={g.asset.url} poster={g.asset.poster} controls playsInline preload="metadata" loop muted={!!autoPlay} autoPlay={!!autoPlay} />;
}

export function downloadAsset(g) {
  const model = S.models[g.modelId];
  const mode = model.modes.find((m) => m.id === g.modeId);
  toastDownload(assetFileName(model, mode, g));
}
function toastDownload(name) {
  S.toasts = [...S.toasts, { id: Math.random(), text: `Downloads as ${name}. Downloads are blocked in this preview.`, tone: "info", at: Date.now(), ttl: 6000 }];
  emit();
}

export function AiNote() { return <span className="ai-note small">AI-generated: say so when you share it.</span>; }

export function ConfirmDelete({ onConfirm, label = "Delete", small = true }) {
  const [ask, setAsk] = useState(false);
  if (!ask) return <button className={`btn ghost ${small ? "sm" : ""}`} onClick={(e) => { e.stopPropagation(); setAsk(true); }} aria-label={label} title={label}><Icon name="trash" size={14} />{small ? "" : ` ${label}`}</button>;
  return (
    <span className="confirm" onClick={(e) => e.stopPropagation()}>
      <span className="small">{label}?</span>
      <button className="btn danger xs" onClick={onConfirm}>Delete</button>
      <button className="btn ghost xs" onClick={() => setAsk(false)}>Keep</button>
    </span>
  );
}

export function RemovedCard({ g, className = "" }) {
  return (
    <div className={`gen removed ${className}`}>
      <div className="gen-media" style={{ aspectRatio: aspectCss(g.aspect) }}><div className="ph"><div className="ph-center"><Icon name="alert" size={20} /><span>Removed by an administrator</span></div></div></div>
      <div className="gen-foot"><span className="small muted">This Generation broke the studio's rules.</span><span className="spacer" /><button className="btn ghost xs" onClick={() => dismissRemoved(g.id)}>Dismiss</button></div>
    </div>
  );
}

export const aspectCss = (a) => (a === "tall" ? "9 / 16" : a === "square" ? "1 / 1" : "16 / 9");

export function GenCard({ g, tile, className = "" }) {
  if (g.dismissed) return null;
  if (g.removed) return <RemovedCard g={g} className={className} />;
  const st = genStatus(g);
  const active = ACTIVE.includes(g.state);
  return (
    <div className={`gen ${g.state} a-${g.aspect} ${tile ? "tile" : ""} ${className}`}>
      <div className="gen-media" style={{ aspectRatio: aspectCss(g.aspect) }}>
        {g.state === "succeeded" ? <AssetVideo g={g} /> : (
          <div className={`ph ${active ? "live" : ""}`} onClick={() => !active && openDetail(g.id)}>
            <div className="ph-center">
              {g.state === "failed" ? <Icon name="alert" size={22} /> : g.state === "cancelled" ? <Icon name="stop" size={20} /> : null}
              {active && g.state === "running" && g.pct != null ? <span className="big-pct tnum">{Math.floor(g.pct * 100)}%</span> : null}
              {active && !(g.state === "running" && g.pct != null) ? <span className="stage">{g.cancelRequested ? "cancelling" : g.state === "queued" ? "queued" : STAGE_LABEL[g.state]}</span> : null}
              {g.state === "failed" && <span className="fail-msg">{g.failure}</span>}
            </div>
            {active && <div className="ph-bottom"><Progress g={g} thin /></div>}
          </div>
        )}
      </div>
      <div className="gen-foot">
        <span className={`pill ${st.tone}`}>{st.pill}</span>
        <span className="small muted ellipsis grow tnum" title={st.text}>{st.text}</span>
        {active && g.state !== "saving" && !g.cancelRequested && <button className="btn ghost sm" onClick={() => cancelGen(g.id)}>Cancel</button>}
        {g.state === "succeeded" && <button className="btn ghost sm" aria-label="Download" title="Download" onClick={() => downloadAsset(g)}><Icon name="download" size={14} /></button>}
        {!active && <button className="btn ghost sm" aria-label="Details" title="Details" onClick={() => openDetail(g.id)}><Icon name="expand" size={14} /></button>}
        {ENDED.includes(g.state) && <ConfirmDelete onConfirm={() => deleteGen(g.id)} label="Delete this Generation" />}
      </div>
      {g.state === "failed" && <div className="gen-id small faint mono">id …{g.id.slice(-12)} <CopyButton text={g.id} label="Copy Generation id" /></div>}
    </div>
  );
}

// The words of a Generation: its first text Input with a value.
export function promptText(g) {
  const model = S.models[g.modelId];
  const t = model.inputs.find((i) => i.type === "text" && typeof g.values[i.id] === "string" && g.values[i.id].trim());
  return t ? g.values[t.id] : "";
}
export function PromptLine({ g, className = "sub-prompt" }) {
  const text = promptText(g);
  if (text) return <p className={className} title={text}>{text}</p>;
  const model = S.models[g.modelId];
  const mode = model.modes.find((m) => m.id === g.modeId);
  const def = model.inputs.find((i) => i.type === "text" && i.wf && mode?.states[i.id]);
  return <p className={`${className} faint`}>{def ? `Default prompt: ${def.wf}` : "No prompt"}</p>;
}

export function submissionsOf(gens) {
  const map = new Map();
  for (const g of gens) { if (!map.has(g.submissionId)) map.set(g.submissionId, []); map.get(g.submissionId).push(g); }
  return [...map.values()].sort((a, b) => b[0].createdAt - a[0].createdAt);
}

export function UsedUploads({ g, size = 22 }) {
  const ups = Object.values(g.values).filter((v) => v?.uploadId).map((v) => S.uploads[v.uploadId]).filter(Boolean);
  if (!ups.length) return null;
  return <span className="used-ups">{ups.map((u) => <span key={u.id} title={u.name}><UploadThumb upload={u} size={size} /></span>)}</span>;
}

export function SubmissionGroup({ gens, showModel, className = "", cardsClass = "" }) {
  const visible = gens.filter((g) => !g.dismissed);
  if (!visible.length) return null;
  const first = gens[0];
  const model = S.models[first.modelId];
  const mode = model.modes.find((m) => m.id === first.modeId);
  const nActive = gens.filter((g) => ACTIVE.includes(g.state) && !g.cancelRequested).length;
  const allEnded = gens.every((g) => ENDED.includes(g.state));
  return (
    <section className={`sub ${className}`}>
      <div className="sub-head">
        <strong>{mode?.name || "Deleted Mode"}</strong>
        {showModel && <span className="muted">· {model.name}</span>}
        <UsedUploads g={first} />
        <span className="small faint">{ago(first.createdAt, S.now)}{gens.length > 1 ? ` · ${gens.length} Generations` : ""}</span>
        <span className="spacer" />
        {nActive > 1 && <button className="btn ghost sm" onClick={() => cancelSubmission(first.submissionId)}>Cancel all</button>}
        {allEnded && gens.length > 1 && <ConfirmDelete small={false} label="Delete all" onConfirm={() => deleteSubmission(first.submissionId)} />}
      </div>
      <PromptLine g={first} />
      <div className={`sub-cards n${visible.length} ${cardsClass}`}>{gens.map((g) => <GenCard key={g.id} g={g} />)}</div>
    </section>
  );
}

// ---------- dialogs ----------
export function Dialogs() {
  const s = useStore();
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && s.dialog && !(s.dialog.type === "terms" && !s.dialog.readOnly)) closeDialog(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!s.dialog) return null;
  if (s.dialog.type === "terms") return <TermsDialog modelId={s.dialog.modelId} readOnly={s.dialog.readOnly} />;
  if (s.dialog.type === "detail") return <DetailDialog genId={s.dialog.genId} />;
  return null;
}

function TermsDialog({ modelId, readOnly }) {
  const m = S.models[modelId];
  return (
    <div className="scrim" role="presentation">
      <div className="modal terms" role="dialog" aria-modal="true" aria-labelledby="terms-title">
        <header><h2 id="terms-title">{readOnly ? `${m.name}: Model terms` : `Before you use ${m.name}`}</h2></header>
        <div className="body stack">
          <p>{m.terms.text}</p>
          <p><a href={m.terms.licenseUrl} target="_blank" rel="noopener noreferrer">Read the model license</a></p>
          {m.attribution && <p className="small muted">{m.attribution}</p>}
          {!readOnly && <p className="small muted">You agree once. If these terms change, we'll ask again.</p>}
        </div>
        <footer>
          {readOnly ? <button className="btn primary" onClick={closeDialog}>Close</button> : (
            <>
              <button className="btn" onClick={() => go({ name: "home" })}>Back to Models</button>
              <button className="btn primary" onClick={() => acceptTerms(modelId)}>I agree</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function valueText(input, v, upload) {
  if (input.type === "select") return input.options.find((o) => o.id === v)?.label || v;
  if (input.type === "number") return `${v}${input.unit ? ` ${input.unit}` : ""}`;
  return String(v);
}

function DetailDialog({ genId }) {
  const g = S.gens.find((x) => x.id === genId);
  if (!g) return null;
  const model = S.models[g.modelId];
  const mode = model.modes.find((m) => m.id === g.modeId);
  const st = genStatus(g);
  const rows = shownInputs(model, mode);
  return (
    <div className="scrim" onClick={closeDialog} role="presentation">
      <div className="modal wide detail" role="dialog" aria-modal="true" aria-labelledby="det-title" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2 id="det-title" className="grow">{mode.name} <span className="muted">· {model.name}</span></h2>
          <button className="btn ghost sm" aria-label="Close" onClick={closeDialog}><Icon name="x" /></button>
        </header>
        <div className="body detail-grid">
          <div className="stack">
            <div className="gen-media big" style={{ aspectRatio: aspectCss(g.aspect) }}>
              {g.state === "succeeded" ? <AssetVideo g={g} /> : <div className="ph"><div className="ph-center"><span className={`pill ${st.tone}`}>{st.pill}</span>{g.failure && <span className="fail-msg">{g.failure}</span>}</div></div>}
            </div>
            {g.state === "succeeded" && <div className="row"><button className="btn" onClick={() => downloadAsset(g)}><Icon name="download" size={14} /> Download</button><AiNote /></div>}
            {model.attribution && <p className="small muted">{model.attribution}</p>}
          </div>
          <div className="stack">
            <dl className="settings">
              {rows.map(({ input }) => {
                const v = g.values[input.id];
                const blank = v === undefined || v === "" || (Array.isArray(v) && !v.length);
                if (input.type === "seed") return null;
                return (
                  <Fragment key={input.id}>
                    <dt>{input.label}</dt>
                    <dd>
                      {blank ? <span className="faint">{input.wf ? `Default (${input.type === "select" ? input.options.find((o) => o.id === input.wf)?.label : input.wf}${input.unit ? ` ${input.unit}` : ""})` : "Not set"}</span>
                        : isUpload(input) ? <UploadValue upload={S.uploads[v.uploadId]} />
                        : input.type === "points" ? <PointsValue g={g} input={input} />
                        : input.type === "text" ? <span className="pre">{v}</span>
                        : valueText(input, v)}
                    </dd>
                  </Fragment>
                );
              })}
              <dt>Seed</dt><dd className="mono tnum">{g.seed}</dd>
            </dl>
            <dl className="settings meta">
              <dt>Submitted</dt><dd>{new Date(g.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</dd>
              {g.runFor ? <><dt>Ran for</dt><dd className="tnum">{secs(g.runFor)}</dd></> : null}
              <dt>Generation</dt><dd className="mono small wrap-anywhere">{g.id} <CopyButton text={g.id} label="Copy Generation id" /></dd>
            </dl>
            <div className="row">
              <button className="btn primary" onClick={() => reuse(g.id)}><Icon name="reuse" size={14} /> Reuse these settings</button>
              {ENDED.includes(g.state) && <ConfirmDelete small={false} label="Delete" onConfirm={() => deleteGen(g.id)} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadValue({ upload }) {
  if (!upload) return <span className="faint">Upload deleted</span>;
  const orig = upload.trimmedFrom && S.uploads[upload.trimmedFrom];
  return (
    <span className="row nowrap">
      <UploadThumb upload={upload} size={36} />
      <span className="stack tight grow">
        <span className="ellipsis">{upload.name}</span>
        <span className="small muted">{upload.status === "removed" ? "Removed by an administrator" : uploadMeta(upload)}{orig ? ` · trimmed from ${orig.name}` : ""}</span>
      </span>
    </span>
  );
}

function PointsValue({ g, input }) {
  const src = S.uploads[g.values[input.of]?.uploadId];
  const pts = g.values[input.id];
  const frame = useFrame(src, 0);
  if (!frame) return <span>{pts.length} point{pts.length > 1 ? "s" : ""}</span>;
  return (
    <span className="points-mini" style={{ aspectRatio: `${frame.w} / ${frame.h}` }}>
      <img src={frame.url} alt="" />
      {pts.map((p, i) => <span key={i} className="pt sm" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />)}
    </span>
  );
}

export function Toasts() {
  const s = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {s.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span className="grow">{t.text}</span>
          {t.genId && <button className="btn ghost xs" onClick={() => openDetail(t.genId)}>View</button>}
        </div>
      ))}
    </div>
  );
}

// ---------- pages shared by A and C ----------
export function ModelsHome() {
  useStore();
  return (
    <main className="page home">
      <h1>Models</h1>
      <div className="model-cards">
        {MODELS.map((m) => {
          const model = S.models[m.id];
          return (
            <button key={m.id} className="model-card" onClick={() => go({ name: "model", modelId: m.id })}>
              <img src={(m.id === "ltx" ? S.gens.find((g) => g.modelId === "ltx" && g.asset)?.asset.poster : S.gens.find((g) => g.modelId === "wan" && g.asset)?.asset.poster) || ""} alt="" className="mc-img" />
              <span className="stack tight">
                <strong className="mc-name">{model.name}</strong>
                <span className="muted">{model.description}</span>
                <span className="small faint">{model.modes.length === 1 ? model.modes[0].name : `${model.modes.length} Modes`}{model.attribution ? ` · ${model.attribution}` : ""}</span>
              </span>
            </button>
          );
        })}
      </div>
    </main>
  );
}

const STATE_FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "active", label: "Under way", test: (g) => ACTIVE.includes(g.state) },
  { id: "done", label: "Finished", test: (g) => g.state === "succeeded" },
  { id: "other", label: "Failed or cancelled", test: (g) => g.state === "failed" || g.state === "cancelled" },
];
export function GalleryPage() {
  const s = useStore();
  const [model, setModel] = useState("all");
  const [st, setSt] = useState("all");
  const test = STATE_FILTERS.find((x) => x.id === st).test;
  const subs = submissionsOf(s.gens.filter((g) => !g.dismissed)).filter((gs) => (model === "all" || gs[0].modelId === model) && gs.some(test));
  const day = (t) => { const d = new Date(t); const today = new Date(s.now); if (d.toDateString() === today.toDateString()) return "Today"; const y = new Date(s.now - 86400e3); if (d.toDateString() === y.toDateString()) return "Yesterday"; return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }); };
  let last = null;
  return (
    <main className="page gallery">
      <div className="row gal-head">
        <h1>Gallery</h1>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Model">
          {[{ id: "all", label: "All Models" }, ...MODELS.map((m) => ({ id: m.id, label: m.name }))].map((o) => <button key={o.id} aria-pressed={model === o.id} onClick={() => setModel(o.id)}>{o.label}</button>)}
        </div>
        <div className="seg" role="group" aria-label="State">
          {STATE_FILTERS.map((o) => <button key={o.id} aria-pressed={st === o.id} onClick={() => setSt(o.id)}>{o.label}</button>)}
        </div>
      </div>
      {!subs.length && <p className="empty">Nothing here yet.</p>}
      <div className="gal-list">
        {subs.map((gs) => {
          const d = day(gs[0].createdAt);
          const head = d !== last ? <h2 className="day">{d}</h2> : null;
          last = d;
          return <Fragment key={gs[0].submissionId}>{head}<SubmissionGroup gens={gs} showModel /></Fragment>;
        })}
      </div>
      {subs.length > 0 && <p className="small faint center">That's everything. Older Generations would load here, 24 Submissions at a time.</p>}
    </main>
  );
}

export function modeKind(model, mode) {
  const ups = shownInputs(model, mode).filter(({ input, state }) => isUpload(input) && state === "required").map(({ input }) => input.type);
  if (ups.includes("video")) return "video";
  if (ups.includes("audio")) return "audio";
  if (ups.includes("image")) return "image";
  return "text";
}
export const KIND_LABEL = { text: "From a prompt", image: "From images", audio: "With your audio", video: "From a video" };
export const KINDS = ["text", "image", "audio", "video"];

export function ModeUses({ model, mode }) {
  const ups = shownInputs(model, mode).filter(({ input }) => isUpload(input) || input.type === "points");
  if (!ups.length) return <span className="uses small faint">Prompt only</span>;
  return (
    <span className="uses small faint">
      {ups.map(({ input, state }) => <span key={input.id} className={`use ${state}`}><Icon name={TYPE_ICON[input.type]} size={12} />{input.label}{state === "optional" ? " (optional)" : ""}</span>)}
    </span>
  );
}

export { trimLength };
