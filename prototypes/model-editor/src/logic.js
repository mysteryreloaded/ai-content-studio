// PROTOTYPE logic: Path computation and a simplified checkModel, following
// ADR 0001 and the Input-binding and validation decisions. Not production code.
import { FIELD_SPECS, EXTERNAL_CLASSES } from "./data.js";

export const UPLOAD_LOADERS = {
  LoadImage: { field: "image", kind: "image" },
  VHS_LoadVideo: { field: "video", kind: "video" },
  LoadVideo: { field: "file", kind: "video" },
  VHS_LoadAudioUpload: { field: "audio", kind: "audio" },
  LoadAudio: { field: "audio", kind: "audio" },
};
export const OUTPUT_CLASSES = { SaveVideo: "video", VHS_VideoCombine: "video", SaveImage: "image", SaveAnimatedWEBP: "image", SaveAudio: "audio", SaveAudioMP3: "audio" };
export const PREVIEW_CLASSES = new Set(["PreviewImage", "PreviewAudio", "PreviewAny"]);
export const STATES = ["hidden", "optional", "required", "fixed"];
export const INPUT_TYPES = [
  { id: "text", label: "Text" },
  { id: "number", label: "Number" },
  { id: "seed", label: "Seed" },
  { id: "select", label: "Select" },
  { id: "toggle", label: "Toggle" },
  { id: "image", label: "Image Upload" },
  { id: "video", label: "Video Upload" },
  { id: "audio", label: "Audio Upload" },
  { id: "points", label: "Points on a frame" },
];
export const UPLOAD_TYPES = new Set(["image", "video", "audio"]);

export const isLink = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";
export const key = (bnd) => `${bnd.node}.${bnd.field}`;
export const nodeTitle = (wf, id) => (wf && wf[id] ? wf[id]._meta?.title || wf[id].class_type : `#${id}`);
export const nodeLabel = (wf, id) => `${nodeTitle(wf, id)} (#${id})`;

export function fieldSpec(wf, nodeId, field) {
  const n = wf?.[nodeId];
  if (!n) return null;
  const v = n.inputs[field];
  if (isLink(v)) return { type: "LINK", from: v[0] };
  const known = FIELD_SPECS[n.class_type]?.[field];
  if (known) return known;
  if (typeof v === "boolean") return { type: "BOOLEAN" };
  if (typeof v === "number") return Number.isInteger(v) ? { type: "INT", min: -1e18, max: 1e18, step: 1 } : { type: "FLOAT", min: -1e18, max: 1e18, step: 0.01 };
  return { type: "STRING" };
}

// Which Node field types an Input type may bind
export function compatible(inputType, spec, classType, field) {
  if (!spec || spec.type === "LINK") return false;
  const loader = UPLOAD_LOADERS[classType];
  if (UPLOAD_TYPES.has(inputType)) return !!loader && loader.field === field && loader.kind === inputType;
  if (loader && loader.field === field) return false;
  switch (inputType) {
    case "text": return spec.type === "STRING";
    case "points": return spec.type === "STRING";
    case "number": return spec.type === "INT" || spec.type === "FLOAT";
    case "seed": return spec.type === "INT";
    case "select":
    case "toggle": return ["COMBO", "STRING", "INT", "FLOAT", "BOOLEAN"].includes(spec.type);
    default: return false;
  }
}

export function stateOf(mode, inputId) {
  return mode.states[inputId] || { s: "hidden" };
}

// The value an Input writes into one bound field, for a given Input value
export function fieldValue(input, value, bnd) {
  if (input.type === "select" || input.type === "toggle") {
    const opt = input.options?.find((o) => o.id === value);
    return opt ? opt.values[key(bnd)] : undefined;
  }
  return value;
}

// Path: the Mode's output nodes plus everything upstream. A core ComfySwitchNode
// whose value is known (fixed, or hidden so the Workflow's own value applies) is
// followed one side only; a visible Input on the switch keeps both sides.
export function computePath(draft, mode) {
  const wf = draft.workflow;
  const seen = new Set();
  if (!wf) return seen;
  const switchValue = (nodeId) => {
    for (const input of draft.inputs) {
      const bnd = input.bindings.find((x) => x.node === nodeId && x.field === "switch");
      if (!bnd) continue;
      const st = stateOf(mode, input.id);
      if (st.s === "fixed") return fieldValue(input, st.v, bnd);
      if (st.s === "hidden") return wf[nodeId].inputs.switch;
      return undefined;
    }
    const v = wf[nodeId].inputs.switch;
    return isLink(v) ? undefined : v;
  };
  const stack = mode.outputs.map((o) => o.node).filter((id) => wf[id]);
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const n = wf[id];
    for (const [k, v] of Object.entries(n.inputs)) {
      if (!isLink(v) || !wf[v[0]]) continue;
      if (n.class_type === "ComfySwitchNode" && (k === "on_true" || k === "on_false")) {
        const s = switchValue(id);
        if (s === true && k === "on_false") continue;
        if (s === false && k === "on_true") continue;
      }
      stack.push(v[0]);
    }
  }
  return seen;
}

export function pathSummary(draft, mode) {
  const path = computePath(draft, mode);
  const uploads = [];
  const external = [];
  for (const id of path) {
    const n = draft.workflow[id];
    if (UPLOAD_LOADERS[n.class_type]) {
      const field = UPLOAD_LOADERS[n.class_type].field;
      const input = draft.inputs.find((i) => i.bindings.some((x) => x.node === id && x.field === field));
      uploads.push({ node: id, kind: UPLOAD_LOADERS[n.class_type].kind, input, state: input ? stateOf(mode, input.id).s : null });
    }
    if (EXTERNAL_CLASSES[n.class_type]) external.push(id);
  }
  return { path, uploads, external };
}

export function visibleInputs(draft, mode) {
  return draft.inputs.filter((i) => ["optional", "required"].includes(stateOf(mode, i.id).s));
}

const issue = (level, area, text, where = {}) => ({ level, area, text, ...where });

export function checkModel(draft, backends) {
  const out = [];
  const wf = draft.workflow;
  if (!wf) {
    out.push(issue("error", "workflow", "Upload the Workflow, exported from ComfyUI with Export (API)."));
    return out;
  }
  const d = draft.details;
  if (!d.name.trim()) out.push(issue("error", "details", "Give the Model a name."));

  // Inputs and bindings
  const fieldOwner = {};
  for (const input of draft.inputs) {
    if (!input.bindings.length) out.push(issue("error", "inputs", `${input.label} binds no Node field. Bind it, or delete it.`, { inputId: input.id }));
    for (const bnd of input.bindings) {
      const n = wf[bnd.node];
      if (!n) {
        out.push(issue("error", "inputs", `${input.label} binds node #${bnd.node}, which isn't in this Workflow. Rebind it.`, { inputId: input.id, broken: bnd }));
        continue;
      }
      if (!(bnd.field in n.inputs)) {
        out.push(issue("error", "inputs", `${input.label} binds ${nodeLabel(wf, bnd.node)}.${bnd.field}, which no longer exists. Rebind it.`, { inputId: input.id, broken: bnd }));
        continue;
      }
      const spec = fieldSpec(wf, bnd.node, bnd.field);
      if (spec.type === "LINK") out.push(issue("error", "inputs", `${input.label} binds ${nodeLabel(wf, bnd.node)}.${bnd.field}, which is fed by a link. Bind the source node instead.`, { inputId: input.id }));
      else if (!compatible(input.type, spec, n.class_type, bnd.field)) out.push(issue("error", "inputs", `${input.label} (${input.type}) can't write into ${nodeLabel(wf, bnd.node)}.${bnd.field} (${spec.type}).`, { inputId: input.id }));
      const k = key(bnd);
      if (fieldOwner[k]) out.push(issue("error", "inputs", `${nodeLabel(wf, bnd.node)}.${bnd.field} is bound by both ${fieldOwner[k]} and ${input.label}. A field takes one Input.`, { inputId: input.id }));
      fieldOwner[k] = input.label;
      if (input.type === "number" && spec.type !== "LINK") {
        if (input.min === "" || input.max === "" || input.min == null || input.max == null) out.push(issue("error", "inputs", `${input.label} needs a min and a max.`, { inputId: input.id }));
        else {
          if (spec.min != null && input.min < spec.min) out.push(issue("error", "inputs", `${input.label}'s min ${input.min} is below ${nodeTitle(wf, bnd.node)}.${bnd.field}'s min ${spec.min}.`, { inputId: input.id }));
          if (spec.max != null && input.max > spec.max) out.push(issue("error", "inputs", `${input.label}'s max ${input.max} is above ${nodeTitle(wf, bnd.node)}.${bnd.field}'s max ${spec.max}.`, { inputId: input.id }));
          if (spec.type === "INT" && spec.step > 1 && ((input.min - spec.min) % spec.step !== 0 || input.step % spec.step !== 0)) out.push(issue("error", "inputs", `${nodeTitle(wf, bnd.node)}.${bnd.field} takes ${spec.min} + a multiple of ${spec.step}. Set ${input.label}'s min and step to match.`, { inputId: input.id }));
        }
      }
      if ((input.type === "select" || input.type === "toggle") && spec.type === "COMBO") {
        for (const o of input.options || []) {
          const v = o.values[k];
          if (v !== undefined && !spec.options.includes(v)) out.push(issue("error", "inputs", `${input.label} option "${o.label}" writes "${v}", which ${nodeTitle(wf, bnd.node)}.${bnd.field} doesn't list.`, { inputId: input.id }));
        }
      }
      if (bnd.field === "filename_prefix") out.push(issue("error", "inputs", `${input.label} binds a save node's filename_prefix. The studio names Asset files itself.`, { inputId: input.id }));
    }
    if ((input.type === "select" || input.type === "toggle") && (input.options || []).length < 2) out.push(issue("error", "inputs", `${input.label} needs at least two options.`, { inputId: input.id }));
  }

  // Modes and Paths
  if (!draft.modes.length) out.push(issue("error", "modes", "Add at least one Mode."));
  const sigs = {};
  for (const mode of draft.modes) {
    const where = { modeId: mode.id };
    if (!mode.outputs.length) out.push(issue("error", "modes", `${mode.name} names no output node. Pick the node that saves its Asset.`, where));
    for (const o of mode.outputs) {
      const n = wf[o.node];
      if (!n) out.push(issue("error", "modes", `${mode.name}'s output #${o.node} isn't in this Workflow. Pick its output again.`, { ...where, brokenOutput: o.node }));
      else if (!OUTPUT_CLASSES[n.class_type] && !o.kind) out.push(issue("error", "modes", `${mode.name}: ${nodeLabel(wf, o.node)} is not a known save node. Pick the kind of file it saves.`, where));
    }
    const { path, uploads, external } = pathSummary(draft, mode);
    for (const u of uploads) {
      if (!u.input || u.state === "hidden") out.push(issue("error", "modes", `${mode.name}: ${nodeLabel(wf, u.node)} is on its Path, but no Input fills it. Show ${u.input ? u.input.label : "an Input bound to it"}, or fix a value.`, { ...where, nodeId: u.node }));
    }
    for (const input of draft.inputs) {
      const st = stateOf(mode, input.id).s;
      const onPath = input.bindings.some((x) => path.has(x.node));
      if ((st === "optional" || st === "required") && !onPath && input.bindings.every((x) => wf[x.node])) out.push(issue("warning", "modes", `${mode.name} shows ${input.label}, but none of its fields are on this Mode's Path, so it does nothing.`, { ...where, inputId: input.id }));
      if (st === "fixed" && !onPath && input.bindings.every((x) => wf[x.node])) out.push(issue("warning", "modes", `${mode.name} fixes ${input.label}, but its fields are outside this Mode's Path.`, { ...where, inputId: input.id }));
      if (st === "fixed" && UPLOAD_TYPES.has(input.type)) {
        for (const bk of backends.filter((x) => draft.backendIds.includes(x.id) && x.health === "healthy")) {
          const n = wf[input.bindings[0]?.node];
          const opts = n && FIELD_SPECS[n.class_type]?.[input.bindings[0].field]?.options;
          if (opts && !opts.includes(stateOf(mode, input.id).v)) out.push(issue("error", "modes", `${mode.name} fixes ${input.label} to "${stateOf(mode, input.id).v}", which isn't in input/ on ${bk.name}.`, { ...where, backendId: bk.id }));
        }
      }
    }
    for (const id of external) {
      const ext = EXTERNAL_CLASSES[wf[id].class_type];
      const keyVal = wf[id].inputs[ext.keyField];
      if (typeof keyVal === "string" && keyVal.trim()) out.push(issue("warning", "modes", `${mode.name}: ${nodeLabel(wf, id)} holds an API key, so it sends user prompts to ${ext.host}. Clear the key in ComfyUI and re-upload.`, { ...where, nodeId: id }));
    }
    const fixed = Object.entries(mode.states).filter(([, s]) => s.s === "fixed").map(([k, s]) => `${k}=${JSON.stringify(s.v)}`).sort().join("&");
    const sig = [...path].sort().join(",") + "|" + fixed;
    if (sigs[sig]) out.push(issue("warning", "modes", `${mode.name} runs the same Path with the same fixed values as ${sigs[sig]}.`, where));
    else sigs[sig] = mode.name;

    // Node types on each attached Backend
    for (const bk of backends.filter((x) => draft.backendIds.includes(x.id) && x.health === "healthy")) {
      const missing = [...new Set([...path].map((id) => wf[id].class_type))].filter((c) => bk.missing.includes(c));
      if (missing.length) out.push(issue("error", "backends", `${mode.name} needs ${missing.join(", ")}, which ${bk.name} doesn't have${bk.missingPack ? ` (install ${bk.missingPack} there)` : ""}, or detach ${bk.name}.`, { ...where, backendId: bk.id }));
    }
  }

  // Backends
  const attached = backends.filter((x) => draft.backendIds.includes(x.id));
  if (!attached.length) out.push(issue("error", "backends", "Attach at least one Backend to run this Model."));
  for (const bk of attached) {
    if (bk.health === "unreachable") out.push(issue("warning", "backends", `${bk.name} is unreachable, so its node list can't be checked.`, { backendId: bk.id }));
    if (bk.health === "credentials") out.push(issue("warning", "backends", `${bk.name}'s credentials no longer decrypt (SECRET_KEY changed). Re-enter them; until then it counts as unreachable.`, { backendId: bk.id }));
  }
  if (d.termsText.trim() && d.licenseUrl && !/^https?:\/\//.test(d.licenseUrl)) out.push(issue("error", "terms", "The license URL must start with https:// or http://."));
  return out;
}

export function validateBackendUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return "Use http:// or https://.";
    if (u.username || u.password) return "Put credentials in the fields below, not in the address.";
    if (u.search || u.hash) return "Leave out ? queries and # fragments.";
    return "";
  } catch {
    return "Enter a full address, like http://100.101.7.12:8188";
  }
}

// Re-upload scenario: the Admin re-exported after moving two nodes in ComfyUI
export function reexport(wf) {
  const json = JSON.stringify(wf).replaceAll('"5444"', '"5450"').replaceAll('"7821"', '"7830"');
  return JSON.parse(json);
}

export function workflowStats(wf) {
  if (!wf) return null;
  const nodes = Object.entries(wf);
  return {
    nodes: nodes.length,
    outputs: nodes.filter(([, n]) => OUTPUT_CLASSES[n.class_type]).length,
    uploads: nodes.filter(([, n]) => UPLOAD_LOADERS[n.class_type]).length,
    external: nodes.filter(([, n]) => EXTERNAL_CLASSES[n.class_type]).length,
    classes: new Set(nodes.map(([, n]) => n.class_type)).size,
  };
}

// Group nodes by what an Admin looks for
export function nodeGroup(n) {
  const c = n.class_type;
  if (UPLOAD_LOADERS[c]) return "Upload loaders";
  if (OUTPUT_CLASSES[c] || PREVIEW_CLASSES.has(c)) return "Outputs";
  if (EXTERNAL_CLASSES[c]) return "Outside services";
  if (/^Primitive|INTConstant|mxSlider|ResolutionSelector|ComfySwitchNode|MathExpression/.test(c)) return "Values and switches";
  if (/Loader|LoRA/i.test(c)) return "Models and LoRAs";
  if (/CLIPTextEncode|Conditioning/.test(c)) return "Prompts and conditioning";
  return "Sampling and the rest";
}
export const GROUP_ORDER = ["Upload loaders", "Values and switches", "Prompts and conditioning", "Outputs", "Outside services", "Models and LoRAs", "Sampling and the rest"];

export function slugify(s) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
