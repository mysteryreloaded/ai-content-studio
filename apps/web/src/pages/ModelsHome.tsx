import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { ModelCard } from "../components/ModelCard.js";
import { api, ok } from "../lib/api.js";
import { useSession } from "../useSession.js";

interface EnabledModel {
  id: string;
  slug: string;
  name: string;
  description: string;
  modeCount: number;
  attribution: string;
}

/** The prototype's Model-card grid (issue #175): one card per row on phones, auto-fill to 340px above. */
const CARD_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-3.5";

/** A placeholder card while the Models load. */
function ModelCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-[10px] border border-border bg-card"
    >
      <div className="flex animate-pulse flex-col gap-1.5 p-3.5">
        <div className="h-5 w-2/3 rounded-md bg-muted" />
        <div className="h-4 w-full rounded-md bg-muted" />
        <div className="h-3 w-1/2 rounded-md bg-muted" />
      </div>
    </div>
  );
}

/** The signed-in Models home: enabled Models, in Admin order (issue #42), as Model cards (issue #175). */
export function ModelsHome() {
  const { session } = useSession();
  // The one shared `["models"]` query (issue #175): the landing page and
  // this page read the same cache entry, and a failed request shows an
  // error instead of silently listing nothing.
  const { data, isPending, isError } = useQuery({
    queryKey: ["models"],
    queryFn: () => ok<{ models: EnabledModel[] }>(api.api.models.$get()),
  });

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;

  const models = data?.models;

  return (
    <main className="flex flex-col gap-3">
      <h1>Models</h1>

      {isError && (
        <p className="text-muted-foreground">could not load Models</p>
      )}

      {!isError && isPending && (
        <div className={CARD_GRID_CLASS}>
          {Array.from({ length: 4 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed set of identical placeholders.
            <ModelCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!isError && !isPending && models && models.length === 0 && (
        <p className="text-muted-foreground">No Models yet.</p>
      )}

      {models && models.length > 0 && (
        <nav aria-label="Models" className={CARD_GRID_CLASS}>
          {models.map((model) => (
            <ModelCard
              key={model.id}
              to={`/models/${model.slug}`}
              model={model}
            />
          ))}
        </nav>
      )}
    </main>
  );
}
