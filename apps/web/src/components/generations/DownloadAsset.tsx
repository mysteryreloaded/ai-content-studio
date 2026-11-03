import type { AssetSummary } from "./types.js";

/** A Download link for `asset`, with the AI-generated reminder the AC asks for beside every Download (issue #45). */
export function DownloadAsset({ asset }: { asset: AssetSummary }) {
  return (
    <p className="workbench-download">
      <a href={`/api/assets/${asset.id}?download=1`}>Download</a>{" "}
      <span className="workbench-ai-reminder">
        AI-generated: say so when you share it.
      </span>
    </p>
  );
}
