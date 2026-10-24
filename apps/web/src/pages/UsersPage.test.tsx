// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, render, screen, waitFor } = await import(
  "@testing-library/react"
);
const { MemoryRouter } = await import("react-router-dom");
const { UsersPage } = await import("./UsersPage.js");

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
  return render(
    <MemoryRouter initialEntries={["/admin/users"]}>
      <UsersPage />
    </MemoryRouter>,
  );
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

    const { default: userEvent } = await import("@testing-library/user-event");
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
});
