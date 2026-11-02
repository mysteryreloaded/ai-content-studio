import { afterEach, describe, expect, test } from "bun:test";
// See ./test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup } = await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { AccountPage } = await import("./AccountPage.js");
const { renderWithProviders } = await import("../test/render.js");

afterEach(() => {
  cleanup();
  // A mocked fetch must never leak into the next test, in this file or
  // another's — bun test runs every file in one process.
  globalThis.fetch = BUN_FETCH;
});

interface Calls {
  accountEmail: string | null;
  signOuts: number;
}

function mockFetch(
  overrides: {
    emailMismatch?: boolean;
  } & Partial<Calls> = {},
): Calls {
  const calls: Calls = {
    accountEmail: null,
    signOuts: overrides.signOuts ?? 0,
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/auth/me")) {
      return Response.json({
        id: "u1",
        email: "user@example.com",
        name: "Test User",
        picture: null,
        role: "user",
        status: "active",
        termsAcceptedVersion: 1,
      });
    }
    if (url.endsWith("/api/auth/account")) {
      if (init?.method !== "DELETE")
        throw new Error(`unexpected ${init?.method}`);
      const body = JSON.parse(String(init.body)) as { email?: string };
      calls.accountEmail = body.email ?? null;
      if (overrides.emailMismatch) {
        return Response.json({ error: "email_mismatch" }, { status: 400 });
      }
      return Response.json({ ok: true });
    }
    if (url.endsWith("/api/auth/signout")) {
      calls.signOuts += 1;
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return calls;
}

function renderAccount() {
  return renderWithProviders(null, {
    route: "/account",
    routes: [
      { path: "/account", element: <AccountPage /> },
      { path: "/", element: <p>home</p> },
    ],
  });
}

describe("AccountPage (issue #174)", () => {
  test("delete: the typed email, a confirming dialog, then the DELETE", async () => {
    const calls = mockFetch();
    const view = renderAccount();

    expect(await view.findByText("Test User")).toBeTruthy();
    expect(view.getByText("user@example.com")).toBeTruthy();

    const email = await view.findByLabelText(
      "Type your email (user@example.com) to confirm",
    );
    await userEvent.type(email, "user@example.com");
    await userEvent.click(
      view.getByRole("button", { name: "Delete my account" }),
    );

    // The confirm dialog opens before the delete mutation runs.
    expect(await view.findByRole("dialog")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Delete" })).toBeTruthy();
    await userEvent.click(view.getByRole("button", { name: "Delete" }));

    expect(calls.accountEmail).toBe("user@example.com");
    expect(await view.findByText("home")).toBeTruthy();
  });

  test("delete: the server's email_mismatch maps onto the email field", async () => {
    mockFetch({ emailMismatch: true });
    const view = renderAccount();

    const email = await view.findByLabelText(
      "Type your email (user@example.com) to confirm",
    );
    await userEvent.type(email, "user@example.com");
    await userEvent.click(
      view.getByRole("button", { name: "Delete my account" }),
    );
    await userEvent.click(await view.findByRole("button", { name: "Delete" }));

    // The dialog stays open, and the mismatch shows on the field.
    expect(await view.findByText("That email doesn't match your account.")).toBeTruthy();
  });

  test("sign out: the Sign out button posts to /api/auth/signout and navigates home", async () => {
    const calls = mockFetch();
    const view = renderAccount();

    await userEvent.click(
      await view.findByRole("button", { name: "Sign out" }),
    );

    expect(calls.signOuts).toBe(1);
    expect(await view.findByText("home")).toBeTruthy();
  });
});
