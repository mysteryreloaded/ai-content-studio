import { Square } from "lucide-react";
import { Link } from "react-router-dom";
import { AssetPlayer } from "../../../components/generations/AssetPlayer.js";
import { CopyButton } from "../../../components/generations/CopyButton.js";
import { DownloadAsset } from "../../../components/generations/DownloadAsset.js";
import { GenerationProgress } from "../../../components/generations/ProgressLabel.js";
import { genStatus } from "../../../components/generations/stateLabel.js";
import type { GenerationProgress as GenerationProgressData } from "../../../components/generations/types.js";
import { Button } from "../../../components/ui/button.js";
import { Pill } from "../../../components/ui/pill.js";
import {
  TEST_UNFINISHED_STATES,
  testRunPillTone,
  testRunStateLabel,
} from "../helpers/testRuns.js";
import type { TestRun } from "../types.js";

/**
 * "Test Generation" (issue #259's inline result panel): a state pill
 * (today's `testRunStateLabel`), the same stage/percentage/step
 * progress bar as the Workbench's own cards, Cancel while unfinished,
 * the Asset playing in place once done, the failure text and full id
 * with Copy, and a link to the Admin Generations detail.
 */
export function TestResultPanel({
  run,
  progress,
  cancelling,
  onCancel,
}: {
  run: TestRun;
  progress: GenerationProgressData | undefined;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const unfinished = TEST_UNFINISHED_STATES.has(run.state);
  const showsBar =
    run.state === "starting" ||
    run.state === "running" ||
    run.state === "saving";
  const status = genStatus(run, { paused: false, progress });
  const mainAsset = run.assets[0];

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Test Generation</h3>
        <Pill tone={testRunPillTone(run)}>{testRunStateLabel(run)}</Pill>
        {unfinished && status.text && (
          <span className="text-muted-foreground tabular-nums">
            {status.text}
          </span>
        )}
        <span className="min-w-0 flex-1" />
        {unfinished && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={cancelling || run.state === "cancelling"}
            onClick={onCancel}
          >
            <Square /> Cancel
          </Button>
        )}
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/admin/generations/${run.id}`}>
            Open on Admin Generations
          </Link>
        </Button>
      </div>

      {showsBar && (
        <div className="relative h-6 w-full overflow-hidden rounded-md bg-media">
          <GenerationProgress generation={run} progress={progress} />
        </div>
      )}

      {run.state === "succeeded" && mainAsset && (
        <div className="flex flex-col gap-2">
          <AssetPlayer asset={mainAsset} />
          <div>
            <DownloadAsset asset={mainAsset} />
          </div>
        </div>
      )}

      {run.state === "failed" && (
        <div className="flex flex-col gap-1.5">
          {run.error && <p className="text-err">{run.error}</p>}
          <div className="flex items-center gap-1 font-mono text-[12.5px] text-faint break-all">
            <span>{run.id}</span>
            <CopyButton text={run.id} label="Copy Generation id" />
          </div>
        </div>
      )}

      {run.state === "cancelled" && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Square className="size-3.5" /> Cancelled.
        </p>
      )}
    </div>
  );
}
