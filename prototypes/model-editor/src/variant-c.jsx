// PROTOTYPE Variant C: "Guided, Mode by Mode". Six steps in the order a Model is
// built. Inputs come with suggestions mined from the Workflow; each Mode is set
// up beside a live preview of what users will see.
import {
  Icon, TypeDot, Field, Seg, StateChip, StateEditor, InputEditor, NewInputMenu, OutputsEditor, PathFacts, ChecksList,
  SaveControls, EnableSwitch, ModelFileActions, DetailsForm, TermsForm, BackendsPanel, WorkflowPanel, TestRunner, UserForm,
  defaultInput, short,
} from "./ui.jsx";
import { stateOf, nodeTitle, nodeLabel, fieldSpec, isLink, key, pathSummary, OUTPUT_CLASSES, UPLOAD_LOADERS, INPUT_TYPES } from "./logic.js";
import { EXTERNAL_CLASSES } from "./data.js";

const { useState, useMemo } = React;

const STEPS = [
  { id: "workflow", label: "Workflow", areas: ["workflow"] },
  { id: "inputs", label: "Inputs", areas: ["inputs"] },
  { id: "modes", label: "Modes", areas: ["modes"] },
  { id: "backends", label: "Backends", areas: ["backends"] },
  { id: "details", label: "Name and terms", areas: ["details", "terms"] },
  { id: "test", label: "Test and enable", areas: [] },
];

export function VariantC({ studio }) {
  const { draft, issues } = studio;
  const [step, setStep] = useState(draft.workflow ? "modes" : "workflow");
  const [inputId, setInputId] = useState(draft.inputs[0]?.id || null);
  const [modeId, setModeId] = useState(draft.modes[0]?.id || null);
  const idx = STEPS.findIndex((s) => s.id === step);
  const status = (s) => {
    const list = issues.filter((x) => s.areas.includes(x.area));
    const e = list.filter((x) => x.level === "error").length;
    const w = list.length - e;
    const filled = { workflow: !!draft.workflow, inputs: draft.inputs.length > 0, modes: draft.modes.length > 0, backends: draft.backendIds.length > 0, details: !!draft.details.name, test: draft.details.enabled }[s.id];
    return { e, w, done: filled && !e };
  };
  const jump = (x) => {
    const s = STEPS.find((s) => s.areas.includes(x.area));
    if (s) setStep(s.id);
    if (x.inputId && x.area === "inputs") setInputId(x.inputId);
    if (x.modeId) setModeId(x.modeId);
  };
  return (
    <div className="vc">
      <header className="vc-head">
        <div className="row">
          <div className="grow"><span className="eyebrow">{draft.revision ? `Model · revision ${draft.revision}` : "New Model"}</span><h1>{draft.details.name || "Untitled Model"}</h1></div>
          <ModelFileActions studio={studio} />
          <SaveControls studio={studio} />
        </div>
        <nav className="steps" aria-label="Steps">
          {STEPS.map((s, i) => {
            const st = status(s);
            return (
              <button key={s.id} aria-current={step === s.id ? "step" : undefined} onClick={() => setStep(s.id)}>
                <span className={`num ${st.e ? "err" : st.done ? "done" : st.w ? "warn" : ""}`}>{st.e ? "!" : st.done ? <Icon name="check" size={12} /> : i + 1}</span>
                <span className="stack" style={{ gap: 0 }}><span style={{ fontWeight: 600, color: "var(--fg)" }}>{s.label}</span><span className="small">{st.e ? `${st.e} error${st.e > 1 ? "s" : ""}` : st.w ? `${st.w} warning${st.w > 1 ? "s" : ""}` : st.done ? "Done" : "To do"}</span></span>
              </button>
            );
          })}
        </nav>
      </header>
      <div className="vc-body">
        {step === "workflow" && <StepWorkflow studio={studio} />}
        {step === "inputs" && <StepInputs studio={studio} inputId={inputId} setInputId={setInputId} />}
        {step === "modes" && <StepModes studio={studio} modeId={modeId} setModeId={setModeId} onOpenInput={(id) => { setInputId(id); setStep("inputs"); }} />}
        {step === "backends" && <StepIntro title="Where it runs" text="Attach the ComfyUI Backends that have this Workflow's node packs and weights. The studio checks each one's node list against every Mode's Path."><BackendsPanel studio={studio} /></StepIntro>}
        {step === "details" && <StepDetails studio={studio} />}
        {step === "test" && <StepTest studio={studio} onJump={jump} />}
        <div className="vc-foot">
          <button className="btn" disabled={idx === 0} onClick={() => setStep(STEPS[idx - 1].id)}><Icon name="left" /> {idx > 0 ? STEPS[idx - 1].label : "Back"}</button>
          {idx < STEPS.length - 1 && <button className="btn primary" onClick={() => setStep(STEPS[idx + 1].id)}>{STEPS[idx + 1].label} <Icon name="right" /></button>}
        </div>
      </div>
    </div>
  );
}

function StepIntro({ title, text, children }) {
  return (
    <div className="stack loose">
      <div className="stack tight"><h2>{title}</h2><p className="muted prose">{text}</p></div>
      {children}
    </div>
  );
}

function StepWorkflow({ studio }) {
  const { draft } = studio;
  const wf = draft.workflow;
  const nodes = wf ? Object.entries(wf) : [];
  const outputs = nodes.filter(([, n]) => OUTPUT_CLASSES[n.class_type]);
  const loaders = nodes.filter(([, n]) => UPLOAD_LOADERS[n.class_type]);
  const ext = nodes.filter(([, n]) => EXTERNAL_CLASSES[n.class_type]);
  const filler = (id) => {
    const f = UPLOAD_LOADERS[wf[id].class_type].field;
    return draft.inputs.find((i) => i.bindings.some((b) => b.node === id && b.field === f));
  };
  return (
    <StepIntro title="Upload the Workflow" text="Export it from ComfyUI with Export (API). Give each Mode its own save node: a Mode runs only its Path, the nodes its save node depends on.">
      <WorkflowPanel studio={studio} />
      {wf && (
        <div className="vc-cols two" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div className="panel pad stack tight">
            <h4>Output nodes · {outputs.length}</h4>
            <p className="small muted">Each Mode names one of these as its main Asset.</p>
            <div className="list">{outputs.map(([id, n]) => { const used = draft.modes.filter((m) => m.outputs.some((o) => o.node === id)); return <div key={id} className="item small"><TypeDot type={OUTPUT_CLASSES[n.class_type]} /><span className="grow">{nodeTitle(wf, id)} <span className="mono faint">#{id}</span></span><span className="muted">{used.length ? short(used.map((m) => m.name).join(", "), 36) : "unused"}</span></div>; })}</div>
          </div>
          <div className="panel pad stack tight">
            <h4>Upload loaders · {loaders.length}</h4>
            <p className="small muted">Each needs an Upload Input in the Modes whose Path holds it.</p>
            <div className="list">{loaders.map(([id, n]) => { const i = filler(id); return <div key={id} className="item small"><TypeDot type={UPLOAD_LOADERS[n.class_type].kind} /><span className="grow">{nodeTitle(wf, id)} <span className="mono faint">#{id}</span></span>{i ? <span>{i.label}</span> : <span style={{ color: "var(--warn)" }}>no Input yet</span>}</div>; })}</div>
          </div>
          <div className="panel pad stack tight">
            <h4>Outside services · {ext.length}</h4>
            {ext.length ? ext.map(([id, n]) => <p key={id} className="small"><strong>{nodeLabel(wf, id)}</strong>: {EXTERNAL_CLASSES[n.class_type].note} {n.inputs.api_key ? <span style={{ color: "var(--err)" }}>Its key is set.</span> : <span className="muted">Its key is empty, so nothing leaves the Backend.</span>}</p>) : <p className="small muted">No node here calls an outside service.</p>}
            <p className="small muted">Partner API nodes fail the node check, because Backends run with <code>--disable-partner-nodes</code>.</p>
          </div>
        </div>
      )}
    </StepIntro>
  );
}

// Fields an Admin usually turns into Inputs, found in the Workflow
function useSuggestions(draft) {
  return useMemo(() => {
    const wf = draft.workflow;
    if (!wf) return [];
    const boundKeys = new Set(draft.inputs.flatMap((i) => i.bindings.map(key)));
    const out = [];
    const seeds = [];
    for (const [id, n] of Object.entries(wf)) {
      const c = n.class_type;
      const cand = UPLOAD_LOADERS[c] ? UPLOAD_LOADERS[c].field
        : /^Primitive(String|StringMultiline|Int|Float|Boolean)$|^INTConstant$/.test(c) ? "value"
        : c === "mxSlider" ? "Xi" : c === "ResolutionSelector" ? "aspect_ratio" : c === "ComfySwitchNode" ? "switch"
        : c === "CLIPTextEncode" && !isLink(n.inputs.text) ? "text" : c === "RandomNoise" ? "noise_seed" : null;
      if (!cand || isLink(n.inputs[cand]) || boundKeys.has(`${id}.${cand}`)) continue;
      if (c === "RandomNoise") { seeds.push(id); continue; }
      const spec = fieldSpec(wf, id, cand);
      const type = UPLOAD_LOADERS[c] ? UPLOAD_LOADERS[c].kind : { STRING: "text", INT: "number", FLOAT: "number", BOOLEAN: "toggle", COMBO: "select" }[spec.type];
      out.push({ id: `${id}.${cand}`, type, label: UPLOAD_LOADERS[c] ? nodeTitle(wf, id).replace(/^Load /, "") : nodeTitle(wf, id), bindings: [{ node: id, field: cand }], where: `${nodeTitle(wf, id)}.${cand} #${id}`, current: n.inputs[cand] });
    }
    if (seeds.length) {
      const seedInput = draft.inputs.find((i) => i.type === "seed");
      out.unshift({ id: "seeds", type: "seed", label: "Seed", bindings: seeds.map((id) => ({ node: id, field: "noise_seed" })), where: `${seeds.length} RandomNoise node${seeds.length > 1 ? "s" : ""} not bound`, addTo: seedInput?.id });
    }
    return out;
  }, [draft.workflow, draft.inputs]);
}

function StepInputs({ studio, inputId, setInputId }) {
  const { draft, mutate } = studio;
  const suggestions = useSuggestions(draft);
  const [showAll, setShowAll] = useState(false);
  const current = draft.inputs.find((i) => i.id === inputId);
  const add = (s) => {
    if (s.addTo) { mutate((d) => d.inputs.find((i) => i.id === s.addTo).bindings.push(...s.bindings)); setInputId(s.addTo); return; }
    const inp = defaultInput(s.type, s.label, s.bindings, draft);
    mutate((d) => d.inputs.push(inp));
    setInputId(inp.id);
  };
  const visible = showAll ? suggestions : suggestions.slice(0, 5);
  return (
    <StepIntro title="Inputs users fill in" text="An Input writes its value into one or more Node fields. Left blank, those fields keep the Workflow's own values. You choose which Inputs each Mode shows in the next step.">
      <div className="vc-cols">
        <div className="stack">
          <div className="row"><h4 className="grow">Inputs · {draft.inputs.length}</h4><NewInputMenu studio={studio} onCreated={setInputId} label="Add" /></div>
          <div className="table-wrap"><div className="list">
            {draft.inputs.map((i) => {
              const e = studio.issues.filter((x) => x.inputId === i.id && x.area === "inputs" && x.level === "error").length;
              return <button key={i.id} className={`item ${i.id === inputId ? "sel" : ""}`} onClick={() => setInputId(i.id)}><TypeDot type={i.type} /><span className="grow">{i.label}</span>{e > 0 && <span className="count err">{e}</span>}</button>;
            })}
            {!draft.inputs.length && <div className="item small muted">None yet. Start from a suggestion.</div>}
          </div></div>
        </div>
        <div className="panel pad">{current ? <div className="stack"><div className="row"><TypeDot type={current.type} /><h3>{current.label}</h3><span className="small muted">{INPUT_TYPES.find((t) => t.id === current.type)?.label}</span></div><InputEditor studio={studio} inputId={current.id} onDeleted={() => setInputId(null)} /></div> : <p className="muted">Pick an Input, or add one from a suggestion.</p>}</div>
        <div className="stack">
          <h4>Suggested from your Workflow</h4>
          <p className="small muted">Fields that usually become Inputs and aren't bound yet.</p>
          <div className="table-wrap"><div className="list">
            {visible.map((s) => (
              <div key={s.id} className="suggest">
                <TypeDot type={s.type} />
                <span className="grow small"><strong>{s.label}</strong><br /><span className="muted mono wrap-anywhere">{s.where}</span></span>
                <button className="btn xs" onClick={() => add(s)}>{s.addTo ? "Add to Seed" : `Add as ${INPUT_TYPES.find((t) => t.id === s.type)?.label}`}</button>
              </div>
            ))}
            {!suggestions.length && <div className="suggest small muted">Nothing left to suggest.</div>}
          </div></div>
          {suggestions.length > 5 && <button className="btn ghost sm" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show ${suggestions.length - 5} more`}</button>}
        </div>
      </div>
    </StepIntro>
  );
}

function StepModes({ studio, modeId, setModeId, onOpenInput }) {
  const { draft, mutate } = studio;
  const mode = draft.modes.find((m) => m.id === modeId) || draft.modes[0];
  const set = (patch) => mutate((d) => Object.assign(d.modes.find((m) => m.id === mode.id), patch));
  const onPath = mode && draft.workflow ? pathSummary(draft, mode).path : new Set();
  const addMode = () => {
    const id = `mode${Date.now() % 100000}`;
    mutate((d) => d.modes.push({ id, name: `Mode ${d.modes.length + 1}`, description: "", outputs: [], states: Object.fromEntries((mode ? Object.entries(mode.states) : [])) }));
    setModeId(id);
  };
  return (
    <StepIntro title="Modes users pick" text="A Mode names the node that saves its Asset, which sets its Path, then shows, hides or fixes each Input. On the right is the form users will see.">
      <div className="vc-cols">
        <div className="stack">
          <div className="row"><h4 className="grow">Modes · {draft.modes.length}</h4><button className="btn sm" disabled={!draft.workflow} onClick={addMode} title="Copies the current Mode's Input settings"><Icon name="plus" /> Add</button></div>
          <div className="table-wrap"><div className="list">
            {draft.modes.map((m, i) => {
              const e = studio.issues.filter((x) => x.modeId === m.id && x.level === "error").length;
              const ups = draft.workflow ? pathSummary(draft, m).uploads : [];
              return (
                <button key={m.id} className={`item ${mode?.id === m.id ? "sel" : ""}`} onClick={() => setModeId(m.id)}>
                  <span className="faint tnum small" style={{ width: 16 }}>{i + 1}</span>
                  <span className="grow">{m.name}</span>
                  <span className="row nowrap" style={{ gap: 3 }}>{ups.map((u) => <TypeDot key={u.node} type={u.kind} />)}</span>
                  {e > 0 && <span className="count err">{e}</span>}
                </button>
              );
            })}
          </div></div>
          <p className="small muted">Dots are the Uploads each Mode asks for.</p>
        </div>
        {mode ? (
          <div className="stack loose">
            <div className="panel pad stack">
              <div className="fields">
                <Field label="Name" id={`c-mname-${mode.id}`}><input id={`c-mname-${mode.id}`} className="input" value={mode.name} onChange={(e) => set({ name: e.target.value })} /></Field>
                <Field label="Description" id={`c-mdesc-${mode.id}`}><input id={`c-mdesc-${mode.id}`} className="input" value={mode.description} onChange={(e) => set({ description: e.target.value })} /></Field>
              </div>
              <OutputsEditor studio={studio} modeId={mode.id} />
              <PathFacts studio={studio} mode={mode} />
            </div>
            <div className="stack tight">
              <h4>Inputs in {mode.name}</h4>
              <div className="table-wrap">
                {draft.inputs.map((i) => {
                  const st = stateOf(mode, i.id);
                  const relevant = i.bindings.some((b) => onPath.has(b.node));
                  return (
                    <div key={i.id} className="state-row" style={!relevant && st.s === "hidden" ? { opacity: 0.6 } : undefined}>
                      <span className="small"><button className="btn ghost xs" style={{ padding: 0 }} onClick={() => onOpenInput(i.id)}><TypeDot type={i.type} /> <strong>{i.label}</strong></button>{!relevant && <span className="faint"> · not on this Path</span>}</span>
                      <StateEditor size="sm" input={i} st={st} onChange={(ns) => mutate((d) => { d.modes.find((m) => m.id === mode.id).states[i.id] = ns; })} />
                    </div>
                  );
                })}
              </div>
            </div>
            <ChecksList studio={studio} title="Checks for this Mode" filter={(x) => x.modeId === mode.id} />
          </div>
        ) : <p className="muted">Add a Mode to start.</p>}
        <div className="stack tight" style={{ position: "sticky", top: 150 }}>
          <span className="eyebrow">What users see</span>
          {mode && <UserForm studio={studio} mode={mode} preview />}
        </div>
      </div>
    </StepIntro>
  );
}

function StepDetails({ studio }) {
  const { draft } = studio;
  const d = draft.details;
  return (
    <StepIntro title="Name and terms" text="How the Model shows in the Model list, and what users acknowledge before using it.">
      <div className="vc-cols two">
        <div className="stack loose"><DetailsForm studio={studio} /><hr className="divider" /><TermsForm studio={studio} /></div>
        <div className="stack tight" style={{ position: "sticky", top: 150 }}>
          <span className="eyebrow">In the Model list</span>
          <div className="panel pad stack tight"><strong>{d.name || "Untitled Model"}</strong><span className="small muted">{d.description || "No description"}</span>{d.attribution && <span className="small faint">{d.attribution}</span>}</div>
          {d.termsText && (<><span className="eyebrow" style={{ marginTop: 10 }}>Before first use</span>
            <div className="panel pad stack tight"><strong>{d.name} terms</strong><p className="small">{d.termsText}</p>{d.licenseUrl && <a className="small" href={d.licenseUrl} target="_blank" rel="noreferrer">Read the license</a>}<div className="row"><span className="spacer" /><button className="btn sm" disabled>Not now</button><button className="btn sm primary" disabled>I agree</button></div></div></>)}
        </div>
      </div>
    </StepIntro>
  );
}

function StepTest({ studio, onJump }) {
  return (
    <StepIntro title="Test, then enable" text="Run a Mode on a Backend to see a real Asset come back. Enabling makes the Model visible to users once nothing blocks it.">
      <div className="vc-cols two-l">
        <div className="stack loose">
          <div className="panel pad stack"><EnableSwitch studio={studio} /><SaveControls studio={studio} /></div>
          <ChecksList studio={studio} onJump={onJump} />
        </div>
        <TestRunner studio={studio} layout="split" />
      </div>
    </StepIntro>
  );
}
