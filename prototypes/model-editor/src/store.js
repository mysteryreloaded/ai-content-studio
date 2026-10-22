// PROTOTYPE store: one in-memory draft shared by all three variants, so a change
// made in one layout shows up in the others. Nothing is persisted.
import { buildLtxWorkflow, BACKENDS, LTX_INPUTS, LTX_MODES, LTX_DETAILS } from "./data.js";
import { checkModel, reexport } from "./logic.js";

const { useState, useMemo, useCallback, useRef, useEffect } = React;

const LTX_WF = buildLtxWorkflow();

function ltxDraft() {
  return { workflow: LTX_WF, inputs: LTX_INPUTS(), modes: LTX_MODES(), details: LTX_DETAILS(), backendIds: ["b1", "b2", "b4"], revision: 7, pendingWorkflow: null };
}
function emptyDraft() {
  return {
    workflow: null, inputs: [], modes: [], revision: 0, backendIds: [], pendingWorkflow: null,
    details: { name: "", slug: "", description: "", order: 4, maxRunMin: 15, enabled: false, termsText: "", licenseUrl: "", askAgain: false, attribution: "" },
  };
}

export const SCENARIOS = [
  { id: "edit", label: "Editing LTX 2.5 (enabled, revision 7)" },
  { id: "new", label: "New Model, no Workflow yet" },
  { id: "reupload", label: "Re-uploaded Workflow, 2 bindings broken" },
];

function scenarioDraft(id) {
  if (id === "new") return emptyDraft();
  const d = ltxDraft();
  if (id === "reupload") d.workflow = reexport(LTX_WF);
  return d;
}

const cloneDraft = ({ workflow, pendingWorkflow, ...rest }) => ({ ...structuredClone(rest), workflow, pendingWorkflow });

export function useStudio(initialScenario) {
  const [scenario, setScenarioId] = useState(initialScenario);
  const [saved, setSaved] = useState(() => (initialScenario === "new" ? emptyDraft() : ltxDraft()));
  const [draft, setDraft] = useState(() => scenarioDraft(initialScenario));
  const [backends, setBackends] = useState(() => structuredClone(BACKENDS));
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const toast = useCallback((text, tone = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const mutate = useCallback((fn) => setDraft((d) => { const c = cloneDraft(d); fn(c); return c; }), []);

  const setScenario = useCallback((id) => {
    setScenarioId(id);
    setSaved(id === "new" ? emptyDraft() : ltxDraft());
    setDraft(scenarioDraft(id));
  }, []);

  const issues = useMemo(() => checkModel(draft, backends), [draft, backends]);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  const revisionChanged = draft.workflow !== saved.workflow || JSON.stringify(draft.inputs) !== JSON.stringify(saved.inputs) || JSON.stringify(draft.modes) !== JSON.stringify(saved.modes);
  const dirty = revisionChanged || JSON.stringify(draft.details) !== JSON.stringify(saved.details) || JSON.stringify(draft.backendIds) !== JSON.stringify(saved.backendIds);
  const isNew = draft.revision === 0 && saved.revision === 0;

  const save = useCallback(() => {
    const c = cloneDraft(draft);
    const disable = c.details.enabled && errors.length > 0;
    if (disable) c.details.enabled = false;
    if (revisionChanged) c.revision = draft.revision + 1;
    if (!c.details.slug && c.details.name) c.details.slug = c.details.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const askedAgain = c.details.askAgain;
    c.details.askAgain = false;
    setDraft(c);
    setSaved(cloneDraft(c));
    toast(`${revisionChanged ? `Saved revision ${c.revision}` : "Saved"}${disable ? ", and disabled the Model until its errors are fixed" : ""}${askedAgain ? ". Users will be asked to accept the Model terms again" : ""}.`, disable ? "warn" : "ok");
  }, [draft, errors.length, revisionChanged, toast]);

  const discard = useCallback(() => { setDraft(cloneDraft(saved)); toast("Discarded unsaved changes."); }, [saved, toast]);

  const exportModel = useCallback(() => {
    toast(`Exported ${draft.details.slug || "model"}.model.json: the Workflow, ${draft.inputs.length} Inputs, ${draft.modes.length} Modes, Model terms and Attribution. Backends and credentials are left out.`, "ok");
  }, [draft, toast]);

  const importModel = useCallback(() => {
    setScenarioId("new");
    const d = ltxDraft();
    d.details = { ...d.details, name: "LTX 2.5 (imported)", slug: "ltx-2-5-2", enabled: false, order: 4 };
    d.backendIds = [];
    d.revision = 0;
    setSaved(emptyDraft());
    setDraft(d);
    toast("Imported ltx-2-5.model.json as a new, disabled Model. Attach Backends, check it, then enable it.", "ok");
  }, [toast]);

  const updateBackend = useCallback((id, patch) => setBackends((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b))), []);
  const addBackend = useCallback((bk) => { setBackends((bs) => [...bs, bk]); }, []);

  return { scenario, setScenario, draft, saved, mutate, backends, updateBackend, addBackend, issues, errors, warnings, dirty, revisionChanged, isNew, save, discard, exportModel, importModel, toast, toasts };
}

// Simulated test Generation: queued → starting → running → saving → succeeded
export function useTestRun() {
  const [run, setRun] = useState(null);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const start = (info) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const at = (ms, patch) => timers.current.push(setTimeout(() => setRun((r) => (r ? { ...r, ...patch } : r)), ms));
    setRun({ ...info, state: "queued", progress: 0, step: "" });
    at(700, { state: "starting", step: "loading weights" });
    const steps = 8;
    for (let i = 1; i <= steps; i++) at(1500 + i * 450, { state: "running", progress: Math.round((i / steps) * 60), step: `stage 1 · step ${i}/${steps}` });
    for (let i = 1; i <= 3; i++) at(1500 + steps * 450 + i * 600, { state: "running", progress: 60 + i * 13, step: `stage 2 · step ${i}/3` });
    at(1500 + steps * 450 + 2400, { state: "saving", progress: 99, step: "copying the Asset" });
    at(1500 + steps * 450 + 3400, { state: "succeeded", progress: 100, step: "" });
  };
  const cancel = () => { timers.current.forEach(clearTimeout); setRun((r) => (r ? { ...r, state: "cancelled" } : r)); };
  return { run, start, cancel, clear: () => setRun(null) };
}
