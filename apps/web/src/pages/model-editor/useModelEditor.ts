import {
  checkModel,
  computeModePath,
  hasBlockingErrors,
  modeInputSetting,
  renderMarkdown,
} from "@ai-content-studio/shared";
import type {
  AudioUploadInputDefinition,
  BindableField,
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
import { candidateFieldsFor, toggleBinding } from "./helpers/bindings.js";
import {
  detailsFrom,
  draftsFrom,
  messageFrom,
  readFileAsJson,
  sameDetails,
  sameInputs,
  sameModes,
  sameTerms,
  termsFrom,
  withoutKey,
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
import type {
  AdminBackendSummary,
  AttachedBackendEntry,
  BrokenNodeRef,
  DetailsForm,
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

  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<DetailsForm | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
  const [modesSaveError, setModesSaveError] = useState<string | null>(null);
  const [savingModes, setSavingModes] = useState(false);
  const [inputsDraft, setInputsDraft] = useState<InputDefinition[] | null>(
    null,
  );
  const [editingInputIndex, setEditingInputIndex] = useState<number | null>(
    null,
  );
  const [newInputKind, setNewInputKind] =
    useState<InputDefinition["kind"]>("text");
  const [inputsSaveError, setInputsSaveError] = useState<string | null>(null);
  const [savingInputs, setSavingInputs] = useState(false);
  const [stateError, setStateError] = useState<string[] | null>(null);
  const [togglingState, setTogglingState] = useState(false);
  const [termsForm, setTermsForm] = useState<TermsForm | null>(null);
  const [askAgain, setAskAgain] = useState(false);
  const [savingTerms, setSavingTerms] = useState(false);
  const [termsSaveError, setTermsSaveError] = useState<string | null>(null);
  // Issue #71: a re-uploaded Workflow file lives only in the editor
  // (parsed client-side) until "Replace Workflow" sends it in one PUT —
  // there's no separate server-side draft.
  const [pendingWorkflow, setPendingWorkflow] = useState<unknown | null>(null);
  const [pendingWorkflowFileName, setPendingWorkflowFileName] = useState<
    string | null
  >(null);
  const [workflowUploadError, setWorkflowUploadError] = useState<string | null>(
    null,
  );
  const [uploadingWorkflow, setUploadingWorkflow] = useState(false);
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
  const didInitialOpenRef = useRef(false);
  const inputsHeadingRef = useRef<HTMLHeadingElement>(null);
  const modesHeadingRef = useRef<HTMLHeadingElement>(null);

  function load() {
    if (!id) return;
    fetch(`/api/admin/models/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<ModelDetail>;
      })
      .then((body) => {
        setDetail(body);
        setForm(detailsFrom(body));
        setModesDraft(draftsFrom(body));
        setEditingModeIndex(null);
        setModesSaveError(null);
        setInputsDraft(body.inputs);
        setEditingInputIndex(null);
        setInputsSaveError(null);
        setStateError(null);
        setLoadError(null);
        setTermsForm(termsFrom(body));
        setAskAgain(false);
        setTermsSaveError(null);
      })
      .catch(() => setLoadError("could not load this Model"));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the route's :id changes
  useEffect(load, [id]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: a different :id gets its own "open on" decision
  useEffect(() => {
    didInitialOpenRef.current = false;
  }, [id]);

  useEffect(() => {
    if (!detail || didInitialOpenRef.current) return;
    didInitialOpenRef.current = true;
    if ((detail.inputs ?? []).length === 0) {
      inputsHeadingRef.current?.scrollIntoView({ block: "start" });
    } else {
      setEditingModeIndex(detail.modes.length > 0 ? 0 : null);
      modesHeadingRef.current?.scrollIntoView({ block: "start" });
    }
  }, [detail]);

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

  async function handlePickWorkflowFile(file: File | null) {
    setWorkflowUploadError(null);
    setRebindMap({});
    if (!file) {
      setPendingWorkflow(null);
      setPendingWorkflowFileName(null);
      return;
    }
    try {
      setPendingWorkflow(await readFileAsJson(file));
      setPendingWorkflowFileName(file.name);
    } catch {
      setPendingWorkflow(null);
      setPendingWorkflowFileName(null);
      setWorkflowUploadError("that file isn't valid JSON");
    }
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

  async function handleReplaceWorkflow() {
    if (!detail || pendingWorkflow === null) return;
    setUploadingWorkflow(true);
    setWorkflowUploadError(null);

    const rebind = Object.entries(rebindMap).map(([nodeId, newNodeId]) => ({
      nodeId,
      newNodeId,
    }));

    try {
      const res = await fetch(`/api/admin/models/${detail.model.id}/workflow`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: detail.model.version,
          workflow: pendingWorkflow,
          ...(rebind.length > 0 ? { rebind } : {}),
          ...(mustDisableToSaveWorkflow ? { disable: true } : {}),
        }),
      });

      if (!res.ok) {
        setWorkflowUploadError(await messageFrom(res, "upload failed"));
        return;
      }

      setPendingWorkflow(null);
      setPendingWorkflowFileName(null);
      setRebindMap({});
      load();
      loadRevisions();
    } finally {
      setUploadingWorkflow(false);
    }
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

      load();
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

  async function handleSaveModes() {
    if (!detail || !modesDraft) return;
    setSavingModes(true);
    setModesSaveError(null);

    try {
      const currentInputIds = new Set(
        (detail.inputs ?? []).map((input) => input.id),
      );
      const res = await fetch(`/api/admin/models/${detail.model.id}/modes`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: detail.model.version,
          ...(mustDisableToSave ? { disable: true } : {}),
          modes: modesDraft.map(withoutKey).map((mode) => ({
            ...mode,
            inputSettings: mode.inputSettings.filter((s) =>
              currentInputIds.has(s.inputId),
            ),
          })),
        }),
      });

      if (!res.ok) {
        setModesSaveError(await messageFrom(res, "save failed"));
        return;
      }

      load();
    } finally {
      setSavingModes(false);
    }
  }

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
            message: `${file.name} ${issue}.`,
          },
        }));
        return;
      }
      setTestUploads((u) => ({
        ...u,
        [input.id]: { status: "uploading", name: file.name, progress: 0 },
      }));
      return uploadResumable(file, httpUploadApi(), {
        hint: { modelId: detail?.model.id ?? "", inputId: input.id },
        signal: controller.signal,
        onProgress: (progress) => {
          if (controller.signal.aborted) return;
          setTestUploads((u) => ({
            ...u,
            [input.id]: { status: "uploading", name: file.name, progress },
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
            },
          }));
          if (done.durationMs !== null) {
            setTestTrimRangeByInputId((ranges) => ({
              ...ranges,
              [input.id]: { startMs: 0, endMs: done.durationMs as number },
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
    setEditingInputIndex(inputsDraft.length);
  }

  function removeInput(index: number) {
    if (!inputsDraft) return;
    setInputsDraft(inputsDraft.filter((_, i) => i !== index));
    if (editingInputIndex === index) setEditingInputIndex(null);
  }

  function updateInput(index: number, next: InputDefinition) {
    if (!inputsDraft) return;
    setInputsDraft(inputsDraft.map((input, i) => (i === index ? next : input)));
  }

  /** Toggles `field` in and out of the currently *picking* Input's bindings. */
  function toggleFieldInEditingInput(field: BindableField) {
    if (editingInputIndex === null || !inputsDraft) return;
    const input = inputsDraft[editingInputIndex];
    if (!input) return;
    updateInput(editingInputIndex, toggleBinding(input, field));
  }

  async function handleSaveInputs() {
    if (!detail || !inputsDraft) return;
    setSavingInputs(true);
    setInputsSaveError(null);

    try {
      const res = await fetch(`/api/admin/models/${detail.model.id}/inputs`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: detail.model.version,
          ...(mustDisableToSave ? { disable: true } : {}),
          inputs: inputsDraft,
        }),
      });

      if (!res.ok) {
        setInputsSaveError(await messageFrom(res, "save failed"));
        return;
      }

      load();
    } finally {
      setSavingInputs(false);
    }
  }

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

  const dirty = Boolean(
    detail && form && !sameDetails(detailsFrom(detail), form),
  );

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

  // Issue #71 CEO review: `load()` after Replace Workflow/Restore wipes
  // every draft back to the server's own state, silently discarding
  // whatever's unsaved in another section — so both stay disabled while
  // any section is dirty, the same way a risky action elsewhere would.
  const anyDraftDirty = dirty || modesDirty || inputsDirty || termsDirty;

  const termsPreviewHtml = termsForm ? renderMarkdown(termsForm.termsBody) : "";

  async function handleSaveTerms(event: FormEvent) {
    event.preventDefault();
    if (!detail || !termsForm) return;
    setSavingTerms(true);
    setTermsSaveError(null);

    try {
      const res = await fetch(`/api/admin/models/${detail.model.id}/terms`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: detail.model.termsRevision,
          ...termsForm,
          askAgain,
        }),
      });

      if (!res.ok) {
        setTermsSaveError(await messageFrom(res, "save failed"));
        return;
      }

      load();
    } finally {
      setSavingTerms(false);
    }
  }

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
  const modelHasErrors = hasBlockingErrors(modelIssues);
  // An enabled Model with errors can only be saved by disabling it (issue
  // #49): Modes/Inputs then offer "Save and disable" instead of Save.
  const mustDisableToSave = detail?.model.state === "enabled" && modelHasErrors;

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
      // it with a clear message once "Replace Workflow" is pressed.
      return [];
    }
  }, [detail, pendingWorkflow, checkModelBackends, rebindMap]);
  const mustDisableToSaveWorkflow =
    detail?.model.state === "enabled" &&
    hasBlockingErrors(pendingWorkflowIssues);

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

  const editingInput =
    editingInputIndex !== null
      ? (inputsDraft?.[editingInputIndex] ?? null)
      : null;
  const editingInputCandidates =
    detail && editingInput && inputsDraft
      ? candidateFieldsFor(detail.workflow, editingInput, inputsDraft)
      : null;

  useEffect(() => {
    if (!dirty && !modesDirty && !inputsDirty && !termsDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, modesDirty, inputsDirty, termsDirty]);

  // Catches every in-app navigation away from the editor while dirty: the
  // "Back to Models" button, AdminShell's nav links, and the browser's
  // own Back/Forward (issue #40 follow-up: beforeunload alone misses all
  // three since they never unload the page).
  useBlocker(({ currentLocation, nextLocation }) => {
    if (
      bypassBlockerRef.current ||
      (!dirty && !modesDirty && !inputsDirty && !termsDirty) ||
      currentLocation.pathname === nextLocation.pathname
    ) {
      return false;
    }
    return !window.confirm("Discard unsaved changes?");
  });

  function goBack() {
    navigate("/admin/models");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!detail || !form) return;
    setSaving(true);
    setSaveError(null);

    try {
      const res = await fetch(`/api/admin/models/${detail.model.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, version: detail.model.version }),
      });

      if (!res.ok) {
        setSaveError(await messageFrom(res, "save failed"));
        return;
      }

      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!detail) return;
    if (!window.confirm("Delete this Model?")) return;
    setDeleteError(null);

    const res = await fetch(
      `/api/admin/models/${detail.model.id}?version=${detail.model.version}`,
      { method: "DELETE" },
    );

    if (!res.ok) {
      setDeleteError(await messageFrom(res, "delete failed"));
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
    setDetail,
    loadError,
    setLoadError,
    form,
    setForm,
    saveError,
    setSaveError,
    saving,
    setSaving,
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
    modesSaveError,
    setModesSaveError,
    savingModes,
    setSavingModes,
    inputsDraft,
    setInputsDraft,
    editingInputIndex,
    setEditingInputIndex,
    newInputKind,
    setNewInputKind,
    inputsSaveError,
    setInputsSaveError,
    savingInputs,
    setSavingInputs,
    stateError,
    setStateError,
    togglingState,
    setTogglingState,
    termsForm,
    setTermsForm,
    askAgain,
    setAskAgain,
    savingTerms,
    setSavingTerms,
    termsSaveError,
    setTermsSaveError,
    pendingWorkflow,
    setPendingWorkflow,
    pendingWorkflowFileName,
    setPendingWorkflowFileName,
    workflowUploadError,
    setWorkflowUploadError,
    uploadingWorkflow,
    setUploadingWorkflow,
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
    didInitialOpenRef,
    inputsHeadingRef,
    modesHeadingRef,
    load,
    loadAttachedBackends,
    loadObjectInfo,
    loadAllBackends,
    loadRevisions,
    handlePickWorkflowFile,
    setRebind,
    handleReplaceWorkflow,
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
    handleSaveModes,
    toggleTestForm,
    startTestUpload,
    testValuesPayload,
    handleTestSubmit,
    addInput,
    removeInput,
    updateInput,
    toggleFieldInEditingInput,
    handleSaveInputs,
    handleToggleState,
    dirty,
    modesDirty,
    inputsDirty,
    termsDirty,
    anyDraftDirty,
    termsPreviewHtml,
    handleSaveTerms,
    checkModelBackends,
    modelHasErrors,
    mustDisableToSave,
    mustDisableToSaveWorkflow,
    editingMode,
    editingPath,
    editingInput,
    editingInputCandidates,
    goBack,
    handleSubmit,
    handleDelete,
    modelIssues,
    pendingWorkflowIssues,
    brokenNodeRefs,
    pendingWorkflowNodes,
  };
}

export type ModelEditor = ReturnType<typeof useModelEditor>;
