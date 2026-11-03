import { effectiveNoticeText } from "@ai-content-studio/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { UPLOAD_KINDS } from "../components/inputs/types.js";
import { usePauseNotice } from "../usePauseNotice.js";
import { useSession } from "../useSession.js";
import { GenerateBar } from "./workbench/GenerateBar.js";
import { ModelTermsDialog } from "./workbench/ModelTermsDialog.js";
import { WorkbenchFeed } from "./workbench/WorkbenchFeed.js";
import { WorkbenchForm } from "./workbench/WorkbenchForm.js";
import { WorkbenchHeader } from "./workbench/WorkbenchHeader.js";
import { carryValuesFor, liveIssuesFor } from "./workbench/formValues.js";
import type { WorkbenchMode, WorkbenchModel } from "./workbench/types.js";
import { useCaps } from "./workbench/useCaps.js";
import { useGenerate } from "./workbench/useGenerate.js";
import { useModelTerms } from "./workbench/useModelTerms.js";
import { useReuseSettings } from "./workbench/useReuseSettings.js";
import { useUploads } from "./workbench/useUploads.js";
import { useWorkbenchFeed } from "./workbench/useWorkbenchFeed.js";
import { WORKBENCH_STYLE } from "./workbench/workbenchStyle.js";

/** A Model's Workbench at its slug (issue #43, #44, #61): pick the Mode, press Generate, watch it dispatch, run and play its Asset live. */
export function WorkbenchPage() {
  const { slug = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const reuseGenerationId = searchParams.get("reuse");
  const { session } = useSession();
  const { paused, notice } = usePauseNotice();
  const pauseNoticeText = effectiveNoticeText(paused, notice);

  const [model, setModel] = useState<WorkbenchModel | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reuseNotice, setReuseNotice] = useState<string | null>(null);
  /** 1-4 (issue #47); only meaningful when the Mode's Path holds a bound Seed Input. */
  const [count, setCount] = useState(1);
  const [issuesByInputId, setIssuesByInputId] = useState<
    Record<string, string>
  >({});
  /** Updates `values`, dropping any stale issue for every Input id that actually changed (shared by InputGroups and the Points picker). */
  const updateValues = useCallback(
    (update: (current: Record<string, string>) => Record<string, string>) => {
      setValues((current) => {
        const next = update(current);
        const changedIds = Object.keys(next).filter(
          (id) => next[id] !== current[id],
        );
        if (changedIds.length > 0) {
          setIssuesByInputId((issues) => {
            const remaining = { ...issues };
            for (const id of changedIds) delete remaining[id];
            return remaining;
          });
        }
        return next;
      });
    },
    [],
  );
  const handlePointsChange = useCallback(
    (inputId: string, raw: string) => {
      updateValues((current) => ({ ...current, [inputId]: raw }));
    },
    [updateValues],
  );
  const [lastOwnSubmissionId, setLastOwnSubmissionId] = useState<string | null>(
    null,
  );
  const maxUploadMb =
    session.status === "signed-in" ? (session.user.maxUploadMb ?? null) : null;
  const selectedMode =
    model?.modes.find((m) => m.id === selectedModeId) ?? null;
  /** The count picker shows whenever the Mode's Path holds a bound Seed Input (issue #47's AC), even one this Mode hides (issue #48 CEO review), so it's read off `hasSeed` rather than `inputs`, which excludes hidden ones. */
  const hasSeedInput = selectedMode?.hasSeed ?? false;
  const modelRef = useRef(model);
  modelRef.current = model;
  // Read after waiting for Uploads, so the submit sees their finished ids.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const { capsStatus, refreshCaps } = useCaps();
  const uploadsApi = useUploads({
    modelRef,
    valuesRef,
    maxUploadMb,
    setValues,
    setIssuesByInputId,
  });
  const feedApi = useWorkbenchFeed({ model, slug, refreshCaps });
  const termsApi = useModelTerms({ model, setModel });
  const generateApi = useGenerate({
    modelRef,
    valuesRef,
    runningUploadsRef: uploadsApi.runningUploadsRef,
    selectedModeId,
    count,
    uploads: uploadsApi.uploads,
    trimRangeByInputId: uploadsApi.trimRangeByInputId,
    setValues,
    setIssuesByInputId,
    setModel,
    setSelectedModeId,
    setTermsDialog: termsApi.setTermsDialog,
    refreshCaps,
    setSubmissions: feedApi.setSubmissions,
    setLastOwnSubmissionId,
  });
  const selectMode = useCallback(
    (mode: WorkbenchMode) => {
      setSelectedModeId(mode.id);
      setValues((current) => carryValuesFor(mode, current));
      setIssuesByInputId({});
      uploadsApi.resetUploads();
      setCount(1);
    },
    [uploadsApi.resetUploads],
  );
  useReuseSettings({
    model,
    reuseGenerationId,
    selectMode,
    setValues,
    setReuseNotice,
    searchParams,
    setSearchParams,
  });
  // Live validation (issue #46): the same parseInputValues schema the
  // server uses as the form resolver, so issues show before submit. A
  // not-yet-picked Upload isn't flagged until Generate is pressed.
  const liveIssuesByInputId = useMemo(() => {
    if (!model || !selectedMode) return {};
    const issues = liveIssuesFor(model.revision, selectedMode, values);
    for (const input of selectedMode.inputs) {
      if (UPLOAD_KINDS.has(input.kind) || input.kind === "points") {
        delete issues[input.id];
      }
    }
    return issues;
  }, [model, selectedMode, values]);
  const displayedIssuesByInputId = {
    ...liveIssuesByInputId,
    ...issuesByInputId,
  };
  useEffect(() => {
    let cancelled = false;
    setModel(null);
    setNotFound(false);
    setSelectedModeId(null);

    fetch(`/api/models/${slug}`)
      .then((res) => {
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ model: WorkbenchModel }>;
      })
      .then((body) => {
        if (cancelled || !body) return;
        setModel(body.model);
        const firstMode = body.model.modes[0];
        if (firstMode) selectMode(firstMode);
        // Blocking dialog the first time a user opens a Model with terms,
        // and again whenever re-asked (issue #61).
        if (body.model.terms && !body.model.terms.accepted) {
          termsApi.setTermsDialog({ blocking: true, error: null });
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, selectMode, termsApi.setTermsDialog]);
  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;
  if (notFound) {
    return (
      <main>
        <p role="alert">Model not found.</p>
      </main>
    );
  }
  if (!model) return <p>Loading…</p>;
  return (
    <>
      <main className="workbench">
        <style>{WORKBENCH_STYLE}</style>
        <WorkbenchHeader
          model={model}
          reuseNotice={reuseNotice}
          onShowTerms={() =>
            termsApi.setTermsDialog({ blocking: false, error: null })
          }
        />
        {termsApi.termsDialog && model.terms && (
          <ModelTermsDialog
            modelName={model.name}
            terms={model.terms}
            blocking={termsApi.termsDialog.blocking}
            accepting={termsApi.accepting}
            error={termsApi.termsDialog.error}
            onAccept={() => void termsApi.handleAcceptTerms()}
            onClose={termsApi.handleTermsClose}
          />
        )}
        <div className="workbench-layout">
          <WorkbenchForm
            {...uploadsApi}
            modes={model.modes}
            selectedModeId={selectedModeId}
            selectedMode={selectedMode}
            onSelectMode={selectMode}
            values={values}
            updateValues={updateValues}
            handlePointsChange={handlePointsChange}
            displayedIssuesByInputId={displayedIssuesByInputId}
            hasSeedInput={hasSeedInput}
            count={count}
            setCount={setCount}
            submitState={generateApi.submitState}
          />
          <WorkbenchFeed
            {...feedApi}
            model={model}
            paused={paused}
            lastOwnSubmissionId={lastOwnSubmissionId}
          />
        </div>
        <GenerateBar
          capsStatus={capsStatus}
          {...generateApi}
          paused={paused}
          pauseNoticeText={pauseNoticeText}
          selectedModeId={selectedModeId}
        />
      </main>
    </>
  );
}
