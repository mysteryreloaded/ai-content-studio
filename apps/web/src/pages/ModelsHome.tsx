import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useSession } from "../useSession.js";

interface EnabledModel {
  id: string;
  slug: string;
  name: string;
  description: string;
  modeCount: number;
}

/** The signed-in Models home: enabled Models, in Admin order (issue #42). */
export function ModelsHome() {
  const { session } = useSession();
  const [models, setModels] = useState<EnabledModel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/models")
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<{ models: EnabledModel[] }>;
      })
      .then((body) => {
        setModels(body.models);
        setLoadError(null);
      })
      .catch(() => setLoadError("could not load Models"));
  }, []);

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;

  return (
    <main>
      <h1>Models</h1>

      {models && models.length > 0 && (
        <nav aria-label="Models">
          {models.map((model) => (
            <Link key={model.id} to={`/models/${model.slug}`}>
              {model.name}
            </Link>
          ))}
        </nav>
      )}

      {loadError && <p role="alert">{loadError}</p>}
      {!models && !loadError && <p>Loading…</p>}
      {models && models.length === 0 && <p>No Models yet.</p>}

      {models?.map((model) => (
        <article key={model.id}>
          <h2>
            <Link to={`/models/${model.slug}`}>{model.name}</Link>
          </h2>
          {model.description && <p>{model.description}</p>}
          <p>
            {model.modeCount} {model.modeCount === 1 ? "Mode" : "Modes"}
          </p>
        </article>
      ))}
    </main>
  );
}
