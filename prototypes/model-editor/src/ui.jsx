// PROTOTYPE shared widgets. Variants share these pieces, never a layout.
import { EXTERNAL_CLASSES, FIELD_SPECS, buildLtxWorkflow } from "./data.js";
import {
  UPLOAD_LOADERS, OUTPUT_CLASSES, PREVIEW_CLASSES, STATES, INPUT_TYPES, UPLOAD_TYPES,
  isLink, key, nodeTitle, nodeLabel, fieldSpec, compatible, stateOf, pathSummary, visibleInputs,
  validateBackendUrl, reexport, workflowStats, nodeGroup, GROUP_ORDER, slugify,
} from "./logic.js";
import { useTestRun } from "./store.js";

const { useState, useMemo, useRef, useEffect, Fragment } = React;

// ---------- primitives ----------
const PATHS = {
  left: "M10 3 5 8l5 5", right: "m6 3 5 5-5 5", plus: "M8 3v10M3 8h10", x: "m4 4 8 8M12 4l-8 8",
  up: "m4 10 4-4 4 4", down: "m4 6 4 4 4-4", check: "m3.5 8.5 3 3 6-7", lock: "M5 7V5a3 3 0 0 1 6 0v2M4 7h8v6H4z",
  err: "M8 4.5v4M8 11v.5M8 1.5l6.5 12h-13z", warn: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 5v3.5M8 10.5v.5",
  upload: "M8 11V3M5 6l3-3 3 3M3 12v1.5h10V12", link: "M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5L8 4.5M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5L8 11.5",
  ext: "M9 3h4v4M13 3 7 9M11 9v4H3V5h4", play: "M5 3.5v9l7-4.5z", grid: "M2.5 2.5h11v11h-11zM2.5 6.5h11M6.5 2.5v11",
  node: "M2.5 4.5h7v7h-7zM9.5 8h4", eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
};
export function Icon({ name, size = 14, className = "" }) {
  return (
    <svg className={`ic ${className}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
export const TypeDot = ({ type }) => <span className={`dot t-${type}`} title={type} />;

export function Switch({ checked, onChange, label, disabled, id }) {
  return (
    <span id={id} role="switch" tabIndex={0} aria-checked={checked} aria-disabled={!!disabled} className="switch"
      onClick={() => !disabled && onChange(!checked)}
      onKeyDown={(e) => { if (!disabled && (e.key === " " || e.key === "Enter")) { e.preventDefault(); onChange(!checked); } }}>
      <span className="track" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Seg({ value, options, onChange, size }) {
  return (
    <span className={`seg ${size || ""}`} role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} title={o.title}>{o.label}</button>
      ))}
    </span>
  );
}

export function Field({ label, hint, error, children, id }) {
  return (
    <div className="field">
      {label && <label htmlFor={id}>{label}</label>}
      {children}
      {error ? <span className="err">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

// Escape closes only the topmost overlay (popover, picker, sheet)
const escStack = [];
export function useEscape(onClose) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const token = {};
    escStack.push(token);
    const onKey = (e) => { if (e.key === "Escape" && escStack[escStack.length - 1] === token) ref.current(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); escStack.splice(escStack.indexOf(token), 1); };
  }, []);
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEscape(onClose);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title}>
        <header><h3 className="grow">{title}</h3><button className="btn ghost" onClick={onClose} aria-label="Close"><Icon name="x" /></button></header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Sheet({ title, onClose, children, eyebrow }) {
  useEscape(onClose);
  return (
    <div className="sheet" role="dialog" aria-label={title}>
      <header><div className="grow">{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h3>{title}</h3></div><button className="btn ghost" onClick={onClose} aria-label="Close"><Icon name="x" /></button></header>
      <div className="body">{children}</div>
    </div>
  );
}

export function Popover({ open, ...rest }) {
  return open ? <PopoverBody {...rest} /> : null;
}
function PopoverBody({ onClose, children, align = "left" }) {
  const ref = useRef(null);
  useEscape(onClose);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); };
  }, [onClose]);
  return <div ref={ref} className="popover" style={align === "right" ? { left: "auto", right: 0 } : undefined}>{children}</div>;
}

export function Toasts({ toasts }) {
  return <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}</div>;
}

const fmt = (v) => (v === "" || v === undefined || v === null ? "—" : typeof v === "string" ? v : JSON.stringify(v));
const short = (s, n = 26) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---------- Input states ----------
export function stateText(input, st) {
  if (st.s !== "fixed") return st.s[0].toUpperCase() + st.s.slice(1);
  if (input.type === "select" || input.type === "toggle") return input.options?.find((o) => o.id === st.v)?.label ?? "?";
  return fmt(st.v);
}
export function StateChip({ input, st }) {
  return (
    <span className={`st ${st.s}`} title={st.s === "fixed" ? `Fixed: ${stateText(input, st)}` : undefined}>
      {st.s === "fixed" && <Icon name="lock" size={11} />}
      {st.s === "hidden" ? "—" : stateText(input, st)}
    </span>
  );
}

export function FixedValueInput({ input, value, onChange, id }) {
  if (input.type === "select" || input.type === "toggle")
    return (
      <select id={id} className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>Pick a value</option>
        {input.options?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    );
  if (input.type === "number" || input.type === "seed")
    return <input id={id} className="input mono" type="number" value={value ?? ""} step={input.step || 1} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />;
  if (UPLOAD_TYPES.has(input.type))
    return <input id={id} className="input mono" placeholder="file name in input/ on every Backend" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  return <input id={id} className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
}

export function StateEditor({ input, st, onChange, size }) {
  return (
    <div className="stack tight">
      <Seg size={size} value={st.s} onChange={(s) => onChange(s === "fixed" ? { s, v: st.v ?? input.options?.[0]?.id ?? "" } : { s })}
        options={STATES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1), title: { hidden: "Not shown; its fields keep the Workflow's values", optional: "Shown; blank keeps the Workflow's value", required: "Shown; must be filled", fixed: "Not shown; always writes this value" }[s] }))} />
      {st.s === "fixed" && <FixedValueInput input={input} value={st.v} onChange={(v) => onChange({ s: "fixed", v })} />}
    </div>
  );
}

// ---------- Binding picker ----------
export function BindingPicker({ draft, inputType, title, onPick, onClose, suggestion, exclude = [] }) {
  const wf = draft.workflow;
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(suggestion || null);
  const nodes = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return Object.entries(wf)
      .filter(([id, n]) => !ql || id.includes(ql) || n.class_type.toLowerCase().includes(ql) || (n._meta?.title || "").toLowerCase().includes(ql))
      .filter(([id, n]) => all || Object.keys(n.inputs).some((f) => compatible(inputType, fieldSpec(wf, id, f), n.class_type, f)))
      .sort((a, b) => (a[0] === suggestion ? -1 : b[0] === suggestion ? 1 : GROUP_ORDER.indexOf(nodeGroup(a[1])) - GROUP_ORDER.indexOf(nodeGroup(b[1])) || Number(a[0]) - Number(b[0])));
  }, [wf, q, all, inputType, suggestion]);
  const owner = useMemo(() => {
    const m = {};
    draft.inputs.forEach((i) => i.bindings.forEach((bnd) => (m[key(bnd)] = i.label)));
    return m;
  }, [draft.inputs]);
  return (
    <Modal title={title || "Bind a Node field"} onClose={onClose} wide>
      <div className="stack">
        <div className="row">
          <input autoFocus className="input grow" style={{ maxWidth: 360 }} placeholder="Search by title, class or id" value={q} onChange={(e) => setQ(e.target.value)} id="picker-search" />
          <label className="check small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} id="picker-all" /> Show nodes with no field this Input can take</label>
        </div>
        <p className="small muted">Showing {nodes.length} of {Object.keys(wf).length} nodes. Fields fed by a link can't hold a value; bind the node that feeds them.</p>
        <div className="table-wrap" style={{ maxHeight: "56vh", overflowY: "auto" }}>
          <div className="list">
            {nodes.map(([id, n]) => {
              const isOpen = open === id;
              return (
                <Fragment key={id}>
                  <button className={`item ${isOpen ? "sel" : ""}`} onClick={() => setOpen(isOpen ? null : id)}>
                    <Icon name={isOpen ? "down" : "right"} size={12} />
                    <span className="grow"><strong>{nodeTitle(wf, id)}</strong> <span className="muted mono">{n.class_type}</span></span>
                    {id === suggestion && <span className="pill accent">Looks like the old node</span>}
                    {EXTERNAL_CLASSES[n.class_type] && <span className="pill warn">outside service</span>}
                    <span className="mono faint">#{id}</span>
                  </button>
                  {isOpen && (
                    <div style={{ padding: "4px 10px 10px 32px", background: "var(--sunk)" }}>
                      <table className="t">
                        <tbody>
                          {Object.entries(n.inputs).map(([f, v]) => {
                            const spec = fieldSpec(wf, id, f);
                            const ok = compatible(inputType, spec, n.class_type, f) && !exclude.includes(`${id}.${f}`);
                            const taken = owner[`${id}.${f}`];
                            return (
                              <tr key={f}>
                                <td style={{ width: 28 }}><TypeDot type={spec.type} /></td>
                                <td className="mono">{f}</td>
                                <td className="small muted wrap-anywhere">
                                  {isLink(v) ? <>fed by a link from {nodeLabel(wf, v[0])}. Bind that node instead.</> : <>{spec.type} · {short(fmt(v), 48)}</>}
                                  {taken && <> · bound by <strong>{taken}</strong></>}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  {isLink(v) ? (
                                    <button className="btn xs" onClick={() => { setOpen(v[0]); setQ(""); }}>Go to #{v[0]}</button>
                                  ) : (
                                    <button className="btn xs primary" disabled={!ok || !!taken} title={!ok ? `Takes ${spec.type}; this Input can't write it` : taken ? "A field takes one Input" : ""} onClick={() => onPick({ node: id, field: f })}>Bind</button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Input editor ----------
let inputSeq = 1;
export function newInputId(label, draft) {
  let base = slugify(label || "input") || "input";
  let id = base;
  while (draft.inputs.some((i) => i.id === id)) id = `${base}-${++inputSeq}`;
  return id;
}
export function defaultInput(type, label, bindings, draft) {
  const inp = { id: newInputId(label, draft), label, type, help: "", bindings };
  if (type === "text") Object.assign(inp, { multiline: true, maxLength: 1000 });
  if (type === "number") {
    const spec = bindings[0] && fieldSpec(draft.workflow, bindings[0].node, bindings[0].field);
    const cur = bindings[0] && draft.workflow[bindings[0].node].inputs[bindings[0].field];
    Object.assign(inp, { min: spec?.min > -1e9 ? spec.min : 0, max: typeof cur === "number" ? Math.max(cur, 1) * 2 : 100, step: spec?.step || 1 });
  }
  if (type === "select" || type === "toggle") {
    const bnd = bindings[0];
    const spec = bnd && fieldSpec(draft.workflow, bnd.node, bnd.field);
    const cur = bnd && draft.workflow[bnd.node].inputs[bnd.field];
    const vals = spec?.type === "COMBO" ? [cur, ...spec.options.filter((o) => o !== cur)].slice(0, 2) : spec?.type === "BOOLEAN" ? [true, false] : [cur, cur];
    inp.options = vals.map((v, i) => ({ id: `opt${i + 1}`, label: String(v), values: bnd ? { [key(bnd)]: v } : {} }));
  }
  if (UPLOAD_TYPES.has(type)) inp.limits = { maxMB: type === "image" ? 20 : 200, maxLongSide: type === "audio" ? undefined : 4096, maxSec: type === "image" ? undefined : 10, trimmable: type !== "image" };
  return inp;
}
export function inferInputType(wf, nodeId, field) {
  const n = wf[nodeId];
  const loader = UPLOAD_LOADERS[n.class_type];
  if (loader && loader.field === field) return loader.kind;
  const spec = fieldSpec(wf, nodeId, field);
  if (/seed/i.test(field) && spec.type === "INT") return "seed";
  return { STRING: "text", INT: "number", FLOAT: "number", BOOLEAN: "toggle", COMBO: "select" }[spec.type] || "text";
}

function OptionValueInput({ spec, value, onChange }) {
  if (spec?.type === "COMBO") return <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>{spec.options.map((o) => <option key={o}>{o}</option>)}</select>;
  if (spec?.type === "BOOLEAN") return <Seg size="sm" value={value} onChange={onChange} options={[{ value: true, label: "true" }, { value: false, label: "false" }]} />;
  if (spec?.type === "INT" || spec?.type === "FLOAT") return <input className="input mono" type="number" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} />;
  return <input className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
}

export function InputEditor({ studio, inputId, onDeleted, compact }) {
  const { draft, mutate } = studio;
  const input = draft.inputs.find((i) => i.id === inputId);
  const [picking, setPicking] = useState(null); // {replace?: binding}
  if (!input) return <p className="muted">This Input was deleted.</p>;
  const wf = draft.workflow;
  const set = (patch) => mutate((d) => Object.assign(d.inputs.find((i) => i.id === inputId), patch));
  const setLimit = (k, v) => mutate((d) => { const i = d.inputs.find((x) => x.id === inputId); i.limits = { ...i.limits, [k]: v }; });
  const inputIssues = studio.issues.filter((x) => x.inputId === inputId && x.area === "inputs");
  const num = (v) => (v === "" ? "" : Number(v));
  const usedIn = draft.modes.map((m) => ({ m, st: stateOf(m, input.id) }));
  // When rebinding, suggest the node with the same class and title as the one in the saved revision
  const old = picking?.replace && studio.saved.workflow?.[picking.replace.node];
  const suggestion = old && wf && Object.entries(wf).find(([, n]) => n.class_type === old.class_type && n._meta?.title === old._meta?.title)?.[0];

  return (
    <div className="stack loose">
      {inputIssues.length > 0 && <div className="stack tight">{inputIssues.map((x, i) => <div key={i} className={`callout ${x.level === "error" ? "err" : "warn"}`}>{x.text}</div>)}</div>}
      <div className="fields">
        <Field label="Label" id={`in-label-${input.id}`}><input id={`in-label-${input.id}`} className="input" value={input.label} onChange={(e) => set({ label: e.target.value })} /></Field>
        <Field label="Type" hint={input.bindings.length ? "Remove its bindings to change the type." : ""} id={`in-type-${input.id}`}>
          <select id={`in-type-${input.id}`} className="select" value={input.type} disabled={input.bindings.length > 0} onChange={(e) => set({ type: e.target.value })}>
            {INPUT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Help text" hint="Shown under the field on the Model page." id={`in-help-${input.id}`}><input id={`in-help-${input.id}`} className="input" value={input.help || ""} onChange={(e) => set({ help: e.target.value })} /></Field>

      {input.type === "text" && (
        <div className="fields">
          <Field label="Max length" id={`in-max-${input.id}`}><input id={`in-max-${input.id}`} className="input" type="number" value={input.maxLength ?? ""} onChange={(e) => set({ maxLength: num(e.target.value) })} /></Field>
          <Field label="Lines"><Seg value={!!input.multiline} onChange={(v) => set({ multiline: v })} options={[{ value: false, label: "One line" }, { value: true, label: "Several" }]} /></Field>
        </div>
      )}
      {input.type === "number" && (
        <div className="fields">
          <Field label="Min" id={`in-min-${input.id}`}><input id={`in-min-${input.id}`} className="input" type="number" value={input.min ?? ""} onChange={(e) => set({ min: num(e.target.value) })} /></Field>
          <Field label="Max" id={`in-maxn-${input.id}`}><input id={`in-maxn-${input.id}`} className="input" type="number" value={input.max ?? ""} onChange={(e) => set({ max: num(e.target.value) })} /></Field>
          <Field label="Step" id={`in-step-${input.id}`}><input id={`in-step-${input.id}`} className="input" type="number" value={input.step ?? ""} onChange={(e) => set({ step: num(e.target.value) })} /></Field>
          <Field label="Unit" id={`in-unit-${input.id}`}><input id={`in-unit-${input.id}`} className="input" placeholder="s, px, …" value={input.unit || ""} onChange={(e) => set({ unit: e.target.value })} /></Field>
        </div>
      )}
      {input.type === "seed" && <p className="note">A blank seed gives each Generation in a Submission its own random seed. The count picker shows in every Mode whose Path holds these fields, even when the seed is hidden.</p>}
      {UPLOAD_TYPES.has(input.type) && (
        <div className="stack tight">
          <div className="eyebrow">Upload limits</div>
          <div className="fields">
            <Field label="Max size (MB)" hint="Up to MAX_UPLOAD_MB (500)." id={`in-mb-${input.id}`}><input id={`in-mb-${input.id}`} className="input" type="number" value={input.limits?.maxMB ?? ""} onChange={(e) => setLimit("maxMB", num(e.target.value))} /></Field>
            {input.type !== "audio" && <Field label="Max long side (px)" id={`in-ls-${input.id}`}><input id={`in-ls-${input.id}`} className="input" type="number" value={input.limits?.maxLongSide ?? ""} onChange={(e) => setLimit("maxLongSide", num(e.target.value))} /></Field>}
            {input.type !== "image" && <Field label="Max duration (s)" id={`in-sec-${input.id}`}><input id={`in-sec-${input.id}`} className="input" type="number" value={input.limits?.maxSec ?? ""} onChange={(e) => setLimit("maxSec", num(e.target.value))} /></Field>}
          </div>
          {input.type !== "image" && <label className="check"><input type="checkbox" checked={!!input.limits?.trimmable} onChange={(e) => setLimit("trimmable", e.target.checked)} /> Users can trim it before submitting</label>}
        </div>
      )}

      <div className="stack tight">
        <div className="section-head"><div className="eyebrow grow">Writes into these Node fields</div><button className="btn sm" disabled={!wf} onClick={() => setPicking({})}><Icon name="plus" /> Bind a field</button></div>
        {input.bindings.length === 0 && <p className="note">Not bound yet. Each Input writes its value into one or more Node fields.</p>}
        <div className="table-wrap">
          <div className="list">
            {input.bindings.map((bnd) => {
              const n = wf?.[bnd.node];
              const broken = !n || !(bnd.field in n.inputs);
              const spec = !broken && fieldSpec(wf, bnd.node, bnd.field);
              return (
                <div key={key(bnd)} className="item" style={broken ? { background: "var(--err-soft)" } : undefined}>
                  <TypeDot type={broken ? "LINK" : spec.type} />
                  <span className="grow wrap-anywhere">
                    {broken ? <><strong>#{bnd.node}.{bnd.field}</strong> <span className="small" style={{ color: "var(--err)" }}>isn't in this Workflow</span></> : <><strong>{nodeTitle(wf, bnd.node)}</strong><span className="mono">.{bnd.field}</span> <span className="mono faint">#{bnd.node}</span><br /><span className="small muted">{n.class_type} · Workflow value {short(fmt(n.inputs[bnd.field]), 40)}</span></>}
                  </span>
                  {broken && <button className="btn sm primary" onClick={() => setPicking({ replace: bnd })}>Rebind</button>}
                  <button className="btn ghost sm" aria-label="Remove binding" onClick={() => mutate((d) => { const i = d.inputs.find((x) => x.id === inputId); i.bindings = i.bindings.filter((x) => key(x) !== key(bnd)); i.options?.forEach((o) => delete o.values[key(bnd)]); })}><Icon name="x" /></button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {(input.type === "select" || input.type === "toggle") && (
        <div className="stack tight">
          <div className="section-head"><div className="eyebrow grow">Options: the value each writes into each field</div>
            <button className="btn sm" onClick={() => mutate((d) => { const i = d.inputs.find((x) => x.id === inputId); i.options = [...(i.options || []), { id: `opt${Date.now() % 100000}`, label: `Option ${(i.options || []).length + 1}`, values: {} }]; })}><Icon name="plus" /> Option</button></div>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Option label</th>{input.bindings.map((bnd) => <th key={key(bnd)} className="mono" style={{ fontWeight: 500 }}>{wf?.[bnd.node] ? short(nodeTitle(wf, bnd.node), 18) : `#${bnd.node}`}.{bnd.field}</th>)}<th /></tr></thead>
              <tbody>
                {(input.options || []).map((o, oi) => (
                  <tr key={o.id}>
                    <td style={{ minWidth: 120 }}><input className="input" value={o.label} onChange={(e) => mutate((d) => { d.inputs.find((x) => x.id === inputId).options[oi].label = e.target.value; })} /></td>
                    {input.bindings.map((bnd) => (
                      <td key={key(bnd)} style={{ minWidth: 130 }}>
                        <OptionValueInput spec={wf?.[bnd.node] && fieldSpec(wf, bnd.node, bnd.field)} value={o.values[key(bnd)]} onChange={(v) => mutate((d) => { d.inputs.find((x) => x.id === inputId).options[oi].values[key(bnd)] = v; })} />
                      </td>
                    ))}
                    <td><button className="btn ghost sm" aria-label="Remove option" onClick={() => mutate((d) => { const i = d.inputs.find((x) => x.id === inputId); i.options = i.options.filter((x) => x.id !== o.id); })}><Icon name="x" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {input.type === "toggle" && <p className="small muted">A toggle is a two-option select shown as a switch.</p>}
        </div>
      )}

      {!compact && draft.modes.length > 0 && (
        <div className="stack tight">
          <div className="eyebrow">In each Mode</div>
          <div className="row">{usedIn.map(({ m, st }) => <span key={m.id} className="row nowrap small" style={{ gap: 4 }}><span className="muted">{short(m.name, 22)}</span><StateChip input={input} st={st} /></span>)}</div>
        </div>
      )}

      <div className="row"><span className="spacer" /><button className="btn danger sm" onClick={() => { mutate((d) => { d.inputs = d.inputs.filter((x) => x.id !== inputId); d.modes.forEach((m) => delete m.states[inputId]); }); onDeleted?.(); }}>Delete Input</button></div>

      {picking && (
        <BindingPicker draft={draft} inputType={input.type} suggestion={suggestion} title={picking.replace ? `Rebind ${input.label} (was #${picking.replace.node}.${picking.replace.field})` : `Bind ${input.label} to a Node field`}
          onClose={() => setPicking(null)}
          onPick={(bnd) => {
            mutate((d) => {
              const i = d.inputs.find((x) => x.id === inputId);
              if (picking.replace) {
                i.bindings = i.bindings.map((x) => (key(x) === key(picking.replace) ? bnd : x));
                i.options?.forEach((o) => { if (key(picking.replace) in o.values) { o.values[key(bnd)] = o.values[key(picking.replace)]; delete o.values[key(picking.replace)]; } });
              } else i.bindings.push(bnd);
            });
            setPicking(null);
          }} />
      )}
    </div>
  );
}

export function NewInputMenu({ studio, onCreated, label = "New Input" }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="pop-anchor">
      <button className="btn sm" onClick={() => setOpen(!open)} disabled={!studio.draft.workflow}><Icon name="plus" /> {label}</button>
      <Popover open={open} onClose={() => setOpen(false)}>
        <div className="stack tight">
          <div className="eyebrow">Type</div>
          {INPUT_TYPES.map((t) => (
            <button key={t.id} className="btn ghost sm" style={{ justifyContent: "flex-start" }} onClick={() => {
              const inp = defaultInput(t.id, t.label, [], studio.draft);
              studio.mutate((d) => d.inputs.push(inp));
              setOpen(false);
              onCreated?.(inp.id);
            }}><TypeDot type={t.id} /> {t.label}</button>
          ))}
        </div>
      </Popover>
    </span>
  );
}

// ---------- Outputs ----------
export function OutputPicker({ draft, onPick, onClose, taken = [] }) {
  const wf = draft.workflow;
  const [all, setAll] = useState(false);
  const nodes = Object.entries(wf).filter(([, n]) => all || OUTPUT_CLASSES[n.class_type] || PREVIEW_CLASSES.has(n.class_type));
  return (
    <Modal title="Pick an output node" onClose={onClose}>
      <div className="stack">
        <p className="small muted">An output node saves a file. Preview nodes don't, so they can't be outputs. Unknown save nodes need their kind picked.</p>
        <label className="check small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show every node (for custom save nodes)</label>
        <div className="table-wrap" style={{ maxHeight: "50vh", overflowY: "auto" }}>
          <div className="list">
            {nodes.map(([id, n]) => {
              const preview = PREVIEW_CLASSES.has(n.class_type);
              const kind = OUTPUT_CLASSES[n.class_type];
              return (
                <div key={id} className="item">
                  <span className="grow"><strong>{nodeTitle(wf, id)}</strong> <span className="mono muted">{n.class_type}</span> <span className="mono faint">#{id}</span>{preview && <><br /><span className="small" style={{ color: "var(--err)" }}>Preview node: it saves nothing, so it can't be an output.</span></>}</span>
                  {kind && <span className="pill"><TypeDot type={kind} /> {kind}</span>}
                  <button className="btn xs primary" disabled={preview || taken.includes(id)} onClick={() => onPick({ node: id, kind: kind || "" })}>Use</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function OutputsEditor({ studio, modeId }) {
  const { draft, mutate } = studio;
  const mode = draft.modes.find((m) => m.id === modeId);
  const [picking, setPicking] = useState(null);
  const wf = draft.workflow;
  const upd = (fn) => mutate((d) => fn(d.modes.find((m) => m.id === modeId)));
  return (
    <div className="stack tight">
      <div className="section-head"><div className="eyebrow grow">Output nodes</div><button className="btn sm" disabled={!wf} onClick={() => setPicking({})}><Icon name="plus" /> Output</button></div>
      {mode.outputs.length === 0 && <p className="callout err">Name the node that saves this Mode's Asset. Its Path is that node plus everything it depends on.</p>}
      <div className="table-wrap"><div className="list">
        {mode.outputs.map((o, i) => {
          const n = wf?.[o.node];
          const known = n && OUTPUT_CLASSES[n.class_type];
          return (
            <div className="item" key={o.node} style={!n ? { background: "var(--err-soft)" } : undefined}>
              <span className="pill outline tnum">{i === 0 ? "Main Asset" : `Extra ${i}`}</span>
              <span className="grow wrap-anywhere">{n ? <><strong>{nodeTitle(wf, o.node)}</strong> <span className="mono muted">{n.class_type}</span> <span className="mono faint">#{o.node}</span></> : <><strong className="mono">#{o.node}</strong> <span className="small" style={{ color: "var(--err)" }}>isn't in this Workflow</span></>}</span>
              {n && (known ? <span className="pill"><TypeDot type={known} /> {known}</span> : (
                <select className="select" style={{ width: 100 }} value={o.kind} onChange={(e) => upd((m) => (m.outputs[i].kind = e.target.value))}><option value="">Kind?</option><option>video</option><option>image</option><option>audio</option></select>
              ))}
              {!n && <button className="btn sm primary" onClick={() => setPicking({ replace: o.node })}>Pick again</button>}
              <button className="btn ghost xs" disabled={i === 0} aria-label="Move up" onClick={() => upd((m) => m.outputs.splice(i - 1, 0, m.outputs.splice(i, 1)[0]))}><Icon name="up" /></button>
              <button className="btn ghost xs" aria-label="Remove output" onClick={() => upd((m) => m.outputs.splice(i, 1))}><Icon name="x" /></button>
            </div>
          );
        })}
      </div></div>
      {picking && <OutputPicker draft={draft} taken={mode.outputs.map((o) => o.node)} onClose={() => setPicking(null)} onPick={(o) => { upd((m) => { if (picking.replace) m.outputs = m.outputs.map((x) => (x.node === picking.replace ? o : x)); else m.outputs.push(o); }); setPicking(null); }} />}
    </div>
  );
}

export function PathFacts({ studio, mode }) {
  const { draft } = studio;
  if (!draft.workflow) return null;
  const { path, uploads, external } = pathSummary(draft, mode);
  return (
    <div className="stack tight">
      <div className="eyebrow">Path</div>
      <p className="small"><strong className="tnum">{path.size}</strong> <span className="muted">of {Object.keys(draft.workflow).length} nodes are sent to the Backend for this Mode.</span></p>
      {uploads.length > 0 && (
        <div className="row small">{uploads.map((u) => (
          <span key={u.node} className={`pill ${!u.input || u.state === "hidden" ? "err" : ""}`}><TypeDot type={u.kind} /> {nodeTitle(draft.workflow, u.node)} → {u.input ? `${u.input.label} (${u.state})` : "no Input"}</span>
        ))}</div>
      )}
      {external.length > 0 && <p className="small muted"><Icon name="ext" size={12} /> {external.map((id) => nodeLabel(draft.workflow, id)).join(", ")} can call {EXTERNAL_CLASSES[draft.workflow[external[0]].class_type].host}. Its key field is empty, so prompts stay on the Backend.</p>}
    </div>
  );
}

// ---------- Checks ----------
export function ChecksList({ studio, onJump, filter, title = "Checks" }) {
  const list = filter ? studio.issues.filter(filter) : studio.issues;
  const errs = list.filter((i) => i.level === "error");
  const warns = list.filter((i) => i.level === "warning");
  return (
    <div className="stack tight">
      <div className="section-head">
        <h4 className="grow">{title}</h4>
        {errs.length > 0 && <span className="pill err tnum">{errs.length} error{errs.length > 1 ? "s" : ""}</span>}
        {warns.length > 0 && <span className="pill warn tnum">{warns.length} warning{warns.length > 1 ? "s" : ""}</span>}
        {!list.length && <span className="pill ok"><Icon name="check" size={12} /> No problems</span>}
      </div>
      {errs.length > 0 && <p className="small muted">Errors keep the Model from being enabled. A draft with errors can still be saved.</p>}
      <div className="stack" style={{ gap: 0 }}>
        {[...errs, ...warns].map((x, i) => (
          <button key={i} className={`issue ${x.level}`} onClick={() => onJump?.(x)}>
            <Icon name={x.level === "error" ? "err" : "warn"} className="ic" />
            <span>{x.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Save, enable, export ----------
export function SaveControls({ studio, compact }) {
  const { dirty, revisionChanged, draft, saved, errors, save, discard } = studio;
  const willDisable = draft.details.enabled && errors.length > 0;
  return (
    <div className="row nowrap">
      {!compact && <span className="small muted">{dirty ? (revisionChanged ? `Unsaved · saves as revision ${saved.revision + 1}` : "Unsaved changes") : saved.revision ? `Saved · revision ${saved.revision}` : "Not saved yet"}</span>}
      <button className="btn sm" disabled={!dirty} onClick={discard}>Discard</button>
      <button className={`btn sm ${willDisable ? "warn" : "primary"}`} disabled={!dirty} onClick={save} title={willDisable ? "Errors keep an enabled Model from saving as is, so this saves it disabled" : ""}>{willDisable ? "Save and disable" : "Save"}</button>
    </div>
  );
}

export function EnableSwitch({ studio }) {
  const { draft, errors, mutate } = studio;
  const on = draft.details.enabled;
  const blocked = !on && errors.length > 0;
  return (
    <div className="stack tight">
      <Switch id="enable-switch" checked={on} disabled={blocked} onChange={(v) => mutate((d) => (d.details.enabled = v))} label={on ? "Enabled: users can see it" : "Disabled: hidden from users"} />
      {blocked && <span className="small" style={{ color: "var(--err)" }}>Fix {errors.length} error{errors.length > 1 ? "s" : ""} to enable.</span>}
      {on && errors.length > 0 && <span className="small" style={{ color: "var(--warn)" }}>Saving now will disable it until the errors are fixed.</span>}
    </div>
  );
}

export function ModelFileActions({ studio }) {
  return (
    <div className="row nowrap">
      <button className="btn sm" disabled={!studio.draft.workflow} onClick={studio.exportModel} title="One JSON file: Workflow, Inputs, Modes, Model terms, Attribution">Export</button>
      <button className="btn sm" onClick={studio.importModel} title="Creates a new, disabled Model from a Model file">Import…</button>
    </div>
  );
}

// ---------- Details, terms ----------
export function DetailsForm({ studio }) {
  const { draft, mutate } = studio;
  const d = draft.details;
  const set = (patch) => mutate((x) => Object.assign(x.details, patch));
  return (
    <div className="stack">
      <div className="fields">
        <Field label="Name" id="md-name"><input id="md-name" className="input" value={d.name} onChange={(e) => set({ name: e.target.value, ...(d.slug === slugify(d.name) || !d.slug ? { slug: slugify(e.target.value) } : {}) })} placeholder="LTX 2.5" /></Field>
        <Field label="URL" hint={`/${d.slug || "…"}`} id="md-slug"><input id="md-slug" className="input mono" value={d.slug} onChange={(e) => set({ slug: slugify(e.target.value) })} /></Field>
      </div>
      <Field label="One-line description" id="md-desc"><input id="md-desc" className="input" value={d.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <div className="fields">
        <Field label="Position in the Model list" id="md-order"><input id="md-order" className="input" type="number" value={d.order} onChange={(e) => set({ order: Number(e.target.value) })} /></Field>
        <Field label="Max run time (minutes)" hint="A Generation running longer is cancelled and fails." id="md-max"><input id="md-max" className="input" type="number" value={d.maxRunMin} onChange={(e) => set({ maxRunMin: Number(e.target.value) })} /></Field>
      </div>
    </div>
  );
}

export function TermsForm({ studio }) {
  const { draft, saved, mutate } = studio;
  const d = draft.details;
  const set = (patch) => mutate((x) => Object.assign(x.details, patch));
  const firstTime = !saved.details.termsText.trim() && d.termsText.trim();
  const changed = saved.details.termsText.trim() && d.termsText !== saved.details.termsText;
  return (
    <div className="stack">
      <Field label="Model terms" hint="Optional. Users acknowledge them before their first use of this Model." id="md-terms"><textarea id="md-terms" className="textarea" rows={4} value={d.termsText} onChange={(e) => set({ termsText: e.target.value })} /></Field>
      <Field label="License URL" id="md-license" hint={<>Linked from the terms. See the docs page <a href="#" onClick={(e) => e.preventDefault()}>Model licenses and AI rules</a> for what each license asks of an Operator.</>}>
        <input id="md-license" className="input mono" value={d.licenseUrl} onChange={(e) => set({ licenseUrl: e.target.value })} placeholder="https://…" />
      </Field>
      {firstTime && <p className="note">Users will be asked to accept these terms before their next use.</p>}
      {changed && <label className="check"><input type="checkbox" checked={d.askAgain} onChange={(e) => set({ askAgain: e.target.checked })} id="md-again" /> <span>Ask everyone to accept again<br /><span className="small muted">Leave unticked for small fixes, such as a typo.</span></span></label>}
      <Field label="Attribution" hint="Shown under the Model's name and in each Generation's detail." id="md-attr"><input id="md-attr" className="input" value={d.attribution} onChange={(e) => set({ attribution: e.target.value })} placeholder="Powered by …" /></Field>
      <p className="callout">The studio adds no visible "AI-generated" label and runs no classifier on outputs. If you want either, put ComfyUI's <code>TextOverlay</code> node or a classifier node in the Workflow.</p>
    </div>
  );
}

// ---------- Backends ----------
const HEALTH = { healthy: ["ok", "Healthy"], unreachable: ["err", "Unreachable"], credentials: ["warn", "Re-enter credentials"], checking: ["", "Checking…"] };
export function BackendsPanel({ studio }) {
  const { draft, backends, mutate, updateBackend, addBackend, toast } = studio;
  const [form, setForm] = useState(null);
  const [reenter, setReenter] = useState(null);
  const attached = backends.filter((b) => draft.backendIds.includes(b.id));
  const others = backends.filter((b) => !draft.backendIds.includes(b.id));
  const row = (b, isAttached) => {
    const [tone, label] = HEALTH[b.health];
    const problems = studio.issues.filter((x) => x.backendId === b.id && x.level === "error");
    return (
      <div key={b.id} className="item" style={{ alignItems: "flex-start" }}>
        <div className="grow stack tight">
          <div className="row"><strong>{b.name}</strong><span className={`pill ${tone}`}>{label}</span>{b.health === "healthy" && <span className="small muted">ComfyUI {b.comfy} · {b.vram} · {b.running}</span>}</div>
          <span className="mono small muted wrap-anywhere">{b.url} · auth {b.auth}{b.auth !== "none" ? " · secret set" : ""}</span>
          {b.used.length > 0 && <span className="small muted">Runs {b.used.join(", ")}</span>}
          {isAttached && problems.map((p, i) => <span key={i} className="small" style={{ color: "var(--err)" }}>{p.text}</span>)}
          {!isAttached && b.missing.length > 0 && <span className="small" style={{ color: "var(--warn)" }}>Missing {b.missing.length} node types this Model uses ({b.missingPack}).</span>}
          {reenter === b.id && (
            <div className="row" style={{ marginTop: 6 }}>
              <input className="input" style={{ maxWidth: 160 }} placeholder="Username" id={`re-user-${b.id}`} />
              <input className="input" style={{ maxWidth: 160 }} type="password" placeholder="Password" id={`re-pass-${b.id}`} />
              <button className="btn sm primary" onClick={() => { updateBackend(b.id, { health: "checking" }); setReenter(null); setTimeout(() => updateBackend(b.id, { health: "healthy", comfy: "v0.36.1", vram: "48 GB", running: "idle" }), 1200); }}>Save credentials</button>
            </div>
          )}
        </div>
        <div className="row nowrap">
          {b.health === "credentials" && reenter !== b.id && <button className="btn sm" onClick={() => setReenter(b.id)}>Re-enter credentials</button>}
          {isAttached ? <button className="btn sm" onClick={() => mutate((d) => (d.backendIds = d.backendIds.filter((x) => x !== b.id)))}>Detach</button> : <button className="btn sm primary" onClick={() => mutate((d) => d.backendIds.push(b.id))}>Attach</button>}
        </div>
      </div>
    );
  };
  return (
    <div className="stack loose">
      <div className="stack tight">
        <div className="section-head"><h4 className="grow">Runs on</h4><span className="small muted">{attached.length} Backend{attached.length === 1 ? "" : "s"}, one Generation each at a time</span></div>
        <div className="table-wrap"><div className="list">{attached.length ? attached.map((b) => row(b, true)) : <div className="item muted">No Backends yet. Attach one below.</div>}</div></div>
      </div>
      {others.length > 0 && (
        <div className="stack tight">
          <h4>Other Backends</h4>
          <div className="table-wrap"><div className="list">{others.map((b) => row(b, false))}</div></div>
        </div>
      )}
      {!form ? <div><button className="btn sm" onClick={() => setForm({ name: "", url: "", auth: "none", user: "", secret: "", header: "" })}><Icon name="plus" /> New Backend</button></div> : (
        <div className="panel pad stack">
          <h4>New Backend</h4>
          <div className="fields">
            <Field label="Name" id="nb-name"><input id="nb-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="3090 #2" /></Field>
            <Field label="Address" id="nb-url" error={form.url && validateBackendUrl(form.url)} hint="The Backend's tailnet IP and port. MagicDNS names don't resolve inside the studio container.">
              <input id="nb-url" className={`input mono ${form.url && validateBackendUrl(form.url) ? "invalid" : ""}`} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="http://100.101.7.12:8190" />
            </Field>
          </div>
          <Field label="Authentication"><Seg value={form.auth} onChange={(v) => setForm({ ...form, auth: v })} options={[{ value: "none", label: "None" }, { value: "basic", label: "Basic" }, { value: "header", label: "Header" }]} /></Field>
          {form.auth === "basic" && <div className="fields"><Field label="Username" id="nb-user"><input id="nb-user" className="input" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} /></Field><Field label="Password" hint="Write-only: stored encrypted, never shown again." id="nb-pass"><input id="nb-pass" type="password" className="input" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} /></Field></div>}
          {form.auth === "header" && <div className="fields"><Field label="Header name" id="nb-h"><input id="nb-h" className="input mono" value={form.header} placeholder="Authorization" onChange={(e) => setForm({ ...form, header: e.target.value })} /></Field><Field label="Header value" hint="Write-only." id="nb-hv"><input id="nb-hv" type="password" className="input" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} /></Field></div>}
          <div className="row"><span className="spacer" /><button className="btn sm" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn sm primary" disabled={!form.name || !form.url || !!validateBackendUrl(form.url)} onClick={() => {
              const id = `b${Date.now() % 100000}`;
              addBackend({ id, name: form.name, url: form.url, auth: form.auth, health: "checking", comfy: "", vram: "", used: [], missing: [], running: "" });
              mutate((d) => d.backendIds.push(id));
              setForm(null);
              toast(`Added ${form.name}. Health, ComfyUI version and VRAM appear within about 30 seconds.`);
              setTimeout(() => updateBackend(id, { health: "healthy", comfy: "v0.36.1", vram: "24 GB", running: "idle" }), 2500);
            }}>Add and attach</button></div>
        </div>
      )}
    </div>
  );
}

// ---------- Workflow upload ----------
export function WorkflowPanel({ studio, compact }) {
  const { draft, mutate, toast } = studio;
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);
  const stats = workflowStats(draft.workflow);
  const broken = studio.issues.filter((x) => x.broken || x.brokenOutput);
  const accept = (wf, name) => {
    setErr("");
    const had = !!draft.workflow;
    mutate((d) => (d.workflow = wf));
    toast(`${had ? "Re-uploaded" : "Uploaded"} ${name}: ${Object.keys(wf).length} nodes. ${had ? "Bindings match by node id; anything broken is listed in red." : ""}`, "ok");
  };
  const readFile = (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return setErr("This file is over 10 MB. Export the Workflow with Export (API).");
    const r = new FileReader();
    r.onload = () => {
      try {
        const json = JSON.parse(r.result);
        if (Array.isArray(json.nodes)) return setErr("This is a UI save; export it with Export (API).");
        const entries = Object.entries(json);
        if (!entries.length || !entries.every(([, n]) => n && typeof n.class_type === "string" && n.inputs)) return setErr("This isn't a ComfyUI API export. In ComfyUI, use Workflow → Export (API).");
        accept(json, file.name);
      } catch {
        setErr("This file isn't valid JSON.");
      }
    };
    r.readAsText(file);
  };
  return (
    <div className="stack">
      {!draft.workflow || !compact ? (
        <div className={`drop ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files[0]); }}>
          <div className="row"><Icon name="upload" size={18} /><strong>{draft.workflow ? "Re-upload the Workflow" : "Upload the Workflow"}</strong></div>
          <p className="small muted prose">The API export from ComfyUI (Workflow → Export (API)), up to 10 MB. {draft.workflow ? "Inputs and outputs keep their bindings by node id. Nothing changes for users until you save." : "Drop it here or choose the file."}</p>
          <div className="row">
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => readFile(e.target.files[0])} id="wf-file" />
            <button className="btn sm" onClick={() => fileRef.current.click()}>Choose file…</button>
            {!draft.workflow && <button className="btn sm" onClick={() => accept(buildLtxWorkflow(), "ltx-2-5-all-in-one.api.json")}>Use the sample LTX 2.5 export</button>}
            {draft.workflow && <button className="btn sm" onClick={() => accept(reexport(draft.workflow), "ltx-2-5-all-in-one.api (2).json")}>Sample: re-export with 2 nodes moved</button>}
            <button className="btn ghost sm" onClick={() => setErr("This is a UI save; export it with Export (API).")}>Sample: a UI save</button>
          </div>
          {err && <p className="callout err">{err}</p>}
        </div>
      ) : null}
      {stats && (
        <div className="row small">
          <span className="pill tnum">{stats.nodes} nodes</span>
          <span className="pill tnum">{stats.classes} node types</span>
          <span className="pill tnum"><TypeDot type="video" /> {stats.outputs} output nodes</span>
          <span className="pill tnum"><TypeDot type="image" /> {stats.uploads} Upload loaders</span>
          {stats.external > 0 && <span className="pill warn tnum"><Icon name="ext" size={12} /> {stats.external} can call an outside service</span>}
        </div>
      )}
      {broken.length > 0 && (
        <div className="callout err stack tight">
          <strong>{broken.length} binding{broken.length > 1 ? "s" : ""} broke with this Workflow</strong>
          {broken.map((x, i) => <span key={i} className="small">{x.text}</span>)}
          <span className="small muted">Rebind them in the Input or Mode they belong to. An enabled Model with errors can only be saved disabled.</span>
        </div>
      )}
    </div>
  );
}

// ---------- What users see, and test Generations ----------
export function UserForm({ studio, mode, values, setValues, preview }) {
  const { draft } = studio;
  const wf = draft.workflow;
  const shown = visibleInputs(draft, mode);
  const seedInput = draft.inputs.find((i) => i.type === "seed");
  const path = wf ? pathSummary(draft, mode).path : new Set();
  const showCount = seedInput && seedInput.bindings.some((bnd) => path.has(bnd.node));
  const val = (id) => values?.[id] ?? "";
  const setV = (id, v) => setValues?.((x) => ({ ...x, [id]: v }));
  const wfValue = (input) => { const bnd = input.bindings[0]; return bnd && wf?.[bnd.node] ? wf[bnd.node].inputs[bnd.field] : ""; };
  const samples = { image: ["portrait.png", "last-frame.png", "middle.jpg", "sheet.png"], video: ["dance-take-3.mp4"], audio: ["voice-note.m4a"] };
  return (
    <div className="userpage">
      <div className="stack tight">
        <h3>{draft.details.name || "Untitled Model"}</h3>
        {draft.details.attribution && <span className="small muted">{draft.details.attribution}</span>}
        <span className="small"><strong>{mode.name}</strong>{mode.description && <span className="muted"> · {mode.description}</span>}</span>
      </div>
      {shown.length === 0 && <p className="small muted">This Mode shows no Inputs. Users only press Generate.</p>}
      {shown.map((input) => {
        const st = stateOf(mode, input.id).s;
        const id = `uf-${mode.id}-${input.id}`;
        const ph = st === "optional" ? `Default: ${short(fmt(wfValue(input)), 40)}` : "";
        return (
          <div className="uf" key={input.id}>
            <label htmlFor={id}>{input.label} <span className="small faint">{st === "required" ? "Required" : "Optional"}</span></label>
            {input.type === "text" && (input.multiline ? <textarea id={id} className="textarea" rows={3} placeholder={ph} value={val(input.id)} disabled={preview} onChange={(e) => setV(input.id, e.target.value)} /> : <input id={id} className="input" placeholder={ph} value={val(input.id)} disabled={preview} onChange={(e) => setV(input.id, e.target.value)} />)}
            {(input.type === "number" || input.type === "seed") && (
              <div className="row nowrap"><input id={id} className="input" type="number" style={{ maxWidth: 160 }} placeholder={input.type === "seed" ? "Random" : ph} min={input.min} max={input.max} step={input.step} value={val(input.id)} disabled={preview} onChange={(e) => setV(input.id, e.target.value)} />{input.unit && <span className="muted">{input.unit}</span>}{input.type === "number" && <span className="small faint tnum">{input.min}–{input.max}</span>}</div>
            )}
            {input.type === "select" && <Seg value={val(input.id) || (st === "optional" ? "" : input.default)} onChange={(v) => !preview && setV(input.id, v)} options={[...(st === "optional" ? [{ value: "", label: "Default" }] : []), ...(input.options || []).map((o) => ({ value: o.id, label: o.label }))]} />}
            {input.type === "toggle" && <Switch checked={val(input.id) === input.options?.[0]?.id} onChange={(v) => !preview && setV(input.id, v ? input.options[0].id : input.options[1].id)} label={input.options?.[0]?.label} />}
            {UPLOAD_TYPES.has(input.type) && (
              <button type="button" className={`upload-box ${val(input.id) ? "filled" : ""}`} disabled={preview} onClick={() => setV(input.id, val(input.id) ? "" : samples[input.type][Math.abs(input.id.length) % samples[input.type].length])}>
                <TypeDot type={input.type} />
                <span className="grow">{val(input.id) ? val(input.id) : `Choose ${input.type === "image" ? "an image" : input.type === "audio" ? "an audio file" : "a video"}…`}</span>
                {val(input.id) && input.limits?.trimmable && <span className="pill">Trim 0:00–0:0{Math.min(5, input.limits.maxSec || 5)}</span>}
                <span className="small faint">{input.limits?.maxMB ? `≤ ${input.limits.maxMB} MB` : ""}{input.limits?.maxSec ? ` · ≤ ${input.limits.maxSec} s` : ""}</span>
              </button>
            )}
            {input.type === "points" && <div className="upload-box">Click 1–10 points on the first frame</div>}
            {input.help && <span className="small muted">{input.help}</span>}
          </div>
        );
      })}
      <div className="row">
        {showCount && <Seg value={values?.__count || 1} onChange={(v) => setV("__count", v)} options={[1, 2, 3, 4].map((n) => ({ value: n, label: `${n}×` }))} />}
        <span className="spacer" />
        {preview && <button className="btn primary" disabled>Generate</button>}
      </div>
    </div>
  );
}

export function TestRunner({ studio, modeId: forcedMode, layout = "stack" }) {
  const { draft, backends, issues } = studio;
  const [modeId, setModeId] = useState(forcedMode || draft.modes[0]?.id);
  const [values, setValues] = useState({});
  const { run, start, cancel, clear } = useTestRun();
  useEffect(() => { if (forcedMode) setModeId(forcedMode); }, [forcedMode]);
  const mode = draft.modes.find((m) => m.id === modeId) || draft.modes[0];
  const usable = backends.filter((b) => draft.backendIds.includes(b.id) && b.health === "healthy");
  const [backendId, setBackendId] = useState(usable[0]?.id);
  if (!mode) return <p className="muted">Add a Mode to run a test Generation.</p>;
  const modeErrors = issues.filter((x) => x.level === "error" && (x.modeId === mode.id || (!x.modeId && x.area !== "terms" && x.area !== "details")));
  const missing = visibleInputs(draft, mode).filter((i) => stateOf(mode, i.id).s === "required" && !values[i.id]);
  const bk = usable.find((b) => b.id === backendId) || usable[0];
  const blocked = modeErrors.length ? `${mode.name} has ${modeErrors.length} error${modeErrors.length > 1 ? "s" : ""} to fix first.` : !bk ? "Attach a healthy Backend first." : missing.length ? `Fill ${missing.map((m) => m.label).join(", ")}.` : "";
  const active = run && ["queued", "starting", "running", "saving"].includes(run.state);
  const pathSize = draft.workflow ? pathSummary(draft, mode).path.size : 0;
  const ctl = (
    <div className="stack">
      <div className="fields">
        {!forcedMode && <Field label="Mode" id="tr-mode"><select id="tr-mode" className="select" value={mode.id} onChange={(e) => { setModeId(e.target.value); setValues({}); clear(); }}>{draft.modes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>}
        <Field label="Backend" id="tr-bk"><select id="tr-bk" className="select" value={bk?.id || ""} onChange={(e) => setBackendId(e.target.value)}>{usable.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}{!usable.length && <option value="">No healthy Backend attached</option>}</select></Field>
      </div>
      <p className="small muted">A test runs this draft, unsaved changes included, on the Backend you pick. It shows on the Admin Generations page and doesn't count toward your Caps.</p>
    </div>
  );
  const result = run && (
    <div className="panel pad stack tight">
      <div className="row"><strong>Test Generation</strong><span className={`pill ${run.state === "succeeded" ? "ok" : run.state === "cancelled" ? "" : "accent"}`}>{run.state === "running" ? "Running" : run.state[0].toUpperCase() + run.state.slice(1)}</span><span className="small muted">{run.step}</span><span className="spacer" />{active && <button className="btn sm" onClick={cancel}>Cancel</button>}</div>
      <p className="small muted">Sent {run.pathSize} of {Object.keys(draft.workflow).length} nodes (the Path of {run.modeName}) to {run.backend}.</p>
      {active && <div className="progress"><div style={{ width: `${run.progress}%` }} /></div>}
      {run.state === "succeeded" && <><div className="poster">1280×704 · 5.0 s · 24 fps · audio</div><span className="small muted">Generation 0193b2a4-7c1e-7d55-9f1a-3e2c8b9d1f40 · open it on the Admin Generations page</span></>}
    </div>
  );
  return (
    <div className={layout === "split" ? "vc-cols two" : "stack loose"}>
      <div className="stack">
        {ctl}
        <UserForm studio={studio} mode={mode} values={values} setValues={setValues} />
        <div className="row"><button className="btn primary" disabled={!!blocked || active} onClick={() => start({ modeName: mode.name, backend: bk.name, pathSize })}><Icon name="play" /> Run test Generation</button>{blocked && <span className="small muted">{blocked}</span>}</div>
      </div>
      <div className="stack">{result || (layout === "split" ? <div className="note">The test's progress and Asset show here.</div> : null)}</div>
    </div>
  );
}

export { stateOf, nodeTitle, nodeLabel, short, fmt };
