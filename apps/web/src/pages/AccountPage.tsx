import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Footer } from "../Footer.js";
import { useSession } from "../useSession.js";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function AccountPage() {
  const { session, signOut } = useSession();
  const [pictureFailed, setPictureFailed] = useState(false);

  if (session.status === "loading") return null;
  if (session.status === "signed-out") return <Navigate to="/" replace />;

  const { user } = session;

  return (
    <>
      <main>
        <h1>Account</h1>
        {user.picture && !pictureFailed ? (
          <img
            src={user.picture}
            alt=""
            width={64}
            height={64}
            referrerPolicy="no-referrer"
            onError={() => setPictureFailed(true)}
          />
        ) : (
          <div aria-hidden="true">{initials(user.name)}</div>
        )}
        <p>{user.name}</p>
        <p>{user.email}</p>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </main>
      <Footer />
    </>
  );
}
