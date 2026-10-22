// PROTOTYPE variant B · Feed and dock. The Model page is the user's Gallery for
// that Model: a wall of Generations, newest first. A composer docked at the
// bottom holds the Mode chip, Upload slots, the prompt and settings chips;
// trims and point picking open in a sheet. The Gallery page is the same wall
// across all Models, without the dock.
import { S, useStore, setMode, modeOf, setValue } from "./store.js";
import { shownInputs, isUpload, ACTIVE } from "./logic.js";
import {
  AppHeader, Footer, CapsLine, InputControl, Field, CountPicker, GenerateButton, SubmitNotes, Banner, GenCard,
  submissionsOf, ModelsHome, Icon, modeKind, KIND_LABEL, KINDS, ModeUses, UploadControl, PointsControl, UploadThumb,
  FilePicker, SampleButton, UsedUploads, ConfirmDelete, TYPE_ICON, PromptLine,
} from "./ui.jsx";
import { openTerms, cancelSubmission, deleteSubmission } from "./store.js";
import { ago } from "./logic.js";

const { useState, useEffect, useRef } = React;

export function VariantB() {
  const s = useStore();
  const p = s.page;
  return (
    <div className="vb">
      <AppHeader />
      {p.name === "home" && <ModelsHome />}
      {p.name === "gallery" && <Wall modelId={null} />}
      {p.name === "model" && <Wall key={p.modelId} modelId={p.modelId} />}
      {p.name !== "model" && <Footer />}
    </div>
  );
}

const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "active", label: "Under way", test: (g) => ACTIVE.includes(g.state) },
  { id: "done", label: "Finished", test: (g) => g.state === "succeeded" },
  { id: "other", label: "Failed", test: (g) => g.state === "failed" || g.state === "cancelled" },
];

function Wall({ modelId }) {
  const s = useStore();
  const model = modelId && s.models[modelId];
  const [scope, setScope] = useState(modelId ? "model" : "all");
  const [flt, setFlt] = useState("all");
  const [sheet, setSheet] = useState(null);
  const test = FILTERS.find((x) => x.id === flt).test;
  const subs = submissionsOf(s.gens.filter((g) => !g.dismissed && (scope === "all" || g.modelId === modelId))).filter((gs) => gs.some(test));
  return (
    <>
      <div className="vb-top">
        <div className="vb-title">
          <h1>{model ? model.name : "Gallery"}</h1>
          {model && (
            <span className="small muted">
              {model.description}
              {model.attribution ? ` · ${model.attribution}` : ""}
              {model.terms ? <> · <button className="link" onClick={() => openTerms(model.id)}>Model terms</button></> : null}
            </span>
          )}
        </div>
        <span className="spacer" />
        {model && (
          <div className="seg sm" role="group" aria-label="Show">
            <button aria-pressed={scope === "model"} onClick={() => setScope("model")}>{model.name}</button>
            <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>All Models</button>
          </div>
        )}
        <div className="seg sm" role="group" aria-label="Filter">
          {FILTERS.map((x) => <button key={x.id} aria-pressed={flt === x.id} onClick={() => setFlt(x.id)}>{x.label}</button>)}
        </div>
      </div>
      <main className={`vb-wall ${model ? "with-dock" : ""}`}>
        {!subs.length && (
          <div className="empty-feed">
            <p><strong>{model ? `Your ${model.name} Generations will appear here.` : "Nothing here yet."}</strong></p>
            {model && <p className="muted">Describe a shot in the box below and press Generate. You can keep starting new ones while others run.</p>}
          </div>
        )}
        {subs.map((gs) => <WallBlock key={gs[0].submissionId} gens={gs} showModel={scope === "all"} />)}
      </main>
      {model && <Dock modelId={modelId} openSheet={setSheet} />}
      {model && sheet && <UploadSheet modelId={modelId} inputId={sheet} onClose={() => setSheet(null)} />}
    </>
  );
}

function WallBlock({ gens, showModel }) {
  const visible = gens.filter((g) => !g.dismissed);
  if (!visible.length) return null;
  const first = gens[0];
  const model = S.models[first.modelId];
  const mode = model.modes.find((m) => m.id === first.modeId);
  const nActive = gens.filter((g) => ACTIVE.includes(g.state) && !g.cancelRequested).length;
  const allEnded = gens.every((g) => !ACTIVE.includes(g.state));
  return (
    <article className={`wall-block n${visible.length}`}>
      <div className="wb-cards">{gens.map((g) => <GenCard key={g.id} g={g} tile />)}</div>
      <div className="wb-cap">
        <PromptLine g={first} className="wb-prompt" />
        <div className="row small">
          <span className="muted">{mode.name}{showModel ? ` · ${model.name}` : ""}</span>
          <UsedUploads g={first} size={18} />
          <span className="faint">{ago(first.createdAt, S.now)}</span>
          <span className="spacer" />
          {nActive > 1 && <button className="btn ghost xs" onClick={() => cancelSubmission(first.submissionId)}>Cancel all</button>}
          {allEnded && gens.length > 1 && <ConfirmDelete small label="Delete all" onConfirm={() => deleteSubmission(first.submissionId)} />}
        </div>
      </div>
    </article>
  );
}

function usePopover() {
  const [open, setOpen] = useState(null);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(null); };
    const esc = (e) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return [open, setOpen, ref];
}

function Dock({ modelId, openSheet }) {
  const s = useStore();
  const model = s.models[modelId];
  const f = s.forms[modelId];
  const mode = modeOf(modelId);
  const shown = shownInputs(model, mode);
  const slots = shown.filter(({ input }) => isUpload(input) || input.type === "points");
  const texts = shown.filter(({ input }) => input.type === "text");
  const settings = shown.filter(({ input }) => !isUpload(input) && input.type !== "points" && input.type !== "text");
  const [pop, setPop, ref] = usePopover();
  const issues = Object.entries(f.issues).filter(([k]) => shown.some(({ input }) => input.id === k));
  return (
    <div className="vb-dock" ref={ref}>
      <div className="dock-inner">
        <Banner modelId={modelId} />
        <div className="dock-row">
          <div className="pop-anchor">
            <button className="mode-chip" aria-haspopup="listbox" aria-expanded={pop === "mode"} disabled={model.modes.length === 1} onClick={() => setPop(pop === "mode" ? null : "mode")}>
              <span className="eyebrow">Mode</span> <strong>{mode.name}</strong> {model.modes.length > 1 && <Icon name="chev" size={14} />}
            </button>
            {pop === "mode" && (
              <div className="popover up mode-list" role="listbox" aria-label="Modes">
                {KINDS.map((k) => {
                  const ms = model.modes.filter((m) => modeKind(model, m) === k);
                  if (!ms.length) return null;
                  return (
                    <div key={k} className="mode-group">
                      <div className="eyebrow">{KIND_LABEL[k]}</div>
                      {ms.map((m) => (
                        <button key={m.id} role="option" aria-selected={m.id === f.modeId} className="mode-opt" onClick={() => { setMode(modelId, m.id); setPop(null); }}>
                          <span className="stack tight"><strong>{m.name}</strong><span className="small muted">{m.description}</span></span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="slots">
            {slots.map(({ input, state }) => <Slot key={input.id} modelId={modelId} input={input} state={state} pop={pop} setPop={setPop} openSheet={openSheet} />)}
          </div>
        </div>
        {texts.map(({ input, state }, i) => (
          <div key={input.id} className={`dock-text ${f.issues[input.id] ? "has-err" : ""}`}>
            <label className="sr-only" htmlFor={`in-${modelId}-${input.id}`}>{input.label}</label>
            <AutoText modelId={modelId} input={input} state={state} big={i === 0} />
          </div>
        ))}
        <div className="dock-row">
          <div className="chips">
            {settings.map(({ input, state }) => <SettingChip key={input.id} modelId={modelId} input={input} state={state} pop={pop} setPop={setPop} />)}
          </div>
          <span className="spacer" />
          <CountPicker modelId={modelId} label="×" />
          <GenerateButton modelId={modelId} />
        </div>
        {issues.length > 0 && (
          <ul className="dock-issues" role="alert">
            {issues.map(([k, msg]) => <li key={k}><Icon name="alert" size={13} /> <strong>{model.inputs.find((i) => i.id === k).label}:</strong> {msg}</li>)}
          </ul>
        )}
        <div className="dock-foot">
          <SubmitNotes modelId={modelId} />
          <CapsLine compact />
        </div>
      </div>
    </div>
  );
}

function AutoText({ modelId, input, state, big }) {
  const f = S.forms[modelId];
  const v = f.values[input.id] || "";
  const ref = useRef();
  useEffect(() => { const el = ref.current; if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; } }, [v]);
  const ph = state === "optional" && input.wf ? `${input.label} (optional): ${input.wf}` : big ? `${input.label}: ${input.help || "describe the shot"}` : input.label;
  return (
    <div className="text-wrap">
      <textarea ref={ref} id={`in-${modelId}-${input.id}`} rows={big ? 2 : 1} className="dock-ta" placeholder={ph} value={v}
        onChange={(e) => setValue(modelId, input.id, e.target.value)} />
      {input.maxLength && v.length > input.maxLength * 0.8 && <span className={`counter tnum ${v.length > input.maxLength ? "over" : ""}`}>{v.length} / {input.maxLength}</span>}
    </div>
  );
}

function Slot({ modelId, input, state, pop, setPop, openSheet }) {
  const f = S.forms[modelId];
  const err = f.issues[input.id];
  const note = f.notes[input.id];
  if (input.type === "points") {
    const n = (f.values[input.id] || []).length;
    return (
      <button className={`slot ${n ? "filled" : ""} ${err ? "err" : ""}`} onClick={() => openSheet(input.of)} title={input.help}>
        <span className="slot-box"><Icon name="target" size={18} />{n ? <span className="slot-badge">{n}</span> : null}</span>
        <span className="slot-label">{input.label}</span>
      </button>
    );
  }
  const v = f.values[input.id];
  const u = v?.uploadId ? S.uploads[v.uploadId] : null;
  if (!u) {
    return (
      <div className="pop-anchor">
        <button className={`slot ${err ? "err" : ""} ${note ? "noted" : ""}`} aria-expanded={pop === input.id} onClick={() => setPop(pop === input.id ? null : input.id)} title={note || input.help}>
          <span className="slot-box empty"><Icon name="plus" size={18} /></span>
          <span className="slot-label">{input.label}{state === "optional" ? <em> optional</em> : null}</span>
        </button>
        {pop === input.id && (
          <div className="popover up slot-menu">
            <FilePicker modelId={modelId} input={input} onPicked={() => setPop(null)}>
              {(open) => <button className="menu-item" onClick={open}><Icon name={TYPE_ICON[input.type]} size={14} /> Choose {input.type === "image" ? "an image" : input.type === "video" ? "a video" : "an audio file"}…</button>}
            </FilePicker>
            <SampleButton modelId={modelId} input={input} className="menu-item" onPicked={() => setPop(null)} />
            {input.help && <p className="small muted">{input.help}</p>}
          </div>
        )}
      </div>
    );
  }
  const busy = u.status === "uploading" || u.status === "checking";
  const pct = u.status === "uploading" ? u.sent / u.size : 1;
  return (
    <button className={`slot filled ${err ? "err" : ""} ${u.status}`} onClick={() => openSheet(input.id)} title={u.name}>
      <span className="slot-box">
        <UploadThumb upload={u} size={52} />
        {busy && <span className="ring" style={{ "--p": pct }} aria-label={`Uploading ${Math.floor(pct * 100)}%`} />}
        {u.status === "removed" && <span className="slot-x"><Icon name="alert" size={16} /></span>}
        {input.limits?.trimmable && u.duration ? <span className="slot-dur tnum">{((v.trim?.end ?? u.duration) - (v.trim?.start ?? 0)).toFixed(1)}s</span> : null}
      </span>
      <span className="slot-label">{input.label}</span>
    </button>
  );
}

function SettingChip({ modelId, input, state, pop, setPop }) {
  const f = S.forms[modelId];
  const v = f.values[input.id];
  const blank = v === undefined || v === "";
  const shownVal = input.type === "select" ? input.options.find((o) => o.id === (blank ? input.wf : v))?.label
    : input.type === "seed" ? (blank ? "random" : v)
    : blank ? input.wf : v;
  return (
    <div className="pop-anchor">
      <button className={`chip ${f.issues[input.id] ? "err" : ""} ${blank ? "is-default" : ""}`} aria-expanded={pop === input.id} onClick={() => setPop(pop === input.id ? null : input.id)}>
        <span className="muted">{input.label}</span> <strong className="tnum">{shownVal ?? "—"}{input.unit && shownVal ? ` ${input.unit}` : ""}</strong>
        {blank && input.type !== "seed" && <span className="def">default</span>}
      </button>
      {pop === input.id && (
        <div className="popover up chip-pop">
          <Field modelId={modelId} input={input} state={state}><InputControl modelId={modelId} input={input} state={state} /></Field>
        </div>
      )}
    </div>
  );
}

function UploadSheet({ modelId, inputId, onClose }) {
  const s = useStore();
  const model = s.models[modelId];
  const mode = modeOf(modelId);
  const shown = shownInputs(model, mode);
  const item = shown.find(({ input }) => input.id === inputId);
  if (!item) return null;
  const pointsInputs = shown.filter(({ input }) => input.type === "points" && input.of === inputId);
  return (
    <div className="scrim sheet-scrim" onClick={onClose} role="presentation">
      <div className="bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
        <header className="row nowrap"><h2 id="sheet-title" className="grow">{item.input.label}</h2><button className="btn primary sm" onClick={onClose}>Done</button></header>
        <div className="stack">
          <Field modelId={modelId} input={item.input} state={item.state} bare><UploadControl modelId={modelId} input={item.input} state={item.state} /></Field>
          {item.input.help && <p className="small muted">{item.input.help}</p>}
          {pointsInputs.map(({ input, state }) => (
            <Field key={input.id} modelId={modelId} input={input} state={state}><PointsControl modelId={modelId} input={input} big /></Field>
          ))}
        </div>
      </div>
    </div>
  );
}
