import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ok } from "./lib/api.js";

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

const SESSION_KEY = ["session"];

// `authRoute` still carries a `: Hono<AppEnv>` return annotation, which
// erases its routes from `AppType` (apps/server/src/app.ts: those sub-apps
// "convert in a follow-up" — issue #170), so the typed client only
// exposes `account` under `auth`. Hand-type the two methods this hook
// calls until that lands; both are plain JSON responses.
const auth = api.api.auth as unknown as {
  me: { $get(): Promise<Response> };
  signout: { $post(): Promise<Response> };
};

export function useSession(): {
  session: SessionState;
  refresh: () => void;
  signOut: () => Promise<void>;
  deleteAccount: (email: string) => Promise<DeleteAccountResult>;
} {
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      const res = await auth.me.$get();
      // A 401 is the signed-out answer, not a failure.
      if (res.status === 401) return null;
      return ok<SessionUser>(res);
    },
  });

  // No data yet: "loading" while the first attempt (and its retries) run,
  // "signed-out" once the attempts are exhausted without a 401 — the
  // same recovery the pre-Query hook had for a failed fetch.
  const session: SessionState =
    data === undefined
      ? isError
        ? { status: "signed-out" }
        : { status: "loading" }
      : data === null
        ? { status: "signed-out" }
        : { status: "signed-in", user: data };

  // `undefined` first, so the hook shows its "loading" state while the
  // refetch is in flight, like the pre-Query implementation did.
  const refresh = () => {
    queryClient.setQueryData<SessionUser | null | undefined>(
      SESSION_KEY,
      undefined,
    );
    void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
  };

  // Browsers set Sec-Fetch-Site themselves for a same-origin fetch, so
  // the server's CSRF check (ADR 0003) is satisfied without extra work.
  const { mutateAsync: signOut } = useMutation({
    mutationFn: async () => {
      await auth.signout.$post();
      queryClient.setQueryData<SessionUser | null>(SESSION_KEY, null);
    },
  });

  const deleteAccount = async (email: string): Promise<DeleteAccountResult> => {
    const res = await api.api.auth.account.$delete({ json: { email } });
    if (res.ok) {
      queryClient.setQueryData<SessionUser | null>(SESSION_KEY, null);
      return { ok: true };
    }
    if (res.status === 403) return { ok: false, error: "forbidden" };
    if (res.status === 400) return { ok: false, error: "email_mismatch" };
    return { ok: false, error: "unknown" };
  };

  return { session, refresh, signOut, deleteAccount };
}
