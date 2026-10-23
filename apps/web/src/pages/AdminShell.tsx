import { Navigate } from "react-router-dom";
import { useSession } from "../useSession.js";

export function AdminShell() {
  const { session } = useSession();

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;
  if (session.user.role !== "admin") return <Navigate to="/models" replace />;

  return (
    <main>
      <h1>Admin</h1>
    </main>
  );
}
