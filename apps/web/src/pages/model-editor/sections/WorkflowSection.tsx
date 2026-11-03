import {
  OUTSIDE_SERVICE_NODE_CLASSES,
  PREVIEW_NODE_CLASSES,
  SAVE_NODE_KINDS,
  fieldKey,
  isNodeLink,
} from "@ai-content-studio/shared";
import type {
  BindableField,
  InputDefinition,
  ModeInputState,
} from "@ai-content-studio/shared";
import type { DragEvent } from "react";
import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/button.js";
import { Checkbox } from "../../../components/ui/checkbox.js";
import { Pill } from "../../../components/ui/pill.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.js";
import { candidateFieldsFor } from "../helpers/bindings.js";
import { newInputFromField } from "../helpers/newInputs.js";
import { GROUP_ORDER, nodeGroup } from "../helpers/workflow.js";
import type { EditorNavigation } from "../hooks/useEditorNavigation.js";
import type { ModelDetail, ModelNode } from "../types.js";
import { ChecksList } from "../ui/ChecksList.js";
import { StateEditor } from "../ui/StateEditor.js";
import {
  TypeDot,
  typeDotKindFor,
  typeDotKindForValueType,
} from "../ui/TypeDot.js";
import type { ModelEditor } from "../useModelEditor.js";
import { OutsideServiceNotes } from "./OutsideServiceNotes.js";

function sortedNodeIds(nodes: ModelNode[]): ModelNode[] {
  return [...nodes].sort((a, b) => {
    const diff = Number(a.id) - Number(b.id);
    return Number.isNaN(diff) ? a.id.localeCompare(b.id) : diff;
  });
}

function cutTo60(value: string): string {
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

function bindableField(
  node: ModelNode,
  field: string,
  value: unknown,
): BindableField {
  return {
    nodeId: node.id,
    field,
    classType: node.classType,
    title: node.title,
    valueType: typeof value as "string" | "number" | "boolean",
    value: value as string | number | boolean | null,
  };
}

/** The upload loader's own file field, for the inspector's loader note (issue #214): a best-effort guess (not Backend-driven) from a known mapping, falling back to the first plain string field. */
function loaderFileField(
  node: ModelNode,
  inputs: ModelDetail["workflow"][string]["inputs"],
): string | null {
  if (node.classType === "LoadImage") return "image";
  if (node.classType.includes("Video")) return "video";
  if (node.classType.includes("Audio")) return "audio";
  const firstString = Object.entries(inputs).find(
    ([field, value]) =>
      field !== "filename_prefix" &&
      !isNodeLink(value) &&
      typeof value === "string",
  );
  return firstString?.[0] ?? null;
}

export function WorkflowSection({
  editor,
  detail,
  nav,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
  nav: EditorNavigation;
}) {
  const {
    anyDraftDirty,
    brokenNodeRefs,
    editingMode,
    editingModeIndex,
    editingPath,
    handlePickWorkflowFile,
    handleReplaceWorkflow,
    inputsDraft,
    modelIssues,
    modesDraft,
    mustDisableToSaveWorkflow,
    pendingWorkflow,
    pendingWorkflowFileName,
    pendingWorkflowIssues,
    pendingWorkflowNodes,
    rebindMap,
    setEditingModeIndex,
    setInputsDraft,
    setModeInputSetting,
    setRebind,
    toggleOutputNodeInEditingMode,
    uploadingWorkflow,
    updateInput,
    workflowUploadError,
  } = editor;

  const [search, setSearch] = useState("");
  const [onlyOnPath, setOnlyOnPath] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [makeInputKey, setMakeInputKey] = useState<string | null>(null);
  const [addToInputId, setAddToInputId] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const inputs = inputsDraft ?? detail.inputs ?? [];

  const nodeTypeCount = useMemo(
    () => new Set(detail.nodes.map((n) => n.classType)).size,
    [detail.nodes],
  );
  const outputNodeIdsSaved = useMemo(
    () =>
      new Set(
        detail.modes.flatMap((mode) => mode.outputNodes.map((n) => n.nodeId)),
      ),
    [detail.modes],
  );
  const outputNodeIdsDraft = useMemo(
    () => new Set((modesDraft ?? []).flatMap((mode) => mode.outputNodeIds)),
    [modesDraft],
  );
  const uploadLoaderCount = useMemo(
    () =>
      detail.nodes.filter((n) => nodeGroup(n.classType) === "Upload loaders")
        .length,
    [detail.nodes],
  );

  function bindingFor(nodeId: string, field: string): InputDefinition | null {
    return (
      inputs.find((input) =>
        input.bindings.some((b) => b.nodeId === nodeId && b.field === field),
      ) ?? null
    );
  }

  function boundCountFor(nodeId: string): number {
    return inputs.reduce(
      (count, input) =>
        count + input.bindings.filter((b) => b.nodeId === nodeId).length,
      0,
    );
  }

  function errorCountForMode(modeKey: string): number {
    return modelIssues.filter(
      (issue) => issue.modeId === modeKey && issue.severity === "error",
    ).length;
  }

  const needle = search.trim().toLowerCase();
  const filteredNodes = detail.nodes.filter((node) => {
    if (needle) {
      const matches =
        node.id.toLowerCase().includes(needle) ||
        node.classType.toLowerCase().includes(needle) ||
        (node.title ?? "").toLowerCase().includes(needle);
      if (!matches) return false;
    }
    if (onlyOnPath && editingPath && !editingPath.nodeIds.has(node.id)) {
      return false;
    }
    return true;
  });

  const onPathCount = editingPath
    ? detail.nodes.filter((n) => editingPath.nodeIds.has(n.id)).length
    : 0;

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    nodes: sortedNodeIds(
      filteredNodes.filter((n) => nodeGroup(n.classType) === group),
    ),
  })).filter((entry) => entry.nodes.length > 0);

  const selectedNode =
    detail.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedWorkflowNode = selectedNode
    ? detail.workflow[selectedNode.id]
    : undefined;
  const hasSeed = inputs.some((input) => input.kind === "seed");

  function selectNode(nodeId: string) {
    setSelectedNodeId(nodeId);
    setMakeInputKey(null);
    setAddToInputId("");
  }

  async function onFileInputChange(file: File | null) {
    await handlePickWorkflowFile(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0] ?? null;
    void onFileInputChange(file);
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-semibold">Workflow</h2>
        <p className="max-w-[66ch] text-muted-foreground">
          The ComfyUI graph this Model runs, in API format. Each Mode sends only
          its Path: its output nodes and everything they depend on.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Pill>{detail.nodes.length} nodes</Pill>
        <Pill>{nodeTypeCount} node types</Pill>
        <Pill>
          <TypeDot kind="video" />
          {outputNodeIdsSaved.size} output nodes
        </Pill>
        <Pill>
          <TypeDot kind="image" />
          {uploadLoaderCount} Upload loaders
        </Pill>
        {detail.outsideServiceNotes.length > 0 && (
          <Pill tone="warn">
            {detail.outsideServiceNotes.length} can call an outside service
          </Pill>
        )}
      </div>

      <OutsideServiceNotes detail={detail} />

      <fieldset
        aria-label="Mode picker"
        className="flex gap-1.5 overflow-x-auto border-0 p-0"
      >
        <button
          type="button"
          aria-pressed={editingModeIndex === null}
          onClick={() => setEditingModeIndex(null)}
          className="shrink-0 rounded-full border border-border bg-card px-2.5 py-0.5 text-[12.5px] text-muted-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
        >
          Whole Workflow
        </button>
        {(modesDraft ?? []).map((mode, index) => (
          <button
            key={mode.key}
            type="button"
            aria-pressed={editingModeIndex === index}
            onClick={() =>
              setEditingModeIndex(editingModeIndex === index ? null : index)
            }
            className="shrink-0 rounded-full border border-border bg-card px-2.5 py-0.5 text-[12.5px] text-muted-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
          >
            {mode.name || "Mode"} ({errorCountForMode(mode.key)})
          </button>
        ))}
      </fieldset>

      <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl border border-border @max-[900px]:grid-cols-1">
        <div className="flex flex-col gap-2 border-r border-border bg-card p-3 @max-[900px]:max-h-[45vh] @max-[900px]:overflow-y-auto">
          <label htmlFor="node-filter" className="sr-only">
            Find a node by title, class or id
          </label>
          <input
            id="node-filter"
            placeholder="Find a node by title, class or id"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {editingMode && (
            <label
              htmlFor="workflow-only-on-path"
              className="flex items-center gap-2 text-[12.5px] text-muted-foreground"
            >
              <Checkbox
                id="workflow-only-on-path"
                checked={onlyOnPath}
                onCheckedChange={(checked) => setOnlyOnPath(checked === true)}
              />
              Only nodes on {editingMode.name || "this Mode"}'s Path (
              {onPathCount})
            </label>
          )}
          <div className="flex flex-col gap-1 overflow-y-auto">
            {grouped.map(({ group, nodes }) => (
              <div key={group}>
                <div className="px-1 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {group} · {nodes.length}
                </div>
                {nodes.map((node) => {
                  const onPath = editingPath
                    ? editingPath.nodeIds.has(node.id)
                    : true;
                  const dim = Boolean(editingPath) && !onPath;
                  const boundCount = boundCountFor(node.id);
                  const isOutput = outputNodeIdsDraft.has(node.id);
                  const isOutsideService =
                    OUTSIDE_SERVICE_NODE_CLASSES.includes(node.classType);
                  return (
                    <button
                      key={node.id}
                      type="button"
                      data-selected={selectedNodeId === node.id || undefined}
                      data-dim={dim || undefined}
                      onClick={() => selectNode(node.id)}
                      className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-muted data-[selected]:bg-accent-soft data-[dim]:opacity-40"
                    >
                      <span className="flex-1 truncate">
                        {node.title ?? node.classType}
                      </span>
                      {boundCount > 0 && (
                        <Pill tone="accent">{boundCount} bound</Pill>
                      )}
                      {isOutput && <Pill>output</Pill>}
                      {isOutsideService && (
                        <Pill tone="warn">outside service</Pill>
                      )}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        #{node.id}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3.5 px-5 py-4">
          {!selectedNode || !selectedWorkflowNode ? (
            <p className="text-muted-foreground">
              Select a node from the list to inspect it.
            </p>
          ) : (
            <NodeInspector
              node={selectedNode}
              workflowNode={selectedWorkflowNode}
              detail={detail}
              inputs={inputs}
              editingMode={editingMode}
              editingModeIndex={editingModeIndex}
              editingPath={editingPath}
              modesDraft={modesDraft ?? []}
              hasSeed={hasSeed}
              makeInputKey={makeInputKey}
              setMakeInputKey={setMakeInputKey}
              addToInputId={addToInputId}
              setAddToInputId={setAddToInputId}
              onSelectNode={selectNode}
              onToggleOutput={(nodeId) => toggleOutputNodeInEditingMode(nodeId)}
              onCreateInput={(field) => {
                const created = newInputFromField(field, hasSeed);
                setInputsDraft([...inputs, created]);
                nav.openInput(created.id);
                setMakeInputKey(null);
              }}
              onAddToInput={(input, index, field) => {
                updateInput(index, {
                  ...input,
                  bindings: [
                    ...input.bindings,
                    {
                      nodeId: field.nodeId,
                      field: field.field,
                      classType: field.classType,
                      title: field.title,
                    },
                  ],
                });
                setMakeInputKey(null);
              }}
              onOpenInput={(id) => nav.openInput(id)}
              onModeInputSettingChange={(inputId, patch) => {
                if (editingModeIndex === null) return;
                setModeInputSetting(editingModeIndex, inputId, patch);
              }}
              bindingFor={bindingFor}
            />
          )}
        </div>
      </div>

      <div
        onDrop={onDrop}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        data-over={dragOver || undefined}
        className="rounded-2xl border-[1.5px] border-dashed border-input p-[22px] data-[over]:border-primary data-[over]:bg-accent-soft"
      >
        <p className="font-medium">Re-upload the Workflow</p>
        <p className="text-muted-foreground">
          The API export from ComfyUI (Workflow → Export (API)), up to 10 MB.
          Inputs and outputs keep their bindings by node id. Nothing changes for
          users until you save.
        </p>
        <label
          htmlFor="replace-workflow-file"
          className="mt-2 inline-flex h-9 w-fit cursor-pointer items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted"
        >
          Choose file…
        </label>
        <input
          id="replace-workflow-file"
          type="file"
          accept="application/json"
          className="sr-only"
          onChange={(event) =>
            void onFileInputChange(event.target.files?.[0] ?? null)
          }
        />
        {pendingWorkflowFileName && (
          <p>
            Picked "{pendingWorkflowFileName}": Modes' output nodes and Inputs'
            bindings carry forward by node id. Nothing is sent until you press
            "Replace Workflow".
          </p>
        )}
      </div>

      {pendingWorkflowIssues.length > 0 && (
        <ChecksList
          issues={pendingWorkflowIssues}
          title="Checks on the picked file"
          onJump={() => {}}
        />
      )}

      {brokenNodeRefs.length > 0 && (
        <div className="rounded-r-md border border-border border-l-[3px] border-l-err px-3 py-2">
          <p className="font-medium">
            {brokenNodeRefs.length} binding(s) broke with this Workflow
          </p>
          <ul className="flex flex-col gap-2">
            {brokenNodeRefs.map((ref) => (
              <li
                key={ref.nodeId}
                className="flex items-center gap-2 text-[13px]"
              >
                <span>{ref.description}</span>
                <label htmlFor={`rebind-${ref.nodeId}`} className="sr-only">
                  {`Rebind node "${ref.nodeId}"`}
                </label>
                <select
                  id={`rebind-${ref.nodeId}`}
                  aria-label={`Rebind node "${ref.nodeId}"`}
                  value={rebindMap[ref.nodeId] ?? ""}
                  onChange={(event) =>
                    setRebind(ref.nodeId, event.target.value)
                  }
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-[13px]"
                >
                  <option value="">Leave broken</option>
                  {pendingWorkflowNodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.id} ({node.classType})
                      {node.title ? ` "${node.title}"` : ""}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          disabled={
            uploadingWorkflow || pendingWorkflow === null || anyDraftDirty
          }
          title={
            anyDraftDirty
              ? "Save or discard your other unsaved changes first"
              : undefined
          }
          onClick={() => void handleReplaceWorkflow()}
        >
          {mustDisableToSaveWorkflow
            ? "Replace Workflow and disable"
            : "Replace Workflow"}
        </Button>
        {workflowUploadError && (
          <p role="alert" className="text-err">
            {workflowUploadError}
          </p>
        )}
      </div>
    </section>
  );
}

function NodeInspector({
  node,
  workflowNode,
  detail,
  inputs,
  editingMode,
  editingModeIndex,
  editingPath,
  modesDraft,
  hasSeed,
  makeInputKey,
  setMakeInputKey,
  addToInputId,
  setAddToInputId,
  onSelectNode,
  onToggleOutput,
  onCreateInput,
  onAddToInput,
  onOpenInput,
  onModeInputSettingChange,
  bindingFor,
}: {
  node: ModelNode;
  workflowNode: ModelDetail["workflow"][string];
  detail: ModelDetail;
  inputs: InputDefinition[];
  editingMode: ModelEditor["editingMode"];
  editingModeIndex: number | null;
  editingPath: ModelEditor["editingPath"];
  modesDraft: ModelEditor["modesDraft"];
  hasSeed: boolean;
  makeInputKey: string | null;
  setMakeInputKey: (key: string | null) => void;
  addToInputId: string;
  setAddToInputId: (id: string) => void;
  onSelectNode: (nodeId: string) => void;
  onToggleOutput: (nodeId: string) => void;
  onCreateInput: (field: BindableField) => void;
  onAddToInput: (
    input: InputDefinition,
    index: number,
    field: BindableField,
  ) => void;
  onOpenInput: (id: string) => void;
  onModeInputSettingChange: (
    inputId: string,
    patch: {
      state?: ModeInputState;
      fixedValue?: string | number | boolean | null;
    },
  ) => void;
  bindingFor: (nodeId: string, field: string) => InputDefinition | null;
}) {
  const group = nodeGroup(node.classType);
  const isOutputClass = node.classType in SAVE_NODE_KINDS;
  const isPreview = PREVIEW_NODE_CLASSES.has(node.classType);
  const isUploadLoader = group === "Upload loaders";
  const kind = SAVE_NODE_KINDS[node.classType];
  const modesUsingAsOutput = (modesDraft ?? []).filter((mode) =>
    mode.outputNodeIds.includes(node.id),
  );
  const onPath = editingPath ? editingPath.nodeIds.has(node.id) : false;
  const note = detail.outsideServiceNotes.find((n) => n.nodeId === node.id);
  const loaderField_ = isUploadLoader
    ? loaderFileField(node, workflowNode.inputs)
    : null;

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {group}
        </div>
        <h2 className="font-heading text-base font-semibold">
          {node.title ?? node.classType}
        </h2>
        <p className="font-mono text-[12.5px] text-muted-foreground">
          {node.classType} · #{node.id}
        </p>
      </div>

      {editingMode && (
        <Pill tone={onPath ? "accent" : "neutral"}>
          {onPath
            ? `On ${editingMode.name || "this Mode"}'s Path`
            : `Not on ${editingMode.name || "this Mode"}'s Path, so never sent in that Mode`}
        </Pill>
      )}

      {isUploadLoader && (
        <p className="rounded-md bg-muted px-[11px] py-[9px] text-[13px] text-muted-foreground">
          Upload loader. In each Mode whose Path holds it, an Input must fill
          its <code className="font-mono">{loaderField_ ?? "file"}</code> field,
          or that Mode can't be enabled.
        </p>
      )}

      {note && !note.keySet && (
        <p className="rounded-r-md border border-border border-l-[3px] border-l-warn px-3 py-2 text-[13px]">
          Its key field is empty, so encoding stays on the Backend.
        </p>
      )}

      {isOutputClass && (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="font-medium">Output node</p>
          {isPreview ? (
            <p className="text-muted-foreground">
              A preview node saves no file, so it can't be a Mode's output.
            </p>
          ) : (
            <>
              <p>Saves a {kind}.</p>
              <p className="text-muted-foreground">
                {modesUsingAsOutput.length > 0
                  ? `Output of ${modesUsingAsOutput.map((m) => m.name || "this Mode").join(", ")}.`
                  : "No Mode uses it yet."}
              </p>
              {editingMode && (
                <label
                  htmlFor={`use-as-output-${node.id}`}
                  className="flex items-center gap-2 text-[13px]"
                >
                  <Checkbox
                    id={`use-as-output-${node.id}`}
                    checked={editingMode.outputNodeIds.includes(node.id)}
                    onCheckedChange={() => onToggleOutput(node.id)}
                  />
                  Use as an output of {editingMode.name || "this Mode"}
                </label>
              )}
            </>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-semibold text-muted-foreground">
                Field
              </TableHead>
              <TableHead className="text-xs font-semibold text-muted-foreground">
                Workflow value
              </TableHead>
              <TableHead className="text-xs font-semibold text-muted-foreground">
                Input
              </TableHead>
              {editingMode && (
                <TableHead className="text-xs font-semibold text-muted-foreground">
                  In {editingMode.name || "this Mode"}
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(workflowNode.inputs).map(([field, value]) => {
              const linked = isNodeLink(value);
              const linkedFrom = linked ? value[0] : null;
              const valueType =
                linked || value === null
                  ? null
                  : (typeof value as "string" | "number" | "boolean");
              const isFilenamePrefix = field === "filename_prefix";
              const boundInput = bindingFor(node.id, field);
              const key = fieldKey(node.id, field);
              const sourceNode = linkedFrom
                ? detail.workflow[linkedFrom]
                : undefined;
              const otherCompatibleInputs = valueType
                ? inputs.filter(
                    (candidate) =>
                      candidate.id !== boundInput?.id &&
                      candidateFieldsFor(
                        detail.workflow,
                        candidate,
                        inputs.filter((o) => o.id !== candidate.id),
                      ).some((f) => f.nodeId === node.id && f.field === field),
                  )
                : [];

              return (
                <TableRow key={field} className="align-top">
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {valueType && (
                        <TypeDot kind={typeDotKindForValueType(valueType)} />
                      )}
                      <span className="font-mono">{field}</span>
                      {valueType && (
                        <span className="text-[11px] text-muted-foreground">
                          {valueType}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {linked ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => linkedFrom && onSelectNode(linkedFrom)}
                      >
                        ←{" "}
                        {sourceNode?._meta?.title ??
                          sourceNode?.class_type ??
                          linkedFrom}
                      </Button>
                    ) : (
                      <span className="font-mono text-[12.5px]">
                        {cutTo60(String(value))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {boundInput ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenInput(boundInput.id)}
                      >
                        <TypeDot kind={typeDotKindFor(boundInput.kind)} />
                        {boundInput.label || "Input"}
                      </Button>
                    ) : linked ? (
                      <span className="text-[12.5px] text-muted-foreground">
                        Fed by a link. Bind the source node.
                      </span>
                    ) : isFilenamePrefix ? (
                      <span className="text-[12.5px] text-muted-foreground">
                        Keeps the Workflow value
                      </span>
                    ) : makeInputKey === key ? (
                      <div className="flex flex-col gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() =>
                            onCreateInput(bindableField(node, field, value))
                          }
                        >
                          New Input from this field
                        </Button>
                        {otherCompatibleInputs.length > 0 && (
                          <select
                            aria-label="Or add to an Input…"
                            value={addToInputId}
                            onChange={(event) => {
                              const chosen = inputs.find(
                                (i) => i.id === event.target.value,
                              );
                              const index = inputs.findIndex(
                                (i) => i.id === event.target.value,
                              );
                              if (chosen && index >= 0) {
                                onAddToInput(
                                  chosen,
                                  index,
                                  bindableField(node, field, value),
                                );
                              }
                              setAddToInputId(event.target.value);
                            }}
                            className="h-8 rounded-md border border-input bg-transparent px-2 text-[13px]"
                          >
                            <option value="">Or add to an Input…</option>
                            {otherCompatibleInputs.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.label || "Input"}
                              </option>
                            ))}
                          </select>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setMakeInputKey(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setMakeInputKey(key)}
                      >
                        Make it an Input
                      </Button>
                    )}
                  </TableCell>
                  {editingMode && (
                    <TableCell>
                      {boundInput ? (
                        <StateEditor
                          input={boundInput}
                          state={
                            editingMode.inputSettings.find(
                              (s) => s.inputId === boundInput.id,
                            )?.state ?? "hidden"
                          }
                          fixedValue={
                            editingMode.inputSettings.find(
                              (s) => s.inputId === boundInput.id,
                            )?.fixedValue ?? null
                          }
                          onStateChange={(state) =>
                            onModeInputSettingChange(boundInput.id, {
                              state,
                              fixedValue:
                                state === "fixed"
                                  ? (editingMode.inputSettings.find(
                                      (s) => s.inputId === boundInput.id,
                                    )?.fixedValue ?? null)
                                  : null,
                            })
                          }
                          onFixedValueChange={(fixedValue) =>
                            onModeInputSettingChange(boundInput.id, {
                              fixedValue,
                            })
                          }
                        />
                      ) : (
                        <span className="text-[12.5px] text-muted-foreground">
                          Keeps the Workflow value
                        </span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
