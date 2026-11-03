import {
  PREVIEW_NODE_CLASSES,
  inferOutputNodeKind,
} from "@ai-content-studio/shared";
import { useState } from "react";
import { Button } from "../../../components/ui/button.js";
import { Checkbox } from "../../../components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
import { Label } from "../../../components/ui/label.js";
import { Pill } from "../../../components/ui/pill.js";
import type { ModelNode } from "../types.js";
import { TypeDot, type TypeDotKind } from "../ui/TypeDot.js";

/** The kind pill's label (issue #216): the asset kind, or "unknown kind" when `inferOutputNodeKind` can't tell. */
function kindLabel(classType: string): string {
  const kind = inferOutputNodeKind(classType);
  return kind ?? "unknown kind";
}

function kindDotKind(classType: string): TypeDotKind | null {
  const kind = inferOutputNodeKind(classType);
  if (kind === "video" || kind === "image" || kind === "audio") return kind;
  return null;
}

/** The "Pick an output node" dialog (issue #216): a save-node class or a preview node by default, every node with "Show every node". Preview rows and ones already used refuse `onPick`. */
export function OutputPicker({
  open,
  onOpenChange,
  nodes,
  existingOutputNodeIds,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: ModelNode[];
  existingOutputNodeIds: string[];
  onPick: (nodeId: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const candidates = nodes.filter(
    (node) =>
      showAll ||
      inferOutputNodeKind(node.classType) !== null ||
      PREVIEW_NODE_CLASSES.has(node.classType),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setShowAll(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Pick an output node</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground">
          An output node saves a file. Preview nodes don't, so they can't be
          outputs.
        </p>
        <Label className="flex items-center gap-2 text-[13px] font-normal">
          <Checkbox
            checked={showAll}
            onCheckedChange={(checked) => setShowAll(checked === true)}
          />
          Show every node (for custom save nodes)
        </Label>
        <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {candidates.map((node) => {
            const isPreview = PREVIEW_NODE_CLASSES.has(node.classType);
            const alreadyUsed = existingOutputNodeIds.includes(node.id);
            const dotKind = kindDotKind(node.classType);
            return (
              <li
                key={node.id}
                className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-medium">
                    {node.title ?? node.classType}
                    <Pill>
                      {dotKind && <TypeDot kind={dotKind} />}
                      {kindLabel(node.classType)}
                    </Pill>
                  </span>
                  <span className="font-mono text-[12.5px] text-muted-foreground">
                    {node.classType} · #{node.id}
                  </span>
                  {isPreview && (
                    <span className="text-[12.5px] text-err">
                      Preview node: it saves nothing, so it can't be an output.
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPreview || alreadyUsed}
                  onClick={() => onPick(node.id)}
                >
                  Use
                </Button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
