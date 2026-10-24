import { useCallback, useEffect, useState } from "react";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: "user" | "admin";
  status: "pending" | "active" | "disabled";
  /** Issue #60: null until this user accepts the Site terms' current version. */
  termsAcceptedVersion: number | null;
  /** Issue #50: the Operator's MAX_UPLOAD_MB, so a too-large file is refused on pick. */
  maxUploadMb?: number;
}

export type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: SessionUser };

/** The current sign-in state, from `/api/auth/me`, refetched on demand. */
export function useSession(): {
  session: SessionState;
  refresh: () => void;
  signOut: () => Promise<void>;
} {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [generation, setGeneration] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: generation is a deliberate refetch trigger, not a data dependency
  useEffect(() => {
    let cancelled = false;
    setSession({ status: "loading" });

    fetch("/api/auth/me")
      .then((res) => {
        if (res.status === 401) return null;
        if (!res.ok) throw new Error(`unexpected status ${res.status}`);
        return res.json() as Promise<SessionUser>;
      })
      .then((user) => {
        if (cancelled) return;
        setSession(
          user ? { status: "signed-in", user } : { status: "signed-out" },
        );
      })
      .catch(() => {
        if (!cancelled) setSession({ status: "signed-out" });
      });

    return () => {
      cancelled = true;
    };
  }, [generation]);

  const refresh = useCallback(() => setGeneration((n) => n + 1), []);

  const signOut = useCallback(async () => {
    // Browsers set Sec-Fetch-Site themselves for a same-origin fetch, so
    // the server's CSRF check (ADR 0003) is satisfied without extra work.
    await fetch("/api/auth/signout", { method: "POST" });
    setSession({ status: "signed-out" });
  }, []);

  return { session, refresh, signOut };
}
