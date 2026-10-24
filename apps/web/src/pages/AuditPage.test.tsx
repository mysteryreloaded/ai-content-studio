// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, render, screen, waitFor } = await import(
  "@testing-library/react"
);
const { MemoryRouter } = await import("react-router-dom");
const { AuditPage } = await import("./AuditPage.js");

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

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const call: FetchCall = {
      method: "GET",
      url: typeof input === "string" ? input : input.toString(),
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return calls;
}

const SITE_SETTINGS_ENTRY = {
  id: "e1",
  createdAt: "2026-01-01T00:00:00.000Z",
  actorType: "admin",
  actorName: "admin@example.com",
  targetType: "site_settings",
  targetId: "singleton",
  targetName: null,
  action: "update",
  before: { title: "Old title" },
  after: { title: "New title" },
  images: null,
};

const USER_ENTRY = {
  id: "e2",
  createdAt: "2026-01-02T00:00:00.000Z",
  actorType: "system",
  actorName: null,
  targetType: "user",
  targetId: "u1",
  targetName: "Deleted user",
  action: "disable",
  before: { status: "active" },
  after: { status: "disabled" },
  images: null,
};

function renderAt(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuditPage />
    </MemoryRouter>,
  );
}

describe("AuditPage", () => {
  test("lists entries newest first with actor, target and action", async () => {
    mockFetch(() =>
      Response.json({ entries: [USER_ENTRY, SITE_SETTINGS_ENTRY] }),
    );

    renderAt("/admin/audit");

    expect(await screen.findByText(/System disable user/)).toBeTruthy();
    expect(
      screen.getByText(/admin@example\.com update site_settings/),
    ).toBeTruthy();
  });

  test("shows the diff computed from before/after when expanded", async () => {
    mockFetch(() => Response.json({ entries: [SITE_SETTINGS_ENTRY] }));

    renderAt("/admin/audit");

    const summary = await screen.findByText(
      /admin@example\.com update site_settings/,
    );
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(summary);

    expect(screen.getByText("Old title")).toBeTruthy();
    expect(screen.getByText("New title")).toBeTruthy();
  });

  test("a Deleted user target shows live-looked-up name", async () => {
    mockFetch(() => Response.json({ entries: [USER_ENTRY] }));

    renderAt("/admin/audit");

    expect(await screen.findByText(/Deleted user/)).toBeTruthy();
  });

  test("reads initial filters from the URL, as a History link would set them", async () => {
    const calls = mockFetch(() => Response.json({ entries: [] }));

    renderAt("/admin/audit?targetType=site_settings&targetId=singleton");

    await waitFor(() => {
      expect(calls[0]?.url).toContain("targetType=site_settings");
      expect(calls[0]?.url).toContain("targetId=singleton");
    });
    expect(
      (screen.getByLabelText("Target type") as HTMLInputElement).value,
    ).toBe("site_settings");
  });

  test("no entries matching the filters shows a message", async () => {
    mockFetch(() => Response.json({ entries: [] }));

    renderAt("/admin/audit");

    expect(
      await screen.findByText("No Audit entries match these filters."),
    ).toBeTruthy();
  });
});
