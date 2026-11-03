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
  AudioUploadInputDefinition,
  InputDefinition,
  ModeInputSetting,
  ModelIssue,
  VideoUploadInputDefinition,
  Workflow,
} from "@ai-content-studio/shared";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate, useParams } from "react-router-dom";
import { issueFor } from "../../components/inputs/issueFor.js";
import type {
  UploadState,
  ImageUploadInput as WorkbenchImageUploadInput,
  MediaUploadInput as WorkbenchMediaUploadInput,
} from "../../components/inputs/types.js";
import {
  httpUploadApi,
  trimUpload,
  uploadResumable,
} from "../../lib/chunkedUpload.js";
import { useSession } from "../../useSession.js";
import {
  draftsFrom,
  messageFrom,
  readFileAsJson,
  sameInputs,
  sameModes,
  sameTerms,
  termsFrom,
} from "./helpers/drafts.js";
import {
  newAudioUploadInput,
  newImageUploadInput,
  newNumberInput,
  newPointsInput,
  newSeedInput,
  newSelectInput,
  newTextInput,
  newVideoUploadInput,
} from "./helpers/newInputs.js";
import { sortedTestRuns } from "./helpers/testRuns.js";
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
import { useModelChecks } from "./hooks/useModelChecks.js";
import { useModelDetail } from "./hooks/useModelDetail.js";
import { useModelDraft } from "./hooks/useModelDraft.js";
import type {
  AdminBackendSummary,
  AttachedBackendEntry,
  BrokenNodeRef,
  DraftMode,
  ModelDetail,
  ModelNode,
  ObjectInfoBackendJson,
  RevisionSummary,
  TermsForm,
  TestRun,
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
  const [attachedBackends, setAttachedBackends] = useState<
    AttachedBackendEntry[] | null
  >(null);
  const [backendsLoadError, setBackendsLoadError] = useState<string | null>(
    null,
  );
  const [allBackends, setAllBackends] = useState<AdminBackendSummary[] | null>(
    null,
  );
  // null until the first successful load (issue #49 CEO review): checkModel
  // treats an empty Backend list as an error, so staying null — rather than
  // defaulting to [] — keeps the rail from flagging a healthy Model as
  // backend-less while /object-info is still in flight or has failed.
  const [objectInfo, setObjectInfo] = useState<ObjectInfoBackendJson[] | null>(
    null,
  );
  const [attachBackendId, setAttachBackendId] = useState("");
  const [attachError, setAttachError] = useState<string | null>(null);
  const [modesDraft, setModesDraft] = useState<DraftMode[] | null>(null);
  const [editingModeIndex, setEditingModeIndex] = useState<number | null>(null);
  const [inputsDraft, setInputsDraft] = useState<InputDefinition[] | null>(
    null,
  );
  const [newInputKind, setNewInputKind] =
    useState<InputDefinition["kind"]>("text");
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
  const [revisions, setRevisions] = useState<RevisionSummary[] | null>(null);
  const [revisionsLoadError, setRevisionsLoadError] = useState<string | null>(
    null,
  );
  const [restoringRevision, setRestoringRevision] = useState<number | null>(
    null,
  );
  const [restoreErrors, setRestoreErrors] = useState<Record<number, string>>(
    {},
  );
  // Issue #74: which Mode's test form is open, its draft values and
  // chosen Backend, and the last 5 Tests (persisted server-side, so
  // they're still here after leaving and returning to this page).
  const [testOpenForModeKey, setTestOpenForModeKey] = useState<string | null>(
    null,
  );
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [testBackendId, setTestBackendId] = useState("");
  const [testSubmitting, setTestSubmitting] = useState(false);
  const [testError, setTestError] = useState<string[] | null>(null);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  // Issue #74 CEO review: an Upload or Points Input on the Mode under
  // test needs the same picker the Workbench itself uses, so this
  // mirrors its own upload bookkeeping (uploads, running promises, a
  // trim range), scoped to the test form instead of a real Submission.
  const [testUploads, setTestUploads] = useState<Record<string, UploadState>>(
    {},
  );
  const testRunningUploadsRef = useRef(
    new Map<string, { promise: Promise<void>; controller: AbortController }>(),
  );
  const [testTrimRangeByInputId, setTestTrimRangeByInputId] = useState<
    Record<string, { startMs: number; endMs: number }>
  >({});
  const testMaxUploadMb =
    session.status === "signed-in" ? (session.user.maxUploadMb ?? null) : null;
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

  // Issue #74's AC: "the last 5 tests are listed" — loaded once up
  // front so they're there even before the SSE stream below (re)) opens.
  useEffect(() => {
    if (!id) return;
    fetch(`/api/admin/models/${id}/tests`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { tests: TestRun[] } | null) => {
        if (body && Array.isArray(body.tests)) {
          setTestRuns(sortedTestRuns(body.tests));
        }
      })
      .catch(() => {});
  }, [id]);

  // Issue #74's AC: "the test survives leaving the editor" — this is the
  // same per-user Generation stream the Workbench uses, so a Test
  // already under way shows its live progress right away on return,
  // not just once it's loaded from `/tests`.
  useEffect(() => {
    if (!id) return;
    const source = new EventSource("/api/generations/stream");
    source.addEventListener("change", (event) => {
      const generation = JSON.parse((event as MessageEvent).data) as TestRun;
      if (!generation.isTest || generation.modelId !== id) return;
      setTestRuns((prev) =>
        sortedTestRuns([
          generation,
          ...prev.filter((run) => run.id !== generation.id),
        ]),
      );
    });
    return () => source.close();
  }, [id]);

  function loadAttachedBackends() {
    if (!id) return;
    fetch(`/api/admin/models/${id}/backends`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ backends: AttachedBackendEntry[] }>;
      })
      .then((body) => {
        setAttachedBackends(body.backends);
        setBackendsLoadError(null);
      })
      .catch(() => setBackendsLoadError("could not load Backends"));
  }

  /** `/object-info` (issue #49): each attached Backend's node knowledge, for the live rail. */
  function loadObjectInfo() {
    if (!id) return;
    fetch(`/api/admin/models/${id}/object-info`)
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ backends: ObjectInfoBackendJson[] }>)
          : null,
      )
      .then((body) => {
        if (body) setObjectInfo(body.backends);
      })
      .catch(() => {
        /* the rail just runs without Backend-aware checks */
      });
  }

  function loadAllBackends() {
    fetch("/api/admin/backends")
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ backends: AdminBackendSummary[] }>)
          : null,
      )
      .then((body) => {
        if (body) setAllBackends(body.backends);
      })
      .catch(() => {
        /* the "attach" picker just stays empty */
      });
  }

  /** Issue #71: every numbered revision, for the Revisions section. */
  function loadRevisions() {
    if (!id) return;
    fetch(`/api/admin/models/${id}/revisions`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ revisions: RevisionSummary[] }>;
      })
      .then((body) => {
        setRevisions(body.revisions);
        setRevisionsLoadError(null);
      })
      .catch(() => setRevisionsLoadError("could not load revisions"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the route's :id changes
  useEffect(() => {
    loadAttachedBackends();
    loadAllBackends();
    loadObjectInfo();
    loadRevisions();
  }, [id]);

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
      const res = await fetch(
        `/api/admin/models/${detail.model.id}/revisions/${revisionNumber}/restore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version: detail.model.version,
            ...(disable ? { disable: true } : {}),
          }),
        },
      );

      if (!res.ok) {
        const message = await messageFrom(res, "restore failed");
        setRestoreErrors((prev) => ({ ...prev, [revisionNumber]: message }));
        return;
      }

      // Issue #241 CEO review: restoring a revision replaces the saved
      // Modes/Inputs/Terms, so they need a full reseed, not just a
      // refetch under the once-per-id seeding effect. Restore only runs
      // while every draft is clean, so `draft.reload()` is safe here.
      await draft.reload();
      loadRevisions();
    } finally {
      setRestoringRevision(null);
    }
  }

  async function handleAttach(event: FormEvent) {
    event.preventDefault();
    if (!detail || !attachBackendId) return;
    setAttachError(null);

    const res = await fetch(`/api/admin/models/${detail.model.id}/backends`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backendId: attachBackendId }),
    });

    if (!res.ok) {
      setAttachError(await messageFrom(res, "could not attach this Backend"));
      return;
    }

    setAttachBackendId("");
    loadAttachedBackends();
    loadObjectInfo();
  }

  async function handleDetach(backendId: string) {
    if (!detail) return;
    await fetch(`/api/admin/models/${detail.model.id}/backends/${backendId}`, {
      method: "DELETE",
    });
    loadAttachedBackends();
    loadObjectInfo();
  }

  function addMode() {
    if (!modesDraft) return;
    setModesDraft([
      ...modesDraft,
      {
        key: crypto.randomUUID(),
        name: "",
        description: "",
        outputNodeIds: [],
        inputSettings: [],
      },
    ]);
    setEditingModeIndex(modesDraft.length);
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

  /** Duplicates Mode `index` right after it, as a fresh (unsaved) Mode (issue #48). */
  function duplicateMode(index: number) {
    if (!modesDraft) return;
    const mode = modesDraft[index];
    if (!mode) return;
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

  /** Opens (or closes) a Mode's test form, resetting its draft values and Backend pick. */
  function toggleTestForm(mode: DraftMode) {
    if (testOpenForModeKey === mode.key) {
      setTestOpenForModeKey(null);
      return;
    }
    for (const running of testRunningUploadsRef.current.values()) {
      running.controller.abort();
    }
    testRunningUploadsRef.current.clear();
    setTestOpenForModeKey(mode.key);
    setTestValues({});
    setTestUploads({});
    setTestTrimRangeByInputId({});
    setTestBackendId("");
    setTestError(null);
  }

  /** Mirrors WorkbenchPage's own `startUpload` (issue #74 CEO review): picking a file for a Test's Upload Input watches it upload the same way, scoped to `testUploads`/`testValues` instead of the Workbench's own. */
  function startTestUpload(
    input: WorkbenchImageUploadInput | WorkbenchMediaUploadInput,
    file: File,
  ) {
    testRunningUploadsRef.current.get(input.id)?.controller.abort();
    testRunningUploadsRef.current.delete(input.id);
    setTestValues((v) => ({ ...v, [input.id]: "" }));
    setTestUploads((u) => {
      const { [input.id]: _, ...rest } = u;
      return rest;
    });
    setTestTrimRangeByInputId((ranges) => {
      const { [input.id]: _, ...rest } = ranges;
      return rest;
    });

    const controller = new AbortController();
    const promise = issueFor(input, file, testMaxUploadMb).then((issue) => {
      if (controller.signal.aborted) return;
      if (issue) {
        setTestUploads((u) => ({
          ...u,
          [input.id]: {
            status: "error",
            name: file.name,
            message: issue.prefixed
              ? `${file.name} ${issue.message}.`
              : issue.message,
          },
        }));
        return;
      }
      setTestUploads((u) => ({
        ...u,
        [input.id]: {
          status: "uploading",
          name: file.name,
          progress: 0,
          size: file.size,
          file,
        },
      }));
      return uploadResumable(file, httpUploadApi(), {
        hint: { modelId: detail?.model.id ?? "", inputId: input.id },
        signal: controller.signal,
        onProgress: (progress) => {
          if (controller.signal.aborted) return;
          setTestUploads((u) => ({
            ...u,
            [input.id]: {
              status: "uploading",
              name: file.name,
              progress,
              size: file.size,
              file,
            },
          }));
        },
      })
        .then((done) => {
          if (controller.signal.aborted) return;
          setTestValues((v) => ({ ...v, [input.id]: done.id }));
          setTestUploads((u) => ({
            ...u,
            [input.id]: {
              status: "complete",
              name: file.name,
              uploadId: done.id,
              durationMs: done.durationMs,
              browserPlayable: done.browserPlayable,
              size: file.size,
              width: done.width,
              height: done.height,
            },
          }));
          if (done.durationMs !== null) {
            const maxDurationMs =
              input.kind === "image_upload" ? null : input.maxDurationMs;
            setTestTrimRangeByInputId((ranges) => ({
              ...ranges,
              [input.id]: {
                startMs: 0,
                endMs:
                  maxDurationMs !== null
                    ? Math.min(done.durationMs as number, maxDurationMs)
                    : (done.durationMs as number),
              },
            }));
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setTestUploads((u) => ({
            ...u,
            [input.id]: {
              status: "error",
              name: file.name,
              message: `${file.name} ${err instanceof Error ? err.message : "couldn't be uploaded"}.`,
            },
          }));
        });
    });
    testRunningUploadsRef.current.set(input.id, { promise, controller });
  }

  /** Mirrors WorkbenchPage's own `clearUpload` (issue #197), scoped to the Test form. */
  function clearTestUpload(
    input: WorkbenchImageUploadInput | WorkbenchMediaUploadInput,
  ) {
    testRunningUploadsRef.current.get(input.id)?.controller.abort();
    testRunningUploadsRef.current.delete(input.id);
    setTestValues((v) => ({ ...v, [input.id]: "" }));
    setTestUploads((u) => {
      const { [input.id]: _, ...rest } = u;
      return rest;
    });
    setTestTrimRangeByInputId((ranges) => {
      const { [input.id]: _, ...rest } = ranges;
      return rest;
    });
  }

  /** The Test submit payload (issue #74 CEO review, mirrors WorkbenchPage's valuesPayload): blank values are left out, a number/seed is parsed, not sent as the raw typed string. */
  function testValuesPayload(
    inputs: InputDefinition[],
    values: Record<string, string>,
  ): Record<string, string | number> {
    const byId = new Map(inputs.map((input) => [input.id, input]));
    const payload: Record<string, string | number> = {};
    for (const [id, raw] of Object.entries(values)) {
      if (raw === "") continue;
      const input = byId.get(id);
      payload[id] =
        input?.kind === "number" || input?.kind === "seed" ? Number(raw) : raw;
    }
    return payload;
  }

  async function handleTestSubmit(mode: DraftMode) {
    if (!detail) return;
    const inputs = inputsDraft ?? detail.inputs ?? [];

    // Issue #74 CEO review: Generate's own wait-for-Uploads-then-trim
    // steps (see WorkbenchPage's handleGenerate), so a Test on a Mode
    // with a trimmable Video/Audio Input submits the trimmed range, not
    // whatever's still uploading or the untrimmed file.
    const running = [...testRunningUploadsRef.current.values()];
    if (running.length > 0) {
      await Promise.allSettled(running.map((r) => r.promise));
    }

    setTestSubmitting(true);
    setTestError(null);

    try {
      let values = testValues;
      const mediaInputs = inputs.filter(
        (
          input,
        ): input is VideoUploadInputDefinition | AudioUploadInputDefinition =>
          input.kind === "video_upload" || input.kind === "audio_upload",
      );
      const toTrim = mediaInputs.filter((input) => {
        const upload = testUploads[input.id];
        const range = testTrimRangeByInputId[input.id];
        return (
          upload?.status === "complete" &&
          upload.durationMs !== null &&
          range &&
          (range.startMs > 0 || range.endMs < upload.durationMs)
        );
      });
      const toTrimIds = new Set(toTrim.map((input) => input.id));
      const untrimmedUpdates = Object.fromEntries(
        mediaInputs
          .filter((input) => !toTrimIds.has(input.id))
          .map((input): readonly [string, string] | null => {
            const upload = testUploads[input.id];
            return upload?.status === "complete"
              ? [input.id, upload.uploadId]
              : null;
          })
          .filter(
            (entry): entry is readonly [string, string] => entry !== null,
          ),
      );
      if (Object.keys(untrimmedUpdates).length > 0) {
        values = { ...values, ...untrimmedUpdates };
        setTestValues((v) => ({ ...v, ...untrimmedUpdates }));
      }

      if (toTrim.length > 0) {
        try {
          const trimmed = await Promise.all(
            toTrim.map(async (input) => {
              const upload = testUploads[input.id];
              const range = testTrimRangeByInputId[input.id];
              if (upload?.status !== "complete" || !range) return null;
              const result = await trimUpload(
                upload.uploadId,
                range.startMs,
                range.endMs,
              );
              return [input.id, result.id] as const;
            }),
          );
          const updates = Object.fromEntries(
            trimmed.filter((t): t is readonly [string, string] => t !== null),
          );
          values = { ...values, ...updates };
          setTestValues((v) => ({ ...v, ...updates }));
        } catch (err) {
          setTestError([
            err instanceof Error ? err.message : "couldn't be trimmed",
          ]);
          return;
        }
      }

      const currentInputIds = new Set(inputs.map((input) => input.id));
      const res = await fetch(`/api/admin/models/${detail.model.id}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: {
            name: mode.name,
            description: mode.description,
            outputNodeIds: mode.outputNodeIds,
            inputSettings: mode.inputSettings.filter((s) =>
              currentInputIds.has(s.inputId),
            ),
          },
          inputs,
          values: testValuesPayload(inputs, values),
          backendId: testBackendId || null,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const payload = body as {
          reasons?: string[];
          message?: string;
          error?: string;
          issues?: { message: string }[];
        };
        const reasons =
          payload.reasons ??
          payload.issues?.map((issue) => issue.message) ??
          (payload.message || payload.error
            ? [payload.message ?? payload.error ?? "test failed"]
            : ["test failed"]);
        setTestError(reasons);
        return;
      }

      const { generation } = body as { generation: TestRun };
      setTestRuns((prev) => sortedTestRuns([generation, ...prev]));
    } finally {
      setTestSubmitting(false);
    }
  }

  function addInput() {
    if (!inputsDraft) return;
    if (newInputKind === "seed" && inputsDraft.some((i) => i.kind === "seed")) {
      return;
    }
    const created =
      newInputKind === "text"
        ? newTextInput()
        : newInputKind === "number"
          ? newNumberInput()
          : newInputKind === "seed"
            ? newSeedInput()
            : newInputKind === "image_upload"
              ? newImageUploadInput()
              : newInputKind === "video_upload"
                ? newVideoUploadInput()
                : newInputKind === "audio_upload"
                  ? newAudioUploadInput()
                  : newInputKind === "points"
                    ? newPointsInput()
                    : newSelectInput();
    setInputsDraft([...inputsDraft, created]);
  }

  function removeInput(index: number) {
    if (!inputsDraft) return;
    setInputsDraft(inputsDraft.filter((_, i) => i !== index));
  }

  function updateInput(index: number, next: InputDefinition) {
    if (!inputsDraft) return;
    setInputsDraft(inputsDraft.map((input, i) => (i === index ? next : input)));
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

  const termsDirty = Boolean(
    detail &&
      termsForm &&
      (!sameTerms(termsFrom(detail), termsForm) || askAgain),
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
    askAgain,
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
    () => (objectInfo === null ? null : toCheckModelBackends(objectInfo)),
    [objectInfo],
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
    attachedBackends,
    setAttachedBackends,
    backendsLoadError,
    setBackendsLoadError,
    allBackends,
    setAllBackends,
    objectInfo,
    setObjectInfo,
    attachBackendId,
    setAttachBackendId,
    attachError,
    setAttachError,
    modesDraft,
    setModesDraft,
    editingModeIndex,
    setEditingModeIndex,
    inputsDraft,
    setInputsDraft,
    newInputKind,
    setNewInputKind,
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
    revisions,
    setRevisions,
    revisionsLoadError,
    setRevisionsLoadError,
    restoringRevision,
    setRestoringRevision,
    restoreErrors,
    setRestoreErrors,
    testOpenForModeKey,
    setTestOpenForModeKey,
    testValues,
    setTestValues,
    testBackendId,
    setTestBackendId,
    testSubmitting,
    setTestSubmitting,
    testError,
    setTestError,
    testRuns,
    setTestRuns,
    testUploads,
    setTestUploads,
    testRunningUploadsRef,
    testTrimRangeByInputId,
    setTestTrimRangeByInputId,
    testMaxUploadMb,
    bypassBlockerRef,
    inputsHeadingRef,
    modesHeadingRef,
    load,
    loadAttachedBackends,
    loadObjectInfo,
    loadAllBackends,
    loadRevisions,
    handlePickWorkflowFile,
    setRebind,
    handleRestoreRevision,
    handleAttach,
    handleDetach,
    addMode,
    removeMode,
    updateMode,
    duplicateMode,
    setModeInputSetting,
    applySettingToEveryEligibleMode,
    toggleOutputNodeInEditingMode,
    removeOutputNode,
    moveOutputNode,
    toggleTestForm,
    startTestUpload,
    clearTestUpload,
    testValuesPayload,
    handleTestSubmit,
    addInput,
    removeInput,
    updateInput,
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
