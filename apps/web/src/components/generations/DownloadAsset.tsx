import { Download } from "lucide-react";
import { Button } from "../ui/button.js";
import type { AssetSummary } from "./types.js";

/** The foot's Download control (issue #45/#195's AC): named by the server, downloaded rather than opened. */
export function DownloadAsset({ asset }: { asset: AssetSummary }) {
  return (
    <Button
      asChild
      variant="ghost"
      size="icon-sm"
      aria-label="Download"
      title="Download"
    >
      <a href={`/api/assets/${asset.id}?download=1`} download>
        <Download />
      </a>
    </Button>
  );
}

/** Sits beside every Download, on its own line under a card's foot (issue #195's AC). */
export function AiNote() {
  return (
    <p className="px-2 pb-1.5 text-[12.5px] text-muted-foreground">
      AI-generated: say so when you share it.
    </p>
  );
}
