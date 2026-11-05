import {
  BYTES_PER_MB,
  checkModel,
  computeModePath,
  findOutsideServiceNotes,
  hasBlockingErrors,
  isValidModelLicenseUrl,
  modeInputSetting,
  parseApiFormatWorkflow,
  renderMarkdown,
} from "@ai-content-studio/shared";
import type {
  InputDefinition,
  ModeInputSetting,
  ModelIssue,
  Workflow,
} from "@ai-content-studio/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router-dom";
import { ApiError, api, ok } from "../../lib/api.js";
import { useSession } from "../../useSession.js";
import {
  draftsFrom,
  messageFrom,
  readFileAsJson,
  sameInputs,
  sameModes,
  sameTerms,
  sameTermsText,
  termsFrom,
} from "./helpers/drafts.js";
import { newInputOfKind } from "./helpers/newInputs.js";
import {
  boundNodeIds,
  checkModelModesFrom,
  findBrokenNodeRefs,
  nodesFromWorkflow,
  reboundInputsFrom,
  toCheckModelBackends,
  visibleBoundFieldsFor,
  workflowForMode,
} from "./helpers/workflow.js";
import { useBackendsSection } from "./hooks/useBackendsSection.js";
import { useModelChecks } from "./hooks/useModelChecks.js";
import { useModelDetail } from "./hooks/useModelDetail.js";
import { useModelDraft } from "./hooks/useModelDraft.js";
import { useRevisionsSection } from "./hooks/useRevisionsSection.js";
import type {
  BrokenNodeRef,
  DraftMode,
  ModelDetail,
  ModelNode,
  TermsForm,
} from "./types.js";

/** The Model editor: Details, and the Workflow's nodes with a filter (issue #40). */
export function useModelEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useSession();
  const maxUploadMb =
    session.status === "signed-in" ? session.user.maxUploadMb : undefined;

  // Issue #213: the Model's own load is a `useQuery` through the typed
  // `api` client now, not a bare `fetch` kept in local state.
  const detailQuery = useModelDetail(id);
  const detail = detailQuery.data ?? null;
  const loadError = detailQuery.isError ? "could not load this Model" : null;
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [nodeFilter, setNodeFilter] = useState("");
  // Issue #217: the Backends section's three loads plus attach/detach,
  // as `useQuery`/`useMutation` via the typed `api` client.
  const backends = useBackendsSection(id);
  const [modesDraft, setModesDraft] = useState<DraftMode[] | null>(null);
  const [editingModeIndex, setEditingModeIndex] = useState<number | null>(null);
  const [inputsDraft, setInputsDraft] = useState<InputDefinition[] | null>(
    null,
  );
  const [stateError, setStateError] = useState<string[] | null>(null);
  const [togglingState, setTogglingState] = useState(false);
  const [termsForm, setTermsForm] = useState<TermsForm | null>(null);
  const [askAgain, setAskAgain] = useState(false);
  // Issue #71: a re-uploaded Workflow file lives only in the editor
  // (parsed client-side) until the header's one Save sends it (issue #218) —
  // there's no separate server-side draft.
  const [pendingWorkflow, setPendingWorkflow] = useState<unknown | null>(null);
  const [pendingWorkflowFileName, setPendingWorkflowFileName] = useState<
    string | null
  >(null);
  const [workflowUploadError, setWorkflowUploadError] = useState<string | null>(
    null,
  );
  // Issue #71's rebind picker (CEO review): old node id -> the picked
  // Workflow's node id it's repointed onto, for the Mode outputs/Input
  // bindings `findBrokenNodeRefs` flags. Reset whenever a different file
  // is picked, since the broken node ids it answers for change too.
  const [rebindMap, setRebindMap] = useState<Record<string, string>>({});
  // Issue #259: the revisions list itself is a `useQuery` now (replacing
  // the old `fetch`+local-state pair); Restore stays here since it needs
  // `useModelDraft`'s own `reload()` to reseed the Inputs/Modes/Terms
  // drafts on success.
  const revisionsSection = useRevisionsSection(id);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(
    null,
  );
  const [restoreErrors, setRestoreErrors] = useState<
    Record<number, { message: string; reasons: string[] }>
  >({});
  // Set right before navigating away after a successful delete: `dirty`
  // is still computed from this render's (pre-setForm(null)) state when
  // the blocker runs, since state updates haven't flushed yet, so without
  // this it would ask "Discard unsaved changes?" a second time right
  // after the Admin already confirmed the delete itself.
  const bypassBlockerRef = useRef(false);
  // issue #48 AC3: a new Model (no Inputs yet) opens on the Inputs
  // section; one that already has Inputs opens on Modes instead, with
  // its first Mode's sheet expanded. Only the first load of a given
  // Model decides this — a reload after Save shouldn't yank the page
  // back or collapse what the Admin has open.
  const inputsHeadingRef = useRef<HTMLHeadingElement>(null);
  const modesHeadingRef = useRef<HTMLHeadingElement>(null);

  // Issue #241 CEO review: this used to re-derive the Modes/Inputs/Terms
  // drafts from every `detail` change, including a refetch after one
  // save step (or after enable/disable, Replace Workflow, ...) — so if
  // Details saved and Modes was then refused, the still-dirty Modes
  // edits got silently wiped by this effect, not by anything that
  // actually saved them. It now only seeds the drafts once per Model
  // (the first time `detail` loads for a given id); `useModelDraft`'s
  // own `discard()`/`discardFor()` reset all four explicitly on
  // Discard, Reload and an id change.
  const draftsInitializedForRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!detail) return;
    if (draftsInitializedForRef.current === detail.model.id) return;
    draftsInitializedForRef.current = detail.model.id;
    setModesDraft(draftsFrom(detail));
    setEditingModeIndex(null);
    setInputsDraft(detail.inputs);
    setStateError(null);
    setTermsForm(termsFrom(detail));
    setAskAgain(false);
  }, [detail]);

  function load() {
    void detailQuery.refetch();
  }

  /** The agreed browser-side refusals (issue #214), run before a picked file ever becomes `pendingWorkflow`. */
  function refuseWorkflowFile(file: File, parsed: unknown): string | null {
    if (file.size > 10 * BYTES_PER_MB) {
      return "This file is over 10 MB. Export the Workflow with Export (API).";
    }
    const result = parseApiFormatWorkflow(parsed);
    if (!result.ok) return result.error;
    for (const note of findOutsideServiceNotes(result.workflow)) {
      if (!note.keySet) continue;
      const node = result.workflow[note.nodeId];
      const name = node?._meta?.title ?? note.classType;
      return `${name} holds an API key; clear it in ComfyUI and export again`;
    }
    return null;
  }

  async function handlePickWorkflowFile(file: File | null) {
    setWorkflowUploadError(null);
    setRebindMap({});
    if (!file) {
      setPendingWorkflow(null);
      setPendingWorkflowFileName(null);
      return;
    }
    let parsed: unknown;
    try {
      parsed = await readFileAsJson(file);
    } catch {
      setPendingWorkflow(null);
      setPendingWorkflowFileName(null);
      setWorkflowUploadError("That file isn't valid JSON.");
      return;
    }
    const refusal = refuseWorkflowFile(file, parsed);
    if (refusal) {
      setPendingWorkflow(null);
      setPendingWorkflowFileName(null);
      setWorkflowUploadError(refusal);
      return;
    }
    setPendingWorkflow(parsed);
    setPendingWorkflowFileName(file.name);
  }

  /** Issue #241 CEO review: Discard and Reload must drop a picked-but-unsaved Workflow file, its name and the rebind picker too, not just the four section drafts. */
  function resetWorkflowPicker() {
    setPendingWorkflow(null);
    setPendingWorkflowFileName(null);
    setRebindMap({});
    setWorkflowUploadError(null);
  }

  function setRebind(nodeId: string, newNodeId: string) {
    setRebindMap((prev) => {
      if (newNodeId === "") {
        const { [nodeId]: _removed, ...rest } = prev;
        void _removed;
        return rest;
      }
      return { ...prev, [nodeId]: newNodeId };
    });
  }

  async function handleRestoreRevision(
    revisionNumber: number,
    disable: boolean,
  ) {
    if (!detail) return;
    setRestoringRevision(revisionNumber);
    setRestoreErrors((prev) => {
      const next = { ...prev };
      delete next[revisionNumber];
      return next;
    });

    try {
      await ok(
        api.api.admin.models[":id"].revisions[":number"].restore.$post({
          param: {
            id: detail.model.id,
            number: String(revisionNumber),
          },
          json: {
            version: detail.model.version,
            ...(disable ? { disable: true } : {}),
          },
        }),
      );
    } catch (err) {
      const body =
        err instanceof ApiError
          ? (err.body as { error?: string; reasons?: string[] } | null)
          : null;
      setRestoreErrors((prev) => ({
        ...prev,
        [revisionNumber]: {
          message: body?.error ?? "restore failed",
          reasons: body?.reasons ?? [],
        },
      }));
      setRestoringRevision(null);
      return;
    }

    // Issue #241 CEO review: restoring a revision replaces the saved
    // Modes/Inputs/Terms, so they need a full reseed, not just a
    // refetch under the once-per-id seeding effect. Reset
    // `restoringRevision` in a `finally` so a failed `draft.reload()`
    // can't leave Restore disabled forever.
    try {
      await draft.reload();
      revisionsSection.invalidate();
    } finally {
      setRestoringRevision(null);
    }
  }

  /** "+ Mode" (issue #216): adds "Mode N" (N = count + 1) with no outputs, returning its key so the caller opens its sheet right away. */
  function addMode(): string | null {
    if (!modesDraft) return null;
    const key = crypto.randomUUID();
    setModesDraft([
      ...modesDraft,
      {
        key,
        name: `Mode ${modesDraft.length + 1}`,
        description: "",
        outputNodeIds: [],
        inputSettings: [],
      },
    ]);
    return key;
  }

  function removeMode(index: number) {
    if (!modesDraft) return;
    setModesDraft(modesDraft.filter((_, i) => i !== index));
    if (editingModeIndex === index) setEditingModeIndex(null);
  }

  function updateMode(index: number, patch: Partial<DraftMode>) {
    if (!modesDraft) return;
    setModesDraft(
      modesDraft.map((mode, i) => (i === index ? { ...mode, ...patch } : mode)),
    );
  }

  /** Duplicates Mode `index` right after it, as a fresh (unsaved) Mode (issue #48), returning the copy's key so the caller opens its sheet right away (issue #216). */
  function duplicateMode(index: number): string | null {
    if (!modesDraft) return null;
    const mode = modesDraft[index];
    if (!mode) return null;
    const copy: DraftMode = {
      ...mode,
      key: crypto.randomUUID(),
      name: `${mode.name} copy`.slice(0, 60),
    };
    setModesDraft([
      ...modesDraft.slice(0, index + 1),
      copy,
      ...modesDraft.slice(index + 1),
    ]);
    return copy.key;
  }

  /** Sets Mode `modeIndex`'s setting for `inputId` (issue #48's grid cell). */
  function setModeInputSetting(
    modeIndex: number,
    inputId: string,
    patch: Partial<ModeInputSetting>,
  ) {
    if (!modesDraft) return;
    const mode = modesDraft[modeIndex];
    if (!mode) return;
    const current = modeInputSetting(mode.inputSettings, inputId);
    const next: ModeInputSetting = { ...current, ...patch };
    const withoutThisInput = mode.inputSettings.filter(
      (s) => s.inputId !== inputId,
    );
    updateMode(modeIndex, {
      inputSettings: [...withoutThisInput, next],
    });
  }

  /** "Apply to every Mode whose Path holds this Input" (issue #48): copies `inputId`'s setting onto every other Mode whose output nodes depend on one of its bound fields. */
  function applySettingToEveryEligibleMode(
    sourceIndex: number,
    input: InputDefinition,
  ) {
    if (!detail || !modesDraft) return;
    const setting = modeInputSetting(
      (modesDraft[sourceIndex] as DraftMode).inputSettings,
      input.id,
    );
    const nodeIds = boundNodeIds(input);
    setModesDraft(
      modesDraft.map((mode, i) => {
        if (i === sourceIndex) return mode;
        if (mode.outputNodeIds.length === 0) return mode;
        const path = computeModePath(
          workflowForMode(mode, detail.inputs ?? [], detail.workflow),
          mode.outputNodeIds,
          visibleBoundFieldsFor(mode, detail.inputs ?? []),
        );
        const onPath = [...nodeIds].some((id) => path.nodeIds.has(id));
        if (!onPath) return mode;
        return {
          ...mode,
          inputSettings: [
            ...mode.inputSettings.filter((s) => s.inputId !== input.id),
            { ...setting },
          ],
        };
      }),
    );
  }

  /** Toggles `nodeId` in and out of the currently *picking* Mode's output nodes (the Workflow table's Add/Remove button). */
  function toggleOutputNodeInEditingMode(nodeId: string) {
    if (editingModeIndex === null || !modesDraft) return;
    const mode = modesDraft[editingModeIndex];
    if (!mode) return;
    const outputNodeIds = mode.outputNodeIds.includes(nodeId)
      ? mode.outputNodeIds.filter((id) => id !== nodeId)
      : [...mode.outputNodeIds, nodeId];
    updateMode(editingModeIndex, { outputNodeIds });
  }

  /** Removes `nodeId` from Mode `index`'s own output-node list, regardless of which Mode is currently being picked. */
  function removeOutputNode(index: number, nodeId: string) {
    if (!modesDraft) return;
    const mode = modesDraft[index];
    if (!mode) return;
    updateMode(index, {
      outputNodeIds: mode.outputNodeIds.filter((id) => id !== nodeId),
    });
  }

  /** Reorders `nodeId` within Mode `index`'s own output-node list, regardless of which Mode is currently being picked. */
  function moveOutputNode(
    index: number,
    nodeId: string,
    direction: "up" | "down",
  ) {
    if (!modesDraft) return;
    const mode = modesDraft[index];
    if (!mode) return;
    const position = mode.outputNodeIds.indexOf(nodeId);
    const swapWith = direction === "up" ? position - 1 : position + 1;
    if (
      position === -1 ||
      swapWith < 0 ||
      swapWith >= mode.outputNodeIds.length
    ) {
      return;
    }
    const outputNodeIds = [...mode.outputNodeIds];
    const a = outputNodeIds[position] as string;
    const b = outputNodeIds[swapWith] as string;
    outputNodeIds[position] = b;
    outputNodeIds[swapWith] = a;
    updateMode(index, { outputNodeIds });
  }

  // issue #213: the per-section "Save Modes" is gone — Modes now save
  // through the header's one Save, via `useModelDraft`.

  /** Issue #215's New Input menu: creates a fresh Input of `kind` (refused for a second Seed) and returns its id, so the caller can open its sheet. */
  function createInput(kind: InputDefinition["kind"]): string | null {
    if (!inputsDraft) return null;
    if (kind === "seed" && inputsDraft.some((i) => i.kind === "seed")) {
      return null;
    }
    const created = newInputOfKind(kind);
    setInputsDraft([...inputsDraft, created]);
    return created.id;
  }

  /** Issue #215: "Delete Input" removes it from the draft and its settings from every Mode draft, rather than leaving that to the server's own save-time filter. */
  function removeInput(index: number) {
    if (!inputsDraft) return;
    const removed = inputsDraft[index];
    setInputsDraft(inputsDraft.filter((_, i) => i !== index));
    if (removed && modesDraft) {
      setModesDraft(
        modesDraft.map((mode) => ({
          ...mode,
          inputSettings: mode.inputSettings.filter(
            (s) => s.inputId !== removed.id,
          ),
        })),
      );
    }
  }

  function updateInput(index: number, next: InputDefinition) {
    if (!inputsDraft) return;
    setInputsDraft(inputsDraft.map((input, i) => (i === index ? next : input)));
  }

  /** Issue #215's Move up/Move down: reorders `inputsDraft`, which is also the Workbench's own Input order within each group. */
  function moveInput(index: number, direction: "up" | "down") {
    if (!inputsDraft) return;
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= inputsDraft.length) return;
    const next = [...inputsDraft];
    const a = next[index] as InputDefinition;
    const b = next[swapWith] as InputDefinition;
    next[index] = b;
    next[swapWith] = a;
    setInputsDraft(next);
  }

  // issue #213: ditto for "Save Inputs".

  async function handleToggleState() {
    if (!detail) return;
    setTogglingState(true);
    setStateError(null);
    const endpoint = detail.model.state === "enabled" ? "disable" : "enable";

    try {
      const res = await fetch(
        `/api/admin/models/${detail.model.id}/${endpoint}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: detail.model.version }),
        },
      );

      if (!res.ok) {
        const payload: { error?: string; reasons?: string[] } = await res
          .json()
          .catch(() => ({}));
        setStateError(
          payload.reasons ?? [payload.error ?? "could not change state"],
        );
        return;
      }

      load();
    } finally {
      setTogglingState(false);
    }
  }

  const modesDirty = Boolean(
    detail && modesDraft && !sameModes(draftsFrom(detail), modesDraft),
  );

  const inputsDirty = Boolean(
    detail && inputsDraft && !sameInputs(detail.inputs, inputsDraft),
  );

  // Issue #264: the "ask everyone to accept again" tick only counts
  // (dirty, and what Save sends) while the terms text still differs
  // from the saved text — the same trim the server applies before it
  // decides, so ticking it and then reverting the text to what was
  // saved can't make `termsVersion` bump (the Site terms form's
  // `isChanged` gate sends `askAgain: false` the same way).
  const askAgainCounts =
    askAgain &&
    detail !== null &&
    termsForm !== null &&
    !sameTermsText(termsForm.termsBody, detail.model.termsBody);

  const termsDirty = Boolean(
    detail &&
      termsForm &&
      (!sameTerms(termsFrom(detail), termsForm) || askAgainCounts),
  );

  const termsPreviewHtml = termsForm ? renderMarkdown(termsForm.termsBody) : "";

  // issue #213's hook layout: the Details draft (react-hook-form +
  // zod) and the one Save sequence, chaining `version` across Details
  // -> Inputs -> Modes -> Terms. The other three drafts still live
  // here (their own sections' tickets own that markup); this hook
  // just takes them, and how to reset them, as arguments.
  const draft = useModelDraft({
    id,
    detail: detail ?? undefined,
    inputsDraft,
    inputsDirty,
    modesDraft,
    modesDirty,
    termsForm,
    termsDirty,
    // Issue #264: what the draft PUT actually sends for `askAgain` —
    // the tick, but only while the text has really changed.
    askAgain: askAgainCounts,
    pendingWorkflow,
    rebindMap,
    resetInputsDraft: setInputsDraft,
    resetModesDraft: (fresh) => setModesDraft(draftsFrom(fresh)),
    resetTermsForm: (fresh) => {
      setTermsForm(termsFrom(fresh));
      setAskAgain(false);
    },
    resetWorkflowPicker,
  });

  // issue #213: ditto for "Save Terms" — Terms now saves through the
  // header's one Save too (`useModelDraft`'s `save`, below).

  // issue #49: checkModel runs live, client-side, against whatever's in
  // the drafts right now — the rail updates on every edit, before Save.
  const checkModelBackends = useMemo(
    () =>
      backends.objectInfo === null
        ? null
        : toCheckModelBackends(backends.objectInfo),
    [backends.objectInfo],
  );
  const modelIssues: ModelIssue[] = useMemo(() => {
    if (!detail || !modesDraft || !inputsDraft || !checkModelBackends)
      return [];
    return checkModel(
      {
        workflow: detail.workflow,
        inputs: inputsDraft,
        modes: modesDraft.map((mode) => ({
          id: mode.key,
          name: mode.name,
          outputNodeIds: mode.outputNodeIds,
          inputSettings: mode.inputSettings,
        })),
      },
      checkModelBackends,
    );
  }, [detail, modesDraft, inputsDraft, checkModelBackends]);

  // Issue #71: the same rail, run against the picked-but-not-yet-saved
  // Workflow file plus the Model's currently *saved* Modes/Inputs (what
  // "Replace Workflow" actually carries forward, by node id) — not the
  // Modes/Inputs drafts, which are saved separately.
  const pendingWorkflowIssues: ModelIssue[] = useMemo(() => {
    if (!detail || pendingWorkflow === null || !checkModelBackends) return [];
    try {
      const workflow = pendingWorkflow as Workflow;
      return checkModel(
        {
          workflow,
          inputs: reboundInputsFrom(detail.inputs, workflow, rebindMap),
          modes: checkModelModesFrom(detail.modes, rebindMap),
        },
        checkModelBackends,
      );
    } catch {
      // Not a Workflow-shaped object; the server's own parse will refuse
      // it with a clear message once Save is pressed.
      return [];
    }
  }, [detail, pendingWorkflow, checkModelBackends, rebindMap]);
  const mustDisableToSaveWorkflow =
    detail?.model.state === "enabled" &&
    hasBlockingErrors(pendingWorkflowIssues);

  const termsErrorCount =
    termsForm && !isValidModelLicenseUrl(termsForm.licenseUrl) ? 1 : 0;

  const {
    issuesBySection,
    modelHasErrors,
    mustDisableToSave: mustDisableToSaveModel,
  } = useModelChecks({
    modelIssues,
    pendingWorkflowIssues,
    detailsErrorCount: Object.keys(draft.form.formState.errors).length,
    termsErrorCount,
    enabled: detail?.model.state === "enabled",
  });
  // Issue #218: the header Save now carries a re-uploaded Workflow too,
  // so its "Save and disable" label must also account for errors the
  // picked-but-not-yet-saved file would bring, not just the already
  // saved Workflow's own `modelIssues`.
  const mustDisableToSave = mustDisableToSaveModel || mustDisableToSaveWorkflow;

  /** Issue #71's rebind picker: every broken Mode output/Input binding, each repointable to a node of the picked file. */
  const brokenNodeRefs: BrokenNodeRef[] = useMemo(() => {
    if (!detail || pendingWorkflow === null) return [];
    try {
      return findBrokenNodeRefs(detail, pendingWorkflow as Workflow);
    } catch {
      return [];
    }
  }, [detail, pendingWorkflow]);
  const pendingWorkflowNodes: ModelNode[] = useMemo(() => {
    if (pendingWorkflow === null) return [];
    try {
      return nodesFromWorkflow(pendingWorkflow as Workflow);
    } catch {
      return [];
    }
  }, [pendingWorkflow]);

  const editingMode =
    editingModeIndex !== null ? (modesDraft?.[editingModeIndex] ?? null) : null;
  const editingPath =
    detail && editingMode && editingMode.outputNodeIds.length > 0
      ? computeModePath(
          workflowForMode(editingMode, detail.inputs ?? [], detail.workflow),
          editingMode.outputNodeIds,
          visibleBoundFieldsFor(editingMode, detail.inputs ?? []),
        )
      : null;

  useEffect(() => {
    if (!draft.anyDraftDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [draft.anyDraftDirty]);

  // Catches every in-app navigation away from the editor while dirty:
  // the "Admin / Models" link, AdminShell's nav links, and the
  // browser's own Back/Forward (issue #40 follow-up: beforeunload
  // alone misses all three since they never unload the page). Issue
  // #213: a `Dialog` ("Discard unsaved changes?", Stay/Discard) now
  // drives `blocker.reset()`/`blocker.proceed()` instead of
  // `window.confirm` — rendered by `ModelEditorPage` from this
  // `blocker`.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (
      bypassBlockerRef.current ||
      !draft.anyDraftDirty ||
      currentLocation.pathname === nextLocation.pathname
    ) {
      return false;
    }
    return true;
  });

  function goBack() {
    navigate("/admin/models");
  }

  async function handleDelete() {
    if (!detail) return;
    setDeleteError(null);

    const res = await fetch(
      `/api/admin/models/${detail.model.id}?version=${detail.model.version}`,
      { method: "DELETE" },
    );

    if (!res.ok) {
      const payload: { error?: string } = await res.json().catch(() => ({}));
      setDeleteError(
        payload.error === "has unfinished Generations"
          ? "This Model has unfinished Generations. Cancel or let them finish, then delete it."
          : (payload.error ?? "delete failed"),
      );
      return;
    }

    // The Model is gone; there's nothing left to discard a confirm over.
    bypassBlockerRef.current = true;
    navigate("/admin/models");
  }

  return {
    id,
    navigate,
    session,
    maxUploadMb,
    detail,
    loadError,
    draft,
    blocker,
    issuesBySection,
    deleteError,
    setDeleteError,
    nodeFilter,
    setNodeFilter,
    backends,
    modesDraft,
    setModesDraft,
    editingModeIndex,
    setEditingModeIndex,
    inputsDraft,
    setInputsDraft,
    stateError,
    setStateError,
    togglingState,
    setTogglingState,
    termsForm,
    setTermsForm,
    askAgain,
    setAskAgain,
    pendingWorkflow,
    setPendingWorkflow,
    pendingWorkflowFileName,
    setPendingWorkflowFileName,
    workflowUploadError,
    setWorkflowUploadError,
    rebindMap,
    setRebindMap,
    revisions: revisionsSection.revisions,
    revisionsLoadError: revisionsSection.revisionsLoadError,
    restoringRevision,
    setRestoringRevision,
    restoreErrors,
    setRestoreErrors,
    bypassBlockerRef,
    inputsHeadingRef,
    modesHeadingRef,
    load,
    loadRevisions: revisionsSection.invalidate,
    handlePickWorkflowFile,
    setRebind,
    handleRestoreRevision,
    addMode,
    removeMode,
    updateMode,
    duplicateMode,
    setModeInputSetting,
    applySettingToEveryEligibleMode,
    toggleOutputNodeInEditingMode,
    removeOutputNode,
    moveOutputNode,
    createInput,
    removeInput,
    updateInput,
    moveInput,
    handleToggleState,
    modesDirty,
    inputsDirty,
    termsDirty,
    anyDraftDirty: draft.anyDraftDirty,
    termsPreviewHtml,
    checkModelBackends,
    modelHasErrors,
    mustDisableToSave,
    mustDisableToSaveWorkflow,
    editingMode,
    editingPath,
    goBack,
    handleDelete,
    modelIssues,
    pendingWorkflowIssues,
    brokenNodeRefs,
    pendingWorkflowNodes,
  };
}

export type ModelEditor = ReturnType<typeof useModelEditor>;
