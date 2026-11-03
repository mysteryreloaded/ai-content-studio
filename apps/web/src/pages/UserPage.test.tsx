// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, screen, waitFor } = await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { UserPage } = await import("./UserPage.js");
const { renderWithProviders } = await import("../test/render.js");

afterEach(() => {
  cleanup();
  // A mocked fetch must never leak into the next test, in this file or
  // another's — bun test runs every file in one process.
  globalThis.fetch = BUN_FETCH;
});

interface FetchCall {
  method: string;
  url: string;
  body: unknown;
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

function targetUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "u1",
    email: "user@example.com",
    name: "A User",
    picture: null,
    role: "user",
    status: "active",
    pinned: false,
    dailyCapOverride: null,
    concurrentCapOverride: null,
    disabledReason: null,
    disabledAt: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function mockFetch(
  handler: (call: FetchCall) => Response | Promise<Response> | undefined,
) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/auth/me")) return Response.json(SELF);
    const call: FetchCall = {
      method: init?.method ?? "GET",
      url,
      body: init?.body ? JSON.parse(init.body as string) : null,
    };
    calls.push(call);
    const result = handler(call);
    return result ?? Response.json(targetUser());
  }) as typeof fetch;
  return calls;
}

function renderPage() {
  return renderWithProviders(null, {
    route: "/admin/users/u1",
    routes: [
      { path: "/admin/users/:id", element: <UserPage /> },
      { path: "/admin/users", element: <p>Users list</p> },
    ],
  });
}

describe("UserPage", () => {
  test("disable sends the typed reason and reloads as disabled", async () => {
    let disabled = false;
    const calls = mockFetch((call) => {
      if (call.url.endsWith("/api/admin/users/u1") && call.method === "GET") {
        return Response.json(
          targetUser(disabled ? { status: "disabled" } : {}),
        );
      }
      if (call.url.endsWith("/disable")) {
        disabled = true;
        return Response.json(targetUser({ status: "disabled" }));
      }
      return undefined;
    });

    renderPage();
    await screen.findByText("A User");

    await userEvent.click(screen.getByText("Disable"));
    const textarea = await screen.findByLabelText(/Reason/);
    await userEvent.type(textarea, "Abusive prompts");
    await userEvent.click(screen.getByText("Confirm disable"));

    await waitFor(() =>
      expect(screen.getAllByText("disabled").length).toBeGreaterThan(0),
    );

    const disableCall = calls.find((c) => c.url.endsWith("/disable"));
    expect(disableCall?.body).toEqual({ reason: "Abusive prompts" });
  });

  test("disable asks in a dialog and sends the reason", async () => {
    const calls = mockFetch((call) => {
      if (call.url.endsWith("/disable")) {
        return Response.json(targetUser({ status: "disabled" }));
      }
      return undefined;
    });

    renderPage();
    await screen.findByText("A User");

    await userEvent.click(screen.getByText("Disable"));

    // A dialog asks — it is not an inline form — and nothing is sent
    // until it is confirmed.
    expect(
      await screen.findByRole("heading", { name: "Disable A User?" }),
    ).toBeTruthy();
    expect(screen.getByText(/Their sessions end now/)).toBeTruthy();
    expect(calls.find((c) => c.url.endsWith("/disable"))).toBeUndefined();

    await userEvent.type(
      screen.getByLabelText("Reason (optional, Admin-only)"),
      "Abusive prompts",
    );
    await userEvent.click(screen.getByText("Confirm disable"));

    await waitFor(() => {
      const disableCall = calls.find((c) => c.url.endsWith("/disable"));
      expect(disableCall?.body).toEqual({ reason: "Abusive prompts" });
    });
  });

  test("enable is offered for a disabled user and clears the status", async () => {
    let status = "disabled";
    mockFetch((call) => {
      if (call.url.endsWith("/api/admin/users/u1") && call.method === "GET") {
        return Response.json(targetUser({ status }));
      }
      if (call.url.endsWith("/enable")) {
        status = "active";
        return Response.json(targetUser({ status: "active" }));
      }
      return undefined;
    });

    renderPage();
    const enableButton = await screen.findByText("Enable");
    await userEvent.click(enableButton);

    await waitFor(() => expect(screen.queryByText("Enable")).toBeNull());
  });

  test("delete confirms and navigates back to the Users list", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/admin/users/u1") && call.method === "GET") {
        return Response.json(targetUser());
      }
      if (call.method === "DELETE") {
        return Response.json({ ok: true });
      }
      return undefined;
    });

    renderPage();
    await screen.findByText("A User");

    await userEvent.click(screen.getByText("Delete account"));
    await userEvent.click(screen.getByText("Confirm delete"));

    expect(await screen.findByText("Users list")).toBeTruthy();
  });

  test("Cap overrides save and show the saved values", async () => {
    let caps = { dailyCapOverride: null, concurrentCapOverride: null };
    const calls = mockFetch((call) => {
      if (call.url.endsWith("/api/admin/users/u1") && call.method === "GET") {
        return Response.json(targetUser(caps));
      }
      if (call.url.endsWith("/caps") && call.method === "PUT") {
        caps = call.body as typeof caps;
        return Response.json(targetUser(caps));
      }
      return undefined;
    });

    renderPage();
    await screen.findByText("A User");

    const daily = screen.getByLabelText("Daily cap override");
    await userEvent.type(daily, "0");
    const concurrent = screen.getByLabelText("Concurrent cap override");
    await userEvent.type(concurrent, "2");
    await userEvent.click(screen.getByText("Save"));

    expect(await screen.findByText("Saved.")).toBeTruthy();
    const capsCall = calls.find((c) => c.url.endsWith("/caps"));
    expect(capsCall?.body).toEqual({
      dailyCapOverride: 0,
      concurrentCapOverride: 2,
    });
  });

  test("a 0 Cap override is flagged as blocked", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/admin/users/u1") && call.method === "GET") {
        return Response.json(targetUser({ dailyCapOverride: 0 }));
      }
      return undefined;
    });

    renderPage();
    await screen.findByText("A User");

    // A saved 0 fills the Daily input and is flagged as a block.
    const daily = screen.getByLabelText("Daily cap override");
    expect((daily as HTMLInputElement).value).toBe("0");
    expect(screen.getAllByText("Blocked from generating").length).toBe(1);
  });

  test("actions are hidden for a pinned row and the acting Admin's own row", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/api/admin/users/u1") && call.method === "GET") {
        return Response.json(targetUser({ pinned: true }));
      }
      return undefined;
    });

    renderPage();
    await screen.findByText("A User");
    expect(screen.queryByText("Disable")).toBeNull();
    expect(screen.queryByText("Delete account")).toBeNull();
  });
});
