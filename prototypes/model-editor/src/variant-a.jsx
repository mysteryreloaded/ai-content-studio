// PROTOTYPE Variant A: "Sections". A classic admin form: section nav on the left,
// one section at a time, live checks in a right rail. The Mode × Input grid is
// the centrepiece of the Modes section.
import {
  Icon, TypeDot, Field, Sheet, StateChip, StateEditor, InputEditor, NewInputMenu, OutputsEditor, PathFacts,
  ChecksList, SaveControls, EnableSwitch, ModelFileActions, DetailsForm, TermsForm, BackendsPanel, WorkflowPanel, TestRunner, short, useEscape,
} from "./ui.jsx";
import { stateOf, nodeTitle, nodeGroup, GROUP_ORDER, UPLOAD_LOADERS, OUTPUT_CLASSES, pathSummary, key, INPUT_TYPES } from "./logic.js";
import { EXTERNAL_CLASSES } from "./data.js";

const { useState, useMemo } = React;

const SECTIONS = [
  { id: "details", label: "Details", areas: ["details"] },
  { id: "workflow", label: "Workflow", areas: ["workflow"] },
  { id: "inputs", label: "Inputs", areas: ["inputs"] },
  { id: "modes", label: "Modes", areas: ["modes"] },
  { id: "backends", label: "Backends", areas: ["backends"] },
  { id: "terms", label: "Terms and attribution", areas: ["terms"] },
  { id: "test", label: "Test", areas: [] },
];

export function VariantA({ studio }) {
  const { draft, issues } = studio;
  const [section, setSection] = useState(draft.workflow ? "modes" : "workflow");
  const [openInput, setOpenInput] = useState(null);
  const [openMode, setOpenMode] = useState(null);
  const jump = (x) => {
    const s = SECTIONS.find((s) => s.areas.includes(x.area));
    if (x.area === "inputs" && x.inputId) { setSection("inputs"); setOpenInput(x.inputId); return; }
    if (x.area === "modes" && x.modeId && (x.brokenOutput || /output/.test(x.text))) { setSection("modes"); setOpenMode(x.modeId); return; }
    if (s) setSection(s.id);
  };
  const counts = (s) => {
    const list = issues.filter((x) => s.areas.includes(x.area));
    return { e: list.filter((x) => x.level === "error").length, w: list.filter((x) => x.level === "warning").length };
  };
  return (
    <div className="va">
      <header className="va-head">
        <div className="grow stack tight" style={{ minWidth: 200 }}>
          <span className="small muted">Admin / Models</span>
          <div className="row"><h1>{draft.details.name || "New Model"}</h1>
            <span className={`pill ${draft.details.enabled ? "ok" : ""}`}>{draft.details.enabled ? "Enabled" : "Disabled"}</span>
            {draft.revision > 0 && <span className="pill outline tnum">revision {draft.revision}</span>}
          </div>
        </div>
        <ModelFileActions studio={studio} />
        <SaveControls studio={studio} />
      </header>
      <div className="va-body">
        <nav className="va-nav" aria-label="Model sections">
          {SECTIONS.map((s) => {
            const c = counts(s);
            return (
              <button key={s.id} aria-current={section === s.id} onClick={() => setSection(s.id)}>
                <span className="grow">{s.label}</span>
                {c.e > 0 && <span className="count err tnum">{c.e}</span>}
                {!c.e && c.w > 0 && <span className="count warn tnum">{c.w}</span>}
              </button>
            );
          })}
        </nav>
        <main className="va-main">
          {section === "details" && <Section title="Details" sub="How the Model appears in the Model list and at its URL."><DetailsForm studio={studio} /></Section>}
          {section === "workflow" && <WorkflowSection studio={studio} />}
          {section === "inputs" && <InputsSection studio={studio} onOpen={setOpenInput} />}
          {section === "modes" && <ModesSection studio={studio} onOpenInput={setOpenInput} onOpenMode={setOpenMode} />}
          {section === "backends" && <Section title="Backends" sub="ComfyUI servers this Model runs on. Backends are shared between Models; each runs one Generation at a time."><BackendsPanel studio={studio} /></Section>}
          {section === "terms" && <Section title="Terms and attribution" sub="Optional. What users acknowledge, and the credit shown with the Model."><TermsForm studio={studio} /></Section>}
          {section === "test" && <Section title="Test Generation" sub="Run one Mode end to end before enabling the Model."><TestRunner studio={studio} /></Section>}
        </main>
        <aside className="va-rail">
          <div className="sticky">
            <EnableSwitch studio={studio} />
            <hr className="divider" />
            <ChecksList studio={studio} onJump={jump} />
          </div>
        </aside>
      </div>
      {openInput && (
        <Sheet eyebrow="Input" title={draft.inputs.find((i) => i.id === openInput)?.label || "Input"} onClose={() => setOpenInput(null)}>
          <InputEditor studio={studio} inputId={openInput} onDeleted={() => setOpenInput(null)} />
        </Sheet>
      )}
      {openMode && draft.modes.find((m) => m.id === openMode) && (
        <Sheet eyebrow="Mode" title={draft.modes.find((m) => m.id === openMode).name} onClose={() => setOpenMode(null)}>
          <ModeEditor studio={studio} modeId={openMode} onDeleted={() => setOpenMode(null)} />
        </Sheet>
      )}
    </div>
  );
}

function Section({ title, sub, children, actions }) {
  return (
    <section className="stack loose">
      <div className="section-head"><div className="grow stack tight"><h2>{title}</h2>{sub && <p className="muted prose">{sub}</p>}</div>{actions}</div>
      {children}
    </section>
  );
}

function WorkflowSection({ studio }) {
  const { draft } = studio;
  const [q, setQ] = useState("");
  const wf = draft.workflow;
  const bound = useMemo(() => {
    const m = {};
    draft.inputs.forEach((i) => i.bindings.forEach((b) => (m[b.node] = [...(m[b.node] || []), `${i.label} → ${b.field}`])));
    return m;
  }, [draft.inputs]);
  const outputsOf = useMemo(() => {
    const m = {};
    draft.modes.forEach((md) => md.outputs.forEach((o) => (m[o.node] = [...(m[o.node] || []), md.name])));
    return m;
  }, [draft.modes]);
  const rows = wf ? Object.entries(wf).filter(([id, n]) => !q || id.includes(q) || n.class_type.toLowerCase().includes(q.toLowerCase()) || (n._meta?.title || "").toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => GROUP_ORDER.indexOf(nodeGroup(a[1])) - GROUP_ORDER.indexOf(nodeGroup(b[1])) || Number(a[0]) - Number(b[0])) : [];
  return (
    <Section title="Workflow" sub="The ComfyUI graph this Model runs, in API format. Each Mode sends only its Path: its output nodes and everything they depend on.">
      <WorkflowPanel studio={studio} />
      {wf && (
        <div className="stack tight">
          <div className="row"><h3 className="grow">Nodes</h3><input className="input" style={{ maxWidth: 260 }} placeholder="Filter nodes" value={q} onChange={(e) => setQ(e.target.value)} id="a-node-filter" /></div>
          <div className="table-wrap" style={{ maxHeight: "52vh", overflowY: "auto" }}>
            <table className="t">
              <thead><tr><th>Node</th><th>Class</th><th>Group</th><th>Used by</th></tr></thead>
              <tbody>
                {rows.map(([id, n]) => (
                  <tr key={id}>
                    <td><strong>{nodeTitle(wf, id)}</strong> <span className="mono faint">#{id}</span></td>
                    <td className="mono small">{n.class_type}</td>
                    <td className="small muted">{nodeGroup(n)}</td>
                    <td className="small">
                      {bound[id]?.map((t) => <div key={t}>{t}</div>)}
                      {outputsOf[id] && <div className="muted">Output of {outputsOf[id].join(", ")}</div>}
                      {EXTERNAL_CLASSES[n.class_type] && <div style={{ color: "var(--warn)" }}>{EXTERNAL_CLASSES[n.class_type].note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
}

function InputsSection({ studio, onOpen }) {
  const { draft, mutate } = studio;
  const move = (i, d) => mutate((x) => x.inputs.splice(i + d, 0, x.inputs.splice(i, 1)[0]));
  return (
    <Section title="Inputs" sub="The fields users fill in. Each writes its value into one or more Node fields; blank keeps the Workflow's own value. They appear in this order." actions={<NewInputMenu studio={studio} onCreated={onOpen} />}>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th /><th>Input</th><th>Type</th><th>Writes into</th><th>Shown in</th></tr></thead>
          <tbody>
            {draft.inputs.map((input, i) => {
              const shown = draft.modes.filter((m) => ["optional", "required"].includes(stateOf(m, input.id).s)).length;
              const fixed = draft.modes.filter((m) => stateOf(m, input.id).s === "fixed").length;
              const errs = studio.issues.filter((x) => x.inputId === input.id && x.area === "inputs" && x.level === "error").length;
              return (
                <tr key={input.id} className="clickable" onClick={() => onOpen(input.id)}>
                  <td style={{ width: 54 }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn ghost xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><Icon name="up" size={12} /></button>
                    <button className="btn ghost xs" disabled={i === draft.inputs.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><Icon name="down" size={12} /></button>
                  </td>
                  <td><strong>{input.label}</strong> {errs > 0 && <span className="count err">{errs}</span>}</td>
                  <td className="small"><span className="row nowrap" style={{ gap: 6 }}><TypeDot type={input.type} />{INPUT_TYPES.find((t) => t.id === input.type)?.label}</span></td>
                  <td className="small">{input.bindings.length ? <>{short(draft.workflow?.[input.bindings[0].node] ? nodeTitle(draft.workflow, input.bindings[0].node) : `#${input.bindings[0].node}`, 28)}<span className="mono">.{input.bindings[0].field}</span>{input.bindings.length > 1 && <span className="muted"> +{input.bindings.length - 1}</span>}</> : <span style={{ color: "var(--err)" }}>Not bound</span>}</td>
                  <td className="small muted tnum">{shown} Mode{shown === 1 ? "" : "s"}{fixed ? `, fixed in ${fixed}` : ""}</td>
                </tr>
              );
            })}
            {!draft.inputs.length && <tr><td colSpan={5} className="muted">No Inputs yet. Add one, then bind it to a Node field.</td></tr>}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function ModesSection({ studio, onOpenInput, onOpenMode }) {
  const { draft, mutate } = studio;
  const [cell, setCell] = useState(null);
  const wf = draft.workflow;
  const addMode = () => {
    const id = `mode${Date.now() % 100000}`;
    mutate((d) => d.modes.push({ id, name: `Mode ${d.modes.length + 1}`, description: "", outputs: [], states: {} }));
    onOpenMode(id);
  };
  const cellErr = (m, input) => studio.issues.some((x) => x.level === "error" && x.modeId === m.id && x.text.includes(input.label));
  return (
    <Section title="Modes" sub="Each Mode is a preset users pick. Its output nodes set its Path; each cell sets whether an Input is hidden, optional, required or fixed in that Mode. Click a cell to change it, or a Mode's name to edit it." actions={<button className="btn sm" disabled={!wf} onClick={addMode}><Icon name="plus" /> Mode</button>}>
      {!draft.modes.length ? <p className="note">No Modes yet. A Model needs at least one; name its output node to define its Path.</p> : (
        <div className="grid-wrap">
          <table className="mg">
            <thead>
              <tr>
                <th className="rowh"><span className="eyebrow">Input ↓ · Mode →</span></th>
                {draft.modes.map((m) => {
                  const errs = studio.issues.filter((x) => x.modeId === m.id && x.level === "error").length;
                  const { uploads } = wf ? pathSummary(draft, m) : { uploads: [] };
                  return (
                    <th key={m.id}>
                      <button onClick={() => onOpenMode(m.id)} title="Edit this Mode">
                        <span className="mname">{m.name}</span>
                        <span className="row" style={{ gap: 3, marginTop: 3 }}>{uploads.map((u) => <TypeDot key={u.node} type={u.kind} />)}{errs > 0 && <span className="count err">{errs}</span>}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr className="outrow">
                <th className="rowh small">Output (main Asset)</th>
                {draft.modes.map((m) => {
                  const o = m.outputs[0];
                  return <td key={m.id} className="small mono" style={!o || !wf?.[o.node] ? { color: "var(--err)" } : undefined}>{o ? (wf?.[o.node] ? `#${o.node}` : `#${o.node} missing`) : "none"}{m.outputs.length > 1 && ` +${m.outputs.length - 1}`}</td>;
                })}
              </tr>
              {draft.inputs.map((input) => (
                <tr key={input.id}>
                  <th className="rowh"><button className="btn ghost xs" style={{ padding: 0 }} onClick={() => onOpenInput(input.id)}><TypeDot type={input.type} /> {input.label}</button></th>
                  {draft.modes.map((m) => {
                    const st = stateOf(m, input.id);
                    const k = `${m.id}:${input.id}`;
                    return (
                      <td key={m.id} className={`cell ${cellErr(m, input) ? "has-err" : ""}`}>
                        <div className="pop-anchor">
                          <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCell(cell?.k === k ? null : { k, modeId: m.id, inputId: input.id, top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 300)) }); }} aria-label={`${input.label} in ${m.name}: ${st.s}`}><StateChip input={input} st={st} /></button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cell && (() => {
        const m = draft.modes.find((x) => x.id === cell.modeId);
        const input = draft.inputs.find((x) => x.id === cell.inputId);
        if (!m || !input) return null;
        return (
          <FloatingPanel top={cell.top} left={cell.left} onClose={() => setCell(null)}>
            <div className="stack tight">
              <span className="small"><strong>{input.label}</strong> <span className="muted">in {m.name}</span></span>
              <StateEditor size="sm" input={input} st={stateOf(m, input.id)} onChange={(ns) => mutate((d) => { d.modes.find((x) => x.id === m.id).states[input.id] = ns; })} />
            </div>
          </FloatingPanel>
        );
      })()}
      <p className="small muted">Coloured dots under a Mode's name are the Uploads its Path asks for. A red outline marks a cell with an error.</p>
    </Section>
  );
}

function FloatingPanel({ top, left, onClose, children }) {
  const ref = React.useRef(null);
  useEscape(onClose);
  React.useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest("td.cell")) onClose(); };
    const onScroll = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("scroll", onScroll, true); };
  }, [onClose]);
  return <div ref={ref} className="popover" style={{ position: "fixed", top: Math.min(top, window.innerHeight - 150), left }}>{children}</div>;
}

function ModeEditor({ studio, modeId, onDeleted }) {
  const { draft, mutate } = studio;
  const mode = draft.modes.find((m) => m.id === modeId);
  const set = (patch) => mutate((d) => Object.assign(d.modes.find((m) => m.id === modeId), patch));
  const i = draft.modes.indexOf(mode);
  return (
    <div className="stack loose">
      <div className="fields">
        <Field label="Name" id={`m-name-${modeId}`}><input id={`m-name-${modeId}`} className="input" value={mode.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Position" hint={`${i + 1} of ${draft.modes.length}`}><div className="row nowrap"><button className="btn sm" disabled={i === 0} onClick={() => mutate((d) => d.modes.splice(i - 1, 0, d.modes.splice(i, 1)[0]))}>Earlier</button><button className="btn sm" disabled={i === draft.modes.length - 1} onClick={() => mutate((d) => d.modes.splice(i + 1, 0, d.modes.splice(i, 1)[0]))}>Later</button></div></Field>
      </div>
      <Field label="Description" hint="Optional, one line." id={`m-desc-${modeId}`}><input id={`m-desc-${modeId}`} className="input" value={mode.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <OutputsEditor studio={studio} modeId={modeId} />
      <PathFacts studio={studio} mode={mode} />
      <ChecksList studio={studio} title="This Mode" filter={(x) => x.modeId === modeId} />
      <div className="row"><span className="spacer" /><button className="btn danger sm" onClick={() => { mutate((d) => (d.modes = d.modes.filter((m) => m.id !== modeId))); onDeleted(); }}>Delete Mode</button></div>
    </div>
  );
}
