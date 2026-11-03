import { InfoIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";

/**
 * The Workbench's dismissable info banner (prototype `Banner`, issue
 * #194 step 4): shown right under the Mode menu, e.g. for the reuse
 * notice (issue #57).
 */
export function WorkbenchBanner({
  banner,
  onDismiss,
}: {
  banner: string | null;
  onDismiss: () => void;
}) {
  if (!banner) return null;
  return (
    <Alert className="flex items-start gap-2 rounded-xl border-[color-mix(in_srgb,var(--info)_35%,var(--line))] bg-[color-mix(in_srgb,var(--info)_12%,var(--panel))] px-2.5 py-2">
      <InfoIcon className="size-3.5 text-info" />
      <AlertDescription className="flex-1 text-foreground">
        {banner}
      </AlertDescription>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <XIcon />
      </Button>
    </Alert>
  );
}
