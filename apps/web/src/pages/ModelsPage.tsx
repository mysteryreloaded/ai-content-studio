import {
  findOutsideServiceNotes,
  parseApiFormatWorkflow,
} from "@ai-content-studio/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Plus, Upload } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { AdminPageHeader } from "../components/admin/AdminPageHeader.js";
import { AdminTable, adminHeadCell } from "../components/admin/AdminTable.js";
import { EmptyState } from "../components/admin/EmptyState.js";
import { FormField } from "../components/admin/FormField.js";
import { LoadError } from "../components/admin/LoadError.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Pill } from "../components/ui/pill.js";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { ApiError, api, ok } from "../lib/api.js";
import {
  type ServerFieldError,
  mapApiError,
  zodResolver,
} from "../lib/form.js";

const MODELS_QUERY_KEY = ["admin", "models"];

const MAX_WORKFLOW_BYTES = 10 * 1024 * 1024;

export interface AdminModel {
  id: string;
  name: string;
  slug: string;
  state: "enabled" | "disabled";
  sortOrder: number;
  currentRevision: number;
  version: number;
  modeCount: number;
  backends: { usable: number; attached: number };
  modesWithoutBackend: string[];
  queued: number;
  running: number;
}

/** The subset of `AdminModel` the move endpoints hand back (issue #205): no #204 figures, carried forward from the cache instead. */
type AdminModelOrder = Pick<
  AdminModel,
  "id" | "name" | "slug" | "state" | "sortOrder" | "currentRevision" | "version"
>;

async function readFileAsJson(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}

type WorkflowFileResult = { error: string } | { workflow: unknown };

/**
 * The New Model dialog's browser-side refusals (issue #205's agreed UI):
 * a missing file, invalid JSON, an over-size file, a UI-format export, or
 * a Workflow still holding an outside-service key. Anything else is left
 * for the server to validate.
 */
async function checkWorkflowFile(
  file: File | null,
): Promise<WorkflowFileResult> {
  if (!file) return { error: "Choose a Workflow file" };
  if (file.size > MAX_WORKFLOW_BYTES) {
    return {
      error: "This file is over 10 MB. Export the Workflow with Export (API).",
    };
  }

  let parsed: unknown;
  try {
    parsed = await readFileAsJson(file);
  } catch {
    return { error: "That file isn't valid JSON." };
  }

  const result = parseApiFormatWorkflow(parsed);
  if (!result.ok) {
    if (result.error === "This is a UI save; export it with Export (API)") {
      return { error: result.error };
    }
    return { workflow: parsed };
  }

  for (const note of findOutsideServiceNotes(result.workflow)) {
    if (note.keySet) {
      const title =
        result.workflow[note.nodeId]?._meta?.title ?? note.classType;
      return {
        error: `${title} holds an API key; clear it in ComfyUI and export again`,
      };
    }
  }

  return { workflow: parsed };
}

function statePill(state: AdminModel["state"]) {
  return (
    <Pill tone={state === "enabled" ? "ok" : "neutral"}>
      {state === "enabled" ? "Enabled" : "Disabled"}
    </Pill>
  );
}

function modesText(model: AdminModel): string {
  return `${model.modeCount} ${model.modeCount === 1 ? "Mode" : "Modes"}`;
}

function BackendsCell({ model }: { model: AdminModel }) {
  const flagged = model.modesWithoutBackend.slice(0, 2);
  const extra = model.modesWithoutBackend.length - flagged.length;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="tabular-nums">
        {model.backends.usable} of {model.backends.attached}
      </span>
      {flagged.map((name) => (
        <p key={name} className="text-[12.5px] text-err">
          {name} has no usable Backend
        </p>
      ))}
      {extra > 0 && <p className="text-[12.5px] text-err">+{extra} more</p>}
    </div>
  );
}

function QueuedRunningCell({ model }: { model: AdminModel }) {
  if (model.queued === 0 && model.running === 0) {
    return <span className="text-muted-foreground">Idle</span>;
  }
  return (
    <span className="tabular-nums">
      <Link
        to={`/admin/generations?model=${model.id}&status=queued`}
        className="underline-offset-4 hover:underline"
      >
        {model.queued} queued
      </Link>
      {" · "}
      <Link
        to={`/admin/generations?model=${model.id}&status=running`}
        className="underline-offset-4 hover:underline"
      >
        {model.running} running
      </Link>
    </span>
  );
}

function OrderButtons({
  model,
  disabledUp,
  disabledDown,
  onMove,
}: {
  model: AdminModel;
  disabledUp: boolean;
  disabledDown: boolean;
  onMove: (direction: "up" | "down") => void;
}) {
  return (
    <div className="flex gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Move ${model.name} up`}
        disabled={disabledUp}
        onClick={() => onMove("up")}
      >
        <ChevronUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Move ${model.name} down`}
        disabled={disabledDown}
        onClick={() => onMove("down")}
      >
        <ChevronDown />
      </Button>
    </div>
  );
}

function ModelsTable({
  models,
  onMove,
}: {
  models: AdminModel[];
  onMove: (id: string, direction: "up" | "down") => void;
}) {
  return (
    <>
      <div data-testid="models-table-desktop" className="hidden sm:block">
        <AdminTable>
          <TableHeader>
            <TableRow>
              <TableHead className={`${adminHeadCell} w-[54px]`}>
                <span className="sr-only">Order</span>
              </TableHead>
              <TableHead className={adminHeadCell}>Name</TableHead>
              <TableHead className={adminHeadCell}>State</TableHead>
              <TableHead className={adminHeadCell}>Revision</TableHead>
              <TableHead className={adminHeadCell}>Modes</TableHead>
              <TableHead className={adminHeadCell}>Usable Backends</TableHead>
              <TableHead className={adminHeadCell}>Queued / running</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((model, index) => (
              <TableRow key={model.id}>
                <TableCell>
                  <OrderButtons
                    model={model}
                    disabledUp={index === 0}
                    disabledDown={index === models.length - 1}
                    onMove={(direction) => onMove(model.id, direction)}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <Link
                      to={`/admin/models/${model.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {model.name}
                    </Link>
                    <span className="font-mono text-[12.5px] text-muted-foreground">
                      {model.slug}
                    </span>
                  </div>
                </TableCell>
                <TableCell>{statePill(model.state)}</TableCell>
                <TableCell className="tabular-nums">
                  revision {model.currentRevision}
                </TableCell>
                <TableCell className="tabular-nums">
                  {modesText(model)}
                </TableCell>
                <TableCell>
                  <BackendsCell model={model} />
                </TableCell>
                <TableCell>
                  <QueuedRunningCell model={model} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </AdminTable>
      </div>

      <div
        data-testid="models-table-mobile"
        className="flex flex-col gap-2 sm:hidden"
      >
        {models.map((model, index) => (
          <div
            key={model.id}
            className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card p-3"
          >
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/admin/models/${model.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {model.name}
                </Link>
                {statePill(model.state)}
              </div>
              <p className="tabular-nums text-muted-foreground">
                revision {model.currentRevision} · {modesText(model)} ·{" "}
                {model.backends.usable} of {model.backends.attached} Backends
              </p>
              {model.modesWithoutBackend.slice(0, 2).map((name) => (
                <p key={name} className="text-[12.5px] text-err">
                  {name} has no usable Backend
                </p>
              ))}
              {model.modesWithoutBackend.length > 2 && (
                <p className="text-[12.5px] text-err">
                  +{model.modesWithoutBackend.length - 2} more
                </p>
              )}
              <QueuedRunningCell model={model} />
            </div>
            <OrderButtons
              model={model}
              disabledUp={index === 0}
              disabledDown={index === models.length - 1}
              onMove={(direction) => onMove(model.id, direction)}
            />
          </div>
        ))}
      </div>
    </>
  );
}

const createFormSchema = z.object({
  name: z
    .string()
    .min(1, "must be 1-80 characters")
    .max(80, "must be 1-80 characters"),
});

type CreateFormValues = z.infer<typeof createFormSchema>;

function NewModelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateFormValues>({
    resolver: zodResolver(createFormSchema),
    defaultValues: { name: "" },
  });

  const createMutation = useMutation({
    mutationFn: (vars: { name: string; workflow: unknown }) =>
      ok<{ model: { id: string } }>(api.api.admin.models.$post({ json: vars })),
    onSuccess: (body) => {
      reset();
      setFile(null);
      setFileError(null);
      onOpenChange(false);
      navigate(`/admin/models/${body.model.id}`);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const body = err.body as {
          error?: string;
          errors?: readonly ServerFieldError[];
        } | null;
        if (err.status === 409) {
          setError("name", { message: body?.error ?? "save failed" });
          return;
        }
        if (err.status === 400) {
          mapApiError(setError, err);
          // Only "name" has a registered form field; any other field
          // (e.g. "workflow", from a server-side Workflow rejection) is
          // shown under the Workflow file field instead.
          const otherError = body?.errors?.find((e) => e.field !== "name");
          if (otherError) setFileError(otherError.message);
          if (body?.error) setError("root", { message: body.error });
          return;
        }
      }
      setError("root", { message: "save failed" });
    },
  });

  async function onSubmit(values: CreateFormValues) {
    const result = await checkWorkflowFile(file);
    if ("error" in result) {
      setFileError(result.error);
      return;
    }
    setFileError(null);
    createMutation.mutate({ name: values.name, workflow: result.workflow });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          setFile(null);
          setFileError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New Model</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={handleSubmit(onSubmit)}
        >
          <FormField
            label="Name"
            htmlFor="model-name"
            error={errors.name?.message}
          >
            <Input
              id="model-name"
              maxLength={80}
              aria-invalid={errors.name ? true : undefined}
              {...register("name")}
            />
          </FormField>

          <FormField
            label="Workflow file"
            htmlFor="model-workflow-file"
            hint={
              fileError ? undefined : "Workflow → Export (API), up to 10 MB"
            }
            error={fileError ?? undefined}
          >
            <Input
              id="model-workflow-file"
              type="file"
              accept="application/json"
              aria-invalid={fileError ? true : undefined}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setFileError(null);
              }}
            />
          </FormField>

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
            <Button type="submit" disabled={isSubmitting}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportModelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: async (toImport: File) => {
      let parsed: unknown;
      try {
        parsed = await readFileAsJson(toImport);
      } catch {
        throw new Error("That file isn't valid JSON.");
      }
      // `/import` reads its body without a Hono validator (see the
      // `logs.$get` comment in BackendsPage for why this goes through a
      // variable).
      const args: { json: Record<string, unknown> } = {
        json: parsed as Record<string, unknown>,
      };
      return ok<{ model: { name: string } }>(
        api.api.admin.models.import.$post(args),
      );
    },
    onSuccess: (body) => {
      setFile(null);
      setError(null);
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
      toast.success(`Imported ${body.model.name} as a disabled Model.`);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const body = err.body as {
          error?: string;
          errors?: readonly ServerFieldError[];
        } | null;
        if (body?.errors?.length) {
          setError(body.errors.map((e) => e.message).join("; "));
          return;
        }
        setError(body?.error ?? "import failed");
        return;
      }
      setError(err instanceof Error ? err.message : "import failed");
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setError(null);
    importMutation.mutate(file);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setFile(null);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Import a Model</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
        >
          <FormField
            label="Exported Model file (JSON)"
            htmlFor="model-import-file"
            hint="A file from Export in the Model editor. It comes in as a new, disabled Model."
          >
            <Input
              id="model-import-file"
              type="file"
              accept="application/json"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setError(null);
              }}
            />
          </FormField>

          {error && (
            <p role="alert" className="text-err">
              {error}
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
            <Button type="submit" disabled={!file || importMutation.isPending}>
              Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The Models admin list: Admin order with up/down, per-row state/figures, and New Model/Import dialogs (issue #205). */
export function ModelsPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data, error, refetch } = useQuery({
    queryKey: MODELS_QUERY_KEY,
    queryFn: () => ok<{ models: AdminModel[] }>(api.api.admin.models.$get()),
  });

  const moveMutation = useMutation({
    mutationFn: ({
      id,
      direction,
    }: { id: string; direction: "up" | "down" }) => {
      const call =
        direction === "up"
          ? api.api.admin.models[":id"]["move-up"].$post({ param: { id } })
          : api.api.admin.models[":id"]["move-down"].$post({ param: { id } });
      return ok<{ models: AdminModelOrder[] }>(call);
    },
    onSuccess: (body) => {
      queryClient.setQueryData<{ models: AdminModel[] }>(
        MODELS_QUERY_KEY,
        (current) => ({
          models: body.models.map((model) => {
            const previous = current?.models.find((m) => m.id === model.id);
            return {
              ...model,
              modeCount: previous?.modeCount ?? 0,
              backends: previous?.backends ?? { usable: 0, attached: 0 },
              modesWithoutBackend: previous?.modesWithoutBackend ?? [],
              queued: previous?.queued ?? 0,
              running: previous?.running ?? 0,
            };
          }),
        }),
      );
      void queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
    },
  });

  const models = data?.models ?? null;

  return (
    <>
      <AdminPageHeader
        title="Models"
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload data-icon="inline-start" />
              Import
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus data-icon="inline-start" />
              New Model
            </Button>
          </>
        }
      />

      {error && (
        <LoadError
          message="could not load Models"
          onRetry={() => void refetch()}
        />
      )}

      {!models && !error && <p>Loading…</p>}

      {models &&
        (models.length === 0 ? (
          <EmptyState>
            No Models yet. Create one from a ComfyUI Workflow export.{" "}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              New Model
            </Button>
          </EmptyState>
        ) : (
          <ModelsTable
            models={models}
            onMove={(id, direction) => moveMutation.mutate({ id, direction })}
          />
        ))}

      <NewModelDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ImportModelDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}
