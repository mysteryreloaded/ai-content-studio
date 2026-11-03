import { inferOutputNodeKind } from "@ai-content-studio/shared";
import { ArrowUp, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/button.js";
import { Pill } from "../../../components/ui/pill.js";
import type { DraftMode, ModelDetail } from "../types.js";
import { TypeDot, type TypeDotKind } from "../ui/TypeDot.js";
import { OutputPicker } from "./OutputPicker.js";

function kindDotKind(classType: string): TypeDotKind | null {
  const kind = inferOutputNodeKind(classType);
  if (kind === "video" || kind === "image" || kind === "audio") return kind;
  return null;
}

/**
 * A Mode's ordered output nodes (issue #216): the "+ Output" picker, each
 * row's kind pill, Move up/Remove, and a missing node's own "Pick again".
 * The first output is the main Asset.
 */
export function OutputsEditor({
  mode,
  detail,
  onAdd,
  onReplace,
  onMove,
  onRemove,
}: {
  mode: DraftMode;
  detail: ModelDetail;
  onAdd: (nodeId: string) => void;
  onReplace: (oldNodeId: string, newNodeId: string) => void;
  onMove: (nodeId: string, direction: "up" | "down") => void;
  onRemove: (nodeId: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [replacing, setReplacing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Output nodes
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setReplacing(null);
            setPickerOpen(true);
          }}
        >
          + Output
        </Button>
      </div>

      {mode.outputNodeIds.length === 0 && (
        <p className="rounded-r-md border border-border border-l-[3px] border-l-err bg-err-soft px-3 py-2 text-[13px]">
          Name the node that saves this Mode's Asset. Its Path is that node plus
          everything it depends on.
        </p>
      )}

      {mode.outputNodeIds.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {mode.outputNodeIds.map((nodeId, position) => {
            const node = detail.workflow[nodeId];
            const title = detail.nodes.find((n) => n.id === nodeId)?.title;
            if (!node) {
              return (
                <li
                  key={nodeId}
                  className="flex items-center justify-between gap-2 rounded-md bg-err-soft px-2.5 py-1.5"
                >
                  <div className="flex flex-col gap-0.5">
                    <Pill tone={position === 0 ? "accent" : "neutral"}>
                      {position === 0 ? "Main Asset" : `Extra ${position}`}
                    </Pill>
                    <span className="text-[13px] text-err">
                      Output node "{nodeId}" isn't in this Workflow.
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setReplacing(nodeId);
                      setPickerOpen(true);
                    }}
                  >
                    Pick again
                  </Button>
                </li>
              );
            }
            const dotKind = kindDotKind(node.class_type);
            return (
              <li
                key={nodeId}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Pill tone={position === 0 ? "accent" : "neutral"}>
                    {position === 0 ? "Main Asset" : `Extra ${position}`}
                  </Pill>
                  <span className="flex items-center gap-1.5">
                    <strong className="font-mono">
                      {title ?? node.class_type}
                    </strong>
                    <Pill>
                      {dotKind && <TypeDot kind={dotKind} />}
                      {inferOutputNodeKind(node.class_type) ?? "unknown kind"}
                    </Pill>
                  </span>
                  <span className="text-[12.5px] text-faint">#{nodeId}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Move up"
                    disabled={position === 0}
                    onClick={() => onMove(nodeId, "up")}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remove output"
                    onClick={() => onRemove(nodeId)}
                  >
                    <X />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <OutputPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        nodes={detail.nodes}
        existingOutputNodeIds={mode.outputNodeIds}
        onPick={(nodeId) => {
          if (replacing) onReplace(replacing, nodeId);
          else onAdd(nodeId);
          setPickerOpen(false);
          setReplacing(null);
        }}
      />
    </div>
  );
}
