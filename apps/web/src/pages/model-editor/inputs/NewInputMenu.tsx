import type { InputDefinition } from "@ai-content-studio/shared";
import { Plus } from "lucide-react";
import { Button } from "../../../components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu.js";
import { TypeDot, typeDotKindFor } from "../ui/TypeDot.js";
import { INPUT_TYPE_OPTIONS } from "./inputTypeOptions.js";

/** The prototype's "New Input" menu (issue #215): a type dot and name per kind; Seed is disabled when the Model already has one. */
export function NewInputMenu({
  hasSeed,
  onPick,
}: {
  hasSeed: boolean;
  onPick: (kind: InputDefinition["kind"]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm">
          <Plus data-icon="inline-start" /> New Input
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Type</DropdownMenuLabel>
        {INPUT_TYPE_OPTIONS.map((type) => (
          <DropdownMenuItem
            key={type.kind}
            disabled={type.kind === "seed" && hasSeed}
            onSelect={() => onPick(type.kind)}
          >
            <TypeDot kind={typeDotKindFor(type.kind)} />
            {type.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
