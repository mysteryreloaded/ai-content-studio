import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../useSession.js";

function contactHref(contact: string): string {
  return contact.startsWith("http://") || contact.startsWith("https://")
    ? contact
    : `mailto:${contact}`;
}

/** `/waiting`: shown to a pending user once they've accepted the Site terms (issue #62). */
export function WaitingPage() {
  const { session, signOut } = useSession();
  const [contact, setContact] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/site-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { contact?: string } | null) =>
        setContact(data?.contact || null),
      )
      .catch(() => setContact(null));
  }, []);

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;
  if (session.user.status !== "pending") return <Navigate to="/" replace />;

  return (
    <main>
      <h1>Waiting for approval</h1>
      <p>An Admin needs to approve your account before you can use it.</p>
      {contact && (
        <p>
          Questions or reports: <a href={contactHref(contact)}>{contact}</a>
        </p>
      )}
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </main>
  );
}
