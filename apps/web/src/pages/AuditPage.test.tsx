// See ../test/happy-dom-setup.ts for why this is registered once, here,
// before @testing-library/react is imported, and never unregistered.
import { afterEach, describe, expect, test } from "bun:test";
import { BUN_FETCH } from "../test/happy-dom-setup.js";

const { cleanup, screen, waitFor } = await import("@testing-library/react");
const { Link } = await import("react-router-dom");
const { renderWithProviders } = await import("../test/render.js");
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

describe("AuditPage", () => {
  test("lists entries newest first with actor, action and target", async () => {
    mockFetch(() =>
      Response.json({ entries: [USER_ENTRY, SITE_SETTINGS_ENTRY] }),
    );

    renderWithProviders(<AuditPage />, { route: "/admin/audit" });

    expect(
      await screen.findByText(/System · disabled · User Deleted user/),
    ).toBeTruthy();
    expect(
      screen.getByText(/admin@example\.com · updated · Site settings/),
    ).toBeTruthy();
  });

  test("shows the diff computed from before/after when expanded", async () => {
    mockFetch(() => Response.json({ entries: [SITE_SETTINGS_ENTRY] }));

    renderWithProviders(<AuditPage />, { route: "/admin/audit" });

    const summary = await screen.findByText(
      /admin@example\.com · updated · Site settings/,
    );
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(summary);

    expect(screen.getByText("Old title")).toBeTruthy();
    expect(screen.getByText("New title")).toBeTruthy();
  });

  test("hides unchanged fields until asked", async () => {
    mockFetch(() =>
      Response.json({
        entries: [
          {
            ...SITE_SETTINGS_ENTRY,
            before: { title: "Old title", theme: "dark" },
            after: { title: "New title", theme: "dark" },
          },
        ],
      }),
    );

    renderWithProviders(<AuditPage />, { route: "/admin/audit" });

    const summary = await screen.findByText(
      /admin@example\.com · updated · Site settings/,
    );
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(summary);

    expect(screen.getByText("Old title")).toBeTruthy();
    expect(screen.queryByText("dark")).toBeNull();

    await userEvent.click(screen.getByText("Show 1 unchanged fields"));
    expect(screen.getAllByText("dark").length).toBeGreaterThan(0);
  });

  test("a Deleted user target shows live-looked-up name", async () => {
    mockFetch(() => Response.json({ entries: [USER_ENTRY] }));

    renderWithProviders(<AuditPage />, { route: "/admin/audit" });

    expect(await screen.findByText(/Deleted user/)).toBeTruthy();
  });

  test("reads initial filters from the URL, as a History link would set them", async () => {
    const calls = mockFetch(() => Response.json({ entries: [] }));

    renderWithProviders(<AuditPage />, {
      route: "/admin/audit?targetType=site_settings&targetId=singleton",
    });

    await waitFor(() => {
      expect(calls[0]?.url).toContain("targetType=site_settings");
      expect(calls[0]?.url).toContain("targetId=singleton");
    });
    expect(screen.getByLabelText("Target type").textContent).toContain(
      "Site settings",
    );
  });

  test("a History link shows the Showing History note", async () => {
    mockFetch(() => Response.json({ entries: [USER_ENTRY] }));

    renderWithProviders(<AuditPage />, {
      route: "/admin/audit?targetType=user&targetId=u1",
    });

    expect(
      await screen.findByText("Showing History for User Deleted user"),
    ).toBeTruthy();
    expect(screen.getByText("Show everything")).toBeTruthy();
  });

  test("no entries matching the filters shows a message", async () => {
    mockFetch(() => Response.json({ entries: [] }));

    renderWithProviders(<AuditPage />, { route: "/admin/audit" });

    expect(
      await screen.findByText("No Audit entries match these filters."),
    ).toBeTruthy();
  });

  test("a user target shows the live-looked-up name", async () => {
    mockFetch(() =>
      Response.json({
        entries: [{ ...USER_ENTRY, targetName: "Target Name" }],
      }),
    );

    renderWithProviders(<AuditPage />, { route: "/admin/audit" });

    expect(await screen.findByText(/User Target Name/)).toBeTruthy();
  });

  test("a reload with from= set still filters, and the field shows it", async () => {
    const iso = "2026-01-01T10:00:00.000Z";
    const calls = mockFetch(() => Response.json({ entries: [] }));

    renderWithProviders(<AuditPage />, {
      route: `/admin/audit?from=${encodeURIComponent(iso)}`,
    });

    await waitFor(() => {
      expect(calls[0]?.url).toContain(`from=${encodeURIComponent(iso)}`);
    });

    const date = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    const expectedLocalValue = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe(
      expectedLocalValue,
    );
  });

  test("a bad from= in the URL is skipped instead of crashing the page", async () => {
    const calls = mockFetch(() => Response.json({ entries: [] }));

    renderWithProviders(<AuditPage />, {
      route: "/admin/audit?from=not-a-date",
    });

    await screen.findByText("No Audit entries match these filters.");
    expect(calls[0]?.url).not.toContain("from=");
  });

  test("Load older fetches the next page with a keyset cursor and appends", async () => {
    const calls = mockFetch((call) => {
      if (!call.url.includes("beforeCreatedAt")) {
        return Response.json({ entries: [USER_ENTRY], hasMore: true });
      }
      return Response.json({
        entries: [SITE_SETTINGS_ENTRY],
        hasMore: false,
      });
    });

    renderWithProviders(<AuditPage />, { route: "/admin/audit" });

    await screen.findByText(/System · disabled · User Deleted user/);
    const loadOlder = screen.getByText("Load older");

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(loadOlder);

    expect(
      await screen.findByText(/admin@example\.com · updated · Site settings/),
    ).toBeTruthy();
    expect(screen.queryByText("Load older")).toBeNull();
    expect(screen.getByText("That's everything.")).toBeTruthy();
    const secondCall = calls[1];
    expect(secondCall?.url).toContain(
      `beforeCreatedAt=${encodeURIComponent(USER_ENTRY.createdAt)}`,
    );
    expect(secondCall?.url).toContain(`beforeId=${USER_ENTRY.id}`);
  });

  test("an expanded entry shows where the change was made from, with a link to that request's Logs", async () => {
    mockFetch(() =>
      Response.json({
        entries: [
          {
            ...SITE_SETTINGS_ENTRY,
            actorIp: "192.168.1.23",
            actorUserAgent: "Mozilla/5.0 (X11; Linux x86_64)",
            actorRequestId: "req-42",
          },
        ],
      }),
    );

    renderWithProviders(<AuditPage />, { route: "/admin/audit" });

    const summary = await screen.findByText(
      /admin@example\.com · updated · Site settings/,
    );
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(summary);

    expect(screen.getByText("192.168.1.23")).toBeTruthy();
    expect(screen.getByText("Mozilla/5.0 (X11; Linux x86_64)")).toBeTruthy();
    const link = screen.getByRole("link", { name: "req-42" });
    expect(link.getAttribute("href")).toBe("/admin/logs?requestId=req-42");
  });

  test("navigating to the unfiltered Audit link refetches without the old filter", async () => {
    const calls = mockFetch(() => Response.json({ entries: [] }));

    renderWithProviders(null, {
      route: "/admin/audit?targetType=backend&targetId=b1",
      routes: [
        {
          path: "/admin/audit",
          element: (
            <>
              <Link to="/admin/audit">Audit</Link>
              <AuditPage />
            </>
          ),
        },
      ],
    });

    await waitFor(() => {
      expect(calls[0]?.url).toContain("targetType=backend");
    });

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("link", { name: "Audit" }));

    await waitFor(() => {
      expect(calls[1]?.url).not.toContain("targetType");
    });
    expect(screen.getByLabelText("Target type").textContent).toContain("Any");
  });
});
