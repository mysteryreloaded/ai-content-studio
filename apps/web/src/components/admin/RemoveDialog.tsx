// The one Remove dialog shared by the admin Generations and Uploads
// pages (issue #209): a required reason (≤ 500 characters, the server's
// own rule), a consequence `.note` specific to what's being removed, and
// a 409 (already gone) shown inline rather than as a generic error.

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError } from "../../lib/api.js";
import { mapApiError } from "../../lib/form.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Label } from "../ui/label.js";
import { Textarea } from "../ui/textarea.js";

const removeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

type RemoveFormValues = z.infer<typeof removeSchema>;

const CONSEQUENCE: Record<"Generation" | "Upload", string> = {
  Generation:
    'Its files are deleted and a run in progress is cancelled. The owner sees "Removed by an administrator", without your reason. This can\'t be undone.',
  Upload:
    "Its file is deleted. Generations using it that are still running are cancelled; ended ones keep their Assets. This can't be undone.",
};

export function RemoveDialog({
  kind,
  open,
  onOpenChange,
  onRemove,
}: {
  kind: "Generation" | "Upload";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: (reason: string) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RemoveFormValues>({
    resolver: zodResolver(removeSchema),
    defaultValues: { reason: "" },
  });

  const reason = watch("reason");

  async function onSubmit(values: RemoveFormValues) {
    try {
      await onRemove(values.reason);
      reset();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError("root", { message: "Already removed or deleted." });
          return;
        }
        if (err.status === 400) {
          mapApiError(setError, err);
          return;
        }
      }
      setError("root", { message: `could not remove this ${kind}` });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Remove this {kind}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={handleSubmit(onSubmit)}
        >
          <p className="rounded-md bg-muted px-[11px] py-[9px] text-muted-foreground">
            {CONSEQUENCE[kind]}
          </p>

          <div className="flex flex-col gap-1">
            <Label htmlFor="remove-reason">
              Reason (required, up to 500 characters)
            </Label>
            <Textarea
              id="remove-reason"
              maxLength={500}
              aria-invalid={errors.reason ? true : undefined}
              {...register("reason")}
            />
            <div className="flex items-center justify-between">
              {errors.reason?.message ? (
                <p className="text-err">{errors.reason.message}</p>
              ) : (
                <span />
              )}
              <span className="tabular-nums text-muted-foreground">
                {reason.length} / 500
              </span>
            </div>
          </div>

          {errors.root?.message && (
            <p role="alert" className="text-err">
              {errors.root.message}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={
                reason.trim().length === 0 ||
                reason.trim().length > 500 ||
                isSubmitting
              }
            >
              Remove
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
