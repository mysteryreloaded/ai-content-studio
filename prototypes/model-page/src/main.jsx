// PROTOTYPE entry: three variants of the user's Model page on one page, switched
// by the floating bar (← / → keys too). ?variant=a|b|c or #a|#b|#c picks one on
// load. The bar also switches scenarios and arms simulated faults.
import { S, useStore, resetScenario, start, SCENARIOS, SIMULATIONS, emit } from "./store.js";
import { Toasts, Dialogs } from "./ui.jsx";
import { VariantA } from "./variant-a.jsx";
import { VariantB } from "./variant-b.jsx";
import { VariantC } from "./variant-c.jsx";

const { useState, useEffect, useRef } = React;

const VARIANTS = [
  { key: "a", name: "Workbench", C: VariantA },
  { key: "b", name: "Feed and dock", C: VariantB },
  { key: "c", name: "Storyboard", C: VariantC },
];

function initialVariant() {
  try {
    const q = new URLSearchParams(location.search).get("variant");
    const h = location.hash.replace("#", "");
    const k = (q || h || "a").toLowerCase();
    return VARIANTS.some((v) => v.key === k) ? k : "a";
  } catch { return "a"; }
}

resetScenario("usual");
start();

function SimMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <span className="pop-anchor" ref={ref}>
      <button aria-expanded={open} onClick={() => setOpen(!open)}>Simulate ▴</button>
      {open && (
        <div className="sim-menu" role="menu">
          <p className="small">Things the server or an Admin can do to you. Blocked words to try in a prompt: <code>bloodbath</code>, <code>gore</code>.</p>
          {SIMULATIONS.map((s) => <button key={s.id} role="menuitem" onClick={() => { s.run(); setOpen(false); }}>{s.label}{s.id === "noServer" && S.faults.noServer ? " (on)" : ""}</button>)}
          <p className="small faint">Times run about 8× faster than on real GPUs.</p>
        </div>
      )}
    </span>
  );
}

function App() {
  const s = useStore();
  const [variant, setVariant] = useState(initialVariant);
  const i = VARIANTS.findIndex((v) => v.key === variant);
  const go = (d) => {
    const next = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key;
    setVariant(next);
    try { history.replaceState(null, "", `${location.pathname}?variant=${next}#${next}`); } catch {}
  };
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t.closest?.("input, textarea, select, [contenteditable], [role=dialog], [role=slider]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => { document.title = "Model Page Prototype"; }, []);
  useEffect(() => { // the Model terms dialog opens on the first visit of a Model page
    const m = s.page.name === "model" && s.models[s.page.modelId];
    if (m && m.terms && s.termsAck[m.id] !== m.terms.version && !s.dialog) { s.dialog = { type: "terms", modelId: m.id }; emit(); }
  });
  const V = VARIANTS[i].C;
  return (
    <>
      <V key={variant} />
      <Dialogs />
      <Toasts />
      <div className="proto-bar" role="toolbar" aria-label="Prototype controls">
        <span className="proto-tag">Prototype</span>
        <button onClick={() => go(-1)} aria-label="Previous variant">←</button>
        <span className="lbl"><strong>{VARIANTS[i].key.toUpperCase()}</strong> · {VARIANTS[i].name}</span>
        <button onClick={() => go(1)} aria-label="Next variant">→</button>
        <select aria-label="Scenario" value={s.scenario} onChange={(e) => resetScenario(e.target.value)} id="proto-scenario">
          {SCENARIOS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <SimMenu />
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
