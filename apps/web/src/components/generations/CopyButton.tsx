import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button.js";

/** Copies `text` through the clipboard, showing a checkmark for 1.4s (issue #195's AC, e.g. a failed card's full Generation id). */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}
