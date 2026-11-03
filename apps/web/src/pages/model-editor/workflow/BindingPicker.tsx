import {
  OUTSIDE_SERVICE_NODE_CLASSES,
  fieldKey,
  isNodeLink,
} from "@ai-content-studio/shared";
import type {
  InputDefinition,
  Workflow,
  WorkflowNode,
} from "@ai-content-studio/shared";
import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/button.js";
import { Checkbox } from "../../../components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
import { Input } from "../../../components/ui/input.js";
import { Pill } from "../../../components/ui/pill.js";
import { usedFieldKeys } from "../helpers/bindings.js";
import { TypeDot, typeDotKindForValueType } from "../ui/TypeDot.js";

/** A field that doesn't fit {@link import("@ai-content-studio/shared").BindableField}'s "value-holding only" shape: the picker also shows linked fields, refused with a hint (issue #214). */
interface PickerField {
  nodeId: string;
  field: string;
  linkedFrom: string | null;
  valueType: "string" | "number" | "boolean" | null;
  value: unknown;
}

/** Every node id here comes from `Object.keys(workflow)`, so the lookup is always a hit; `noUncheckedIndexedAccess` doesn't know that. */
function nodeOf(workflow: Workflow, nodeId: string): WorkflowNode {
  return workflow[nodeId] as WorkflowNode;
}

function fieldsOf(workflow: Workflow, nodeId: string): PickerField[] {
  const node = nodeOf(workflow, nodeId);
  return Object.entries(node.inputs)
    .filter(([field]) => field !== "filename_prefix")
    .map(([field, value]) => ({
      nodeId,
      field,
      linkedFrom: isNodeLink(value) ? value[0] : null,
      valueType:
        isNodeLink(value) || value === null
          ? null
          : (typeof value as "string" | "number" | "boolean"),
      value,
    }));
}

/** The same type rule `candidateFieldsFor` applies, per field rather than per Workflow (issue #214's BindingPicker). */
function acceptsValueType(
  kind: InputDefinition["kind"],
  valueType: "string" | "number" | "boolean",
): boolean {
  if (kind === "text") return valueType === "string";
  if (kind === "number" || kind === "seed") return valueType === "number";
  if (
    kind === "image_upload" ||
    kind === "video_upload" ||
    kind === "audio_upload" ||
    kind === "points"
  ) {
    return valueType === "string";
  }
  return true;
}

/**
 * The shared binding picker (issue #214 / spec #33): a wide dialog that
 * binds `input` to one Node field. `onBind` is given the field to add
 * (the caller runs `toggleBinding`); `savedBinding` (when rebinding an
 * existing binding) drives the title and the "Looks like the old node"
 * suggestion.
 */
export function BindingPicker({
  open,
  onOpenChange,
  input,
  workflow,
  otherInputs,
  savedBinding,
  onBind,
  onGoToNode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  input: InputDefinition;
  workflow: Workflow;
  otherInputs: InputDefinition[];
  savedBinding?: {
    nodeId: string;
    field: string;
    classType: string;
    title: string | null;
  };
  onBind: (field: {
    nodeId: string;
    field: string;
    classType: string;
    title: string | null;
    valueType: "string" | "number" | "boolean";
    value: string | number | boolean | null;
  }) => void;
  onGoToNode?: (nodeId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const used = useMemo(
    () => usedFieldKeys(otherInputs, input.id),
    [otherInputs, input.id],
  );

  const nodeIds = useMemo(
    () =>
      Object.keys(workflow).sort((a, b) => {
        const diff = Number(a) - Number(b);
        return Number.isNaN(diff) ? a.localeCompare(b) : diff;
      }),
    [workflow],
  );

  const hasAnyCompatibleField = (nodeId: string): boolean =>
    fieldsOf(workflow, nodeId).some(
      (field) =>
        field.valueType && acceptsValueType(input.kind, field.valueType),
    );

  const needle = search.trim().toLowerCase();
  const matches = (nodeId: string): boolean => {
    if (!needle) return true;
    const node = nodeOf(workflow, nodeId);
    return (
      nodeId.toLowerCase().includes(needle) ||
      node.class_type.toLowerCase().includes(needle) ||
      (node._meta?.title ?? "").toLowerCase().includes(needle)
    );
  };

  const shown = nodeIds.filter(
    (nodeId) => matches(nodeId) && (showEmpty || hasAnyCompatibleField(nodeId)),
  );

  function toggle(nodeId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[980px]">
        <DialogHeader>
          <DialogTitle>
            {savedBinding
              ? `Rebind "${input.label || "this Input"}" (was #${savedBinding.nodeId}.${savedBinding.field})`
              : `Bind "${input.label || "this Input"}" to a Node field`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label htmlFor="binding-picker-search" className="sr-only">
            Search by title, class or id
          </label>
          <Input
            id="binding-picker-search"
            placeholder="Search by title, class or id"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <label
            htmlFor="binding-picker-show-empty"
            className="flex items-center gap-2 text-[13px]"
          >
            <Checkbox
              id="binding-picker-show-empty"
              checked={showEmpty}
              onCheckedChange={(checked) => setShowEmpty(checked === true)}
            />
            Show nodes with no field this Input can take
          </label>
          <p className="text-[12.5px] text-muted-foreground">
            Showing {shown.length} of {nodeIds.length} nodes. Fields fed by a
            link can't hold a value; bind the node that feeds them.
          </p>
          <div className="flex max-h-[56vh] flex-col gap-1 overflow-y-auto">
            {shown.map((nodeId) => {
              const node = nodeOf(workflow, nodeId);
              const isOutsideService = OUTSIDE_SERVICE_NODE_CLASSES.includes(
                node.class_type,
              );
              const looksLikeOld =
                Boolean(savedBinding) &&
                savedBinding?.classType === node.class_type &&
                savedBinding?.title === (node._meta?.title ?? null);
              return (
                <div
                  key={nodeId}
                  className="rounded-md border border-border bg-card"
                >
                  <button
                    type="button"
                    onClick={() => toggle(nodeId)}
                    aria-expanded={expanded.has(nodeId)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-muted"
                  >
                    <span className="flex-1 truncate">
                      {node._meta?.title ?? node.class_type}
                    </span>
                    <span className="font-mono text-[12.5px] text-muted-foreground">
                      #{nodeId}
                    </span>
                    {isOutsideService && (
                      <Pill tone="warn">outside service</Pill>
                    )}
                    {looksLikeOld && (
                      <Pill tone="accent">Looks like the old node</Pill>
                    )}
                  </button>
                  {expanded.has(nodeId) && (
                    <div className="flex flex-col gap-1 border-t border-border px-3 py-2">
                      {fieldsOf(workflow, nodeId).map((field) => {
                        if (field.linkedFrom) {
                          const source = workflow[field.linkedFrom];
                          return (
                            <div
                              key={field.field}
                              className="flex items-center gap-2 text-[13px]"
                            >
                              <span className="text-muted-foreground">
                                {field.field}: fed by a link from{" "}
                                {source?._meta?.title ??
                                  source?.class_type ??
                                  field.linkedFrom}
                                . Bind that node instead.
                              </span>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (field.linkedFrom) {
                                    toggle(field.linkedFrom);
                                    onGoToNode?.(field.linkedFrom);
                                  }
                                }}
                              >
                                Go to #{field.linkedFrom}
                              </Button>
                            </div>
                          );
                        }
                        const valueType = field.valueType;
                        if (!valueType) return null;
                        const key = fieldKey(nodeId, field.field);
                        const boundBy = otherInputs.find((other) =>
                          other.bindings.some(
                            (b) =>
                              b.nodeId === nodeId && b.field === field.field,
                          ),
                        );
                        const compatible = acceptsValueType(
                          input.kind,
                          valueType,
                        );
                        const taken = used.has(key);
                        const disabled = !compatible || taken;
                        const title = !compatible
                          ? `Takes ${valueType}; this Input can't write it`
                          : taken
                            ? "A field takes one Input"
                            : undefined;
                        return (
                          <div
                            key={field.field}
                            className="flex items-center gap-2 text-[13px]"
                          >
                            <TypeDot
                              kind={typeDotKindForValueType(valueType)}
                            />
                            <span className="font-mono">{field.field}</span>
                            <span className="text-muted-foreground">
                              {valueType} · {String(field.value)}
                            </span>
                            {boundBy && (
                              <span className="text-muted-foreground">
                                · bound by {boundBy.label || "this Input"}
                              </span>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              className="ml-auto"
                              disabled={disabled}
                              title={title}
                              onClick={() =>
                                onBind({
                                  nodeId,
                                  field: field.field,
                                  classType: node.class_type,
                                  title: node._meta?.title ?? null,
                                  valueType,
                                  value: field.value as
                                    | string
                                    | number
                                    | boolean
                                    | null,
                                })
                              }
                            >
                              Bind
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
