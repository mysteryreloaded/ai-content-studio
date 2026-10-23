import { Navigate } from "react-router-dom";
import { useSession } from "../useSession.js";

export function ModelsHome() {
  const { session } = useSession();

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;

  return (
    <main>
      <h1>Models</h1>
      <p>No Models yet.</p>
    </main>
  );
}
