import {
  PREVIEW_NODE_CLASSES,
  SAVE_NODE_KINDS,
  inferOutputNodeKind,
} from "@ai-content-studio/shared";
import type { Workflow } from "@ai-content-studio/shared";
import { useState } from "react";
import { Button } from "../../../components/ui/button.js";
import { Checkbox } from "../../../components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
import { Pill } from "../../../components/ui/pill.js";
import { TypeDot, typeDotKindForValueType } from "../ui/TypeDot.js";

/** issue #216's "+ Output" dialog: Preview nodes can't be picked. */
export function OutputPicker({
  open,
  onOpenChange,
  workflow,
  alreadyUsed,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: Workflow;
  alreadyUsed: Set<string>;
  onPick: (nodeId: string) => void;
}) {
  const [showEvery, setShowEvery] = useState(false);

  const nodeIds = Object.keys(workflow).sort((a, b) => {
    const diff = Number(a) - Number(b);
    return Number.isNaN(diff) ? a.localeCompare(b) : diff;
  });

  const shown = nodeIds.filter((nodeId) => {
    if (showEvery) return true;
    const classType = workflow[nodeId]?.class_type ?? "";
    return classType in SAVE_NODE_KINDS || PREVIEW_NODE_CLASSES.has(classType);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Pick an output node</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-muted-foreground">
            An output node saves a file. Preview nodes don't, so they can't be
            outputs.
          </p>
          <label
            htmlFor="output-picker-show-every"
            className="flex items-center gap-2 text-[13px]"
          >
            <Checkbox
              id="output-picker-show-every"
              checked={showEvery}
              onCheckedChange={(checked) => setShowEvery(checked === true)}
            />
            Show every node (for custom save nodes)
          </label>
          <div className="flex max-h-[56vh] flex-col gap-1 overflow-y-auto">
            {shown.map((nodeId) => {
              const node = workflow[nodeId];
              if (!node) return null;
              const isPreview = PREVIEW_NODE_CLASSES.has(node.class_type);
              const kind = inferOutputNodeKind(node.class_type);
              const used = alreadyUsed.has(nodeId);
              return (
                <div
                  key={nodeId}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[13px]"
                >
                  {kind && (
                    <Pill tone="neutral" className="gap-1">
                      <TypeDot kind={typeDotKindForValueType("string")} />
                      {kind}
                    </Pill>
                  )}
                  <span className="flex-1 truncate">
                    {node._meta?.title ?? node.class_type}
                  </span>
                  <span className="font-mono text-[12.5px] text-muted-foreground">
                    #{nodeId}
                  </span>
                  {isPreview ? (
                    <span className="text-[12.5px] text-muted-foreground">
                      Preview node: it saves nothing, so it can't be an output.
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    className="ml-auto"
                    disabled={isPreview || used}
                    onClick={() => onPick(nodeId)}
                  >
                    Use
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
