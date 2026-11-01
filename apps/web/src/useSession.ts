import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, ok } from "./lib/api.js";

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
export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "email_mismatch" | "unknown" };

export function useSession(): {
  session: SessionState;
  refresh: () => void;
  signOut: () => Promise<void>;
  deleteAccount: (email: string) => Promise<DeleteAccountResult>;
} {
  const queryClient = useQueryClient();

  // The session is a query on the shared cache: `null` means signed out
  // (a 401 from `/api/auth/me`), and a failed fetch leaves the previous
  // state in place rather than pretending a sign-out.
  const { isPending, data } = useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        return await ok<SessionUser>(api.api.auth.me.$get());
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });

  const session: SessionState =
    isPending || data === undefined
      ? { status: "loading" }
      : data === null
        ? { status: "signed-out" }
        : { status: "signed-in", user: data };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["session"] });
  };

  // Sign-out is a mutation that clears the cache (issue #172): one
  // `setQueryData` reaches every `useSession` caller in the tree.
  const signOutMutation = useMutation({
    mutationFn: async () => {
      // Browsers set Sec-Fetch-Site themselves for a same-origin fetch, so
      // the server's CSRF check (ADR 0003) is satisfied without extra work.
      await ok(api.api.auth.signout.$post());
    },
    onSettled: () => {
      queryClient.setQueryData<SessionUser | null>(["session"], null);
    },
  });

  const signOut = async () => {
    await signOutMutation.mutateAsync();
  };

  const deleteAccount = async (email: string): Promise<DeleteAccountResult> => {
    try {
      await ok(api.api.auth.account.$delete({ json: { email } }));
      queryClient.setQueryData<SessionUser | null>(["session"], null);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) return { ok: false, error: "forbidden" };
        if (err.status === 400) return { ok: false, error: "email_mismatch" };
      }
      return { ok: false, error: "unknown" };
    }
  };

  return { session, refresh, signOut, deleteAccount };
}
