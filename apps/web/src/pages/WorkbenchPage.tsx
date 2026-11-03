import { effectiveNoticeText } from "@ai-content-studio/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { UPLOAD_KINDS } from "../components/inputs/types.js";
import { api, ok } from "../lib/api.js";
import { usePauseNotice } from "../usePauseNotice.js";
import { useSession } from "../useSession.js";
import { GenerateBar } from "./workbench/GenerateBar.js";
import { ModelIntro } from "./workbench/ModelIntro.js";
import { ModelTermsDialog } from "./workbench/ModelTermsDialog.js";
import { WorkbenchFeed } from "./workbench/WorkbenchFeed.js";
import { WorkbenchForm } from "./workbench/WorkbenchForm.js";
import { WorkbenchLayout } from "./workbench/WorkbenchLayout.js";
import { carryValuesFor, liveIssuesFor } from "./workbench/formValues.js";
import type { WorkbenchMode, WorkbenchModel } from "./workbench/types.js";
import { useCaps } from "./workbench/useCaps.js";
import { useGenerate } from "./workbench/useGenerate.js";
import { useModelTerms } from "./workbench/useModelTerms.js";
import { useReuseSettings } from "./workbench/useReuseSettings.js";
import { useUploads } from "./workbench/useUploads.js";
import { useWorkbenchFeed } from "./workbench/useWorkbenchFeed.js";
import { workbenchModelQueryKey } from "./workbench/workbenchModelQuery.js";
import { WORKBENCH_STYLE } from "./workbench/workbenchStyle.js";

/** A Model's Workbench at its slug (issue #43, #44, #61): pick the Mode, press Generate, watch it dispatch, run and play its Asset live. */
export function WorkbenchPage() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const reuseGenerationId = searchParams.get("reuse");
  const { session } = useSession();
  const { paused, notice } = usePauseNotice();
  const pauseNoticeText = effectiveNoticeText(paused, notice);
  const queryClient = useQueryClient();

  const { data: model, isError: modelErrored } = useQuery({
    queryKey: workbenchModelQueryKey(slug),
    queryFn: async () => {
      const res = await api.api.models[":slug"].$get({ param: { slug } });
      if (res.status === 404) return null;
      return ok<{ model: WorkbenchModel }>(res).then((body) => body.model);
    },
  });

  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
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
  const modelRef = useRef<WorkbenchModel | null>(model ?? null);
  modelRef.current = model ?? null;
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
  const feedApi = useWorkbenchFeed({ model: model ?? null, slug, refreshCaps });
  const termsApi = useModelTerms({ model: model ?? null, slug });
  const generateApi = useGenerate({
    modelRef,
    valuesRef,
    runningUploadsRef: uploadsApi.runningUploadsRef,
    slug,
    queryClient,
    selectedModeId,
    count,
    uploads: uploadsApi.uploads,
    trimRangeByInputId: uploadsApi.trimRangeByInputId,
    setValues,
    setIssuesByInputId,
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
    model: model ?? null,
    reuseGenerationId,
    selectMode,
    setValues,
    setReuseNotice: setBanner,
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
  // The first data for a slug (issue #194): pick the first Mode and open
  // the blocking terms dialog if needed, once — never again on a
  // refetch (e.g. after accepting terms, or a 409 model_changed reload).
  const initializedSlugRef = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `selectMode`/`termsApi.setTermsDialog` are stable; this only ever runs once per `slug`, guarded by `initializedSlugRef`.
  useEffect(() => {
    if (!model || initializedSlugRef.current === slug) return;
    initializedSlugRef.current = slug;
    const firstMode = model.modes[0];
    if (firstMode) selectMode(firstMode);
    // Blocking dialog the first time a user opens a Model with terms,
    // and again whenever re-asked (issue #61).
    if (model.terms && !model.terms.accepted) {
      termsApi.setTermsDialog({ blocking: true, error: null });
    }
  }, [model, slug]);

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;
  if (model === null || modelErrored) {
    return (
      <main className="mx-auto w-full max-w-320 flex-1 px-4 py-10 md:px-8">
        <p role="alert">Model not found.</p>
      </main>
    );
  }
  if (!model) {
    return (
      <main className="mx-auto w-full max-w-320 flex-1 px-4 py-10 md:px-8">
        <p>Loading…</p>
      </main>
    );
  }
  return (
    <>
      <style>{WORKBENCH_STYLE}</style>
      {termsApi.termsDialog && model.terms && (
        <ModelTermsDialog
          modelName={model.name}
          attribution={model.attribution}
          terms={model.terms}
          blocking={termsApi.termsDialog.blocking}
          accepting={termsApi.accepting}
          error={termsApi.termsDialog.error}
          onAccept={() => void termsApi.handleAcceptTerms()}
          onClose={termsApi.handleTermsClose}
          onBackToModels={() => navigate("/models")}
        />
      )}
      <WorkbenchLayout
        modelName={model.name}
        body={
          <>
            <ModelIntro
              model={model}
              onShowTerms={() =>
                termsApi.setTermsDialog({ blocking: false, error: null })
              }
            />
            <WorkbenchForm
              {...uploadsApi}
              modes={model.modes}
              selectedModeId={selectedModeId}
              selectedMode={selectedMode}
              onSelectMode={selectMode}
              banner={banner}
              onDismissBanner={() => setBanner(null)}
              values={values}
              updateValues={updateValues}
              handlePointsChange={handlePointsChange}
              displayedIssuesByInputId={displayedIssuesByInputId}
              hasSeedInput={hasSeedInput}
              count={count}
              setCount={setCount}
              submitState={generateApi.submitState}
            />
          </>
        }
        foot={
          <GenerateBar
            capsStatus={capsStatus}
            {...generateApi}
            paused={paused}
            pauseNoticeText={pauseNoticeText}
            selectedModeId={selectedModeId}
          />
        }
        feed={
          <WorkbenchFeed
            {...feedApi}
            model={model}
            paused={paused}
            lastOwnSubmissionId={lastOwnSubmissionId}
          />
        }
      />
    </>
  );
}
