// PROTOTYPE variant C · Storyboard. The Model page opens on its Modes, grouped by
// what the user starts from. Picking one opens a storyboard: image Uploads sit on
// a timeline at the moment they shape (first / middle / last frame), audio and
// video Uploads are lanes under it with their trim, and the settings sit beside
// it. Work under way lives in a queue tray across all Models; the latest
// Submission shows under the board, everything else is in Gallery.
//
// Note for the spec: placing an image on the timeline needs to know where it
// goes. Here that comes from the Input id (start / middle / last); for real it
// would be a "frame position" an Admin sets on an image Input.
import { S, useStore, setMode, unchoose, modeOf, go, openDetail, cancelGen } from "./store.js";
import { shownInputs, isUpload, ACTIVE, trimLength, STAGE_LABEL } from "./logic.js";
import {
  AppHeader, Footer, ModelIntro, CapsLine, FieldFor, Field, CountPicker, GenerateButton, SubmitNotes, Banner,
  SubmissionGroup, submissionsOf, GalleryPage, ModelsHome, Icon, modeKind, KIND_LABEL, KINDS, ModeUses,
  UploadControl, PointsControl, UploadStatus, FilePicker, SampleButton, genStatus, Progress, aspectCss, TYPE_ICON,
} from "./ui.jsx";
import { clearUpload } from "./store.js";

const { useState } = React;

const FRAME_POS = { start: 0, middle: 0.5, last: 1 };
const ASPECT = { wide: 16 / 9, tall: 9 / 16, square: 1, landscape: 832 / 480, portrait: 480 / 832 };

export function VariantC() {
  const s = useStore();
  const p = s.page;
  return (
    <div className="vc">
      <AppHeader />
      {p.name === "home" && <ModelsHome />}
      {p.name === "gallery" && <GalleryPage />}
      {p.name === "model" && <ModelPageC modelId={p.modelId} />}
      <Footer />
      <QueueTray />
    </div>
  );
}

function ModelPageC({ modelId }) {
  const s = useStore();
  const f = s.forms[modelId];
  const model = s.models[modelId];
  if (!f.chosen && model.modes.length > 1) return <ModeChooser model={model} />;
  return <Composer model={model} />;
}

function Glyph({ model, mode }) {
  const ins = shownInputs(model, mode).map(({ input }) => input);
  const frames = ins.filter((i) => FRAME_POS[i.id] !== undefined);
  const refs = ins.filter((i) => i.type === "image" && FRAME_POS[i.id] === undefined);
  const audio = ins.some((i) => i.type === "audio");
  const video = ins.some((i) => i.type === "video");
  const x0 = refs.length ? 40 : 8;
  const W = 152 - x0;
  return (
    <svg className="glyph" viewBox="0 0 160 64" aria-hidden="true">
      {refs.map((r, i) => <rect key={r.id} x={6 + i * 4} y={8 + i * 3} width="24" height="30" rx="2" className="g-ref" />)}
      <rect x={x0} y="10" width={W} height="24" rx="3" className="g-gen" />
      {frames.map((fr) => <rect key={fr.id} x={x0 + FRAME_POS[fr.id] * (W - 26)} y="8" width="26" height="28" rx="2" className="g-frame" />)}
      {!frames.length && !video && [0, 1, 2].map((k) => <line key={k} x1={x0 + 10} x2={x0 + W - 10 - k * 18} y1={16 + k * 6} y2={16 + k * 6} className="g-text" />)}
      {audio && <path className="g-audio" d={`M${x0} 50 ${Array.from({ length: 24 }, (_, k) => `L${x0 + (k * W) / 23} ${50 + (k % 2 ? -1 : 1) * (2 + ((k * 7) % 5))}`).join(" ")}`} />}
      {video && <g>{Array.from({ length: 7 }, (_, k) => <rect key={k} x={x0 + (k * W) / 7 + 1} y={video && audio ? 56 : 44} width={W / 7 - 2} height="7" rx="1" className="g-video" />)}</g>}
    </svg>
  );
}

function ModeChooser({ model }) {
  const s = useStore();
  const subs = submissionsOf(s.gens.filter((g) => g.modelId === model.id && !g.dismissed));
  return (
    <main className="vc-page">
      <ModelIntro model={model} />
      <h2 className="vc-q">What do you start from?</h2>
      {KINDS.map((k) => {
        const ms = model.modes.filter((m) => modeKind(model, m) === k);
        if (!ms.length) return null;
        return (
          <section key={k} className="vc-kind">
            <h3 className="eyebrow">{KIND_LABEL[k]}</h3>
            <div className="vc-cards">
              {ms.map((m) => (
                <button key={m.id} className="vc-card" onClick={() => { setMode(model.id, m.id); window.scrollTo?.(0, 0); }}>
                  <Glyph model={model} mode={m} />
                  <strong>{m.name}</strong>
                  <span className="small muted">{m.description}</span>
                  <ModeUses model={model} mode={m} />
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {subs.length > 0 && (
        <section className="vc-latest">
          <div className="row"><h2>Latest</h2><span className="spacer" /><button className="link" onClick={() => go({ name: "gallery" })}>All in Gallery</button></div>
          <SubmissionGroup gens={subs[0]} />
        </section>
      )}
    </main>
  );
}

function boardLength(model, mode, f) {
  if (mode.fixedLength) return { L: mode.fixedLength, why: "fixed for this Mode" };
  if (mode.lengthFrom) {
    const v = f.values[mode.lengthFrom];
    const u = v?.uploadId && S.uploads[v.uploadId];
    const input = model.inputs.find((i) => i.id === mode.lengthFrom);
    if (u?.duration) return { L: trimLength(v, u), why: `from your ${input.label.toLowerCase()}` };
    return { L: input.limits?.maxSec || 10, why: `follows your ${input.label.toLowerCase()}` };
  }
  const d = model.inputs.find((i) => i.id === "duration");
  if (d && mode.states.duration) return { L: Number(f.values.duration) || Number(d.wf), why: f.values.duration ? "your duration" : "default duration" };
  return { L: 5, why: "" };
}

function boardAspect(model, mode, f) {
  const key = mode.aspectFrom || (mode.states.aspect ? "aspect" : null);
  if (mode.fixedAspect === "sheet") return 768 / 448;
  if (!key) return 16 / 9;
  const input = model.inputs.find((i) => i.id === key);
  return ASPECT[f.values[key] || input.wf] || 16 / 9;
}

function Composer({ model }) {
  const s = useStore();
  const modelId = model.id;
  const f = s.forms[modelId];
  const mode = modeOf(modelId);
  const shown = shownInputs(model, mode);
  const settings = shown.filter(({ input }) => !isUpload(input) && input.type !== "points" && input.type !== "text");
  const subs = submissionsOf(s.gens.filter((g) => g.modelId === modelId && !g.dismissed));
  const latest = (f.lastSubmission && subs.find((gs) => gs[0].submissionId === f.lastSubmission)) || subs[0];
  return (
    <main className="vc-page">
      <div className="vc-modebar">
        {model.modes.length > 1 && <button className="btn ghost sm" onClick={() => unchoose(modelId)}><Icon name="left" size={14} /> All {model.name} Modes</button>}
        <div className="stack tight">
          <span className="eyebrow">{model.name}{model.attribution ? ` · ${model.attribution}` : ""}</span>
          <h1>{mode.name}</h1>
          <p className="muted">{mode.description}</p>
        </div>
      </div>
      <Banner modelId={modelId} />
      <div className="vc-grid">
        <section className="board" aria-label="Storyboard"><Storyboard model={model} mode={mode} /></section>
        <aside className="vc-side">
          {settings.map(({ input, state }) => <FieldFor key={input.id} modelId={modelId} input={input} state={state} />)}
          <div className="vc-go">
            <CountPicker modelId={modelId} />
            <GenerateButton modelId={modelId} className="wide" />
            <SubmitNotes modelId={modelId} />
            <CapsLine compact />
          </div>
        </aside>
      </div>
      {latest && (
        <section className="vc-latest">
          <div className="row"><h2>Latest</h2><span className="spacer" /><button className="link" onClick={() => go({ name: "gallery" })}>{subs.length > 1 ? `${subs.length - 1} earlier in Gallery` : "Gallery"}</button></div>
          <SubmissionGroup gens={latest} cardsClass="big" />
        </section>
      )}
    </main>
  );
}

function Storyboard({ model, mode }) {
  const s = useStore();
  const f = s.forms[model.id];
  const shown = shownInputs(model, mode);
  const frames = shown.filter(({ input }) => input.type === "image" && FRAME_POS[input.id] !== undefined);
  const refs = shown.filter(({ input }) => input.type === "image" && FRAME_POS[input.id] === undefined);
  const lanes = shown.filter(({ input }) => input.type === "audio" || input.type === "video");
  const texts = shown.filter(({ input }) => input.type === "text");
  const { L, why } = boardLength(model, mode, f);
  const ratio = boardAspect(model, mode, f);
  const ticks = Math.max(1, Math.round(L));
  return (
    <div className="sb">
      <div className="sb-top">
        {refs.length > 0 && (
          <div className="sb-refs">
            {refs.map(({ input, state }) => <FrameSlot key={input.id} model={model} input={input} state={state} ratio={input.id === "sheet" ? 768 / 448 : 3 / 4} reference />)}
          </div>
        )}
        <div className="sb-main">
          <div className="sb-frames" style={{ "--ratio": ratio }}>
            <div className="sb-gen" aria-hidden="true"><span>{frames.length ? (frames.length > 1 ? "generated between your frames" : "generated from your first frame") : lanes.some(({ input }) => input.type === "video") ? "follows your video" : lanes.length ? "follows your audio" : refs.length ? "generated from your reference" : "generated from your prompt"}</span></div>
            {frames.map(({ input, state }) => (
              <div key={input.id} className={`sb-pos p${FRAME_POS[input.id] * 100}`}>
                <FrameSlot model={model} input={input} state={state} ratio={ratio} />
              </div>
            ))}
          </div>
          <div className="ruler" aria-hidden="true">
            {Array.from({ length: ticks + 1 }, (_, i) => <span key={i} style={{ left: `${(i / ticks) * 100}%` }}>{Math.round((i / ticks) * L * 10) / 10}s</span>)}
          </div>
          <p className="small faint sb-len tnum">{L.toFixed(1)} s{why ? ` · ${why}` : ""}</p>
        </div>
      </div>
      {lanes.map(({ input, state }) => (
        <div key={input.id} className="lane">
          <div className="lane-label"><Icon name={TYPE_ICON[input.type]} size={14} /> {input.label}{state === "optional" ? <span className="opt">Optional</span> : null}</div>
          <FieldFor modelId={model.id} input={input} state={state} compact />
          {shown.filter(({ input: p }) => p.type === "points" && p.of === input.id).map(({ input: p, state: ps }) => (
            <Field key={p.id} modelId={model.id} input={p} state={ps}><PointsControl modelId={model.id} input={p} /></Field>
          ))}
        </div>
      ))}
      <div className="sb-text">
        {texts.map(({ input, state }) => <FieldFor key={input.id} modelId={model.id} input={input} state={state} />)}
      </div>
    </div>
  );
}

function FrameSlot({ model, input, state, ratio, reference }) {
  useStore();
  const f = S.forms[model.id];
  const v = f.values[input.id];
  const u = v?.uploadId ? S.uploads[v.uploadId] : null;
  const err = f.issues[input.id];
  const note = f.notes[input.id];
  return (
    <div className={`fslot ${reference ? "ref" : ""} ${err ? "err" : ""}`}>
      <span className="fslot-label small">{input.label}{state === "optional" ? <em> optional</em> : null}</span>
      {u ? (
        <div className="fslot-box filled" style={{ aspectRatio: ratio }}>
          <img src={u.url} alt="" />
          {(u.status === "uploading" || u.status === "checking") && <div className="fslot-over"><UploadStatus upload={u} /></div>}
          {u.status === "removed" && <div className="fslot-over">Removed by an administrator</div>}
          <button className="fslot-x" aria-label={`Remove ${input.label}`} onClick={() => clearUpload(model.id, input.id)}><Icon name="x" size={12} /></button>
        </div>
      ) : (
        <FilePicker modelId={model.id} input={input} className="fslot-box empty-wrap">
          {(open) => (
            <div className="fslot-box empty" style={{ aspectRatio: ratio }}>
              <button className="fslot-add" onClick={open} aria-label={`Choose ${input.label}`}><Icon name="plus" size={18} /></button>
              <SampleButton modelId={model.id} input={input} className="link small" />
            </div>
          )}
        </FilePicker>
      )}
      {err && <span className="err small" role="alert">{err}</span>}
      {note && <span className="note-line small">{note}</span>}
    </div>
  );
}

function QueueTray() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const active = s.gens.filter((g) => ACTIVE.includes(g.state));
  const recent = s.gens.filter((g) => !ACTIVE.includes(g.state) && g.endedAt && s.now - g.endedAt < 120e3 && !g.removed).slice(-4).reverse();
  if (!active.length && !recent.length) return null;
  const running = active.filter((g) => g.state !== "queued").length;
  return (
    <div className={`tray ${open ? "open" : ""}`}>
      {open && (
        <div className="tray-panel" role="region" aria-label="Queue">
          <div className="row"><strong>Under way</strong><span className="spacer" /><button className="btn ghost xs" aria-label="Close queue" onClick={() => setOpen(false)}><Icon name="x" size={13} /></button></div>
          {!active.length && <p className="small muted">Nothing running.</p>}
          {active.map((g) => <TrayRow key={g.id} g={g} />)}
          {recent.length > 0 && <div className="eyebrow">Just finished</div>}
          {recent.map((g) => <TrayRow key={g.id} g={g} />)}
        </div>
      )}
      <button className="tray-pill" aria-expanded={open} onClick={() => setOpen(!open)}>
        {active.length ? <span className="live-dot" /> : <Icon name="check" size={14} />}
        <span className="tnum">{active.length ? `${running} running${active.length - running ? ` · ${active.length - running} queued` : ""}` : `${recent.length} finished`}</span>
        <Icon name={open ? "chev" : "chev"} size={14} className={open ? "" : "flip"} />
      </button>
    </div>
  );
}

function TrayRow({ g }) {
  const model = S.models[g.modelId];
  const mode = model.modes.find((m) => m.id === g.modeId);
  const st = genStatus(g);
  const active = ACTIVE.includes(g.state);
  return (
    <div className="tray-row">
      <div className="tray-thumb" style={{ aspectRatio: aspectCss(g.aspect) }}>
        {g.asset ? <img src={g.asset.poster} alt="" /> : <span className={`pill ${st.tone}`}>{st.pill}</span>}
      </div>
      <div className="grow stack tight">
        <span className="small"><strong>{mode.name}</strong> <span className="muted">· {model.name}</span></span>
        <span className="small muted ellipsis">{st.text || st.pill}</span>
        {active && <Progress g={g} thin />}
      </div>
      {active && g.state !== "saving" && !g.cancelRequested && <button className="btn ghost xs" onClick={() => cancelGen(g.id)}>Cancel</button>}
      {!active && <button className="btn ghost xs" onClick={() => openDetail(g.id)}>View</button>}
    </div>
  );
}
