import { type FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { Footer } from "../Footer.js";
import type { DeleteAccountResult } from "../useSession.js";
import { useSession } from "../useSession.js";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function DeleteAccount({
  email,
  deleteAccount,
  onDeleted,
}: {
  email: string;
  deleteAccount: (email: string) => Promise<DeleteAccountResult>;
  onDeleted: () => void;
}) {
  const [typedEmail, setTypedEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setDeleting(true);
    const result = await deleteAccount(typedEmail);
    if (result.ok) {
      onDeleted();
      return;
    }
    setDeleting(false);
    setError(
      result.error === "email_mismatch"
        ? "That email doesn't match your account."
        : "Could not delete this account.",
    );
  }

  return (
    <section>
      <h2>Delete my account</h2>
      <p>
        This deletes your profile, files, prompts and settings. It can't be
        undone, and signing in again with the same Google account starts fresh.
      </p>
      <form onSubmit={handleDelete}>
        <label htmlFor="delete-account-email">
          Type your email ({email}) to confirm
        </label>
        <input
          id="delete-account-email"
          type="email"
          value={typedEmail}
          onChange={(event) => setTypedEmail(event.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <button
          type="submit"
          disabled={deleting || typedEmail.trim().length === 0}
        >
          Delete my account
        </button>
      </form>
    </section>
  );
}

export function AccountPage() {
  const { session, signOut, deleteAccount } = useSession();
  const [pictureFailed, setPictureFailed] = useState(false);
  const [deleted, setDeleted] = useState(false);

  if (session.status === "loading") return null;
  if (deleted || session.status === "signed-out") {
    return <Navigate to="/" replace />;
  }

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
        {user.role !== "admin" && (
          <DeleteAccount
            email={user.email}
            deleteAccount={deleteAccount}
            onDeleted={() => setDeleted(true)}
          />
        )}
      </main>
      <Footer />
    </>
  );
}
