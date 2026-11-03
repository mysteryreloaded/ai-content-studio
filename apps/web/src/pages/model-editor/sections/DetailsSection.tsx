import { useState } from "react";
import { Button } from "../../../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
import type { ModelDetail } from "../types.js";
import { Section } from "../ui/Section.js";
import type { ModelEditor } from "../useModelEditor.js";

/** Details (issue #213): Name, URL slug, one-line description, max run time, History and Delete. */
export function DetailsSection({
  editor,
  detail,
}: {
  editor: ModelEditor;
  detail: ModelDetail;
}) {
  const { draft, handleDelete, deleteError } = editor;
  const {
    register,
    formState: { errors },
  } = draft.form;
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Section
      title="Details"
      sub="How the Model appears in the Model list and at its URL."
    >
      <form
        noValidate
        className="flex flex-col gap-fields"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-name">Name</Label>
            <Input
              id="model-name"
              maxLength={80}
              aria-invalid={errors.name ? true : undefined}
              {...register("name")}
            />
            {errors.name && (
              <p className="text-[12.5px] text-err">{errors.name.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-slug">URL slug</Label>
            <Input
              id="model-slug"
              maxLength={80}
              className="font-mono"
              aria-invalid={errors.slug ? true : undefined}
              {...register("slug")}
            />
            <p className="text-[12.5px] text-muted-foreground font-mono">
              /{detail.model.slug}
            </p>
            {errors.slug && (
              <p className="text-[12.5px] text-err">{errors.slug.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-description">One-line description</Label>
            <Input id="model-description" {...register("description")} />
            {errors.description && (
              <p className="text-[12.5px] text-err">
                {errors.description.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model-max-run-time">Max run time (minutes)</Label>
            <Input
              id="model-max-run-time"
              type="number"
              min={1}
              max={240}
              aria-invalid={errors.maxRunTimeMinutes ? true : undefined}
              {...register("maxRunTimeMinutes", { valueAsNumber: true })}
            />
            <p className="text-[12.5px] text-muted-foreground">
              A Generation running longer is cancelled and fails.
            </p>
            {errors.maxRunTimeMinutes && (
              <p className="text-[12.5px] text-err">
                {errors.maxRunTimeMinutes.message}
              </p>
            )}
          </div>
        </div>

        <a href={`/admin/audit?targetType=model&targetId=${detail.model.id}`}>
          History
        </a>
      </form>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Button
          type="button"
          variant="danger"
          onClick={() => setConfirmOpen(true)}
        >
          Delete Model
        </Button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this Model?</DialogTitle>
            <DialogDescription>This can't be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setConfirmOpen(false);
                void handleDelete();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {deleteError && (
        <p role="alert" className="text-err">
          {deleteError}
        </p>
      )}
    </Section>
  );
}
