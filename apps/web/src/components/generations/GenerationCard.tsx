import { AssetPlayer } from "./AssetPlayer.js";
import { DownloadAsset } from "./DownloadAsset.js";
import { ProgressLabel } from "./ProgressLabel.js";
import { RemovedCard } from "./RemovedCard.js";
import { stateLabel } from "./stateLabel.js";
import type { GenerationProgress, GenerationSummary } from "./types.js";

export function GenerationCard({
  generation,
  progress,
  paused,
}: {
  generation: GenerationSummary;
  progress: GenerationProgress | undefined;
  paused: boolean;
}) {
  const mainAsset = generation.assets?.[0];
  if (generation.removedAt) {
    return <RemovedCard />;
  }
  return (
    <li>
      <span>{stateLabel(generation.state, generation.tries, paused)}</span>{" "}
      {(generation.state === "starting" || generation.state === "running") && (
        <ProgressLabel progress={progress} />
      )}
      {generation.state === "failed" && (
        <>
          {generation.error && <span role="alert">{generation.error}</span>}
          {/* Issue #55's AC: the full Generation id, so it can be matched to a Log entry. */}
          <span className="workbench-generation-id">{generation.id}</span>
        </>
      )}
      {generation.state === "succeeded" && mainAsset && (
        <>
          <AssetPlayer asset={mainAsset} />
          <DownloadAsset asset={mainAsset} />
        </>
      )}
    </li>
  );
}
