import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "./test/happy-dom-setup.js";
// See ./test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import type { SessionUser } from "./useSession.js";

const { cleanup, screen } = await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { useSession } = await import("./useSession.js");
const { TermsPage } = await import("./pages/TermsPage.js");
const { RequireTermsAccepted } = await import("./RequireTermsAccepted.js");
const { renderWithProviders } = await import("./test/render.js");

afterEach(() => {
  cleanup();
  // A mocked fetch must never leak into the next test, in this file or
  // another's — bun test runs every file in one process.
  globalThis.fetch = BUN_FETCH;
});

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u1",
    email: "user@example.com",
    name: "A User",
    picture: null,
    role: "user",
    status: "active",
    termsAcceptedVersion: 1,
    ...overrides,
  };
}

const SITE_SETTINGS = {
  title: "AI Content Studio",
  landingText: "",
  accent: "teal",
  signUpMode: "approval",
  contact: "",
  hasLogo: false,
  hasBackground: false,
  hasTerms: true,
  footerLinks: [],
  hasNonVideoEnabledModel: false,
};

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  }) as typeof fetch;
}

/** Renders the session state (or the signed-in user's name) plus a refresh button. */
function SessionProbe() {
  const { session, refresh } = useSession();
  return (
    <div>
      <p>
        {session.status === "signed-in" ? session.user.name : session.status}
      </p>
      <button type="button" onClick={() => refresh()}>
        Refresh
      </button>
    </div>
  );
}

describe("useSession.refresh (issue #183 QA round 1)", () => {
  test("shows 'loading' until the refetch lands, instead of keeping the stale session", async () => {
    // `setQueryData(key, undefined)` is a no-op in TanStack v5, so the old
    // implementation left the stale session in the cache and `refresh`
    // looked like it did nothing until the (often never-run) invalidation.
    let releaseRefetch: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });
    let refetching = false;
    mockFetch((url) => {
      if (url.includes("/api/auth/me")) {
        if (refetching) {
          return gate.then(() =>
            Response.json(user({ name: "Refreshed User" })),
          );
        }
        return Response.json(user({ name: "Initial User" }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    renderWithProviders(<SessionProbe />);
    expect(await screen.findByText("Initial User")).toBeTruthy();

    refetching = true;
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    // The reset clears the cached session, so the hook shows "loading"
    // while the refetch is in flight.
    expect(await screen.findByText("loading")).toBeTruthy();
    releaseRefetch?.();
    expect(await screen.findByText("Refreshed User")).toBeTruthy();
  });

  /** Let queued microtasks and React/router work settle after a click. */
  async function settle() {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  test("TermsPage Accept then navigate into a gated route renders the child, not a redirect back to /terms", async () => {
    let accepted = false;
    // The post-accept session refetch is held behind a gate: on a real
    // server it lands long after the navigation, which is exactly when
    // the stale cached session used to break the gate.
    let releaseRefetch: () => void;
    const refetchGate = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });
    let meCalls = 0;
    mockFetch((url, init) => {
      if (url.includes("/api/auth/me")) {
        meCalls += 1;
        // Stale (version 0) until the acceptance is recorded server-side.
        const body = () =>
          Response.json(user({ termsAcceptedVersion: accepted ? 1 : 0 }));
        // The first call is the initial load; the rest are refetches.
        if (meCalls === 1) return body();
        return refetchGate.then(body);
      }
      if (url.endsWith("/api/terms/accept")) {
        if (init?.method !== "POST")
          throw new Error(`unexpected ${init?.method}`);
        accepted = true;
        return Response.json({ ok: true });
      }
      if (url.endsWith("/api/terms")) {
        return Response.json({
          version: 1,
          body: "Be kind.",
          versionDate: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.endsWith("/api/site-settings")) {
        return Response.json(SITE_SETTINGS);
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    renderWithProviders(null, {
      route: "/terms?return_to=%2Fmodels",
      routes: [
        { path: "/terms", element: <TermsPage /> },
        {
          path: "/models",
          element: (
            <RequireTermsAccepted>
              <p>Models home</p>
            </RequireTermsAccepted>
          ),
        },
      ],
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Accept" }),
    );
    await settle();

    // The acceptance is recorded but the refetch hasn't landed yet. With
    // the stale-session bug the gate would read the cached
    // termsAcceptedVersion 0 here and bounce back to /terms, which would
    // leave the Terms heading on screen.
    expect(screen.queryByRole("heading", { name: "Terms" })).toBeNull();

    releaseRefetch?.();
    expect(await screen.findByText("Models home")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Terms" })).toBeNull();
  });
});
