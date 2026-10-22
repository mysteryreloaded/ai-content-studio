// PROTOTYPE Variant B: "Workflow inspector". Starts from the graph, the way a
// ComfyUI user thinks: pick a node, see its Node fields, turn a field into an
// Input. A Mode bar on top dims nodes outside that Mode's Path.
import {
  Icon, TypeDot, Field, Seg, StateChip, StateEditor, InputEditor, NewInputMenu, OutputsEditor, PathFacts, ChecksList,
  SaveControls, EnableSwitch, ModelFileActions, DetailsForm, TermsForm, BackendsPanel, WorkflowPanel, TestRunner,
  defaultInput, inferInputType, short, fmt,
} from "./ui.jsx";
import { stateOf, nodeTitle, nodeLabel, nodeGroup, GROUP_ORDER, fieldSpec, compatible, isLink, key, computePath, OUTPUT_CLASSES, PREVIEW_CLASSES, UPLOAD_LOADERS } from "./logic.js";
import { EXTERNAL_CLASSES } from "./data.js";

const { useState, useMemo, useEffect } = React;

export function VariantB({ studio }) {
  const { draft, issues } = studio;
  const wf = draft.workflow;
  const [modeId, setModeId] = useState(null);
  const [nodeId, setNodeId] = useState(() => (wf?.["6010"] ? "6010" : null));
  const [tab, setTab] = useState("mode");
  const [inputId, setInputId] = useState(null);
  const [q, setQ] = useState("");
  const [onlyPath, setOnlyPath] = useState(false);
  const mode = draft.modes.find((m) => m.id === modeId) || null;
  const path = useMemo(() => (mode && wf ? computePath(draft, mode) : null), [draft, mode, wf]);
  useEffect(() => { if (!wf) setNodeId(null); }, [wf]);

  const bound = useMemo(() => {
    const m = {};
    draft.inputs.forEach((i) => i.bindings.forEach((b) => (m[key(b)] = i)));
    return m;
  }, [draft.inputs]);
  const groups = useMemo(() => {
    if (!wf) return [];
    const ql = q.trim().toLowerCase();
    const g = {};
    Object.entries(wf).forEach(([id, n]) => {
      if (ql && !(id.includes(ql) || n.class_type.toLowerCase().includes(ql) || (n._meta?.title || "").toLowerCase().includes(ql))) return;
      if (onlyPath && path && !path.has(id)) return;
      (g[nodeGroup(n)] ||= []).push(id);
    });
    return GROUP_ORDER.filter((k) => g[k]).map((k) => [k, g[k].sort((a, b) => Number(a) - Number(b))]);
  }, [wf, q, onlyPath, path]);

  const openInput = (id) => { setInputId(id); setTab("inputs"); };
  const jump = (x) => {
    if (x.modeId) setModeId(x.modeId);
    if (x.nodeId) setNodeId(x.nodeId);
    if (x.area === "inputs" && x.inputId) openInput(x.inputId);
    else if (x.area === "backends") setTab("model");
    else if (x.area === "terms" || x.area === "details") setTab("model");
    else if (x.modeId) setTab("mode");
  };
  const errs = issues.filter((x) => x.level === "error").length;
  const warns = issues.filter((x) => x.level === "warning").length;

  return (
    <div className="vb">
      <header className="vb-head">
        <div className="row">
          <h2 className="grow">{draft.details.name || "New Model"} <span className="small muted" style={{ fontFamily: "var(--font-ui)", fontWeight: 400 }}>{draft.details.enabled ? "· enabled" : "· disabled"}{draft.revision ? ` · revision ${draft.revision}` : ""}</span></h2>
          <ModelFileActions studio={studio} />
          <SaveControls studio={studio} />
        </div>
        {draft.modes.length > 0 && (
          <div className="vb-modes" role="group" aria-label="Show a Mode's Path">
            <button aria-pressed={!mode} onClick={() => setModeId(null)}>Whole Workflow</button>
            {draft.modes.map((m) => {
              const e = issues.filter((x) => x.modeId === m.id && x.level === "error").length;
              return <button key={m.id} aria-pressed={modeId === m.id} onClick={() => { setModeId(m.id); setTab("mode"); }}>{m.name}{e > 0 && <span className="count err">{e}</span>}</button>;
            })}
          </div>
        )}
      </header>
      <div className="vb-panes">
        <aside className="vb-nodes">
          <div className="pad-sm stack tight" style={{ borderBottom: "1px solid var(--line)" }}>
            <input className="input" placeholder="Find a node by title, class or id" value={q} onChange={(e) => setQ(e.target.value)} id="b-node-search" disabled={!wf} />
            {mode && <label className="check small"><input type="checkbox" checked={onlyPath} onChange={(e) => setOnlyPath(e.target.checked)} id="b-only-path" /> Only nodes on {short(mode.name, 28)}'s Path ({path?.size})</label>}
          </div>
          <div className="scroll">
            {!wf && <p className="pad muted small">Upload a Workflow to see its nodes.</p>}
            {groups.map(([g, ids]) => (
              <div key={g}>
                <div className="node-group eyebrow">{g} · {ids.length}</div>
                {ids.map((id) => {
                  const n = wf[id];
                  const nBound = Object.keys(n.inputs).filter((f) => bound[`${id}.${f}`]).length;
                  const isOut = draft.modes.some((m) => m.outputs.some((o) => o.node === id));
                  return (
                    <button key={id} className={`node-row ${nodeId === id ? "sel" : ""} ${path && !path.has(id) ? "dim" : ""}`} onClick={() => setNodeId(id)}>
                      <span className="t">{nodeTitle(wf, id)}</span>
                      {nBound > 0 && <span className="pill accent" title="Fields bound to Inputs">{nBound} bound</span>}
                      {isOut && <span className="pill">output</span>}
                      {EXTERNAL_CLASSES[n.class_type] && <span className="pill warn" title={EXTERNAL_CLASSES[n.class_type].note}><Icon name="ext" size={11} /></span>}
                      <span className="mono faint small">#{id}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>
        <main className="vb-node">
          {!wf ? <><h2>Start with the Workflow</h2><WorkflowPanel studio={studio} /></> : nodeId && wf[nodeId] ? (
            <NodeInspector studio={studio} nodeId={nodeId} mode={mode} path={path} bound={bound} onOpenInput={openInput} onSelectNode={setNodeId} />
          ) : <p className="muted">Pick a node on the left.</p>}
          {wf && <details className="panel pad-sm"><summary className="small" style={{ cursor: "pointer" }}><strong>Workflow file</strong> <span className="muted">· {Object.keys(wf).length} nodes · re-upload</span></summary><div style={{ marginTop: 10 }}><WorkflowPanel studio={studio} /></div></details>}
        </main>
        <aside className="vb-side">
          <div className="tabs" role="tablist">
            {[["mode", mode ? "Mode" : "Modes"], ["inputs", `Inputs ${draft.inputs.length}`], ["model", "Model"], ["test", "Test"], ["checks", "Checks"]].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}{id === "checks" && errs > 0 && <span className="count err">{errs}</span>}{id === "checks" && !errs && warns > 0 && <span className="count warn">{warns}</span>}</button>
            ))}
          </div>
          <div className="scroll pad stack loose">
            {tab === "mode" && (mode ? <ModePanel studio={studio} mode={mode} onOpenInput={openInput} /> : <ModesList studio={studio} onPick={(id) => setModeId(id)} />)}
            {tab === "inputs" && (inputId && draft.inputs.some((i) => i.id === inputId) ? (
              <div className="stack">
                <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setInputId(null)}><Icon name="left" /> All Inputs</button>
                <h3>{draft.inputs.find((i) => i.id === inputId).label}</h3>
                <InputEditor studio={studio} inputId={inputId} onDeleted={() => setInputId(null)} />
              </div>
            ) : (
              <div className="stack">
                <div className="row"><p className="small muted grow">Fields users fill in, in the order shown. Make one from a node's field, or start blank.</p><NewInputMenu studio={studio} onCreated={setInputId} label="Blank" /></div>
                <div className="table-wrap"><div className="list">
                  {draft.inputs.map((i) => (
                    <button key={i.id} className="item" onClick={() => setInputId(i.id)}>
                      <TypeDot type={i.type} /><span className="grow">{i.label}</span>
                      {mode && <StateChip input={i} st={stateOf(mode, i.id)} />}
                      <span className="small faint tnum">{i.bindings.length} field{i.bindings.length === 1 ? "" : "s"}</span>
                    </button>
                  ))}
                  {!draft.inputs.length && <div className="item muted small">No Inputs yet.</div>}
                </div></div>
              </div>
            ))}
            {tab === "model" && (
              <div className="stack loose">
                <EnableSwitch studio={studio} />
                <DetailsForm studio={studio} />
                <hr className="divider" />
                <h4>Backends</h4>
                <BackendsPanel studio={studio} />
                <hr className="divider" />
                <h4>Terms and attribution</h4>
                <TermsForm studio={studio} />
              </div>
            )}
            {tab === "test" && <TestRunner studio={studio} modeId={mode?.id} />}
            {tab === "checks" && <ChecksList studio={studio} onJump={jump} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

function NodeInspector({ studio, nodeId, mode, path, bound, onOpenInput, onSelectNode }) {
  const { draft, mutate } = studio;
  const wf = draft.workflow;
  const n = wf[nodeId];
  const [binding, setBinding] = useState(null);
  const onPath = path ? path.has(nodeId) : null;
  const isOutputClass = OUTPUT_CLASSES[n.class_type];
  const usedBy = draft.modes.filter((m) => m.outputs.some((o) => o.node === nodeId));
  const ext = EXTERNAL_CLASSES[n.class_type];
  const loader = UPLOAD_LOADERS[n.class_type];
  const makeInput = (field) => {
    const type = inferInputType(wf, nodeId, field);
    const label = loader ? nodeTitle(wf, nodeId).replace(/^Load /, "") : field === "value" ? nodeTitle(wf, nodeId) : `${nodeTitle(wf, nodeId)} ${field}`;
    const inp = defaultInput(type, label, [{ node: nodeId, field }], draft);
    mutate((d) => d.inputs.push(inp));
    onOpenInput(inp.id);
  };
  return (
    <div className="stack loose">
      <div className="stack tight">
        <span className="eyebrow">{nodeGroup(n)}</span>
        <div className="row"><h2 className="grow">{nodeTitle(wf, nodeId)}</h2><span className="mono muted">{n.class_type} · #{nodeId}</span></div>
        {mode && <span className={`pill ${onPath ? "accent" : ""}`} style={{ alignSelf: "flex-start" }}>{onPath ? `On ${mode.name}'s Path` : `Not on ${mode.name}'s Path, so never sent in that Mode`}</span>}
        {ext && <p className="callout warn">{ext.note} The key field is {n.inputs[ext.keyField] ? <strong>set</strong> : "empty"}{n.inputs[ext.keyField] ? ", so user prompts leave the Backend. Clear it in ComfyUI and re-upload." : ", so encoding stays on the Backend."}</p>}
        {loader && <p className="note">Upload loader. In each Mode whose Path holds it, an Input must fill its <code>{loader.field}</code> field (or a fixed file name), or that Mode can't be enabled.</p>}
      </div>

      {(isOutputClass || PREVIEW_CLASSES.has(n.class_type)) && (
        <div className="panel pad-sm stack tight">
          <strong>Output node</strong>
          {PREVIEW_CLASSES.has(n.class_type) ? <span className="small" style={{ color: "var(--err)" }}>A preview node saves no file, so it can't be a Mode's output.</span> : (
            <>
              <span className="small muted">Saves a {isOutputClass}. {usedBy.length ? `Output of ${usedBy.map((m) => m.name).join(", ")}.` : "No Mode uses it yet."}</span>
              {mode && (
                <label className="check small"><input type="checkbox" checked={mode.outputs.some((o) => o.node === nodeId)} onChange={(e) => mutate((d) => { const m = d.modes.find((x) => x.id === mode.id); m.outputs = e.target.checked ? [...m.outputs, { node: nodeId, kind: isOutputClass }] : m.outputs.filter((o) => o.node !== nodeId); })} /> Use as an output of {mode.name}</label>
              )}
            </>
          )}
        </div>
      )}

      <div className="stack tight">
        <h4>Node fields</h4>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Field</th><th>Workflow value</th><th>Input</th>{mode && <th>In {short(mode.name, 18)}</th>}</tr></thead>
            <tbody>
              {Object.entries(n.inputs).map(([f, v]) => {
                const spec = fieldSpec(wf, nodeId, f);
                const input = bound[`${nodeId}.${f}`];
                const linked = isLink(v);
                const others = draft.inputs.filter((i) => i !== input && compatible(i.type, spec, n.class_type, f));
                return (
                  <tr key={f} className="fieldrow">
                    <td><span className="row nowrap" style={{ gap: 6 }}><TypeDot type={spec.type} /><span className="mono">{f}</span></span><span className="small faint">{spec.type === "LINK" ? "link" : spec.type}</span></td>
                    <td className="small wrap-anywhere" style={{ maxWidth: 260 }}>{linked ? <button className="btn ghost xs" style={{ padding: 0 }} onClick={() => onSelectNode(v[0])}>← {nodeLabel(wf, v[0])}</button> : <span className="mono">{short(fmt(v), 60)}</span>}</td>
                    <td style={{ minWidth: 150 }}>
                      {linked ? <span className="small faint">Fed by a link. Bind the source node.</span> : input ? (
                        <button className="btn sm" onClick={() => onOpenInput(input.id)}><TypeDot type={input.type} /> {input.label}</button>
                      ) : binding === f ? (
                        <div className="stack tight">
                          <button className="btn sm primary" onClick={() => { setBinding(null); makeInput(f); }}>New Input from this field</button>
                          {others.length > 0 && (
                            <select className="select" defaultValue="" onChange={(e) => { const id = e.target.value; mutate((d) => d.inputs.find((i) => i.id === id).bindings.push({ node: nodeId, field: f })); setBinding(null); }}>
                              <option value="" disabled>Or add to an Input…</option>
                              {others.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                            </select>
                          )}
                          <button className="btn ghost xs" onClick={() => setBinding(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button className="btn ghost sm" onClick={() => setBinding(f)}><Icon name="plus" /> Make it an Input</button>
                      )}
                    </td>
                    {mode && (
                      <td style={{ minWidth: 200 }}>
                        {input ? <StateEditor size="sm" input={input} st={stateOf(mode, input.id)} onChange={(ns) => mutate((d) => { d.modes.find((m) => m.id === mode.id).states[input.id] = ns; })} /> : <span className="small faint">{linked ? "" : "Keeps the Workflow value"}</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ModesList({ studio, onPick }) {
  const { draft, mutate } = studio;
  return (
    <div className="stack">
      <div className="row"><p className="small muted grow">Pick a Mode to see its Path and set its Inputs. Its nodes light up on the left.</p>
        <button className="btn sm" disabled={!draft.workflow} onClick={() => { const id = `mode${Date.now() % 100000}`; mutate((d) => d.modes.push({ id, name: `Mode ${d.modes.length + 1}`, description: "", outputs: [], states: {} })); onPick(id); }}><Icon name="plus" /> Mode</button></div>
      <div className="table-wrap"><div className="list">
        {draft.modes.map((m) => {
          const e = studio.issues.filter((x) => x.modeId === m.id && x.level === "error").length;
          return <button key={m.id} className="item" onClick={() => onPick(m.id)}><span className="grow">{m.name}</span>{e > 0 && <span className="count err">{e}</span>}<span className="mono faint small">{m.outputs.map((o) => `#${o.node}`).join(" ")}</span></button>;
        })}
        {!draft.modes.length && <div className="item muted small">No Modes yet.</div>}
      </div></div>
    </div>
  );
}

function ModePanel({ studio, mode, onOpenInput }) {
  const { draft, mutate } = studio;
  const set = (patch) => mutate((d) => Object.assign(d.modes.find((m) => m.id === mode.id), patch));
  return (
    <div className="stack loose">
      <Field label="Mode name" id={`b-mname-${mode.id}`}><input id={`b-mname-${mode.id}`} className="input" value={mode.name} onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Description" id={`b-mdesc-${mode.id}`}><input id={`b-mdesc-${mode.id}`} className="input" value={mode.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <OutputsEditor studio={studio} modeId={mode.id} />
      <PathFacts studio={studio} mode={mode} />
      <div className="stack tight">
        <div className="eyebrow">Inputs in this Mode</div>
        <div className="table-wrap"><div className="list">
          {draft.inputs.map((i) => (
            <div key={i.id} className="item" style={{ flexWrap: "wrap" }}>
              <button className="btn ghost xs grow" style={{ justifyContent: "flex-start" }} onClick={() => onOpenInput(i.id)}><TypeDot type={i.type} /> {i.label}</button>
              <StateEditor size="sm" input={i} st={stateOf(mode, i.id)} onChange={(ns) => mutate((d) => { d.modes.find((m) => m.id === mode.id).states[i.id] = ns; })} />
            </div>
          ))}
        </div></div>
      </div>
      <ChecksList studio={studio} title="This Mode" filter={(x) => x.modeId === mode.id} />
    </div>
  );
}
