// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { useQuery } from "@tanstack/react-query";
import { adminBadgeKeys } from "../components/admin/AdminNav.js";
import { api, ok } from "../lib/api.js";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, screen, waitFor } = await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { UsersPage } = await import("./UsersPage.js");
const { renderWithProviders } = await import("../test/render.js");

/**
 * The nav's pending badge, exactly the query AdminNav runs (see
 * AdminNav.tsx) — the query the page's row actions invalidate (issue
 * #207's AC: approving refreshes the badge).
 */
function PendingBadgeProbe() {
  const { data } = useQuery({
    queryKey: adminBadgeKeys.pending,
    queryFn: () =>
      ok<{ count: number }>(api.api.admin.users["pending-count"].$get()),
  });
  return (
    <span data-testid="pending-badge">
      {data ? `${data.count} pending` : ""}
    </span>
  );
}

afterEach(() => {
  cleanup();
  // A mocked fetch must never leak into the next test, in this file or
  // another's — bun test runs every file in one process.
  globalThis.fetch = BUN_FETCH;
});

interface FetchCall {
  url: string;
}

const SELF = {
  id: "self-id",
  email: "self@example.com",
  name: "Self Admin",
  picture: null,
  role: "admin" as const,
  status: "active" as const,
  termsAcceptedVersion: 1,
};

/** Mocks `/api/auth/me` (signed in as `SELF`) and routes `/api/admin/users` to `usersHandler`. */
function mockFetch(usersHandler: (call: FetchCall) => Response) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/auth/me")) {
      return Response.json(SELF);
    }
    const call: FetchCall = { url };
    calls.push(call);
    return usersHandler(call);
  }) as typeof fetch;
  return calls;
}

function userRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "u1",
    email: "user@example.com",
    name: "A User",
    role: "user",
    status: "active",
    pinned: false,
    createdAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  return renderWithProviders(<UsersPage />, { route: "/admin/users" });
}

describe("UsersPage", () => {
  test("action buttons show for an actionable row", async () => {
    mockFetch(() =>
      Response.json({
        users: [userRow({ id: "pending-1", status: "pending" })],
        hasMore: false,
      }),
    );

    renderPage();

    expect(await screen.findByText("Approve")).toBeTruthy();
  });

  test("action buttons are hidden on a pinned row", async () => {
    mockFetch(() =>
      Response.json({
        users: [userRow({ id: "pinned-1", status: "pending", pinned: true })],
        hasMore: false,
      }),
    );

    renderPage();

    await screen.findByText("A User");
    expect(screen.queryByText("Approve")).toBeNull();
  });

  test("action buttons are hidden on the acting Admin's own row", async () => {
    mockFetch(() =>
      Response.json({
        users: [userRow({ id: SELF.id, role: "admin", status: "active" })],
        hasMore: false,
      }),
    );

    renderPage();

    await screen.findByText("A User");
    expect(screen.queryByText("Demote")).toBeNull();
  });

  test("Load older fetches the next page with a keyset cursor and appends", async () => {
    const calls = mockFetch((call) => {
      if (!call.url.includes("beforeCreatedAt")) {
        return Response.json({
          users: [userRow({ id: "u1", name: "First User" })],
          hasMore: true,
        });
      }
      return Response.json({
        users: [userRow({ id: "u2", name: "Second User" })],
        hasMore: false,
      });
    });

    renderPage();

    await screen.findByText("First User");
    const loadOlder = screen.getByText("Load older");
    await userEvent.click(loadOlder);

    expect(await screen.findByText("Second User")).toBeTruthy();
    expect(screen.getByText("First User")).toBeTruthy();
    expect(screen.queryByText("Load older")).toBeNull();

    const secondCall = calls[1];
    expect(secondCall?.url).toContain(
      `beforeCreatedAt=${encodeURIComponent("2026-01-02T00:00:00.000Z")}`,
    );
    expect(secondCall?.url).toContain("beforeId=u1");
  });

  test("no users matching the filters shows a message", async () => {
    mockFetch(() => Response.json({ users: [], hasMore: false }));

    renderPage();

    expect(
      await screen.findByText("No users match these filters."),
    ).toBeTruthy();
  });

  test("links to Blocked accounts, no longer a nav item of its own", async () => {
    mockFetch(() => Response.json({ users: [], hasMore: false }));

    renderPage();

    const link = await screen.findByRole("link", {
      name: "Blocked accounts",
    });
    expect(link.getAttribute("href")).toBe("/admin/blocked-accounts");
  });

  test("filters are read from the URL", async () => {
    const calls = mockFetch(() =>
      Response.json({ users: [userRow()], hasMore: false }),
    );

    renderWithProviders(<UsersPage />, {
      route: "/admin/users?q=alice&status=pending&role=admin",
    });

    await screen.findByText("A User");

    const listCall = calls[0];
    expect(listCall?.url).toContain("q=alice");
    expect(listCall?.url).toContain("status=pending");
    expect(listCall?.url).toContain("role=admin");
  });

  test("approve invalidates the pending badge", async () => {
    let approved = false;
    let pendingCountFetches = 0;
    mockFetch((call) => {
      if (call.url.includes("/pending-count")) {
        pendingCountFetches += 1;
        return Response.json({ count: approved ? 0 : 1 });
      }
      if (call.url.includes("/approve")) {
        approved = true;
        return Response.json(userRow({ id: "pending-1", status: "active" }));
      }
      return Response.json({
        users: [
          userRow({
            id: "pending-1",
            status: approved ? "active" : "pending",
          }),
        ],
        hasMore: false,
      });
    });

    renderWithProviders(
      <>
        <UsersPage />
        <PendingBadgeProbe />
      </>,
      { route: "/admin/users" },
    );

    // The badge, as the nav runs it, loads on mount.
    await screen.findByText("1 pending");

    await userEvent.click(screen.getByText("Approve"));

    // Approve invalidates the badge's query, and the refetched count
    // (now 0) replaces it.
    await screen.findByText("0 pending");
    expect(pendingCountFetches).toBeGreaterThanOrEqual(2);
  });
});
