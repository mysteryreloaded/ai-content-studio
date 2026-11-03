// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, screen } = await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { BlockedAccountsPage } = await import("./BlockedAccountsPage.js");
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

function blockedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ba-1",
    userId: "u-scrubbed",
    disabledAt: "2026-01-03T00:00:00.000Z",
    reason: "Abusive prompts",
    createdAt: "2026-01-04T00:00:00.000Z",
    ...overrides,
  };
}

function mockFetch(handler: (call: FetchCall) => Response | undefined) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/auth/me")) return Response.json(SELF);
    const call: FetchCall = { method: init?.method ?? "GET", url };
    calls.push(call);
    return handler(call) ?? Response.json({ blockedAccounts: [blockedRow()] });
  }) as typeof fetch;
  return calls;
}

function renderPage() {
  return renderWithProviders(<BlockedAccountsPage />, {
    route: "/admin/blocked-accounts",
  });
}

describe("BlockedAccountsPage", () => {
  test("lists blocked accounts", async () => {
    mockFetch(() =>
      Response.json({
        blockedAccounts: [blockedRow()],
      }),
    );

    renderPage();

    expect(await screen.findByText("Abusive prompts")).toBeTruthy();
    // The scrubbed user id links to their (scrubbed) page.
    const link = screen.getByRole("link", { name: "u-scrubbed" });
    expect(link.getAttribute("href")).toBe("/admin/users/u-scrubbed");
    expect(screen.getByText("Clear")).toBeTruthy();
  });

  test("clear asks first, then deletes", async () => {
    let cleared = false;
    const calls = mockFetch((call) => {
      if (call.method === "DELETE" && call.url.endsWith("/ba-1")) {
        cleared = true;
        return Response.json({ ok: true });
      }
      if (call.method === "GET") {
        return Response.json({
          blockedAccounts: cleared ? [] : [blockedRow()],
        });
      }
      return undefined;
    });

    renderPage();
    await screen.findByText("Abusive prompts");

    await userEvent.click(screen.getByText("Clear"));

    // The dialog asks before the entry is deleted.
    expect(
      await screen.findByRole("heading", { name: "Clear this block?" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "That Google account can then sign up again as a brand-new user.",
      ),
    ).toBeTruthy();
    expect(calls.find((c) => c.method === "DELETE")).toBeUndefined();

    // The "Clear" buttons: the row's, then the dialog's.
    const confirmClear = screen.getAllByText("Clear").at(-1);
    if (confirmClear === undefined) throw new Error("no confirm Clear button");
    await userEvent.click(confirmClear);

    const deleteCall = calls.find((c) => c.method === "DELETE");
    expect(deleteCall?.url).toContain("/ba-1");
    // The cleared list reloads to its empty state.
    expect(await screen.findByText("No blocked accounts.")).toBeTruthy();
  });

  test("a failed clear keeps the dialog open and shows the error", async () => {
    mockFetch((call) => {
      if (call.method === "DELETE" && call.url.endsWith("/ba-1")) {
        return Response.json({ error: "boom" }, { status: 500 });
      }
      return undefined;
    });

    renderPage();
    await screen.findByText("Abusive prompts");

    await userEvent.click(screen.getByText("Clear"));
    const confirmClear = screen.getAllByText("Clear").at(-1);
    if (confirmClear === undefined) throw new Error("no confirm Clear button");
    await userEvent.click(confirmClear);

    // The original page's "could not clear this entry" line, inside the
    // open dialog, which stays open for a retry.
    expect(await screen.findByText("could not clear this entry")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Clear this block?" }),
    ).toBeTruthy();
  });
});
