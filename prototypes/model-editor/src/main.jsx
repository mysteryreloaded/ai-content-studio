// PROTOTYPE entry: three Model editor variants on one page, switched by the
// floating bar (← / → keys too). ?variant=a|b|c or #a|#b|#c picks one on load.
import { useStudio, SCENARIOS } from "./store.js";
import { Toasts } from "./ui.jsx";
import { VariantA } from "./variant-a.jsx";
import { VariantB } from "./variant-b.jsx";
import { VariantC } from "./variant-c.jsx";

const { useState, useEffect } = React;

const VARIANTS = [
  { key: "a", name: "Sections and a Mode grid", C: VariantA },
  { key: "b", name: "Workflow inspector", C: VariantB },
  { key: "c", name: "Guided, Mode by Mode", C: VariantC },
];

function initialVariant() {
  try {
    const q = new URLSearchParams(location.search).get("variant");
    const h = location.hash.replace("#", "");
    const k = (q || h || "a").toLowerCase();
    return VARIANTS.some((v) => v.key === k) ? k : "a";
  } catch { return "a"; }
}

function App() {
  const [variant, setVariant] = useState(initialVariant);
  const studio = useStudio("edit");
  const i = VARIANTS.findIndex((v) => v.key === variant);
  const go = (d) => {
    const next = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key;
    setVariant(next);
    try { history.replaceState(null, "", `${location.pathname}?variant=${next}#${next}`); } catch {}
  };
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t.closest?.("input, textarea, select, [contenteditable], [role=dialog]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => { document.title = "Model Editor Prototype"; }, []);
  const V = VARIANTS[i].C;
  return (
    <>
      <V key={`${variant}-${studio.scenario}`} studio={studio} />
      <Toasts toasts={studio.toasts} />
      <div className="proto-bar" role="toolbar" aria-label="Prototype controls">
        <span className="proto-tag">Prototype</span>
        <button onClick={() => go(-1)} aria-label="Previous variant">←</button>
        <span className="lbl"><strong>{VARIANTS[i].key.toUpperCase()}</strong> · {VARIANTS[i].name}</span>
        <button onClick={() => go(1)} aria-label="Next variant">→</button>
        <select aria-label="Scenario" value={studio.scenario} onChange={(e) => studio.setScenario(e.target.value)} id="proto-scenario">
          {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
