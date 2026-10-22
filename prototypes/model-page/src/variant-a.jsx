// PROTOTYPE variant A · Workbench. Two columns: the form on the left with a
// grouped Mode menu at its top and Generate pinned to its foot; this Model's
// Submissions stream in on the right, newest first. Gallery is its own page.
import { S, useStore, setMode, go, modeOf } from "./store.js";
import { shownInputs, isUpload, ACTIVE } from "./logic.js";
import {
  AppHeader, Footer, ModelIntro, CapsLine, FieldFor, CountPicker, GenerateButton, SubmitNotes, Banner,
  SubmissionGroup, submissionsOf, GalleryPage, ModelsHome, Icon, modeKind, KIND_LABEL, KINDS, ModeUses,
} from "./ui.jsx";

const { useState, useEffect, useRef } = React;

export function VariantA() {
  const s = useStore();
  const p = s.page;
  return (
    <div className="va">
      <AppHeader />
      {p.name === "home" && <ModelsHome />}
      {p.name === "gallery" && <GalleryPage />}
      {p.name === "model" && <ModelPageA modelId={p.modelId} />}
      <Footer />
    </div>
  );
}

function ModeMenu({ model }) {
  const f = S.forms[model.id];
  const mode = modeOf(model.id);
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  if (model.modes.length === 1) {
    return (
      <div className="va-mode single">
        <span className="eyebrow">Mode</span>
        <strong>{mode.name}</strong>
        <p className="small muted">{mode.description}</p>
      </div>
    );
  }
  return (
    <div className="va-mode pop-anchor" ref={ref}>
      <span className="eyebrow" id={`mode-l-${model.id}`}>Mode</span>
      <button className="mode-btn" aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`mode-l-${model.id}`} onClick={() => setOpen(!open)}>
        <span className="stack tight grow">
          <strong>{mode.name}</strong>
          <span className="small muted">{mode.description}</span>
        </span>
        <Icon name="chev" />
      </button>
      {open && (
        <div className="popover mode-list" role="listbox" aria-label="Modes">
          {KINDS.map((k) => {
            const ms = model.modes.filter((m) => modeKind(model, m) === k);
            if (!ms.length) return null;
            return (
              <div key={k} className="mode-group">
                <div className="eyebrow">{KIND_LABEL[k]}</div>
                {ms.map((m) => (
                  <button key={m.id} role="option" aria-selected={m.id === f.modeId} className="mode-opt" onClick={() => { setMode(model.id, m.id); setOpen(false); }}>
                    <span className="stack tight">
                      <strong>{m.name}</strong>
                      <ModeUses model={model} mode={m} />
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const GROUPS = [
  { id: "files", label: "Your files", test: (i) => isUpload(i) || i.type === "points" },
  { id: "words", label: "Describe it", test: (i) => i.type === "text" },
  { id: "settings", label: "Settings", test: (i) => !isUpload(i) && i.type !== "points" && i.type !== "text" },
];

function ModelPageA({ modelId }) {
  const s = useStore();
  const model = s.models[modelId];
  const mode = modeOf(modelId);
  const shown = shownInputs(model, mode);
  const subs = submissionsOf(s.gens.filter((g) => g.modelId === modelId && !g.dismissed));
  const active = s.gens.filter((g) => g.modelId === modelId && ACTIVE.includes(g.state)).length;
  const feedRef = useRef();
  return (
    <main className="va-grid">
      <section className="va-compose" aria-label={`Generate with ${model.name}`}>
        <div className="va-compose-body">
          <ModelIntro model={model} />
          <ModeMenu model={model} />
          <Banner modelId={modelId} />
          {GROUPS.map((grp) => {
            const items = shown.filter(({ input }) => grp.test(input));
            if (!items.length) return null;
            return (
              <fieldset key={grp.id} className="va-group">
                <legend className="eyebrow">{grp.label}</legend>
                {items.map(({ input, state }) => <FieldFor key={input.id} modelId={modelId} input={input} state={state} />)}
              </fieldset>
            );
          })}
        </div>
        <div className="va-go">
          <div className="row nowrap">
            <CountPicker modelId={modelId} />
            <span className="spacer" />
            <GenerateButton modelId={modelId} />
          </div>
          <SubmitNotes modelId={modelId} />
          <CapsLine compact />
        </div>
      </section>
      <section className="va-feed" ref={feedRef} aria-label={`Your ${model.name} Generations`}>
        <div className="feed-head">
          <h2>Your {model.name} Generations</h2>
          {active > 0 && <span className="pill accent">{active} under way</span>}
          <span className="spacer" />
          <button className="link" onClick={() => go({ name: "gallery" })}>Everything in Gallery</button>
        </div>
        {!subs.length && (
          <div className="empty-feed">
            <p><strong>Nothing yet.</strong></p>
            <p className="muted">Pick a Mode, fill the form and press Generate. Each Generation shows up here right away and fills in while it runs; you can start more while others run.</p>
          </div>
        )}
        {subs.slice(0, 8).map((gs) => <SubmissionGroup key={gs[0].submissionId} gens={gs} />)}
        {subs.length > 8 && <button className="btn" onClick={() => go({ name: "gallery" })}>Older {model.name} Generations in Gallery</button>}
      </section>
      {active > 0 && <button className="va-jump" onClick={() => feedRef.current?.scrollIntoView({ behavior: "smooth" })}><span className="live-dot" /> {active} under way</button>}
    </main>
  );
}
